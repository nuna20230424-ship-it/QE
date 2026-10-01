# Mac Mini 재배포 가이드

> **2026-09-30 운영 서버 이전:** 운영 서버가 Ubuntu PC `172.16.5.102`로 바뀌었다. 새 서버 설치·재배포는 **[DEPLOY-UBUNTU.md](DEPLOY-UBUNTU.md)** 를 따른다. Mac Mini 자체 IP도 2026-10-01 기준 `172.16.5.164`로 바뀌었다(아래 본문의 `172.16.3.136`은 당시 주소). 이 문서는 이전 서버(Mac Mini) 기록으로 남겨 둔다.

QE 인증 일정 대시보드 운영 서버(Mac Mini)를 최신 코드로 업데이트하는 절차. **Claude는 이 서버에 SSH로 접근할 수 없으므로**(비밀키 미등록) 아래 명령을 사용자가 Mac Mini 터미널에서 직접 실행해야 한다. 실행 후 결과를 알려주면 배포 후 점검(6번)은 Claude가 HTTP로 대신 확인할 수 있다.

| 항목 | 값 |
|------|-----|
| 서버 | Mac Mini, 사내 IP `172.16.3.136` |
| 운영 포트 | `3001` |
| 접속 주소 | `http://172.16.3.136:3001` |
| 배포 폴더 | 클론한 경로 (예: `~/cert-schedule-dashboard` 또는 `~/QE`) — 정확한 경로를 모르면 2-2에서 찾는 법 참고 |
| 저장소 | `https://github.com/nuna20230424-ship-it/QE.git` |

> ⚠️ **개발 PC와 포트가 같다(3001).** 아래 명령은 전부 **Mac Mini 터미널**에서 실행한다. 개발 PC의 PowerShell에 붙여넣지 않는다.

---

## 0. 배포 전 — 개발 PC에서 `main`을 먼저 올린다 (사용자가 직접)

운영 서버는 `origin/main`을 pull한다. **push하지 않으면 배포해도 아무것도 바뀌지 않는다.**

> **push는 Claude가 실행하지 않는다.** 개발 PC PowerShell에서 사용자가 직접 친다.

```powershell
cd C:\Users\k251110\Desktop\QE
git log origin/main..HEAD --oneline   # 올라갈 커밋 확인
git push origin main
```

올라갈 게 없으면 이 절은 건너뛴다.

---

## 1. 사전 백업 (필수, 생략 금지)

운영 DB(`data.db`)에는 실제 인증 의뢰 데이터가 들어 있다(2026-08-26 기준 86건). `git pull`은 `data.db`를 건드리지 않지만(`.gitignore` 처리됨), 사람 실수로 지워질 수 있으니 배포 직전에 수동으로 한 번 더 복사해 둔다.

```bash
cd ~/cert-schedule-dashboard   # 실제 배포 폴더로 변경
cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)
ls -la ~/data.db.bak-*         # 백업 파일이 생겼는지 확인
```

---

## 2. 현재 상태 확인

### 2-1. 실행 중인 서버 프로세스 확인
```bash
lsof -i :3001
# 또는
ps aux | grep "node.*server.js"
```
PID를 적어둔다 (5번에서 종료할 때 필요).

### 2-2. 배포 폴더 위치가 기억 안 나면
```bash
lsof -i :3001 -a -c node    # 실행 중인 node 프로세스의 정보
lsof -p <위에서 찾은 PID> | grep cwd   # 작업 디렉터리 확인
```

### 2-3. 현재 돌고 있는 코드가 구버전인지 확인 (선택)
```bash
curl -s http://localhost:3001/api/options
```
`{"error":...}` 나 404가 나오면 신규 엔드포인트가 없는 구버전이 맞다(이번 배포로 해결됨).

---

## 3. 코드 갱신

```bash
cd ~/cert-schedule-dashboard   # 실제 배포 폴더로 변경
git status                     # 로컬에 손댄 파일이 없는지 확인 (있으면 먼저 확인)
git fetch origin
git checkout main
git pull origin main
git log --oneline -1           # 개발 PC의 최신 커밋과 같은지 대조
```

`config.json`·`.env`·`data.db`는 `.gitignore` 대상이라 pull이 건드리지 않는다.

### 로컬에 손댄 파일이 있어 `git pull`이 막히면
`git status`로 뭐가 걸리는지 먼저 확인한다. 왜 바뀌었는지 확인한 뒤 `git stash`로 잠시 치워두고
진행 — 함부로 `git checkout -- .`나 `git reset --hard`로 지우지 않는다.

---

## 4. 의존성 설치

```bash
npm install
```

