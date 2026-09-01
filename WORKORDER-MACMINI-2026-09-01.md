# [작업지시서] Mac Mini (M4) 재배포 — 메인/서브 담당 테스터와 리소스 분담 (2026-09-01)

이 문서는 **Mac Mini 터미널에서 사람이 직접** 위에서부터 순서대로 실행하는 작업지시서다.
Claude는 이 서버에 SSH 키가 없어 비대화형 접속이 거부되므로(`publickey,password`) 문서로 대신한다.
각 단계 실행 후 결과를 알려주면 다음 단계를 안내할 수 있고, **검증 단계는 Claude가 HTTP로 대신 확인**할 수 있다.

> ⚠️ **개발 PC와 포트가 같다(3001).** 아래 `curl`·`lsof` 명령은 전부 **Mac Mini 터미널**에서 실행한다.

> 🔴 **지난 회차와 다른 점 — 이번엔 DB 스키마가 바뀐다.**
> `requests` 테이블에 `tester_sub` 컬럼이 생긴다. 서버가 처음 뜰 때 `ALTER TABLE`로 자동 추가되므로
> 별도 마이그레이션 명령은 없지만, **2번 백업을 절대 건너뛰지 않는다.**

---

## 0. 선행 조건 — 개발 PC에서 origin으로 push (아직 안 됨)

Mac Mini는 `origin`에서 pull한다. 그런데 이번 변경이 아직 푸시되지 않았고,
**지난 회차와 달리 그냥 `git push`를 하면 거부된다.**

```
## main...origin/main [ahead 5, behind 1]
```

### 왜 갈렸나

원격 `main`이 `c348389 인증 통계에 모델별 인증완료일 표기`로 앞서 있다.
로컬은 **같은 변경을 `9271d28`이라는 다른 해시로 이미 품고 있다** — 어제 `git pull`이 충돌로 멈춰 있던 것을
오늘 해소해 커밋했는데(`392707d`), 그 사이 원격 쪽 이력이 다시 만들어지면서 해시가 갈렸다.
**내용은 같고 계보만 다르다.** 그래서 병합이 필요하다.

### 병합 결과를 미리 확인해 뒀다

`git merge-tree`로 작업 트리를 건드리지 않고 미리 돌려 본 결과다.

- **충돌 없음.**
- 병합 후 파일 내용이 **현재 로컬과 완전히 동일하다.** 계보만 합쳐지고 코드는 한 줄도 바뀌지 않는다.

### 개발 PC(Windows)에서 실행

```powershell
cd C:\Users\k251110\Desktop\QE
git fetch origin
git status -sb                       # "ahead 5, behind 1" 확인
git merge origin/main                # 충돌 없이 병합 커밋 하나 생긴다
git status -sb                       # "ahead 6" (기존 5 + 병합 커밋 1)
npm test                             # 478건 PASS 재확인
git push origin main
git log --oneline origin/main -1     # 방금 만든 병합 커밋인지 확인
```

> ⚠️ **`git pull --rebase`는 쓰지 않는다.** 오늘 만든 충돌 해소 병합(`392707d`)이 평탄화되면서
> 어제 해결한 `report.js` 충돌이 되살아난다. `git merge`로 간다.

푸시는 외부 저장소에 올리는 행위라 **사람이 직접 실행**한다. 끝나면 1번으로 넘어간다.

---

## 0-B. push가 막히면 — 대안 경로

### 먼저 — 지금은 push가 될 것으로 보인다 (2026-09-01 실측)

| 확인 | 결과 |
|---|---|
| `github.com:443` TCP | 도달 |
| `git ls-remote origin` | 성공 (원격 3개 브랜치 조회됨) |
| `gh auth status` | `nuna20230424-ship-it` 로그인, 토큰 스코프에 `repo` 포함 |
| 저장소 권한 | `push: true`, `admin: true`, `private: false` |
| `git config credential.helper` | `manager` (Git Credential Manager) |

