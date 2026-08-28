# Mac Mini 재배포 가이드

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

## 0. 배포 전 판단이 필요한 것 — 어느 브랜치를 배포할지

지금 배포해야 할 변경사항은 전부 `feat/cert-stats-and-round-display` 브랜치에 있고, `main`으로 합치는 **PR #2가 아직 미병합(OPEN)** 상태다. 운영 서버는 현재 옛날 `main`(PR #2 이전)을 돌리고 있다.

- **A안 (권장) — PR을 먼저 병합하고 `main`을 배포한다.** 운영 서버가 항상 `main`만 보면 되므로 이후 재배포가 단순해진다. GitHub에서 PR #2를 병합한 뒤 아래 3번에서 `main`을 pull한다.
- **B안 — PR 병합 전에 `feat/cert-stats-and-round-display`를 바로 배포한다.** 병합 검토가 더 필요하거나 먼저 운영 데이터로 확인해보고 싶을 때. 아래 3번에서 이 브랜치를 checkout한다.

이 문서는 두 경우 모두의 명령을 적어뒀다. **어느 쪽으로 할지 먼저 정하고 시작할 것.**

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

### 공통
```bash
cd ~/cert-schedule-dashboard   # 실제 배포 폴더로 변경
git status                     # 로컬에 손댄 파일이 없는지 확인 (있으면 먼저 사용자에게 확인)
git fetch origin
```

### A안 — `main` 배포 (PR #2 병합 후)
```bash
git checkout main
git pull origin main
```

### B안 — 기능 브랜치 직접 배포 (PR #2 병합 전)
```bash
git checkout feat/cert-stats-and-round-display
git pull origin feat/cert-stats-and-round-display
```

### 로컬에 손댄 파일이 있어 `git pull`이 막히면
`git status`로 뭐가 걸리는지 먼저 확인한다. Mac Mini에서 직접 설정 파일(`config.json`)을 만들었다면 그건 `.gitignore` 대상이라 문제되지 않는다. 그 외 파일이 걸리면 왜 바뀌었는지 확인한 뒤 `git stash`로 잠시 치워두고 진행 — 함부로 `git checkout -- .`나 `git reset --hard`로 지우지 않는다.

---

## 4. 의존성 설치

```bash
npm install
```

- `better-sqlite3`는 네이티브 모듈이라 **반드시 Mac Mini에서 직접 `npm install`을 실행**해야 한다. Windows 개발 PC의 `node_modules`를 복사해오면 동작하지 않는다.
- 이번 변경에는 새 패키지가 추가되지 않았다(`package.json`의 `dependencies`는 그대로, `scripts.test`만 추가됨). 설치가 오래 걸리면 `better-sqlite3`가 소스 빌드로 넘어간 것이니 기다리면 된다.

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

### 6-2. 브라우저 육안 확인 (사람이 직접, `checklist.md` 10차 항목)
`http://172.16.3.136:3001` 접속 후:
- [ ] 의뢰요청 모달에서 모델명 입력 시 과거 이력이 드롭다운으로 뜨는지
- [ ] 인증종류·Test type·Test 목적·모델명을 바꿀 때마다 진행차수가 다시 자동 산출되는지 (스피너 → 값 채워짐)
- [ ] 진행차수 옆 ⓘ 클릭 시 이전 차수 타임라인이 뜨는지
- [ ] 인증 통계 탭의 `결과` 컬럼이 Pass=파란 볼드 / Fail=빨간 음영으로 보이는지
- [ ] 현황 보드 상단에 병목 경고 위젯이 뜨는지(대상 없으면 안 뜨는 게 정상)
- [ ] 기존 의뢰 등록·조회·일일보고·주간보고가 평소대로 동작하는지 (회귀 확인)

### 6-3. (선택) Mac Mini에서 스모크 테스트
```bash
npm test
```
121건 전부 PASS면 정상. `data.db`가 아니라 임시 DB를 쓰므로 운영 데이터에 영향 없다.

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
- **Bash 도구의 `curl`은 사내망(172.16.3.136)에 못 닿는다** (샌드박스가 외부 아웃바운드 차단). Claude가 운영 서버를 확인할 때는 PowerShell의 `Invoke-WebRequest`를 쓴다.
