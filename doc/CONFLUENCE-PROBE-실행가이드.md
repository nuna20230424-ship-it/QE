# [실행가이드] Confluence 응답 키 확인 — `scripts/confluence-probe.js`

**목적** — 대시보드가 Confluence 응답의 **어느 키에서 값을 가져올지 확정**하기 위해 실제 응답을 한 번 찍어 본다.
특히 `관련 페이지 / 어디서`(→비고)와 `이벤트 생성일자`(→희망일정)는 Team Calendars 커스텀 필드라
키 이름을 문서로 확인할 수 없었다. 추측해서 넣지 않고 실물을 보고 채운다.

**읽기 전용이다.** 대시보드 DB도, Confluence도 바꾸지 않는다. GET 한 번 하고 결과를 출력한다.

---

## 0. 실행 조건

| 항목 | 확인 방법 |
|---|---|
| 사내망 접속 | 브라우저에서 `https://confluence.kaonmedia.com` 이 열리는지 |
| Node 18 이상 | `node -v` (동기화는 내장 `fetch`를 쓴다) |
| 실행 위치 | 사내망 안의 **개발 PC `C:\Users\k251110\Desktop\QE`** (권장) 또는 맥미니 배포 폴더 |

> 개발 PC에서 하는 걸 권한다. 맥미니는 배포 후에 같은 설정을 한 번 더 넣으면 된다.

---

## 1. 준비물은 세 가지 — 이제 PAT 하나만 남았다

| 값 | 넣는 곳 | 상태 |
|---|---|---|
| Confluence PAT | `.env` 의 `CONFLUENCE_PAT` | ❌ **남은 것** → 2단계 |
| baseUrl | `config.json` 의 `confluence.baseUrl` | ✅ 반영됨 |
| subCalendarId | `config.json` 의 `confluence.subCalendarId` | ✅ 반영됨 (2026-09-10 개발자도구 확인) |

> **2026-09-10 확인 결과** — 실제 요청의 쿼리 파라미터는
> `subCalendarId` · `userTimeZoneId=Asia/Seoul` · `start` · `end` · `_`(캐시 방지용 타임스탬프)였다.
> `start`·`end`는 날짜가 아니라 **ISO 인스턴트**(`2026-06-26T00:00:00Z`)로 보내므로 클라이언트를 그 형식에 맞췄다.
> `_`는 브라우저 캐시 방지용이라 서버 동작에 필요하지 않아 넣지 않았다.
>
> **아직 확인 못 한 것은 경로(path)뿐이다.** 스크립트는
> `/rest/calendar-services/1.0/calendar/events.json` 을 쓴다 — 실행해서 404가 나면 그 경로가 다른 것이고,
> 그때 개발자도구 Request URL의 `?` 앞부분을 알려 주면 맞춘다.

3단계(subCalendarId 찾기)는 이미 끝났으므로 **2 → 4 → 5 순서로 진행하면 된다.**

---

## 2. PAT 발급

Confluence 우측 상단 **프로필 아이콘 → 개인 액세스 토큰(Personal Access Tokens) → Create token**.

바로 가는 주소는 보통 이렇다.

```
https://confluence.kaonmedia.com/plugins/personalaccesstokens/usertokens.action
```

- 이 메뉴가 **없으면** 관리자가 PAT 기능을 껐거나 버전이 낮은 것이다 → **3-B**로 진행한다.
- 권한은 **읽기만** 있으면 된다. 만료일은 짧게 잡는다(작업이 끝나면 폐기해도 된다).
- 토큰 값은 **발급 화면에서 한 번만 보인다.** 바로 `.env`에 넣는다.
- ⚠️ 토큰을 **채팅·문서·커밋에 붙여넣지 않는다.** 필요한 건 토큰이 아니라 응답의 키 이름이다.

---

## 3. subCalendarId 찾기 — 브라우저 개발자도구가 가장 확실

이 방법은 subCalendarId와 **엔드포인트 경로를 동시에** 확인해 준다.
스크립트가 쓰는 경로(`/rest/calendar-services/1.0/calendar/events.json`)는 **문서로만 확인한 것이라
실제 서버와 다를 수 있다.** 여기서 실물을 보고 맞춘다.

1. 브라우저에서 QE Team 페이지를 연다.
   `https://confluence.kaonmedia.com/display/GQE/[G]+QE+Team`
2. **F12** → **Network(네트워크)** 탭 → 필터 입력창에 `calendar` 입력
3. **QE Schedule 캘린더가 보이도록 스크롤**하거나 **월 이동(‹ ›) 버튼을 한 번 클릭**한다
   → 요청 목록에 `events.json...` 같은 항목이 나타난다
4. 그 요청을 클릭 → **Headers** 탭의 **Request URL** 을 본다

```
https://confluence.kaonmedia.com/rest/calendar-services/1.0/calendar/events.json
    ?subCalendarId=XXXXXXXXXXXX&userTimeZoneId=Asia%2FSeoul&start=...&end=...
```

- `subCalendarId=` **뒤의 값**이 필요한 것이다.
- **경로가 위와 다르면 그 URL을 알려 주세요.** `confluence-client.js` 의 `EVENTS_PATH` 를 맞춰야 한다.
- 캘린더가 여러 개면 요청도 여러 개 뜬다 → **Response** 탭을 열어 QE 일정 제목
  (`[xTS]...`, `[NTS]...`)이 들어 있는 요청을 고른다.

### 3-B. PAT를 못 쓰는 경우 (대안)

PAT 메뉴가 없거나 발급이 막혀 있으면 스크립트 없이도 진행할 수 있다.
위 3단계에서 그 요청을 **우클릭 → Copy → Copy response** 한 뒤 파일로 저장해 주시면
제가 키를 읽어 `fields`를 채운다.