**그러니 0번을 먼저 그대로 시도한다.** 아래는 그게 실패했을 때의 경로다.
실패하면 **에러 메시지 전문을 알려준다** — 아래 넷 중 어느 대안으로 갈지가 그 문구로 갈린다.

| 에러 문구 | 원인 | 갈 곳 |
|---|---|---|
| `Authentication failed` · 자격증명 창이 반복 | Credential Manager 만료 | 대안 1 |
| `403` · `Permission ... denied to` | 토큰 권한/SSO | 대안 1 |
| `Could not resolve host` · `Failed to connect` · 프록시 오류 | 사내망이 GitHub 쓰기를 막음 | 대안 2 |
| `pre-receive hook declined` · 정책 거부 | 저장소 정책 | 대안 2 |

---

### 대안 1 — `gh` 인증으로 push (자격증명 문제일 때)

`gh`는 이미 로그인돼 있고 `repo` 스코프를 갖고 있다. git이 그 토큰을 쓰게 만든다.

```powershell
cd C:\Users\k251110\Desktop\QE
gh auth setup-git          # git 자격증명 헬퍼를 gh 로 연결
git push origin main
```

한 번만 쓰고 전역 설정을 바꾸고 싶지 않으면 이렇게 한다.

```powershell
git -c credential.helper="!gh auth git-credential" push origin main
```

토큰 스코프가 문제면 갱신한다(브라우저가 열린다).

```powershell
gh auth refresh -h github.com -s repo
```

---

### 대안 2 — GitHub를 우회해 맥미니에 직접 전달 (권장 우회로)

**이 경로가 가장 안전하다.** git 이력을 그대로 옮기므로 나중에 push가 풀렸을 때
**맥미니가 origin과 어긋나지 않는다.**

#### 왜 되는지 미리 확인해 뒀다

| 확인 | 결과 |
|---|---|
| 맥미니 `172.16.3.136:22` TCP | 도달 |
| 개발 PC의 `ssh` · `scp` | 둘 다 있음 (`/usr/bin/`) |
| 전체 이력 번들 크기 | **271 KB** (`.git` 전체가 3 MB) |

#### 개발 PC (Git Bash 또는 PowerShell)

```bash
cd /c/Users/k251110/Desktop/QE
git fetch origin
git merge origin/main                       # 0번과 동일 — 충돌 없음
npm test                                    # 478건 PASS

git bundle create qe-2026-09-01.bundle main
git bundle verify qe-2026-09-01.bundle      # "The bundle is okay" 확인
scp qe-2026-09-01.bundle dqa@172.16.3.136:~/
```

> ⚠️ **번들은 반드시 `git merge origin/main` 이후에 만든다.**
> 병합 전에 만들면 맥미니(c348389)에서 fast-forward가 되지 않아 맥미니가 스스로 병합해야 한다.

> 전체 이력 번들(`main`)을 쓴다. 증분 번들(`c348389..main`)은 30 KB로 더 작지만
> 맥미니가 특정 선행 커밋을 갖고 있어야 성립한다. 271 KB면 그 위험을 감수할 이유가 없다.

#### 맥미니 터미널

```bash
cd <배포 폴더>                               # 방법 B 1번으로 찾는다
cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)   # 백업 먼저 (스키마 변경 있음)

git bundle verify ~/qe-2026-09-01.bundle    # "The bundle is okay" 확인
git pull --ff-only ~/qe-2026-09-01.bundle main
git log --oneline -6                        # 이번 회차 커밋들이 올라왔는지

npm install --no-audit --no-fund
# 이후 방법 B의 6번(재기동)·검증 그대로

rm ~/qe-2026-09-01.bundle                   # 반영 확인 후 정리
```

#### 이 경로를 쓴 뒤 알아야 할 것

- **맥미니가 origin보다 앞선 상태가 된다.** origin이 그대로인 동안은
  `git pull --ff-only origin main`이 "Already up to date"로 조용히 지나가므로 문제없다.