- `better-sqlite3`는 네이티브 모듈이라 **반드시 Mac Mini에서 직접 `npm install`을 실행**해야 한다. Windows 개발 PC의 `node_modules`를 복사해오면 동작하지 않는다.
- 이번 변경에는 새 패키지가 추가되지 않았다(`package.json`의 `dependencies`는 그대로, `scripts.test`만 추가됨). 설치가 오래 걸리면 `better-sqlite3`가 소스 빌드로 넘어간 것이니 기다리면 된다.

---

## 4-B. Confluence 동기화 켜기 (2026-09-18 갱신 — 값 확정됨)

**설정이 없으면 동기화만 생략되고 앱은 그대로 뜬다.** 코드를 먼저 올리고 여기서 한 번 멈춰
화면을 확인한 뒤 켜는 것을 권한다 — 켜는 순간 운영 DB에 의뢰가 자동 생성되기 때문이다.

> **`.env`와 `config.json`은 `.gitignore` 대상이라 push·pull로 따라가지 않는다.**
> 서버마다 직접 넣어야 한다. Claude는 이 서버에 SSH로 못 들어가므로 이 절은 전부 사람이 실행한다.

### 1) PAT

```bash
cd ~/cert-schedule-dashboard      # 실제 배포 폴더
nano .env
#    CONFLUENCE_PAT=발급받은토큰   ← 한 줄만. Ctrl+O · Enter · Ctrl+X
chmod 600 .env
```

개발 PC와 같은 토큰을 써도 되고 운영용으로 새로 발급해도 된다. **토큰은 채팅·커밋·문서에 넣지 않는다.**

### 2) config.json 에 confluence 블록 추가

기존 내용은 그대로 두고 맨 바깥 `{ }` 안에 아래를 추가한다. 앞 항목 끝에 쉼표가 필요하다.

```json
  "confluence": {
    "baseUrl": "https://confluence.kaonmedia.com",
    "subCalendarId": "eb1bca9b-35c2-4c19-a9bf-1f9532b64b45",
    "timeZone": "Asia/Seoul",
    "pollMinutes": 5,
    "rangeBackDays": 30,
    "rangeAheadDays": 60,
    "fields": {
      "id": "id",
      "title": "title",
      "invitees": "invitees",
      "start": "start",
      "end": "end",
      "relatedPage": "where",
      "created": "start"
    },
    "requesterByModel": {}
  }
```

값의 근거 (2026-09-18 실물 응답으로 확정).

| 키 | 값 | 왜 |
|---|---|---|
| `subCalendarId` | `eb1bca9b-…` | QE 일정 페이지는 캘린더 **둘**을 겹쳐 보여준다. 옛 캘린더 `7d8fff49-…`는 2026-06-04에서 멈췄다 |
| `fields.relatedPage` | `where` | '관련 페이지 / 어디서' → 비고. 63건 중 43건에 있다 |
| `fields.created` | `start` | 이벤트 응답에 **생성일자 키가 없다.** 희망일정을 시작일로 대체(사용자 결정) |

### 3) 쓰기 전에 확인 — 여기까지는 읽기만 한다

```bash
node scripts/pat-check.js          # 계정 이름이 나와야 정상. 200 이어도 Anonymous 면 실패다
node scripts/confluence-diag.js    # [3] 기본(-30/+60) 에 건수가 잡히는지
```

`node -v`가 **18 이상**이어야 한다. 동기화는 내장 `fetch`를 쓴다.

### 4) 운영 DB 백업 후 재기동

```bash
cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)
lsof -i :3001                      # PID
kill <PID>
PORT=3001 HOST=0.0.0.0 nohup npm start > server.log 2>&1 &
disown
tail -20 server.log
```

`[confluence] 5분 주기 동기화 시작`이 보이면 켜진 것이다.
꺼져 있으면 `[confluence] 설정 없음 → 동기화 생략 (…)` 로 무엇이 빠졌는지 알려 준다.

### 5) 켠 뒤 확인 (Claude가 HTTP로 대신 가능)

```
GET http://172.16.3.136:3001/api/confluence/status
```

`configured:true` · `polling:true` · `last` 에 첫 회차 결과(생성·갱신·건너뜀)가 찍힌다.

### 되돌리기

동기화만 끄려면 `.env`를 지우고 재기동한다. 코드는 그대로 두고 조용히 멈춘다.

```bash
rm .env
kill <PID> && PORT=3001 HOST=0.0.0.0 nohup npm start > server.log 2>&1 & disown
```

자동 생성된 의뢰까지 되돌려야 하면 4)에서 뜬 `~/data.db.bak-…`로 복구한다.

