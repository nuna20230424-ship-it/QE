# [작업지시서] Mac Mini (M4) 재배포 — 보고 본문 복사 서식 + 일정 조정 필요 위젯 (2026-08-31)

이 문서는 **Mac Mini 터미널에서 사람이 직접** 위에서부터 순서대로 실행하는 작업지시서다.
Claude는 이 서버에 SSH 키가 없어 비대화형 접속이 거부되므로(`publickey,password`) 문서로 대신한다.
각 단계 실행 후 결과를 알려주면 다음 단계를 안내할 수 있고, **검증 단계는 Claude가 HTTP로 대신 확인**할 수 있다.

> ⚠️ **개발 PC와 포트가 같다(3001).** 아래 명령은 전부 **Mac Mini 터미널**에서 실행한다.

---

## 0. 선행 조건 — 개발 PC에서 origin으로 push (아직 안 됨)

**Mac Mini는 `origin`에서 pull한다. 그런데 이번 변경 5개 커밋이 아직 푸시되지 않았다.**
이 상태로 배포를 돌리면 4단계에서 "이미 최신입니다"가 뜨고 **아무것도 바뀌지 않는다.**

```
main...origin/main [ahead 5]
  ab4db7e 예약대기 희망 일정 기준 '일정 조정 필요' 위젯 추가
  9a87703 Fail 은 배지 대신 결과 칸 자체를 빨갛게 칠해 흰 글씨가 살아남게 한다
  7b7fb89 인증종류 배지 색을 복사본에도 적용하고 글자색을 font 속성으로 이중 지정
  6f48370 Outlook 데스크톱에서 배지·칩 색이 죽지 않도록 보고 본문을 표 기반으로 전환
  586bc3e 본문 복사 시 서식이 붙여넣기에 살아나도록 클립보드 경로 수정
```

**개발 PC(Windows)에서 먼저 실행한다.**

```powershell
cd C:\Users\k251110\Desktop\QE
git status -sb              # "ahead 5" 확인
git push origin main
git log --oneline origin/main -1    # ab4db7e 인지 확인
```

푸시는 외부 저장소에 올리는 행위라 **사람이 직접 실행**한다. 끝나면 1번으로 넘어간다.

---

## 배경 — 이번에 배포되는 것

### 1. 보고 본문 복사 서식 (일일보고 · 주간보고 · 인증통계)

`📋 본문 복사` 후 메일 작성창에 붙여넣으면 서식이 살아나지 않던 문제. 원인이 세 겹이었다.

- **클립보드에 `text/html`이 실리지 않았다.** 사내망 http는 비보안 컨텍스트라 Clipboard API가 막히고,
  폴백이 뷰포트 밖(`left:-99999px`) 요소를 선택 복사해 브라우저의 직렬화에 기대는 방식이었다.
  → `copy` 이벤트를 가로채 실을 내용을 직접 지정하는 경로를 기본으로 올렸다.
- **Outlook 데스크톱은 Word 렌더러라** 인라인 요소의 배경·`border-radius`를 버린다.
  → 색이 실리는 조각을 표 셀 + `bgcolor` 속성으로 전환.
- **인증종류(NTS · xTS) 배지 색이 복사본에 아예 없었다.** 화면은 `styles.css`로 칠하는데 서버 본문에 대응물이 없었다.
  → 화면과 같은 색값을 `report.js`에 넣고, Fail은 셀 자체를 빨갛게 칠해 흰 글씨가 살아남게 했다.

### 2. 일정 조정 필요 위젯 (신규 기능)

**예약대기 건의 Test 희망 일정 기준으로** 그날 자리가 없어 밀리는 건을 가동률 아래에 정리한다.

- 메인 현황보드 — `⚠ N건  OO모델, OO모델 일정조정필요   세부 가이드 ▸` 한 줄 (클릭하면 QE 리소스 탭으로)
- QE 리소스 탭 `1-1 · 일정 조정 필요` — 건별 **사유**와 **조정 방법**
  - `담당자 겹침` — 희망일에 비는 사람이 있다 → **담당자 교체**로 희망일 유지 가능
  - `팀 포화` — 전원 점유 → **날짜를 옮겨야** 한다
