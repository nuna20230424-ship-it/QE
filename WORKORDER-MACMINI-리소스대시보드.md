# [작업지시서] Mac Mini 재배포 — QE 리소스 대시보드 (2026-08-28)

**대상 서버:** `dqa@172.16.3.136` · 포트 `3001` · 접속 `http://172.16.3.136:3001`
**배포 커밋:** `a096939` (main) — `Merge pull request #4` 포함
**실행 주체:** **사람이 직접.** Claude는 이 서버에 SSH 키가 없어 비대화형 접속이 거부된다(`Permission denied (publickey,password,keyboard-interactive)`). 대신 **6번 배포 검증은 Claude가 HTTP로 대신 확인**할 수 있다.

> ⚠️ 개발 PC와 포트가 같다(3001). 아래 명령은 **전부 Mac Mini 터미널**에서 실행한다.

---

## 배경 — 이번에 배포되는 것

작업지시서 v5의 **Task 6(QE 전체 리소스 현황)** 과 이후 5차례 보완이 `main`에 병합됐다(PR #4, 9커밋).

| 항목 | 내용 |
|------|------|
| 신규 메뉴 | `QE 리소스` 탭 — 위젯 5종 (가동률·팀원 부하도·파이프라인·인증타입 점유·스마트 알림) |
| 메인 변경 | 현황 보드 상단에 **실시간 리소스 가동률**만 노출 (클릭 시 탭 이동) |
| 신규 API | `GET /api/resources` (`?as_of=`, `?days=`) |
| 신규 파일 | `holidays.js` · `resources.js` · `scripts/deploy-macmini.sh` |
| 의뢰 폼 | 진행/결과 영역에 **`잔여 slot`** 입력 필드 추가 |
| **DB 스키마** | `requests.remaining_slots` 컬럼 추가 — **기동 시 자동 마이그레이션**(`ALTER TABLE ADD COLUMN`) |
| 버그 수정 | 날짜를 UTC로 계산해 **KST 00:00~09:00에 하루 뒤처지던 문제** (가동률·지연판정·장기미판정 3곳) |

새로 추가된 npm 패키지는 없다. 검증은 `npm test` **385건 통과**, 라이브 E2E 107건 통과.

---

## 방법 A — 스크립트 한 줄 (권장)

**개발 PC에서** 아래를 실행한다. 저장소에 포함된 배포 스크립트를 SSH stdin으로 넘긴다.

```bash
ssh dqa@172.16.3.136 bash -s < scripts/deploy-macmini.sh
```

스크립트가 순서대로 하는 일이다.

1. `lsof`로 배포 폴더를 찾고 **remote가 `nuna20230424-ship-it/QE` 인지 확인**
2. **`data.db` → `~/data.db.bak-<타임스탬프>` 백업** (실패하면 즉시 중단)
3. 브랜치가 `main` 인지, **손댄 추적 파일이 없는지** 확인 — 있으면 덮어쓰지 않고 멈춘다
4. `git pull --ff-only origin main` → `npm install`
5. launchd가 있으면 `stop`/`start`, 없으면 기존 PID 종료 후 `nohup` 재기동
6. `/api/resources` 가 200을 줄 때까지 15초 폴링 — 실패하면 `server.log` 마지막 30줄을 찍고 중단

**`git reset --hard` 나 `checkout -- .` 같은 파괴적 명령은 들어 있지 않다.** 재기동이 마지막 단계라 어느 지점에서 멈춰도 기존 서비스는 그대로 살아 있다.

스크립트가 중단되면 그 메시지를 그대로 알려주면 된다. 아래 방법 B로 넘어가 단계별로 확인해도 좋다.

---

## 방법 B — 수동 절차

스크립트가 막혔을 때, 또는 단계마다 눈으로 확인하고 싶을 때 쓴다.

### 1. 배포 폴더로 이동

```bash
lsof -i :3001                              # 실행 중인 node 프로세스 PID
lsof -a -p <위 PID> -d cwd -Fn             # 그 프로세스의 작업 디렉터리
cd <위에서 찾은 경로>                       # 보통 ~/cert-schedule-dashboard
pwd
git remote -v                              # nuna20230424-ship-it/QE.git 인지 확인
```

### 2. 사전 백업 (필수, 생략 금지)

운영 DB(`data.db`)에는 실제 인증 의뢰 데이터가 들어 있다. `git pull`은 `data.db`를 건드리지 않지만(`.gitignore` 대상), 사람 실수 대비로 한 번 더 복사한다.

```bash
cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)
ls -lh ~/data.db.bak-*
```

### 3. 현재 상태 확인

```bash
git branch --show-current                  # main 이어야 한다
git status --porcelain --untracked-files=no # 아무것도 안 나와야 한다
git log --oneline -3
```

- **`git status`에 뭔가 나오면 여기서 멈춘다.** `config.json`·`data.db`·`server.log`는 `.gitignore` 대상이라 애초에 안 나온다. 그 외 파일이 나오면 **왜 바뀐 건지 확인이 먼저다.** `git checkout -- .` 나 `git reset --hard` 로 지우지 말고 알려준다.
- 브랜치가 `main`이 아니면 멈추고 알려준다.

### 4. 코드 갱신

```bash
git fetch origin
git pull --ff-only origin main
git log --oneline -3
```

pull 후 최상단에 아래가 보이면 정상이다.

```
a096939 셸 스크립트 줄바꿈을 LF로 고정
fef00fd 맥미니 배포 스크립트 추가
5819610 Merge pull request #4 from nuna20230424-ship-it/feat/qe-resource-dashboard
```

`--ff-only`가 거부되면 로컬에 별도 커밋이 있다는 뜻이다. 강제로 밀지 말고 알려준다.

### 5. 의존성 설치

```bash
npm install --no-audit --no-fund
```

- **새 패키지는 추가되지 않았다.** 오래 걸리면 `better-sqlite3`(네이티브 모듈)가 소스 빌드로 넘어간 것이니 기다리면 된다.

### 6. 서버 재기동

**launchd로 상시 구동 중이라면**

```bash
launchctl stop com.qa.cert-dashboard
launchctl start com.qa.cert-dashboard
```

**launchd 미설정이라면 (현재 이쪽일 가능성이 높다)**

```bash
kill <1번에서 확인한 PID>
sleep 2
lsof -ti:3001                              # 아무것도 안 나와야 한다
PORT=3001 HOST=0.0.0.0 nohup npm start > server.log 2>&1 < /dev/null &
disown
```

> `< /dev/null` 을 빼면 SSH 세션을 닫을 때 서버가 함께 죽을 수 있다.

**기동 확인**

```bash
tail -f server.log
```

`인증 일정 대시보드 실행 중: http://0.0.0.0:3001` 이 보이면 정상이다. `Ctrl+C` 로 `tail`만 끝낸다(서버는 계속 돈다).

DB 스키마 자동 마이그레이션은 기동 시 조용히 처리된다. 별도 로그는 남지 않으며, 확인하려면 아래를 쓴다.

```bash
sqlite3 data.db "PRAGMA table_info(requests);" | grep remaining_slots
```

---

## 검증

### 배포 반영 신호 (Mac Mini에서 직접)

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/api/resources
```

**`200`** 이 나와야 한다. 배포 전에는 이 엔드포인트가 없어 **404**였다 — 이게 이번 배포가 반영됐다는 가장 확실한 신호다.

```bash
# 회귀 확인 (전부 200)
for p in /api/stats /api/cert-stats /api/bottlenecks /api/options; do
  printf '%s → %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001$p")"
done
# 진행차수 필수 파라미터 검증 (400 이어야 정상)
curl -s -o /dev/null -w 'next-round(cert_type 없이) → %{http_code}\n' \
  'http://127.0.0.1:3001/api/next-round?model_name=x'
```

### Claude가 대신 확인할 수 있는 것

재기동 후 **"확인해줘"** 라고 하면 사내망 HTTP로 위 항목을 대신 점검한다. 알려줄 것은 없고, 재기동만 끝났다고 말해주면 된다.

### (선택) 스모크 테스트

```bash
npm test
```

**385건 전부 PASS**면 정상이다. 임시 DB를 쓰므로 운영 데이터에 영향이 없다.

### 브라우저 육안 확인 (사람이 직접)

`http://172.16.3.136:3001` 접속 후 아래를 본다.

**신규 기능**
- [ ] 탭 목록에 **`QE 리소스`** 가 보인다
- [ ] **현황 보드 상단에 `실시간 리소스 가동률`** 패널이 뜬다 (프로그레스 바 + 잔여 가용 slot 큰 숫자)
- [ ] 그 패널을 클릭하면 `QE 리소스` 탭으로 넘어간다
- [ ] `QE 리소스` 탭에 5개 섹션이 순서대로 보인다 — 가동률 / 팀원별 부하도(신호등) / 파이프라인 / 인증 타입 도넛 / 스마트 알림
- [ ] 팀원별 부하도에 4명(이은경·조아라·이해찬·문유림)이 모두 나오고, 초과자는 빨간 점이다
- [ ] 인증 타입 도넛이 그려진다 (외부 라이브러리 없이 SVG)
- [ ] `일별 가용 현황` 표에서 주 소계와 날짜별 여유 인원이 보인다
- [ ] 담당자 행의 `건별 상세`를 펼치면 `계획 / 소화 / 잔여 / 진행률 바`가 나온다
- [ ] 의뢰 상세 모달 진행/결과 영역에 **`잔여 slot`** 입력칸이 있다 (비우면 자동 산출)

**기존 기능 회귀**
- [ ] 의뢰 등록·조회·수정이 평소대로 된다
- [ ] 의뢰요청 모달에서 인증종류·Test type·Test 목적·모델명을 바꿀 때 **진행차수가 자동 산출**된다
- [ ] 일일보고·주간보고·인증 통계 탭이 정상 렌더링된다
- [ ] `📋 본문 복사` 가 동작한다

### 이메일 발송

`config.json`은 `.gitignore` 대상이라 배포 후에도 그대로 유지된다. 서버 로그에서 확인한다.

```bash
grep -m1 notify server.log
```

`[notify] 이메일 알림 활성화` 가 보이면 정상, `config.json 미설정` 이면 발송만 생략되고 앱은 정상 동작한다.

---

## 배포 후 남는 일

### ⚠ 공휴일 상수 검증 — 사람이 해야 한다

영업일 계산에 쓰는 공휴일은 `holidays.js` **코드 상수**다(사내망이라 외부 API를 호출하지 않는다). **음력 기반 공휴일과 대체공휴일은 정부 관보로 확정되는 값이라 Claude가 정확성을 보증할 수 없다.** 요일 정합성은 코드로 확인했지만(대체공휴일 원일 5건 모두 주말, 대체일 모두 월요일) **날짜 자체는 공고와 대조해야 한다.**

특히 확인할 것이다.

| 날짜 | 항목 |
|------|------|
| 2026-02-16 ~ 02-18 | 설 연휴 (설날 2/17) |
| 2026-05-24(일) → 05-25 | 부처님오신날 + 대체공휴일 |
| 2026-09-24 ~ 09-25, 09-28 | 추석 연휴(추석 9/25) + 대체공휴일 |
| 2026-06-03 | 지방선거일 |
| 2026-05-01 | 근로자의날 — **정상 근무라면 `remove` 대상** |

틀린 값이 있으면 코드를 고치지 않고 `config.json`으로 덮어쓴다. **서버 재기동이 필요하다.**

```json
"holidays": {
  "add":    ["2026-11-13"],
  "remove": ["2026-05-01"]
}
```

2027년 이후는 등록돼 있지 않다. 계산이 그 연도로 넘어가면 화면에 "주말만 제외한 값"이라는 경고가 뜬다.

### launchd 상시 구동 (아직 미완)

launchd가 설정돼 있지 않아 **서버가 꺼지거나 재부팅되면 자동으로 살아나지 않는다.** 그러면 자동 보고 메일(일일 18:00 · 주간 금 18:00 · 통계 월 09:00)도 함께 멈춘다. 설정 절차는 `DEPLOY.md` 8번을 따른다.

---

## 문제가 생기면 — 롤백

```bash
git log --oneline -5                       # 되돌릴 커밋 확인
git checkout 5819610~1                     # PR #4 병합 직전
npm install --no-audit --no-fund
# 위 6번과 동일하게 재기동
```

**DB는 되돌리지 않아도 된다.** 이번에 추가된 `remaining_slots` 컬럼은 `ALTER TABLE ADD COLUMN` 으로 붙은 것이라, 코드를 되돌려도 **쓰이지 않는 빈 컬럼으로 남을 뿐 기존 기능에 영향이 없다.**

데이터 자체가 꼬였을 때만 백업본으로 되돌린다.

```bash
lsof -ti:3001 | xargs kill                 # 먼저 서버를 멈춘다
cp ~/data.db.bak-<타임스탬프> data.db
rm -f data.db-wal data.db-shm              # WAL 잔여 파일 제거
# 재기동
```

> `data.db`를 서버가 열고 있는 동안 덮어쓰면 WAL과 어긋난다. **반드시 서버를 먼저 멈춘다.**

---

## 요약 — 최소 경로

```bash
# 개발 PC에서 한 줄
ssh dqa@172.16.3.136 bash -s < scripts/deploy-macmini.sh

# 끝나면 Claude에게 "확인해줘" → HTTP로 검증
# 그 뒤 브라우저에서 위 육안 체크리스트 확인
```
