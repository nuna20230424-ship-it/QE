#!/bin/bash
# 맥미니(dqa@172.16.3.136:3001) 배포 스크립트 — 로컬에서 stdin으로 넘겨 실행한다
#   ssh dqa@172.16.3.136 bash -s < scripts/deploy-macmini.sh
#
# 안전 원칙
#   - data.db 백업을 먼저 하고, 실패하면 즉시 중단한다
#   - git reset --hard / checkout -- . 같은 파괴적 명령은 쓰지 않는다
#   - 손댄 추적 파일이 있으면 덮어쓰지 않고 멈춘다 (사람이 확인할 몫)
#   - 어느 단계에서 멈춰도 기존 서비스는 그대로 살아 있다 (재기동은 마지막)
set -euo pipefail

REMOTE_URL_MATCH="nuna20230424-ship-it/QE"
PORT=3001
FALLBACK_DIR="$HOME/cert-schedule-dashboard"

say() { printf '\n=== %s ===\n' "$1"; }
die() { printf '\n[중단] %s\n' "$1" >&2; exit 1; }

# ---- 1. 배포 폴더 찾기 ----
say "1. 배포 폴더 확인"
APP_DIR=""
PID="$(lsof -ti:"$PORT" 2>/dev/null | head -1 || true)"
if [ -n "$PID" ]; then
  APP_DIR="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1 || true)"
fi
[ -z "$APP_DIR" ] && [ -d "$FALLBACK_DIR" ] && APP_DIR="$FALLBACK_DIR"
[ -z "$APP_DIR" ] && die "배포 폴더를 찾지 못했습니다. lsof -i :$PORT 로 직접 확인하세요."
cd "$APP_DIR"
echo "폴더: $(pwd)"
echo "PID : ${PID:-(실행 중인 프로세스 없음)}"

[ -d .git ] || die "여기는 git 저장소가 아닙니다: $(pwd)"
git remote -v | grep -q "$REMOTE_URL_MATCH" || die "remote가 $REMOTE_URL_MATCH 가 아닙니다. 폴더를 다시 확인하세요."
echo "remote: $(git remote get-url origin)"

# ---- 2. 운영 DB 백업 (생략 금지) ----
say "2. data.db 백업"
if [ -f data.db ]; then
  BACKUP="$HOME/data.db.bak-$(date +%Y%m%d-%H%M%S)"
  cp data.db "$BACKUP"
  [ -f "$BACKUP" ] || die "백업 파일이 생성되지 않았습니다."
  echo "백업: $BACKUP ($(du -h "$BACKUP" | cut -f1))"
else
  echo "data.db 없음 — 첫 배포로 보고 계속합니다."
fi

# ---- 3. 로컬 변경 확인 ----
say "3. 로컬 변경 확인"
BRANCH="$(git branch --show-current)"
echo "브랜치: $BRANCH"
[ "$BRANCH" = "main" ] || die "main이 아닙니다($BRANCH). 브랜치를 확인하고 사람이 판단하세요."

DIRTY="$(git status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY"
  die "추적 파일이 수정돼 있습니다. 왜 바뀐 건지 확인한 뒤 다시 실행하세요(덮어쓰지 않습니다)."
fi
echo "손댄 추적 파일 없음 (config.json·data.db는 .gitignore 대상이라 영향 없음)"
echo "현재: $(git log --oneline -1)"

# ---- 4. 코드 갱신 ----
say "4. git pull origin main"
git fetch origin
BEFORE="$(git rev-parse HEAD)"
git pull --ff-only origin main
AFTER="$(git rev-parse HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "이미 최신입니다 ($AFTER)"
else
  echo "갱신: $BEFORE → $AFTER"
  git log --oneline "$BEFORE..$AFTER" | sed 's/^/  /'
fi

# ---- 5. 의존성 ----
say "5. npm install"
# better-sqlite3는 네이티브 모듈이라 이 기계에서 빌드돼야 한다. 오래 걸리면 소스 빌드 중이다.
npm install --no-audit --no-fund

# ---- 6. 재기동 ----
say "6. 서버 재기동"
if launchctl list 2>/dev/null | grep -q "com.qa.cert-dashboard"; then
  echo "launchd 관리 중 → stop/start"
  launchctl stop com.qa.cert-dashboard || true
  sleep 2
  launchctl start com.qa.cert-dashboard
else
  echo "launchd 미설정 → nohup 재기동"
  CUR_PID="$(lsof -ti:"$PORT" 2>/dev/null | head -1 || true)"
  if [ -n "$CUR_PID" ]; then
    echo "기존 프로세스 종료: $CUR_PID"
    kill "$CUR_PID" || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      lsof -ti:"$PORT" >/dev/null 2>&1 || break
      sleep 1
    done
    lsof -ti:"$PORT" >/dev/null 2>&1 && die "포트 $PORT 가 해제되지 않았습니다. 수동으로 확인하세요."
  fi
  # stdin/stdout/stderr를 모두 떼어내야 SSH 세션이 종료될 때 함께 죽지 않는다
  PORT="$PORT" HOST=0.0.0.0 nohup npm start > server.log 2>&1 < /dev/null &
  disown || true
fi

# ---- 7. 기동 검증 ----
say "7. 기동 검증"
OK=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/resources" || true)"
  if [ "$CODE" = "200" ]; then OK=1; break; fi
done
if [ "$OK" != "1" ]; then
  echo "--- server.log 마지막 30줄 ---"
  tail -30 server.log 2>/dev/null || true
  die "/api/resources 가 200을 돌려주지 않습니다. 위 로그를 확인하세요."
fi

echo "/api/resources        → 200 (신규 API 반영됨)"
printf '/api/next-round 검증  → %s (cert_type 없이 호출 시 400이어야 정상)\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/next-round?model_name=x" || true)"
printf '/api/stats            → %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/stats" || true)"
printf '/api/cert-stats       → %s\n' \
  "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/cert-stats" || true)"
echo "실행 중 PID: $(lsof -ti:"$PORT" 2>/dev/null | head -1 || echo '(확인 실패)')"
grep -m1 'notify' server.log 2>/dev/null || true

say "배포 완료"
echo "접속: http://172.16.3.136:$PORT"
echo "되돌리려면: git log --oneline -5 로 이전 커밋을 확인하고 git checkout <커밋> 후 5~6단계를 다시 실행하세요."
echo "데이터가 꼬였을 때만 백업본을 되돌립니다: cp \$HOME/data.db.bak-<타임스탬프> data.db"