- 메인 조회 구간을 5 → 20영업일로 맞췄다(메인과 탭의 건수가 어긋나지 않게).

### 변경 파일

| 파일 | 성격 |
|---|---|
| `public/app.js` · `public/styles.css` | 정적 파일 — 브라우저 새로고침이면 반영 |
| `report.js` · `resources.js` | 서버 파일 — **재기동 필요** |
| `test/smoke.js` · `checklist.md` · `context-notes.md` | 운영에 영향 없음 |

- **새 패키지 없음.** `npm install`은 스크립트가 어차피 실행하지만 새로 받을 것은 없다.
- **DB 스키마 변경 없음.** 그래서 롤백이 코드만으로 안전하다.
- `npm test` 414건 통과 (개발 PC 기준).

---

## 현재 배포 상태 (2026-08-31 실측)

Claude가 HTTP로 확인한 결과다. **이번 회차는 아직 반영되지 않았다.**

| 확인 | 결과 | 뜻 |
|---|---|---|
| `/api/resources` | 200, 그러나 `schedule_risks` **없음** | 일정 조정 위젯 미배포 |
| `/api/report/daily/copy` | 200, 그러나 `bgcolor` **없음** | 복사 서식 수정 미배포 |
| `/api/next-round?model_name=x` | 400 | 진행차수 수정은 이미 배포됨 (10차) |

즉 **브랜치 전환 없이 `git pull`만 하면 된다.**

---

## 방법 A — 스크립트 한 줄 (권장)

개발 PC에서 실행한다. 스크립트가 폴더 찾기 → 백업 → 상태 확인 → pull → install → 재기동 → 기동 검증까지 한다.

```bash
ssh dqa@172.16.3.136 bash -s < scripts/deploy-macmini.sh
```

스크립트의 안전 원칙은 이렇다.

- `data.db` 백업을 **먼저** 하고, 실패하면 즉시 중단한다.
- `git reset --hard` · `git checkout -- .` 같은 파괴적 명령은 쓰지 않는다.
- **손댄 추적 파일이 있으면 덮어쓰지 않고 멈춘다.** 그 판단은 사람 몫이다.
- 어느 단계에서 멈춰도 기존 서비스는 그대로 살아 있다(재기동은 마지막이다).

> ⚠️ **스크립트의 기동 검증은 이번 회차를 구분하지 못한다.** 7단계가 `/api/resources` → 200만 보는데
> 그건 **배포 전에도 200이었다.** 스크립트가 성공했더라도 아래 **검증** 절의 새 신호를 반드시 확인한다.

스크립트가 막히면 방법 B로 간다.

---

## 방법 B — 수동 절차

### 1. 배포 폴더로 이동

```bash
lsof -i :3001                          # 실행 중인 node 프로세스 PID
lsof -a -p <위 PID> -d cwd -Fn         # 그 프로세스의 작업 디렉터리
cd <위에서 찾은 경로>
pwd
git remote -v                          # nuna20230424-ship-it/QE.git 인지 확인
```

### 2. 사전 백업 (필수, 생략 금지)

운영 `data.db`에는 실제 인증 의뢰 데이터가 들어 있다. `git pull`은 `data.db`를 건드리지 않지만(`.gitignore` 대상)
사람 실수 대비로 한 번 더 복사해 둔다.

```bash
cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)
ls -la ~/data.db.bak-*
```

### 3. 현재 상태 확인

```bash
git branch --show-current              # main 이어야 한다
git status --porcelain -uno            # 아무것도 안 나와야 정상
git log --oneline -1
```

`git status`에 뭔가 걸리면 **왜 바뀐 건지 먼저 확인한다.**
`git checkout -- .`나 `git reset --hard`로 함부로 지우지 말고, 여기서 멈추고 알려준다.
(`config.json`·`data.db`는 `.gitignore` 대상이라 여기 나오지 않는다.)

### 4. 코드 갱신

```bash
git fetch origin
git pull --ff-only origin main
git log --oneline -5
```

pull 후 최상단이 `ab4db7e 예약대기 희망 일정 기준 '일정 조정 필요' 위젯 추가` 여야 한다.
0번(push)을 건너뛰었다면 여기서 "Already up to date"가 뜬다 — 그러면 0번부터 다시 한다.

