#!/bin/bash
# Ubuntu 운영 서버(172.16.5.102:3001) 첫 설치·재배포 스크립트 — 서버 터미널에서 직접 실행한다
#   첫 설치 (GitHub 접근 가능):  bash deploy-ubuntu.sh
#   첫 설치 (번들 파일로):       bash deploy-ubuntu.sh ~/qe.bundle
#   재배포:                      같은 명령을 다시 실행 (번들을 주면 번들에서, 아니면 GitHub에서 갱신)
#
# 안전 원칙
#   - 필요한 프로그램(node·git)을 자동 설치하지 않는다. 없으면 설치 명령을 보여 주고 멈춘다
#   - data.db 백업을 먼저 하고, 실패하면 즉시 중단한다
#   - git reset --hard / checkout -- . 같은 파괴적 명령은 쓰지 않는다
#   - 손댄 추적 파일이 있으면 덮어쓰지 않고 멈춘다 (사람이 확인할 몫)
#   - config.json·.env·data.db 는 만들지도 덮지도 않는다 (서버마다 사람이 둔다)
set -euo pipefail

REPO_URL="https://github.com/nuna20230424-ship-it/QE.git"
APP_DIR="${APP_DIR:-$HOME/cert-schedule-dashboard}"
PORT=3001
SERVICE=qe-dashboard
BUNDLE="${1:-}"

say() { printf '\n=== %s ===\n' "$1"; }
die() { printf '\n[중단] %s\n' "$1" >&2; exit 1; }

# sudo bash 로 돌리면 root 홈에 root 소유로 깔리고 서비스도 root 로 돈다 — 일반 계정으로 실행하고 sudo 는 스크립트가 필요할 때만 쓴다
[ "$(id -u)" -ne 0 ] || die "root 로 실행하지 마세요. 일반 계정으로 bash deploy-ubuntu.sh 를 실행하면 필요한 곳에서만 sudo 비밀번호를 묻습니다."
[ -z "$BUNDLE" ] || [ -f "$BUNDLE" ] || die "번들 파일이 없습니다: $BUNDLE"
[ -z "$BUNDLE" ] || BUNDLE="$(cd "$(dirname "$BUNDLE")" && pwd)/$(basename "$BUNDLE")"

# ---- 1. 필요한 프로그램 확인 ----
say "1. 필요한 프로그램 확인"
command -v git >/dev/null || die "git 이 없습니다. 설치: sudo apt update && sudo apt install -y git"
command -v node >/dev/null || die "node 가 없습니다. DEPLOY-UBUNTU.md 의 '1. Node.js 설치'를 따르세요."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node $(node -v) 는 너무 낮습니다. 18 이상이 필요합니다."
command -v curl >/dev/null || die "curl 이 없습니다. 설치: sudo apt install -y curl"
echo "node $(node -v) · npm $(npm -v) · $(git --version)"

# ---- 2. 코드 받기 / 갱신 ----
if [ ! -d "$APP_DIR" ]; then
  say "2. 첫 설치 — 코드 받기"
  if [ -n "$BUNDLE" ]; then
    git clone -b main "$BUNDLE" "$APP_DIR"
    git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  else
    git clone -b main "$REPO_URL" "$APP_DIR"
  fi
  cd "$APP_DIR"
else
  cd "$APP_DIR"
  [ -d .git ] || die "여기는 git 저장소가 아닙니다: $(pwd)"

  say "2. data.db 백업"
  if [ -f data.db ]; then
    BACKUP="$HOME/data.db.bak-$(date +%Y%m%d-%H%M%S)"
    cp data.db "$BACKUP"
    [ -f "$BACKUP" ] || die "백업 파일이 생성되지 않았습니다."
    echo "백업: $BACKUP ($(du -h "$BACKUP" | cut -f1))"
  else
    echo "data.db 없음 — 백업할 것이 없습니다."
  fi

  say "2-1. 로컬 변경 확인"
  BRANCH="$(git branch --show-current)"
  [ "$BRANCH" = "main" ] || die "main이 아닙니다($BRANCH). 브랜치를 확인하고 사람이 판단하세요."
  DIRTY="$(git status --porcelain --untracked-files=no)"
  if [ -n "$DIRTY" ]; then
    printf '%s\n' "$DIRTY"
    die "추적 파일이 수정돼 있습니다. 왜 바뀐 건지 확인한 뒤 다시 실행하세요(덮어쓰지 않습니다)."
  fi

  say "2-2. 코드 갱신"
  BEFORE="$(git rev-parse HEAD)"
  if [ -n "$BUNDLE" ]; then
    git pull --ff-only "$BUNDLE" main
  else
    git pull --ff-only origin main
  fi
  AFTER="$(git rev-parse HEAD)"
  if [ "$BEFORE" = "$AFTER" ]; then
    echo "이미 최신입니다 ($AFTER)"
  else
    git log --oneline "$BEFORE..$AFTER" | sed 's/^/  /'
  fi