- **나중에 push가 풀리면 저절로 맞춰진다.** 번들로 옮긴 커밋과 push할 커밋은
  **같은 객체(같은 해시)**라 origin에 올라가는 순간 두 이력이 정확히 일치한다. 추가 조치가 없다.
- 다만 **그 사이에 다른 사람이 origin에 새 커밋을 올리면** 맥미니의 다음 `pull --ff-only`가 실패한다.
  그때는 push를 먼저 푸는 것이 순서다.

---

### 대안 3 — 맥미니 저장소로 직접 push (SSH)

번들 파일을 만들고 지우는 과정이 번거로우면 이 방법도 된다. **배포 폴더 절대경로를 미리 알아야 한다.**

```bash
# 맥미니에서 경로 확인
lsof -a -p "$(lsof -ti:3001 | head -1)" -d cwd -Fn
```

```bash
# 개발 PC에서 — 임시 브랜치로 밀어 넣는다
git push dqa@172.16.3.136:<위에서 확인한 절대경로> main:refs/heads/deploy-2026-09-01
```

```bash
# 맥미니에서 받아 합친다
cd <배포 폴더>
cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)
git merge --ff-only deploy-2026-09-01
git branch -d deploy-2026-09-01
npm install --no-audit --no-fund
# 재기동
```

> ⚠️ **`main:main`으로 바로 밀지 않는다.** 맥미니 저장소는 bare가 아니라 `main`이 체크아웃돼 있어
> 현재 브랜치로의 push는 git이 거부한다(`denyCurrentBranch`). 임시 브랜치로 받아 합치는 것이 정석이다.
> `receive.denyCurrentBranch=updateInstead` 설정으로도 되지만, 운영 서버 설정을 바꾸는 일이라 권하지 않는다.

---

### 대안 4 — SSH까지 막힐 때

같은 번들 파일을 **USB나 사내 공유폴더로** 옮긴다. 271 KB라 어디든 들어간다.
맥미니에서 받은 뒤 절차는 대안 2의 맥미니 쪽과 동일하다.

---

### 하지 말 것

- **바뀐 `.js` 파일만 scp로 덮어쓰기.** 맥미니의 git 작업 트리가 더러워져
  다음 배포 때 `git status`에 걸리고, 배포 스크립트가 "손댄 추적 파일 있음"으로 멈춘다.
  이력이 없으니 롤백 지점도 사라진다.
- **`git format-patch` + `git am`.** 이번 이력에는 **병합 커밋이 들어 있다**(`392707d`, 그리고 0번에서 만들 병합).
  `format-patch`는 병합 커밋을 건너뛰므로 결과가 원본과 달라진다. 번들을 쓴다.
- **GitHub 웹 UI로 파일 업로드.** 이력이 갈리고 맥미니의 `pull --ff-only`가 깨진다.

---

## 배경 — 이번에 배포되는 것

### 1. 담당 테스터를 메인 / 서브로 나눈다

프로젝트에 따라 진행 담당이 1인 이상인 경우가 있어 **서브 담당자를 여러 명** 지정할 수 있게 했다.
서브는 없는 경우가 더 많으므로 기본값은 비어 있고, 비워 두면 **지금과 완전히 같게 동작한다.**

- 의뢰 폼에 `서브 담당 테스터` 다중 선택 추가. 명단 밖 인원은 콤마로 구분해 직접 입력.
- 일정표·현황보드의 테스터 칸에 메인 뒤로 서브를 흐리게 붙인다.
- 엑셀 다운로드에 `서브 테스터` 컬럼 추가.
- 보고 본문(일일·주간)의 테스터 칸에 메인 · 서브 병기. **자동발송 본문은 집계+링크만이라 영향 없다.**

### 2. 2인 이상이면 slot을 분담해 가동률에 반영한다

이번 요청의 핵심이다. 기존 구조에서는 두 번째 담당자가 리소스 계산에 **아예 존재하지 않았다.**