### 5. 의존성

```bash
npm install --no-audit --no-fund
```

새 패키지는 없다. 오래 걸리면 `better-sqlite3`가 소스 빌드로 넘어간 것이니 기다리면 된다.

### 6. 서버 재기동

**launchd로 상시 구동 중이라면**

```bash
launchctl stop com.qa.cert-dashboard
launchctl start com.qa.cert-dashboard
```

**launchd 미설정 상태(현재로선 이쪽일 가능성이 높다)라면**

```bash
kill <1번에서 확인한 PID>
sleep 2
lsof -ti:3001 || echo "포트 해제됨"
PORT=3001 HOST=0.0.0.0 nohup npm start >> server.log 2>&1 < /dev/null &
disown
```

- `>>`로 이어 붙인다. `>`로 덮어쓰면 **이전 발송 기록이 사라진다.**
- `< /dev/null`을 붙여야 SSH 세션이 끊길 때 서버가 함께 죽지 않는다.

```bash
tail -f server.log      # "인증 일정 대시보드 실행 중" 이 보이면 Ctrl+C (서버는 계속 돈다)
```

---

## 검증

### 배포 반영 신호 — Mac Mini에서 직접

**이 두 줄이 이번 회차의 판별 기준이다.** 둘 다 `1` 이상이어야 반영된 것이다.

```bash
# 1) 일정 조정 필요 위젯 — schedule_risks 필드가 생겼는가
curl -s http://127.0.0.1:3001/api/resources | grep -c schedule_risks

# 2) 복사 본문 서식 — 표 셀 배경색이 실렸는가
curl -s http://127.0.0.1:3001/api/report/daily/copy | grep -c bgcolor
```

### 회귀 확인 (전부 200)

```bash
for p in stats options resources bottlenecks; do
  printf '%-12s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/$p)"
done

# 진행차수 필수 파라미터 검증 — 400 이어야 정상
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3001/api/next-round?model_name=x'
```

### Claude가 대신 확인할 수 있는 것

재기동이 끝나면 **"확인해줘"** 라고만 하면 된다. PowerShell로 아래를 대신 본다.

- `/api/resources`에 `schedule_risks` 존재 여부
- `/api/report/daily/copy`에 `bgcolor` 존재 여부
- 기존 엔드포인트 회귀 (200 / 400)

### (선택) 스모크 테스트

```bash
npm test
```

414건 전부 PASS면 정상. **임시 DB를 쓰므로 운영 데이터에 영향 없다.**

---

## 브라우저 육안 확인 (사람이 직접)

`http://172.16.3.136:3001` 접속. **강력 새로고침(⌘+Shift+R)으로 정적 파일 캐시를 비운다.**

### 보고 본문 복사 — Outlook 데스크톱에 붙여넣어 확인

- [ ] 일일보고 `📋 본문 복사` → Outlook 작성창 붙여넣기 → 표 테두리·머리행 회색 배경이 살아 있는가
- [ ] 요약 칩(완료 · Pass · Fail · 진행중)의 회색 배경과 숫자 색이 살아 있는가
- [ ] 주간보고도 동일하게 확인
- [ ] 인증통계 `📋 본문 복사` → **인증종류 배지 색** (Netflix NTS 빨강 / Google xTS 파랑)
- [ ] 인증통계 **결과 칼럼의 Fail** — 칸 전체가 빨갛고 **글씨가 흰색**인가
- [ ] Pass가 파란 볼드인가
- [ ] 메모장에도 붙여넣어 텍스트 대체본 확인 — 줄바꿈과 표 칸 구분이 살아 있는가 (한 덩어리로 뭉치면 실패)

> Outlook은 Word 렌더러라 **배지의 둥근 모서리는 각지게 나온다.** 이건 정상이고 수신 클라이언트 한계다.
> 색·배경·표가 살아 있으면 통과다.

### 일정 조정 필요 위젯 (신규)

