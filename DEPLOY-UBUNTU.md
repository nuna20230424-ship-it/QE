# Ubuntu 서버 설치·재배포 가이드

QE 인증 일정 대시보드를 새 운영 서버(Ubuntu PC `172.16.5.102`)에 설치하고 이후 갱신하는 절차다. 이전 서버(Mac Mini `172.16.3.136`)용 절차는 [DEPLOY.md](DEPLOY.md)에 남아 있다.

**Claude Code 세션은 이 서버에 SSH로 붙지 못한다.** 아래 명령은 사용자가 **일반 PowerShell 창**(Claude Code 밖)이나 서버 터미널에서 직접 실행한다. `!` 접두사도 같은 제약을 받는다. 설치가 끝난 뒤 HTTP 확인(6번)은 Claude가 대신할 수 있다.

| 항목 | 값 |
|------|-----|
| 서버 | Ubuntu PC (사용자 확인, SSH 배너상 22.04 — 서버에서 `lsb_release -d`로 한 번 더 확인), 사내 IP `172.16.5.102` |
| 운영 포트 | `3001` |
| 접속 주소 | `http://172.16.5.102:3001` |
| SSH | `22`번. 설치 계정 `qe` (호스트 `qe-System-Product-Name`, 2026-09-30 설치) |
| 설치 폴더 | `/home/qe/cert-schedule-dashboard` (스크립트 기본값 `~/cert-schedule-dashboard`, `APP_DIR=`로 바꿀 수 있음) |
| 서비스 | systemd `qe-dashboard` (재부팅·크래시 자동 복구) |
| 저장소 | `https://github.com/nuna20230424-ship-it/QE.git` |

## 0. 옮길 파일

| 파일 | 용도 | 어디서 |
|------|------|--------|
| `qe.bundle` | 코드 전체(git 이력 포함). 서버가 GitHub에 못 닿거나 아직 push 전일 때 쓴다 | 개발 PC에서 `git bundle create qe.bundle main` |
| `deploy-ubuntu.sh` | 설치·재배포 스크립트 | 저장소 `scripts/deploy-ubuntu.sh` |
| `data.db` | **운영 데이터.** 이전 서버에서 가져온다. 개발 PC의 `data.db`는 테스트 데이터라 쓰지 않는다 | 이전 서버 설치 폴더 |
| `config.json` | 메일(SMTP) 설정. git에 없다 | 이전 서버에서 가져오거나 `config.example.json`을 복사해 새로 채운다 |
| `.env` | Confluence PAT. git에 없다 | 이전 서버에서 가져오거나 새로 만든다 |

`config.json`·`.env`에는 비밀번호와 토큰이 들어 있다. 메일·메신저·공유 폴더로 옮기지 말고 `scp`로 서버에 바로 넣는다.

## 1. Node.js 설치 (서버에서, 한 번만)

**Node 22를 쓴다.** Ubuntu 22.04 기본 `apt`의 nodejs는 v12라서 쓸 수 없다(18 이상 필요).

```bash
lsb_release -d; node -v                       # OS와 이미 깔린 node 버전 확인
sudo apt update
sudo apt install -y curl git build-essential python3
# node 가 없거나 v18 미만일 때만 아래 두 줄
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v                                       # v22.x 확인
```

- **Node 24는 피한다.** 2026-09-30 WSL에서 확인한 결과, 이 저장소의 `better-sqlite3` 11.10.0은 Node 24용 미리 빌드된 바이너리가 없어 소스 빌드로 넘어간다. `make`가 없으면 `npm ci`가 `not found: make`로 실패한다. 이미 24가 깔려 있으면 위 `build-essential` 줄을 꼭 실행한다.
- Node 22에서는 미리 빌드된 바이너리를 받으므로 컴파일러 없이 설치된다(같은 날 확인). `build-essential`은 만일을 위한 것이다.

## 2. 파일 올리기 (개발 PC의 일반 PowerShell 창에서)

```powershell
cd <공유받은 폴더>
scp qe.bundle deploy-ubuntu.sh <계정>@172.16.5.102:~/
```

## 3. 설치 (서버에서)

```bash
ssh <계정>@172.16.5.102
bash ~/deploy-ubuntu.sh ~/qe.bundle      # 서버가 GitHub에 닿으면 인자 없이: bash ~/deploy-ubuntu.sh
```

`sudo bash ...`로 실행하지 않는다. 일반 계정으로 실행하면 서비스 등록 때만 sudo 비밀번호를 묻는다. root로 실행하면 스크립트가 멈춘다. 서비스가 그 계정으로 돌기 때문에 sudo 권한이 있는 계정이어야 한다.

스크립트가 하는 일은 아래와 같다.

1. node(18 이상)·git·curl이 있는지 확인한다. 없으면 설치 명령을 보여 주고 멈춘다(자동 설치하지 않는다).
2. `~/cert-schedule-dashboard`로 코드를 받는다. 번들로 받았으면 origin을 GitHub 주소로 바꿔 둔다.
3. `npm ci --omit=dev`로 의존성을 설치한다.
4. `config.json`·`.env`·`data.db`가 있는지 알려 준다. **이 파일들은 만들거나 덮어쓰지 않는다.**
5. systemd 서비스 `qe-dashboard`를 만들고(처음 한 번, sudo 필요) 켠다. `TZ=Asia/Seoul`을 서비스에 고정한다. 보고 메일 시각(18:00 등)을 서버 로컬 시각으로 계산하므로, UTC 서버에서는 이 값이 없으면 메일이 한국 시각 새벽 3시에 나간다.
6. ufw 방화벽이 켜져 있으면 `3001/tcp`를 허용한다.
7. `/api/resources`가 200을 돌려주는지 확인한다.