### 동기화가 데이터를 다루는 방식 — 미리 알아 둘 것

- **빈 칸만 채운다.** 사람이 입력한 값은 덮지 않는다(`confluence-sync.js` `fillBlanks`).
  예외는 `예약대기` 하나 — 기본값이라 사람이 고른 것으로 보지 않는다.
- **인증종류나 모델명을 못 읽으면 의뢰를 만들지 않는다.** `연차` 같은 비QE 일정이 여기서 걸러진다.
- **같은 이벤트는 다시 만들지 않는다**(`confluence_event_id` 기준). 2회차부터는 `unchanged`다.
- 조회 기간에서 사라진 이벤트는 지우지 않고 `중단`으로 돌린다. 완료·중단 건은 건드리지 않는다.
- 제목 파싱이 규칙으로 못 가르는 것이 남아 있다(`Tivo TMIS KSTB4252` → `Tivo` 등).
  "우선 작성된 기준으로 등록"이 사용자 결정이며, 어긋난 건은 대시보드에서 손으로 고친다.

### 로컬(개발 PC)에서 확인할 때 — 메일 발송 주의

개발 PC에서 서버를 띄우면 `scheduler.start()`가 걸려 **예약 시각에 실제 보고 메일이 나간다.**
차단 스위치는 없다. `config.json`의 `reportTo`를 비우는 것만으로는 부족하다 —
비어 있으면 `notify.js`의 `DEFAULT_REPORT_TO`로 폴백한다.

확실히 끄려면 `smtp` **키 이름을 바꾼다**(값은 그대로 둔다). `loadConfig()`가 `null`을 돌려
발송 경로가 통째로 꺼지고, 기동 로그에 `[notify] config.json 미설정 → 이메일 알림 생략`이 찍힌다.
확인이 끝나면 키 이름을 되돌린다.

---

## 5. 서버 재기동

### launchd로 상시 구동 중이라면
```bash
launchctl stop com.qa.cert-dashboard
launchctl start com.qa.cert-dashboard
```

### launchd 미설정 상태(현재 상태 — 아직 안 돼 있음)라면
1번에서 찾은 PID로 기존 프로세스를 종료하고 새로 띄운다.
```bash
kill <PID>                                  # 2-1에서 확인한 PID
cd ~/cert-schedule-dashboard
PORT=3001 HOST=0.0.0.0 nohup npm start > server.log 2>&1 &
disown
```
`nohup ... &`로 띄워야 터미널을 닫아도 서버가 살아있다. 다만 **Mac Mini가 재부팅되면 이 방식은 자동으로 다시 켜지지 않는다** — 재발방지책은 8번 참고.

### 기동 확인
```bash
tail -f server.log
```
`인증 일정 대시보드 실행 중: http://0.0.0.0:3001`이 보이면 정상. `backup.start()`, `scheduler.start()`도 이어서 호출되므로 에러 없이 조용하면 된다. `Ctrl+C`로 tail 종료(서버는 계속 돈다).

---

## 6. 배포 검증

### 6-1. API 확인 (Claude가 대신 확인 가능 — 사내망 HTTP는 PowerShell로 접근)
아래 세 엔드포인트가 200을 반환해야 이번 배포가 제대로 적용된 것이다 (구버전은 404).
```
GET http://172.16.3.136:3001/api/options
GET http://172.16.3.136:3001/api/next-round?model_name=x&cert_type=Netflix%20NTS
GET http://172.16.3.136:3001/api/bottlenecks
```
`next-round`는 `model_name`·`cert_type` 없이 호출하면 400이 정상이다(이번 Task 0 수정으로 `cert_type`도 필수가 됐다).

이번(2026-09-14) 인증 통계 수정이 올라갔는지는 응답에 `rounds` 필드가 생겼는지로 본다. 배포 전에는 없다.
```powershell
$r = Invoke-WebRequest "http://172.16.3.136:3001/api/cert-stats?from=2026-09-07&to=2026-09-11" -UseBasicParsing
$r.Content.Contains('"rounds"')     # True 면 반영됨
```

Confluence 동기화를 켰다면 상태도 함께 본다 (4-B 5번).
```
GET http://172.16.3.136:3001/api/confluence/status
```

