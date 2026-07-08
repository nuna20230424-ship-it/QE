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

## 현황보고 (2026-07-08 확정)
- **보드 접힘**: 각 상태 칼럼은 카드 5개까지만 노출, 나머지는 "+N개 더보기/접기" 토글. 펼침 상태는 클라이언트 메모리(state.boardExpanded)만 유지.
- **일일 기준**: 오늘 하루(완료일=오늘). **주간 기준**: 이번 주 월~일(사용자 확정). 완료 집계는 completed_date(없으면 completed_at 날짜) 기준.
- **진행중**: 기간과 무관하게 현재 status='진행중'인 건 전체를 표기(스냅샷 성격).
- **리포트 HTML**: report.js 한 곳에서 인라인 스타일로 생성 → 앱 뷰(#view-daily/weekly)와 이메일 본문에 동일 사용. 이메일 클라이언트가 <style>을 제거하므로 인라인 필수.
- **자동 발송**: scheduler.js가 매일 19시(SEND_HOUR) 일일+주간 2통 발송. setTimeout으로 다음 19시 재예약(상시구동 전제). 수신 기본값은 notify.js DEFAULT_REPORT_TO, config.reportTo로 재정의.
- **Fail 상세**: 완료&판정=Fail 건에 대해 진행사항(progress)+결과코멘트(result)를 별도 블록으로 첨부.

## 실행
- `npm install` 후 `npm start` (기본 PORT 3000, HOST 0.0.0.0). 환경변수 PORT/HOST로 변경 가능.
- 이메일 발송은 config.json의 smtp 설정 필요(미설정 시 앱·스케줄러는 정상 동작하되 발송만 생략).