부하 계산은 **분담**이다. 한 건의 업무량을 인원수로 나눠 각자에게 계상하므로
**팀 총 물량은 그대로이고 개인 부하와 소요 기간만 갈린다.** 홀수는 메인이 하나 더 가져간다.

```
NTS 12 slot · 메인 이은경 / 서브 조아라

  이전   이은경 12 slot (240%)   소진 12영업일   실시간 가동률 25%
  이후   이은경  6 slot (120%)   소진  6영업일   실시간 가동률 50%
         조아라  6 slot (120%)                   팀 총량 12 slot · 1건 (불변)
```

- 담당자별 부하·예상 소진일·일별 배치·**실시간 리소스 가동률**에 두 사람이 모두 잡힌다.
- 팀 총 slot과 의뢰 건수는 변하지 않는다 — 2인 분담 한 건이 2건으로 세지지 않게 접었다.
- 메인이 인증 담당 4명 중 하나이고 서브가 기타 테스터면 **한 건의 몫이 두 리소스 풀에 나뉘어** 들어간다.
- 요약 위젯의 `테스터 부하`도 서브를 함께 센다.
- 리소스 탭 건별 상세에 `N인 분담 · 건 전체 M` 표기가 붙는다.

### 변경 파일

| 파일 | 성격 |
|---|---|
| `assignees.js` | **신규 서버 파일** — 담당자 명단·분담 규칙 · **재기동 필요** |
| `db.js` | 서버 파일 — **스키마 마이그레이션 포함** · **재기동 필요** |
| `resources.js` | 서버 파일 — 분담 계산 · **재기동 필요** |
| `report.js` | 서버 파일 — 보고 본문 테스터 표기 · **재기동 필요** |
| `public/index.html` · `public/app.js` · `public/styles.css` | 정적 파일 — 브라우저 강력 새로고침이면 반영 |
| `test/smoke.js` · `checklist.md` · `context-notes.md` | 운영에 영향 없음 |

- **새 패키지 없음.** `npm install`은 스크립트가 어차피 실행하지만 새로 받을 것은 없다.
- **DB 스키마 변경 있음** — 아래 참조.
- `npm test` 478건 통과 (개발 PC 기준). 기존 416건이 그대로 통과하는 것이
  곧 **서브가 비면 예전과 같게 동작한다**는 회귀 가드다.

### DB 스키마 변경 — `requests.tester_sub`

`db.js`가 기동할 때 기존 컬럼 목록을 읽어 없는 것만 `ALTER TABLE ... ADD COLUMN`으로 채운다.
이번에 `tester_sub TEXT`가 그 대상이다.

- **기존 데이터는 건드리지 않는다.** 기존 행의 `tester_sub`는 `NULL`이 되고, 코드는 `NULL`을 빈 값으로 읽는다.
- 실행 시점은 **서버 재기동 직후 첫 로드**다. 별도 명령이 필요 없다.
- 되돌리기는 아래 **롤백** 절 참조 — **컬럼을 지울 필요가 없다.**

---

## 현재 배포 상태 (2026-09-01 11:30 실측)

Claude가 `http://172.16.3.136:3001`로 직접 확인한 결과다.

| 확인 | 결과 | 뜻 |
|---|---|---|
| `/api/requests` | 200 (76 KB) | 서버 정상, 실데이터 있음 |
| `/api/requests` 에 `tester_sub` | **없음** | **이번 회차 미배포** |
| `/index.html` 에 `f-tester_sub-select` | **없음** | **이번 회차 미배포** |
| `/app.js` 에 `share_count` | **없음** | **이번 회차 미배포** |
| `/api/resources` 에 `share_count` | **없음** | **이번 회차 미배포** |
| `/api/resources` 에 `schedule_risks` | 있음 | 13차(일정 조정 필요) 배포 완료 |
| `/api/report/daily/copy` 에 `bgcolor` | 있음 | 13차(복사 서식) 배포 완료 |
| `/api/report/certstats/copy` 에 `인증완료일` | 있음 | `c348389` 반영 완료 |