### 6-2. 브라우저 육안 확인 (사람이 직접, `checklist.md` 10차 항목)
`http://172.16.3.136:3001` 접속 후:
- [ ] 의뢰요청 모달에서 모델명 입력 시 과거 이력이 드롭다운으로 뜨는지
- [ ] 인증종류·Test type·Test 목적·모델명을 바꿀 때마다 진행차수가 다시 자동 산출되는지 (스피너 → 값 채워짐)
- [ ] 진행차수 옆 ⓘ 클릭 시 이전 차수 타임라인이 뜨는지
- [ ] 인증 통계 탭의 `결과` 컬럼이 Pass=파란 볼드 / Fail=빨간 음영으로 보이는지
- [ ] (2026-09-14) 인증 통계 주간 `9/7~9/11` → `LG U+_UHD5KG / Netflix NTS`가 **두 행**으로 서는지
      `Fail 2026-09-07 Pre-Test 2차 0 1 0% 100%` / `Pass 2026-09-11 Pre-Test 3차 1 0 100% 0%`
- [ ] (2026-09-14) 같은 화면에서 `⤓ 엑셀 다운로드` → CSV도 차수마다 행이 갈렸는지 (`동일 차수 판정 내역` 컬럼은 보통 비어 있는 게 정상)
- [ ] (2026-09-14) `📋 본문 복사` → **Outlook 데스크톱** 본문에 붙여넣어 차수별 행이 그대로 오는지 (Word 렌더러라 사내망 http + Outlook 조합으로만 검증된다)
- [ ] 현황 보드 상단에 병목 경고 위젯이 뜨는지(대상 없으면 안 뜨는 게 정상)
- [ ] 기존 의뢰 등록·조회·일일보고·주간보고가 평소대로 동작하는지 (회귀 확인)

### 6-3. (선택) Mac Mini에서 스모크 테스트
```bash
npm test
```
646건 전부 PASS면 정상. `data.db`가 아니라 임시 DB를 쓰므로 운영 데이터에 영향 없다.

---

## 7. 이메일 발송 확인

`config.json`이 이미 있다면 배포 후에도 그대로 유지된다(git이 건드리지 않음). 서버 로그에 `[notify] 이메일 알림 활성화`가 보이는지 확인. 없다면 SMTP 미설정 상태로, 앱은 정상 동작하되 메일 발송만 조용히 생략된다(`README.md`의 "이메일 알림 설정" 참고).

---

## 8. (권장, 아직 미완) 상시 구동 — launchd 설정

지금은 `nohup`으로만 띄운 상태라 **Mac Mini가 재부팅되거나 서버가 죽으면 자동 보고 메일이 에러 없이 조용히 끊긴다.** 아직 이 설정을 안 했다면 `README.md`의 "상시 구동(launchd 권장)" 절을 따라 `~/Library/LaunchAgents/com.qa.cert-dashboard.plist`를 만들고 `launchctl load`한다. 한 번 해두면 이후 재배포는 5번의 "launchd로 상시 구동 중이라면" 경로로 더 간단해진다.

---

## 9. 문제가 생기면 — 롤백

```bash
cd ~/cert-schedule-dashboard
git log --oneline -5          # 되돌릴 커밋 확인
git checkout <이전 커밋 또는 main>
npm install
cp ~/data.db.bak-<타임스탬프> data.db   # 1번 백업이 필요한 경우에만 (스키마 자동 보강이라 보통 불필요)
# 5번과 동일하게 재기동
```
`data.db`는 새 컬럼이 없으면 `db.js`가 기동 시 자동으로 `ALTER TABLE`로 보강하므로, 코드만 롤백해도 대부분 문제없다. 데이터 자체가 꼬였을 때만 백업본으로 되돌린다.

---

## 부록 — 자주 헷갈리는 점
- **개발 PC도 포트 3001을 쓴다.** "3001 서버 재시작" 요청을 받으면 Mac Mini인지 개발 PC인지 먼저 확인한다.
- **Claude는 이 서버에 SSH로 못 들어간다.** 배포 명령은 사람이 직접 실행하고, 결과(로그 출력, 에러 메시지)를 붙여넣어 주면 다음 단계를 안내할 수 있다.
- **Bash 도구는 맥미니(`172.16.3.136`)에 못 닿는다.** Claude가 운영 서버를 확인할 때는 PowerShell의 `Invoke-WebRequest`를 쓴다. 다만 `confluence.kaonmedia.com`은 Bash에서도 닿아서, Confluence 진단 스크립트(`scripts/pat-check.js` 등)는 개발 PC에서 Claude가 직접 돌릴 수 있다.
- **`config.json`과 `.env`는 서버마다 따로다.** `.gitignore` 대상이라 push·pull로 옮겨지지 않는다. 맥미니에 새 설정이 필요하면 항상 4-B를 다시 본다.
- **QE 일정 페이지는 캘린더가 두 개 겹쳐 있다.** 개발자도구에서 `events.json` 요청을 하나만 보고 판단하면 안 된다. 자세한 건 `doc/CONFLUENCE-PROBE-실행가이드.md` 3단계.
