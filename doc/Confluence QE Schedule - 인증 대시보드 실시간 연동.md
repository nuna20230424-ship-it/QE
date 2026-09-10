# [작업지시서] Confluence QE Schedule - 인증 대시보드 실시간 연동

## 1. 작업 개요
- **목적:** 사내 Confluence 페이지의 'QE Schedule' 캘린더 데이터를 사내 인증 대시보드(http://172.16.3.136:3001/)에 실시간으로 동기화
- **핵심 목표:** Confluence 일정 등록/수정/삭제 이벤트 발생 시 대시보드 DB(인증 현황)에 즉시 자동 업데이트 및 데이터 파싱 적용

## 2. 대상 시스템 및 인증 정보
- **Source (Confluence):**
  - URL: `https://confluence.kaonmedia.com/display/GQE/[G]+QE+Team`
  - 대상: 메인 페이지 내 **QE Schedule** Team Calendar 이벤트
  - 인증 방식: Confluence Personal Access Token (PAT) - `.env` 환경 변수로 관리
- **Target (인증 대시보드):**
  - URL: `http://172.16.3.136:3001/`
  - 타겟 메뉴: **QE - Netflix, Google, Amazon 인증 일정 대시보드 > 인증 현황**

## 3. 필드 매핑 및 데이터 가공 규칙

Confluence 캘린더 폼 입력값 데이터 구조와 대시보드 DB 필드 매핑 명세입니다.

| Confluence (QE Schedule) 필드 | 데이터 예시 | 대시보드 (인증 현황) 필드 | 가공 및 매핑 로직 |
| :--- | :--- | :--- | :--- |
| **무엇을** (Title) | `[xTS][Pre] O2_KSTB7268] 1st > Passed` | 인증종류, Test type, Test 목적, 모델명, 진행/결과 | 정규식을 사용하여 텍스트 파싱 (세부 로직 참고) |
| **이벤트 유형 / 누구와** | `Haechan.lee 이해찬 (haechan)` | 담당 테스터 | 사용자 성명 또는 ID 추출 (`이해찬`) |
| **시작** | `2026. 9. 7.` | 진행 / 결과 > 시작일 | Date 포맷 변환 (`YYYY-MM-DD`) |
| **종료** | `2026. 9. 9.` | 진행 / 결과 > 완료일 | Date 포맷 변환 (`YYYY-MM-DD`) |
| **관련 페이지 / 어디서** | `https://jira.kaonmedia.com/browse/KG25040-492` | 비고 | Jira 링크 또는 참고 URL 저장 |
| **이벤트 생성일자** | `2026-09-07` | Test 희망일정 | Confluence 이벤트 생성 시점의 날짜 매핑 |
| *(파싱된 모델명)* | `O2_KSTB7268` | 의뢰자 | 사전 정의된 **[모델명-의뢰자 DB]** 룩업 후 자동 매핑 |
| *(대시보드 전용)* | N/A | 예약 확정일 | **수동 입력 필드.** DB Update(Upsert) 시 기존 값 유지/덮어쓰기 금지 |

---

## 4. '무엇을' 필드 파싱 정규식(Regex) 명세

입력 텍스트 패턴 예시:
- 예시 1: `[xTS][Pre] O2_KSTB7268] 1st > Passed`
- 예시 2: `[xTS][IR][Pre-test] O2_KSTB7268 > In-Progress`

### 파싱 토큰 분류 기준
1. **인증종류:** 첫 번째 대괄호 `[...]` 내부 값 (예: `xTS` -> Google xTS)
2. **Test type / Test 목적:** 두 번째(및 추가) 대괄호 `[...]` 내부 값 (예: `Pre`, `IR`, `Pre-test`)
3. **모델명:** 대괄호가 끝난 후 `>` 기호 이전 또는 회차 표기 전의 모델 코드 (예: `O2_KSTB7268`)
4. **진행 / 결과:** `>` 구분자 뒤의 상태 문자열 (예: `Passed`, `In-Progress`, `Failed`)

### 파싱 권장 정규식 패턴 (Python/JS 예시)
```regex
^\[(?P<cert_type>[^\]]+)\](?:\[(?P<test_type>[^\]]+)\])+\s*(?P<model>[^\s\]]+)\]?\s*(?P<extra>[^>]+)?\s*>\s*(?P<status>.+)$