fi
echo "폴더: $(pwd)"
echo "현재: $(git log --oneline -1)"

# ---- 3. 의존성 ----
say "3. npm ci"
# better-sqlite3는 네이티브 모듈이다. 미리 빌드된 바이너리가 없는 node 버전(2026-09 확인: 24)이면
# 소스 빌드로 넘어가고, 그때 make·g++ 가 없으면 실패한다
npm ci --omit=dev --no-audit --no-fund   || die "npm ci 실패. 'not found: make' 가 보이면 sudo apt install -y build-essential python3 후 다시 실행하세요 (node $(node -v))."

# ---- 4. 서버별 파일 확인 (만들지 않는다) ----
say "4. 서버별 파일 확인"
if [ -f config.json ]; then
  node -e "JSON.parse(require('fs').readFileSync('config.json','utf8'))" \
    || die "config.json 문법 오류입니다. 고친 뒤 다시 실행하세요."
  grep -q '172\.16\.5\.102' config.json || echo "[주의] config.json 의 baseUrl 이 http://172.16.5.102:3001 이 아닙니다."
  echo "config.json 있음 → 메일 발송 켜짐 (매일 18:00 보고)"
else
  echo "config.json 없음 → 메일 발송 꺼진 채로 뜹니다."
fi
[ -f .env ] && echo ".env 있음 (Confluence PAT)" || echo ".env 없음 → Confluence 동기화 꺼짐"
[ -f data.db ] && echo "data.db 있음" || echo "[주의] data.db 없음 → 빈 DB로 시작합니다. 옮겨 올 데이터가 있으면 서비스 시작 전에 넣으세요."

# ---- 5. systemd 서비스 ----
say "5. systemd 서비스 ($SERVICE)"
UNIT="/etc/systemd/system/$SERVICE.service"
if [ ! -f "$UNIT" ]; then
  echo "서비스 파일을 만듭니다 (sudo 비밀번호를 물을 수 있음): $UNIT"
  # TZ 고정: 보고 메일 시각(18:00 등)을 서버 로컬 시각으로 계산하므로 UTC 서버면 새벽 3시에 나간다
  sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=QE 인증 일정 대시보드
After=network-online.target
Wants=network-online.target

[Service]
User=$(id -un)
WorkingDirectory=$APP_DIR
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
Environment=TZ=Asia/Seoul
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5
StandardOutput=append:$APP_DIR/server.log
StandardError=append:$APP_DIR/server.log

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable "$SERVICE"
fi
# 로그 파일을 먼저 만들어 둔다 — 없으면 systemd 가 root 소유로 만들어 계정에서 비우거나 옮길 수 없다
touch server.log
sudo systemctl restart "$SERVICE"

if command -v ufw >/dev/null; then
  UFW="$(sudo ufw status 2>/dev/null || true)"
  if printf '%s
' "$UFW" | grep -q "Status: active"; then
    if printf '%s
' "$UFW" | grep -q "^$PORT/tcp"; then
      echo "방화벽(ufw): $PORT/tcp 이미 허용됨"
    else
      echo "방화벽(ufw)에 $PORT/tcp 허용 추가"
      sudo ufw allow "$PORT/tcp"
    fi
  else
    echo "방화벽(ufw) 꺼져 있음 — 추가 설정 없음"
  fi
fi

# ---- 6. 기동 검증 ----
say "6. 기동 검증"
OK=0
for _ in $(seq 1 15); do
  sleep 1
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/resources" || true)"
  if [ "$CODE" = "200" ]; then OK=1; break; fi
done
if [ "$OK" != "1" ]; then
  echo "--- server.log 마지막 30줄 ---"
  tail -30 server.log 2>/dev/null || true
  sudo systemctl status "$SERVICE" --no-pager || true
  die "/api/resources 가 200을 돌려주지 않습니다. 위 로그를 확인하세요."
fi
echo "/api/resources → 200"
grep 'notify' server.log 2>/dev/null | tail -1 || true

say "배포 완료"
echo "접속: http://172.16.5.102:$PORT"
echo "로그: tail -f $APP_DIR/server.log · 상태: systemctl status $SERVICE"
