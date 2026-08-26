# 넷플릭스 · 구글 인증 일정 대시보드

개발 PL이 인증 의뢰를 **예약**하고, 테스터가 **일정·진행·결과**를 공유하는 사내 웹 대시보드.

- 백엔드: Node.js + Express + better-sqlite3 (파일 DB `data.db`)
- 프런트: 정적 HTML/CSS/JS (빌드 단계 없음)
- 뷰: **현황 보드**(상태별 칸반) · **일정표**(일정순 테이블) · **캘린더**(월간) · **일일보고 / 주간보고** · **인증 통계**(모델 × 인증 × Test 목적) · 병목 경고 위젯 · 등록/상세 모달
- 현황 보드는 상태 칼럼당 카드 **5개까지만** 표시하고 초과분은 `+N개 더보기 / 접기` 토글로 접음
- 상단 **요약 위젯**: 전체/대기·진행/완료/지연/평균 소요일/테스터 부하
- 역할: **의뢰자 / 테스터** 토글로 편집 영역 분리 (이름 입력 시 변경 이력에 기록)
- **변경 이력**: 의뢰별 등록·수정·삭제 기록(작업자·시각·내용)
- **이메일 알림**: 예약확정·완료 시 (config.json 설정 시)
- **일일/주간 현황보고**: 완료 모델 Pass/Fail 현황, Fail은 진행/결과 코멘트 첨부, 진행중·완료 건수 정리. 화면 확인 + **매일 오후 7시 자동 메일**(config.json 설정 시)
- **자동 백업**: `data.db`를 매일 1회 `backups/`로 사본(최근 14개 보관)

## 데이터 항목
| 영역 | 항목 |
|------|------|
| 의뢰 정보 (개발 PL) | 인증종류(Netflix NTS / Google xTS / Amazon AVTS), Test type(IR/LR/MR/파생), Test 목적(3PL/Official/Pre-Test/양산/self/MR + 직접입력), 진행차수(자동 산출·수정 가능), 모델명(드롭다운+직접입력), FW 버전, 의뢰자(드롭다운+직접입력), 희망일정, 비고 |
| 진행/결과 (테스터) | 예약확정 일정, 시작 일정, 완료 일정, 담당 테스터(드롭다운+직접입력), 상태, 판정(Pass/Fail/Drop), 진행사항, 결과 코멘트 |

모델명은 **이전에 한 번이라도 입력된 값**이 드롭다운으로 뜨고(중복은 `DISTINCT`로 제거), 목록에 없는 값은 그대로 직접 입력하면 된다.

`Test 목적`과 `담당 테스터`는 드롭다운에서 **`+ 직접 입력`**을 고르면 옆에 입력칸이 열려 목록에 없는 값을 쓸 수 있다. 직접 입력한 Test 목적은 **한 번 저장되면 다음 의뢰부터 드롭다운에 자동으로 뜬다**(모델명과 동일하게 `DISTINCT` 조회, `/api/options`). 기본 목록 뒤·`+ 직접 입력` 앞에 붙고, 인증 통계에서 별도 행으로 잡히며 진행차수 산출 키로도 그대로 쓰인다. 담당 테스터는 기존대로 누적되지 않는다.

상태 흐름: `예약대기 → 예약확정 → 진행중 → 완료 / 보류 / 중단` (확정·시작·완료 시각 자동 기록 → 평균 소요일 산출). 완료 건은 보드·일정표에서 **`진행차수 3차, Pass`** 형태의 배지로 표시(Pass 파란색 · Fail 빨간색).

## 인증 통계 (모델별)
**인증 통계** 탭에서 **모델 × 인증종류 × Test 목적**별로 다음을 집계한다. 상단에서 **주간(월~금)**과 **전체 누적**을 전환하고, 주간 모드에서는 `‹ 8/24~8/28 ›`로 주를 넘긴다(대상 기간은 `2026-08-24 ~ 2026-08-28 (월~금)`로 함께 표기). **⤓ 엑셀 다운로드**는 화면에 보이는 집계를 그대로 CSV(UTF-8 BOM)로 내려받는다 — 파일명 `인증통계_2026-08-24_2026-08-28.csv`, 첫 줄에 대상 기간, 마지막 줄에 합계.

| 지표 | 정의 |
|------|------|
| 결과 | 그 조합의 **최신 판정** — `Pass`는 파란 볼드, `Fail`은 빨간 음영 + 흰 볼드 |
| Test 목적 | 3PL / Official / Pre-Test / 양산 / self / MR |
| 진행차수 | **최신 판정 건의 `Round`** (Round 미입력 시 판정 건수로 대체) |
| Pass / Fail | 판정별 건수 |
| Pass율 / Fail율 | **판정 완료 건수** 대비 비율 |