- 파일로만 전달해 주세요(사내 일정 내용이 들어 있어 채팅에 붙여넣는 건 권하지 않는다).
- 저장 위치를 알려 주시면 제가 읽는다. 예: `C:\Users\k251110\Desktop\QE\confluence-probe-sample.json`
  (이 파일명은 이미 `.gitignore` 처리되어 있다.)

---

## 4. 설정 파일 두 개 채우기

### 개발 PC (PowerShell)

```powershell
cd C:\Users\k251110\Desktop\QE

# 1) PAT — .env 에만 둔다 (.gitignore 대상이라 커밋되지 않는다)
Set-Content -Path .env -Value 'CONFLUENCE_PAT=발급받은-토큰' -Encoding utf8

# 2) config.json 에 confluence 섹션이 없으면 예시를 참고해 추가한다
notepad config.example.json   # confluence 섹션을 복사
notepad config.json           # 붙여넣고 baseUrl · subCalendarId 를 채운다
```

`config.json` 의 `confluence` 부분이 최소 이렇게 되면 된다.

```json
"confluence": {
  "baseUrl": "https://confluence.kaonmedia.com",
  "subCalendarId": "3단계에서 확인한 값",
  "timeZone": "Asia/Seoul",
  "pollMinutes": 5,
  "fields": {
    "id": "id", "title": "title", "invitees": "invitees",
    "start": "start", "end": "end",
    "relatedPage": "", "created": ""
  }
}
```

> `relatedPage`·`created` 는 **지금은 비워 둔다.** 이 스크립트로 확인한 뒤 채운다.

### 맥미니 (bash)

```bash
cd ~/배포폴더            # 실제 경로로
printf 'CONFLUENCE_PAT=발급받은-토큰\n' > .env
chmod 600 .env
```

---

## 5. 실행

```powershell
cd C:\Users\k251110\Desktop\QE
node scripts/confluence-probe.js
```

어느 폴더에서 실행해도 동작한다(설정 파일은 스크립트 위치 기준으로 찾는다).
그래도 QE 폴더에서 하는 게 헷갈리지 않는다.

---

## 6. 성공하면 이런 모양으로 나온다

아래는 가짜 응답 서버로 확인한 **출력 형식**이다(값은 실제와 다르다).

```
baseUrl        : https://confluence.kaonmedia.com
subCalendarId  : abc123-...
조회 기간      : 2026-08-11 ~ 2026-11-09

요청 성공: https://confluence.kaonmedia.com/rest/calendar-services/1.0/calendar/events.json?subCalendarId=...

최상위 키: success, events
이벤트 수: 1

첫 이벤트의 키 구조
  id : string
  title : string
  start : string
  end : string
  allDay : boolean
  invitees : array(1)
  invitees.0.name : string
  invitees.0.displayName : string
  invitees.0.type : string
  customEventTypeId : string
  subCalendarId : string
  ...

앞 3건을 저장했다: ...\confluence-probe-sample.json
```

- **`첫 이벤트의 키 구조` 블록이 목적물이다.** 키 이름만 나오므로 일정 내용은 새지 않는다.
- 앞 3건은 `confluence-probe-sample.json` 으로 저장된다(`.gitignore` 대상).

---

## 7. 실패하면

| 화면에 나오는 것 | 뜻 | 할 일 |
|---|---|---|
| `설정이 없어 실행할 수 없습니다` + 목록 | `.env`·`config.json` 이 덜 채워짐 | 목록에 적힌 값을 4단계대로 채운다 |
| `요청 실패: Confluence 응답 401 Unauthorized` | PAT가 틀렸거나 만료 | 토큰 재발급, `.env` 오타 확인 |
| `... 403 Forbidden` | 계정에 그 캘린더 열람 권한이 없음 | 캘린더 소유자에게 열람 권한 요청 |
| `... 404 Not Found` | **엔드포인트 경로가 실제와 다름** | 3단계의 Request URL을 알려 주세요 |
| `fetch failed` / `ETIMEDOUT` | 사내망 밖이거나 프록시에 막힘 | VPN·사내망 연결 확인 |
| `응답에서 events 배열을 찾지 못했다` | 응답 구조가 예상과 다름 | 3-B로 응답 원문을 전달해 주세요 |
| `이벤트 수: 0` | 기간에 일정이 없거나 subCalendarId가 다름 | 3단계 재확인 (캘린더가 여럿일 수 있다) |

---

## 8. 결과 전달

아래 중 **하나만** 주시면 된다.

1. 화면의 **`첫 이벤트의 키 구조`** 블록을 그대로 붙여넣기 (키 이름만이라 안전하다)
2. 또는 `confluence-probe-sample.json` **파일 위치**만 알려 주기 (제가 읽는다)

그걸로 다음을 마무리한다.

- `config.json confluence.fields` 의 `relatedPage`·`created` 확정
- 필요하면 `confluence-client.js` 의 `EVENTS_PATH`·쿼리 파라미터 이름 수정
- `invitees` 경로 조정 (예: `invitees` → `invitees.0.displayName`)
- 스모크에 실제 응답 형태 기반 케이스 추가

---

## 보안 메모

- PAT는 `.env` 에만 둔다. 채팅·커밋·문서에 넣지 않는다. `.env` 는 `.gitignore` 대상이다.
- 스크립트는 토큰을 **Authorization 헤더로만** 보낸다. URL·로그에 싣지 않는다(스모크로 고정).
- `confluence-probe-sample.json` 에는 사내 일정 내용이 들어 있다. 확인이 끝나면 지워도 된다.
- 작업이 끝나면 PAT를 폐기하고 운영용으로 새로 발급해도 된다(맥미니 `.env` 에 넣을 것).