- [ ] 메인 현황보드 상단 가동률 **바로 아래**에 한 줄이 뜨는가
      (조정 필요 건이 있으면 `⚠ N건 OO모델, OO모델 일정조정필요`, 없으면 `✓ 예약대기 희망 일정 충돌 없음`)
- [ ] 그 줄을 클릭하면 QE 리소스 탭으로 이동하는가
- [ ] QE 리소스 탭에 `1-1 · 일정 조정 필요` 섹션이 가동률 아래에 있는가
- [ ] 건별로 **희망일 → 가능일 (N영업일 밀림)** 이 표시되는가
- [ ] `사유` 줄이 `담당자 겹침`(주황) / `팀 포화`(빨강)로 구분되는가
- [ ] `조정` 줄이 겹침이면 대안 담당자 이름을, 포화면 가장 빠른 가능일을 알려주는가
- [ ] **메인의 건수와 탭의 건수가 같은가** (다르면 조회 구간이 어긋난 것이니 알려줄 것)

### 기존 기능 회귀

- [ ] 의뢰 등록 · 조회 · 수정이 평소대로 되는가
- [ ] 일일보고 · 주간보고 · 인증통계 화면이 정상 표시되는가
- [ ] QE 리소스 탭의 2~5번 섹션(부하도 · 파이프라인 · 타입 점유 · 알림)이 그대로인가
- [ ] 진행차수 자동 산출이 동작하는가

---

## 이메일 발송

`config.json`은 `.gitignore` 대상이라 배포 후에도 그대로 유지된다.
서버 로그에 `[notify] 이메일 알림 활성화`가 보이는지 확인한다.

```bash
grep notify server.log | tail -3
```

> ⚠️ **개발 PC에서 서버를 띄워 두면 그쪽에서도 보고 메일이 나간다.**
> 일일 매일 18:00 · 주간 금 18:00 · 통계 월 09:00. 확인용으로 띄웠으면 끝나고 반드시 내린다.

---

## 문제가 생기면 — 롤백

**이번 회차는 DB 스키마를 건드리지 않았다.** 코드만 되돌리면 된다.

```bash
git log --oneline -8                   # 되돌릴 지점 확인 (이번 회차 직전 = 8c063e2)
git checkout 8c063e2
npm install --no-audit --no-fund
# 6번과 동일하게 재기동
```

데이터 자체가 꼬였을 때만 2번 백업본으로 되돌린다. **서버를 먼저 멈추고** WAL 잔여 파일을 지운다.

```bash
kill <PID>
rm -f data.db-wal data.db-shm
cp ~/data.db.bak-<타임스탬프> data.db
# 재기동
```

---

## 배포 후 남는 일

### launchd 상시 구동 (아직 미완)

1차 구축부터 미설정이다. **서버가 꺼지면 자동 보고 메일이 에러 없이 조용히 끊긴다.**
재부팅·크래시 복구가 안 되므로 별도 회차로 잡아야 한다.

### 공휴일 상수 검증

`holidays.js`의 2026년 목록을 정부 공고와 대조해야 한다(사람 확인 필요).
리소스 계산이 전부 영업일 기준이라 이 값이 틀리면 가동률·일정 조정 판정이 모두 어긋난다.

### 인증통계 복사본의 칼럼 구성

화면은 10칼럼(비율 막대 포함), 복사본은 9칼럼이다. 원래부터 다른 표이고 이번 범위 밖으로 뒀다.
"화면 그대로" 복사가 필요하면 별도 요청.

---

## 요약 — 최소 경로

```powershell
# 1) 개발 PC (Windows) — 먼저 푸시
cd C:\Users\k251110\Desktop\QE
git push origin main
```

```bash
# 2) 개발 PC — 배포 한 줄
ssh dqa@172.16.3.136 bash -s < scripts/deploy-macmini.sh

# 3) Mac Mini — 반영 신호 두 줄 (둘 다 1 이상이어야 한다)
curl -s http://127.0.0.1:3001/api/resources | grep -c schedule_risks
curl -s http://127.0.0.1:3001/api/report/daily/copy | grep -c bgcolor
```

```
# 4) Claude에게 "확인해줘" → HTTP로 대신 검증
# 5) 브라우저에서 위 육안 체크리스트 (특히 Outlook 붙여넣기)
```