즉 **Mac Mini는 현재 `origin/main`(c348389)과 같은 지점**이고, **브랜치 전환 없이 `git pull`만 하면 된다.**

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
> 그건 **배포 전에도 200이었다.** 스크립트가 성공했더라도 아래 **검증** 절의 새 신호 네 줄을 반드시 확인한다.

> ⚠️ **스크립트는 `server.log`를 `>`로 덮어쓴다**(99행). 이전 발송 기록이 지워진다.
> 로그를 남겨야 하면 방법 B로 `>>`를 쓰거나, 실행 전에 `cp server.log server.log.$(date +%Y%m%d)`로 떠 둔다.
> (스크립트 자체 수정은 이번 범위 밖으로 뒀다.)

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

**이번 회차는 스키마가 바뀐다.** `git pull`은 `data.db`를 건드리지 않지만(`.gitignore` 대상),
재기동 직후 `ALTER TABLE`이 실제 운영 DB에 실행된다. 그 전에 반드시 떠 둔다.

```bash
cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)
ls -la ~/data.db.bak-*
```

백업이 실패하거나 파일 크기가 0이면 **여기서 멈춘다.**

### 3. 현재 상태 확인

```bash
git branch --show-current              # main 이어야 한다
git status --porcelain -uno            # 아무것도 안 나와야 정상
git log --oneline -1                   # c348389 인증 통계에 모델별 인증완료일 표기
```

`git status`에 뭔가 걸리면 **왜 바뀐 건지 먼저 확인한다.**
`git checkout -- .`나 `git reset --hard`로 함부로 지우지 말고, 여기서 멈추고 알려준다.
(`config.json`·`data.db`는 `.gitignore` 대상이라 여기 나오지 않는다.)

### 4. 코드 갱신

```bash
git fetch origin
git pull --ff-only origin main
git log --oneline -6
ls -la assignees.js                    # 신규 파일이 내려왔는지 확인
```

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

이 순간 `tester_sub` 컬럼이 추가된다. 로그에 오류가 없으면 성공이다.

---

## 검증

### 배포 반영 신호 — Mac Mini에서 직접

**이 네 줄이 이번 회차의 판별 기준이다. 전부 `1` 이상이어야 반영된 것이다.**

```bash
# 1) DB 마이그레이션 — tester_sub 컬럼이 실제로 생겼는가 (의뢰가 1건 이상 있어야 잡힌다)
curl -s http://127.0.0.1:3001/api/requests | grep -c tester_sub

# 2) 의뢰 폼 — 서브 담당 테스터 입력 칸이 배포됐는가
curl -s http://127.0.0.1:3001/index.html | grep -c f-tester_sub-select

# 3) 정적 JS — 분담 표기가 배포됐는가
curl -s http://127.0.0.1:3001/app.js | grep -c share_count

# 4) 리소스 계산 — 분담이 실제로 계산에 태워졌는가
curl -s http://127.0.0.1:3001/api/resources | grep -c share_count
```

1번이 `0`이면 **재기동이 안 됐거나 실패한 것**이다. `server.log`를 먼저 본다.
2·3번이 `0`이면 코드는 내려왔는데 정적 파일이 캐시된 것이니 `git log`로 pull 여부를 다시 확인한다.

### 스키마 확인 (선택)

```bash
sqlite3 data.db "PRAGMA table_info(requests);" | grep tester
```

`tester`와 `tester_sub` 두 줄이 나와야 한다. (`sqlite3` 명령이 없으면 위 curl 1번으로 충분하다.)

### 회귀 확인 (전부 200)

