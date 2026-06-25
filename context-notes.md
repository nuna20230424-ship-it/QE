# 컨텍스트 노트 — 인증 일정 대시보드

## 결정 사항
- **결과물**: 실제 동작하는 웹 대시보드 앱 (서브에이전트 정의 아님).
- **스택**: Node.js(Express) + 정적 프런트(빌드 단계 없음). 사용자는 GAS 경험이 풍부하지만 Mac Mini 서버를 별도로 제공해 자체 호스팅 선택.
- **DB**: better-sqlite3 (동기식, macOS/Windows 프리빌드 제공 → Mac Mini 네이티브 컴파일 부담 최소). 파일 DB `data.db`, WAL 모드.
- **인증**: 없음. 사내 LAN 신뢰 환경 가정. 역할(의뢰자/테스터)은 localStorage 토글일 뿐 보안 경계가 아님. 외부 노출 시 reverse proxy + 인증 필요.

## 데이터 모델 (requests)
- 의뢰자(개발 PL) 입력 영역: cert_type(넷플릭스/구글), model_name, fw_version, request_item, requester, note, desired_date(희망일정).
- 테스터 입력 영역: scheduled_date(예약확정), tester, status, progress, result.
- 상태 흐름: 예약대기 → 예약확정 → 진행중 → 완료 / 보류.

## UI 설계 의도
- **현황 보드**: 상태별 5컬럼 칸반. 한눈에 진행 분포 파악.
- **일정표**: 예약일(없으면 희망일) 정렬 테이블. 일정 공유 목적.
- 모달 한 폼에 의뢰 정보 / 진행·결과 두 fieldset. 역할에 따라 반대 영역 `disabled` 처리해 책임 분리.
- 신규 등록 시 진행/결과 영역은 비활성(의뢰 시점엔 불필요).

## 미해결 / 확인 필요
- **서버 IP**: `172.16.3.136`으로 확정 (2026-06-23). 운영 포트 `3001`, 접속 주소 `http://172.16.3.136:3001`.
- Mac Mini의 Node 버전 미확인. README에 Node 18+ 권장 명시.

## 지연(overdue) 정의 (2026-06-25 확정)
- 지연 = **예약 확정일(scheduled_date)이 오늘보다 이전인데 아직 `진행중`으로 전환되지 않은 건** (상태가 `예약대기`/`예약확정`로 잔류).
- 희망일(desired_date)은 지연 기준에서 제외. 진행중/완료/보류/중단 상태는 지연 아님.

## 실행
- `npm install` 후 `npm start` (기본 PORT 3000, HOST 0.0.0.0). 환경변수 PORT/HOST로 변경 가능.
