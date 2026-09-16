// events.json 이 0건으로 나올 때 원인을 갈라 주는 진단 (일정 내용은 출력하지 않는다)
// 사용법: node scripts/confluence-diag.js
// 읽기 전용 — 대시보드 DB도, Confluence도 바꾸지 않는다.
//
// 가르려는 세 가지
//   (1) 토큰이 Team Calendars 플러그인에도 먹는가      → 계정 / 구독 캘린더 수
//   (2) subCalendarId 가 그 계정에 보이는 캘린더인가   → 목록에 그 id 가 있는가
//   (3) 정말로 그 기간에 일정이 없는가                  → success 값과 기간을 바꿔 재조회
const client = require('../confluence-client');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return ymd(d); };

// 값이 스칼라인 키만 보여 준다. 배열·객체는 길이/키 수만 — 일정 내용이 새지 않게.
function summarize(body) {
  if (Array.isArray(body)) return `(배열 ${body.length}건)`;
  if (!body || typeof body !== 'object') return String(body);
  return Object.entries(body).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}=배열(${v.length})`;
    if (v && typeof v === 'object') return `${k}={${Object.keys(v).length}키}`;
    return `${k}=${v}`;
  }).join('  ');
}

async function get(c, path) {
  const url = `${c.baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* HTML 로그인 페이지일 수 있다 */ }
  return { url, status: res.status, body, text };
}

(async () => {
  const c = client.config();
  if (!c.token || !c.baseUrl || !c.subCalendarId) {
    console.error(`설정이 없어 실행할 수 없습니다: ${client.missing().join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // ---- 1. 토큰이 누구로 인식되는가 ----
  const auth = await client.checkAuth(c);
  console.log(`[1] 계정        : ${auth.who || '(없음)'} ${auth.authenticated ? '✅ 인증됨' : '❌ 익명/거부'}`);
  if (!auth.authenticated) {
    console.log('    → 토큰이 안 붙었다. scripts/pat-check.js 부터 다시 본다.');
    process.exitCode = 1;
    return;
  }

  // ---- 2. 이 계정에 보이는 캘린더 목록 ----
  // Team Calendars 는 별도 플러그인이라 /rest/api/** 와 인증 처리가 다를 수 있다.
  // 여기서 0개가 나오면 토큰이 플러그인에는 안 먹는 것이다.
  const subs = await get(c, '/rest/calendar-services/1.0/calendar/subcalendars.json');
  const list = (subs.body && (subs.body.payload || subs.body.subCalendars)) || [];
  console.log(`[2] 구독 캘린더 : ${subs.status} · ${Array.isArray(list) ? list.length + '개' : summarize(subs.body)}`);
  if (Array.isArray(list) && list.length) {
    // 이름은 찍지 않는다. 우리 id 가 그 안에 있는지만 본다.
    const ids = list.map((s) => String((s.subCalendar && s.subCalendar.id) || s.id || ''));
    const hit = ids.includes(c.subCalendarId);
    console.log(`    subCalendarId 일치: ${hit ? '✅ 목록에 있다' : '❌ 목록에 없다'}`);
    if (!hit) console.log(`    → 이 계정에 보이는 캘린더가 ${ids.length}개인데 그중에 없다. id 를 다시 확인한다.`);
  } else if (Array.isArray(list)) {
    console.log('    → 0개다. 토큰이 Team Calendars 플러그인에는 적용되지 않는 것으로 보인다.');
  }

  // ---- 3. 기간을 넓혀 가며 events.json 재조회 ----
  console.log('[3] events.json');
  for (const [label, back, ahead] of [['기본(-30/+60)', -30, 60], ['넓게(-180/+180)', -180, 180]]) {
    try {
      const r = await client.requestEvents({ from: shift(back), to: shift(ahead) }, c);
      const raws = Array.isArray(r.body) ? r.body : (r.body && r.body.events) || null;
      console.log(`    ${label} : ${raws ? raws.length + '건' : 'events 키 없음'}  ·  ${summarize(r.body)}`);
    } catch (e) {
      console.log(`    ${label} : 실패 — ${e.message}`);
    }
  }

  console.log('');
  console.log('읽는 법');
  console.log('  [2]가 0개  → 토큰이 플러그인에 안 먹는다. 가이드 3-B(개발자도구 Copy response)로 우회한다.');
  console.log('  [2]에 없음 → subCalendarId 가 틀렸다. 가이드 3단계에서 다시 확인한다.');
  console.log('  [3] success=false → 서버가 요청을 거부한 것이다. 같이 찍힌 키를 알려 주면 맞춘다.');
  console.log('  넓게도 0건    → 정말 그 캘린더에 일정이 없다. 캘린더를 잘못 고른 것일 수 있다.');
})();