처음 실행하면 `config.json`이 없으니 **메일이 꺼진 채로** 뜬다. 데이터와 설정을 넣기 전에 메일이 나가지 않도록 일부러 이 순서로 한다.

## 4. 운영 데이터 옮기기 (서비스를 멈춘 채로)

```bash
sudo systemctl stop qe-dashboard
# 이전 서버에서 받은 data.db 를 ~/cert-schedule-dashboard/data.db 로 둔다
#   예) 개발 PC 일반 PowerShell: scp data.db <계정>@172.16.5.102:~/cert-schedule-dashboard/
ls -l ~/cert-schedule-dashboard/data.db*
sudo systemctl start qe-dashboard
```

- 이전 서버에서 복사할 때는 **그쪽 서버를 먼저 멈춘다.** 돌고 있는 SQLite를 복사하면 `data.db-wal`에만 있던 최근 변경이 빠질 수 있다.
- 새 서버에 이미 입력한 데이터가 있으면 덮기 전에 `cp data.db ~/data.db.bak-$(date +%Y%m%d-%H%M%S)`로 백업한다.

## 5. 메일·Confluence 설정

```bash
cd ~/cert-schedule-dashboard
cp config.example.json config.json    # 이전 서버의 config.json 을 가져왔다면 이 줄은 건너뛴다
nano config.json                      # smtp.user / smtp.pass / notifyTo / reportTo 확인
                                      # baseUrl 은 반드시 http://172.16.5.102:3001
nano .env                             # Confluence 동기화를 쓰면: CONFLUENCE_PAT=발급받은토큰 (한 줄)
chmod 600 config.json .env
sudo systemctl restart qe-dashboard
grep notify server.log | tail -1      # [notify] 이메일 알림 활성화 → 켜짐
```

Confluence 블록(`confluence`) 값은 [DEPLOY.md](DEPLOY.md)의 `4-B`에 확정값이 있다.

**이전 서버는 꺼 두어야 한다.** 두 서버가 함께 돌면 보고 메일이 두 번 나가고, Confluence 동기화도 양쪽에서 따로 돈다.

## 6. 설치 확인

Claude가 PowerShell로 대신 확인할 수 있다.

```
GET http://172.16.5.102:3001/api/resources
GET http://172.16.5.102:3001/api/stats
GET http://172.16.5.102:3001/api/confluence/status
```

브라우저로 `http://172.16.5.102:3001`에 들어가 의뢰 목록이 이전 서버와 같은지 본다.

## 7. 재배포 (코드가 바뀌었을 때)

```bash
bash ~/cert-schedule-dashboard/scripts/deploy-ubuntu.sh             # GitHub에서 갱신
bash ~/cert-schedule-dashboard/scripts/deploy-ubuntu.sh ~/qe.bundle # 새 번들을 올려 갱신
```

갱신 전에 `data.db`를 `~/data.db.bak-<시각>`으로 백업하고, 손댄 추적 파일이 있으면 덮어쓰지 않고 멈춘다.

## 자주 쓰는 명령

```bash
systemctl status qe-dashboard               # 상태
sudo systemctl restart qe-dashboard         # 재시작 (config.json 을 고친 뒤엔 반드시)
tail -f ~/cert-schedule-dashboard/server.log
```

## 되돌리기

```bash
cd ~/cert-schedule-dashboard
git log --oneline -5                     # 이전 커밋 확인
git checkout <커밋> && npm ci --omit=dev && sudo systemctl restart qe-dashboard
cp ~/data.db.bak-<시각> data.db          # 데이터가 꼬였을 때만 (서비스를 멈추고)
```

되돌린 뒤 다시 최신으로 갈 때는 `git checkout main`을 먼저 한다. 스크립트는 `main`이 아니면 멈춘다.

## 검증 기록

2026-09-30 개발 PC의 WSL(Ubuntu 24.04, systemd 255)에서 임시 계정으로 `qe.bundle` + `deploy-ubuntu.sh`를 실제로 돌려 확인했다. 운영 서버(22.04)와 판이 다르지만 스크립트가 쓰는 bash·systemd·npm 동작은 같다. 테스트 후 임시 계정·서비스·sudo 설정은 지웠다.

| 항목 | Node 22.x | Node 24.15 |
|------|-----------|------------|
| 번들로 첫 설치 → `/api/resources` 200 | 통과 | `npm ci` 실패 (`not found: make`) |
| 서비스 `enabled`·`active`, `User`=설치 계정 | 통과 | — |
| 서비스 환경 `TZ=Asia/Seoul`·`PORT=3001`·`HOST=0.0.0.0` | 통과 | — |
| `server.log`·`data.db`가 설치 계정 소유 | 통과 | — |
| origin이 GitHub 주소로 바뀜 | 통과 | — |
| `config.json` 없을 때 메일 꺼진 채 기동 | 통과 | — |
| 재실행(재배포): data.db 백업 → 이미 최신 → 200 | 통과 | — |
| 프로세스 강제 종료 후 자동 재시작 | 통과 | — |
| root로 실행하면 거부 | 통과 | — |

운영 서버에서 확인하지 못한 것은 sudo 비밀번호 입력, ufw가 켜져 있을 때의 허용 추가, 22.04 판의 NodeSource 설치다.