```bash
for p in stats options resources bottlenecks cert-stats; do
  printf '%-12s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/$p)"
done

# 진행차수 필수 파라미터 검증 — 400 이어야 정상
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3001/api/next-round?model_name=x'

# 13차 기능이 그대로인지
curl -s http://127.0.0.1:3001/api/resources | grep -c schedule_risks
curl -s http://127.0.0.1:3001/api/report/daily/copy | grep -c bgcolor
```

### Claude가 대신 확인할 수 있는 것

재기동이 끝나면 **"확인해줘"** 라고만 하면 된다. PowerShell로 아래를 대신 본다.

- 반영 신호 네 줄 (`tester_sub` · `f-tester_sub-select` · `share_count` ×2)
- 13차 기능 회귀 (`schedule_risks` · `bgcolor` · `인증완료일`)
- 기존 엔드포인트 회귀 (200 / 400)

### (선택) 스모크 테스트

```bash
npm test
```

478건 전부 PASS면 정상. **임시 DB를 쓰므로 운영 데이터에 영향 없다.**

---

## 브라우저 육안 확인 (사람이 직접)

`http://172.16.3.136:3001` 접속. **강력 새로고침(⌘+Shift+R)으로 정적 파일 캐시를 비운다.**

### 서브 담당 테스터 입력

- [ ] 의뢰 하나를 열면 `진행 / 결과` 묶음의 `담당 테스터` 옆에 `서브 담당 테스터` 칸이 있는가
- [ ] 여러 명을 Ctrl(⌘)+클릭으로 고를 수 있는가
- [ ] 명단 밖 인원을 아래 입력칸에 콤마로 구분해 넣을 수 있는가
- [ ] 저장 후 다시 열었을 때 고른 사람이 그대로 선택돼 있는가
- [ ] 서브를 **비우고** 저장하면 지워지는가
- [ ] `변경 이력`에 `서브 테스터: ∅ → 조아라` 형태로 남는가

### 리소스 가동률 반영 (핵심)

**서브가 있는 의뢰를 하나 만들어 두고 본다.** NTS(12 slot) 건이 효과가 가장 잘 보인다.

- [ ] `QE 리소스` 탭 담당자별 표에서 **두 사람 모두** slot이 잡히는가 (12 → 6 / 6)
- [ ] 두 사람의 `예상 소진일`이 같고, 서브를 붙이기 전보다 **당겨졌는가**
- [ ] 상단 `실시간 리소스 가동률`의 `점유` 인원에 **서브가 함께 뜨는가**
- [ ] `여유 인원`에서 서브가 빠졌는가
- [ ] 인증 담당 풀의 **총 slot과 건수가 변하지 않았는가** (분담은 나누는 것이지 늘리는 것이 아니다)
- [ ] 건별 상세를 펼치면 `N인 분담 · 건 전체 M` 표기가 보이는가
- [ ] 모델명 아래에 `함께 <이름>`이 보이는가
- [ ] 일별 배치 표에서 두 사람이 같은 날짜에 나란히 잡히는가

### 목록·내보내기 표기

- [ ] 일정표의 `테스터` 칸이 `이은경 +조아라` 형태로 보이는가
- [ ] 현황보드 카드에도 같은 표기가 보이는가
- [ ] `테스터` 헤더를 눌러 정렬이 되는가
- [ ] `⤓ 엑셀 다운로드` CSV에 `서브 테스터` 컬럼이 있는가

### 보고 본문

- [ ] 일일보고·주간보고의 `테스터` 칸이 `이은경 · 조아라`로 나오는가
- [ ] `📋 본문 복사` → Outlook 붙여넣기 시 표·배지 서식이 13차와 동일하게 살아 있는가

### 기존 기능 회귀

- [ ] 의뢰 등록 · 조회 · 수정이 평소대로 되는가
- [ ] 서브를 지정하지 않은 **기존 의뢰들의 리소스 수치가 배포 전과 같은가** (가장 중요한 회귀 확인)
- [ ] `1-1 · 일정 조정 필요` 섹션이 그대로인가
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

### 코드만 되돌리면 된다

