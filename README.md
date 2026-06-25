# 넷플릭스 · 구글 인증 일정 대시보드

개발 PL이 인증 의뢰를 **예약**하고, 테스터가 **일정·진행·결과**를 공유하는 사내 웹 대시보드.

- 백엔드: Node.js + Express + better-sqlite3 (파일 DB `data.db`)
- 프런트: 정적 HTML/CSS/JS (빌드 단계 없음)
- 뷰: **현황 보드**(상태별 칸반) · **일정표**(일정순 테이블) · **캘린더**(월간) · 등록/상세 모달
- 상단 **요약 위젯**: 전체/대기·진행/완료/지연/평균 소요일/테스터 부하
- 역할: **의뢰자 / 테스터** 토글로 편집 영역 분리 (이름 입력 시 변경 이력에 기록)
- **변경 이력**: 의뢰별 등록·수정·삭제 기록(작업자·시각·내용)
- **이메일 알림**: 예약확정·완료 시 (config.json 설정 시)
- **자동 백업**: `data.db`를 매일 1회 `backups/`로 사본(최근 14개 보관)

## 데이터 항목
| 영역 | 항목 |
|------|------|
| 의뢰 정보 (개발 PL) | 인증종류(Netflix NTS / Google xTS / Amazon AVTS), Test type(IR/LR/MR/파생), Test 목적(3PL/Official/Pre-Test/양산/self), 모델명, FW 버전, 의뢰자(드롭다운+직접입력), 희망일정, 비고 |
| 진행/결과 (테스터) | 예약확정 일정, 완료 일정, 담당 테스터(드롭다운+직접입력), 상태, 판정(Pass/Fail), 진행사항, 결과 코멘트 |

상태 흐름: `예약대기 → 예약확정 → 진행중 → 완료 / 보류 / 중단` (확정·시작·완료 시각 자동 기록 → 평균 소요일 산출). 완료 건은 보드·일정표에서 Pass(파란색)·Fail(빨간색) 배지로 표시.

## 로컬 실행
```bash
npm install
npm start          # 기본 http://localhost:3000
PORT=8080 npm start  # 포트 변경
```

## Mac Mini 배포

- **서버**: Mac Mini, 사내 IP `172.16.3.136`
- **운영 포트**: `3001`
- **접속 주소**: `http://172.16.3.136:3001`

1. 프로젝트를 Mac Mini로 복사 (git clone 또는 폴더 복사). `node_modules`, `data.db`는 제외.
2. 의존성 설치 및 기동:
   ```bash
   cd cert-schedule-dashboard
   npm install
   PORT=3001 HOST=0.0.0.0 npm start
   ```
3. 같은 사내망 PC 브라우저에서 접속: `http://172.16.3.136:3001`
4. macOS 방화벽이 켜져 있으면 node의 들어오는 연결을 허용 (시스템 설정 → 네트워크 → 방화벽 → 옵션에서 node 허용).

### 상시 구동 (재부팅·크래시 자동 복구) — launchd 권장
`~/Library/LaunchAgents/com.qa.cert-dashboard.plist` 생성:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.qa.cert-dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/계정/cert-schedule-dashboard/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PORT</key><string>3001</string><key>HOST</key><string>0.0.0.0</string></dict>
  <key>WorkingDirectory</key><string>/Users/계정/cert-schedule-dashboard</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/계정/cert-schedule-dashboard/server.log</string>
  <key>StandardErrorPath</key><string>/Users/계정/cert-schedule-dashboard/server.log</string>
</dict>
</plist>
```
`node` 경로는 `which node`로 확인 후 교체. 적용:
```bash
launchctl load ~/Library/LaunchAgents/com.qa.cert-dashboard.plist
launchctl start com.qa.cert-dashboard
```

## 이메일 알림 설정 (선택)
`config.json`이 없으면 알림은 자동으로 생략되고 앱은 정상 동작합니다. 사용하려면:

1. 예시 파일 복사: `cp config.example.json config.json`
2. `config.json`을 열어 Gmail 정보 입력:
   - `smtp.user` / `smtp.pass`: 보내는 Gmail 계정과 **앱 비밀번호 16자리**
     (Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 발급. 일반 로그인 비번 아님)
   - `notifyTo`: 알림 받을 메일 주소 목록 (테스터·PL 등)
   - `baseUrl`: `http://172.16.3.136:3001`
3. 서버 재시작. 기동 로그에 `[notify] 이메일 알림 활성화`가 보이면 적용됨.

> 알림 시점: 의뢰 상태가 **예약확정** 또는 **완료**로 바뀔 때 `notifyTo` 전원에게 발송.
> `config.json`은 비밀번호를 담으므로 git에 올리지 않습니다(.gitignore 처리됨).

## 백업
`data.db` 파일 하나가 전체 데이터입니다. 서버가 매일 1회 `backups/`에 자동 사본을 만들고 최근 14개를 보관합니다. 추가로 원격지에도 주기적으로 복사해 두면 안전합니다.

## 보안 메모
현재 로그인/인증이 없습니다(사내 LAN 신뢰 가정). 역할 토글은 화면 편의 기능일 뿐 권한 경계가 아닙니다. 외부 노출이 필요하면 리버스 프록시 + 인증을 앞단에 두세요.