> **미판정 건은 집계 대상에서 제외**하므로 분모는 판정이 끝난 건수이고 **Pass율 + Fail율 = 100%**다. 판정 건이 0이면 비율은 0%로 반환한다(0 나눗셈 방어).

같은 집계를 **주간보고** 하단에 `모델별 인증 현황` 섹션으로 분리해 싣는다. 이 섹션만 **해당 주차 월~금** 기준이고, 주간보고 본문(완료·진행중 집계)은 기존대로 월~일이다. 주차 포함 여부는 시작일~완료일 구간이 주차와 겹치는지로 판정한다.

## 진행차수 자동 산출
의뢰요청 폼에서 **모델명**과 **Test 목적**이 정해지면 `GET /api/next-round`를 호출해 진행차수를 자동으로 채운다. 조회 중에는 스피너가 돌고 입력이 잠겨 중복 입력을 막는다.

| 직전 이력 | 산출 |
|-----------|------|
| 직전 판정이 `Fail` | 직전 차수 **+ 1** (3차 Fail → **4차**) |
| 직전 판정이 `Pass` | **1차** (새 사이클 시작) |
| 판정 이력 없음 | **1차** |

- 이력 조회 키는 **(모델명 × Test 목적)**이며 인증종류는 조건에 넣지 않는다.
- 판정이 끝난 건(Pass/Fail)만 이력으로 센다. 미판정 건은 차수에 영향을 주지 않는다.
- 산출값은 **제안일 뿐이라 직접 수정할 수 있고**, 한 번 손으로 고치면 이후 자동값이 덮어쓰지 않는다.
- 입력칸 옆 **ⓘ**를 누르면 `왜 4차인지`를 이전 차수 타임라인(차수 · 결과 · 일자 · 코멘트)으로 보여준다.

## 병목 경고 위젯
현황 보드 상단에 리스크 건을 끌어올린다. 없으면 위젯 자체가 숨는다.

| 경고 | 기준 (기본값) |
|------|---------------|
| 반복 Fail | 최신 판정이 `Fail`이면서 진행차수 **5차 이상** |
| 장기 미판정 | 판정 없이 **14일**을 넘긴 채 종료되지 않은 건 (클릭 시 상세 열림) |

임계값은 `GET /api/bottlenecks?round=5&days=14`로 조정한다. Pass로 끝난 조합은 반복 Fail 경고에서 빠진다.

## 로컬 실행
```bash
npm install
npm start            # 기본 http://localhost:3000
PORT=8080 npm start  # 포트 변경
npm test             # 스모크 테스트 61건
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
   - `notifyTo`: 상태변경 알림(예약확정·완료)을 받을 메일 주소 목록 (테스터·PL 등)
   - `reportTo`: 일일/주간 현황보고를 받을 메일 주소 목록. 생략하면 코드 기본값(`nuna20230424@gmail.com`, `keonhee.cho@kaongroup.com`)으로 발송
   - `baseUrl`: `http://172.16.3.136:3001`
3. 서버 재시작. 기동 로그에 `[notify] 이메일 알림 활성화`가 보이면 적용됨.

> 상태변경 알림: 의뢰 상태가 **예약확정** 또는 **완료**로 바뀔 때 `notifyTo` 전원에게 발송.
> `config.json`은 비밀번호를 담으므로 git에 올리지 않습니다(.gitignore 처리됨).

## 일일/주간 현황보고
- **일일보고 / 주간보고** 탭에서 언제든 현황을 확인합니다. 일일 = 오늘, 주간 = 이번 주 월~일 기준.
- 구성: 요약(완료·Pass·Fail·진행중 건수) → 완료 모델 Pass/Fail 표 → **Fail 상세**(모델별 진행사항 + 결과 코멘트) → 진행중 모델 표.
- **자동 발송**: 서버가 **매일 오후 7시**에 일일·주간 보고 2통을 `reportTo`(미설정 시 기본값)로 메일 발송합니다. 상시 구동(launchd) 전제이며, SMTP 미설정 시 앱은 정상 동작하되 발송만 생략됩니다.
- 각 보고 화면의 **✉ 지금 메일 발송** 버튼으로 7시를 기다리지 않고 즉시 테스트할 수 있습니다.

## 백업
`data.db` 파일 하나가 전체 데이터입니다. 서버가 매일 1회 `backups/`에 자동 사본을 만들고 최근 14개를 보관합니다. 추가로 원격지에도 주기적으로 복사해 두면 안전합니다.

## 보안 메모
현재 로그인/인증이 없습니다(사내 LAN 신뢰 가정). 역할 토글은 화면 편의 기능일 뿐 권한 경계가 아닙니다. 외부 노출이 필요하면 리버스 프록시 + 인증을 앞단에 두세요.