**추가된 `tester_sub` 컬럼은 지우지 않아도 된다.** 구 코드의 `INSERT`·`UPDATE`는 컬럼을 명시적으로
나열하므로 이 컬럼을 아예 건드리지 않고, `SELECT *`가 값을 함께 읽어도 쓰이지 않는다.
**데이터 손실 없이 조용히 남아 있다가, 다시 배포하면 그대로 되살아난다.**

```bash
git log --oneline -8                   # 되돌릴 지점 = 이번 회차 직전 (c348389)
git checkout c348389
npm install --no-audit --no-fund
# 6번과 동일하게 재기동
```

되돌린 뒤 확인은 `curl -s http://127.0.0.1:3001/index.html | grep -c f-tester_sub-select` → `0`.

### 데이터가 꼬였을 때만 백업 복구

**서버를 먼저 멈추고** WAL 잔여 파일을 지운다.

```bash
kill <PID>
rm -f data.db-wal data.db-shm
cp ~/data.db.bak-<타임스탬프> data.db
# 재기동
```

> 백업본에는 `tester_sub` 컬럼이 없다. 복구 후 **새 코드로 기동하면 다시 자동 추가**되고,
> 그 사이 입력한 서브 담당자 값은 사라진다. 그래서 이건 데이터 자체가 꼬였을 때만 쓴다.

---

## 배포 후 남는 일

### launchd 상시 구동 (아직 미완)

1차 구축부터 미설정이다. **서버가 꺼지면 자동 보고 메일이 에러 없이 조용히 끊긴다.**
재부팅·크래시 복구가 안 되므로 별도 회차로 잡아야 한다.

### 공휴일 상수 검증

`holidays.js`의 2026년 목록을 정부 공고와 대조해야 한다(사람 확인 필요).
리소스 계산이 전부 영업일 기준이라 이 값이 틀리면 가동률·분담 소진일·일정 조정 판정이 모두 어긋난다.

### 서브 비율 조정 (미구현)

분담은 **균등 + 나머지는 메인**이라는 한 가지 규칙이다.
"메인 70% / 서브 30%"처럼 건별 비율을 조정하는 기능은 이번에 넣지 않았다. 필요하면 별도 요청.

### 배포 스크립트의 `server.log` 덮어쓰기

`scripts/deploy-macmini.sh` 99행이 `>`를 쓴다. 방법 A로 배포할 때마다 로그가 초기화된다.
`>>`로 바꿔야 하지만 이번 회차 범위 밖으로 뒀다.

---

## 요약 — 최소 경로

```powershell
# 1) 개발 PC (Windows) — 병합 후 푸시 (그냥 push하면 거부된다)
cd C:\Users\k251110\Desktop\QE
git fetch origin
git merge origin/main
npm test
git push origin main
```

```bash
# 2) 개발 PC — 배포 한 줄
ssh dqa@172.16.3.136 bash -s < scripts/deploy-macmini.sh

# 1)이 막히면 GitHub를 우회한다 (0-B 대안 2) — 번들 271KB
#   git merge origin/main && git bundle create qe-2026-09-01.bundle main
#   scp qe-2026-09-01.bundle dqa@172.16.3.136:~/
#   (맥미니) git pull --ff-only ~/qe-2026-09-01.bundle main

# 3) Mac Mini — 반영 신호 네 줄 (전부 1 이상이어야 한다)
curl -s http://127.0.0.1:3001/api/requests   | grep -c tester_sub
curl -s http://127.0.0.1:3001/index.html     | grep -c f-tester_sub-select
curl -s http://127.0.0.1:3001/app.js         | grep -c share_count
curl -s http://127.0.0.1:3001/api/resources  | grep -c share_count
```

```
# 4) Claude에게 "확인해줘" → HTTP로 대신 검증
# 5) 브라우저에서 위 육안 체크리스트
#    (특히 서브를 붙인 NTS 건이 6/6으로 갈리고 가동률에 두 사람이 잡히는지)
```
