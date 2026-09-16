// 개발자도구에서 뜬 subCalendarId 가 QE Schedule 캘린더가 맞는지 확인한다 (config.json 은 건드리지 않는다)
// 사용법: node scripts/calendar-check.js <subCalendarId>
// 읽기 전용 — 일정 제목 원문은 출력하지 않는다. 건수·기간·제목 앞 대괄호 분포만 본다.
const client = require('../confluence-client');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

const id = (process.argv[2] || '').trim();
if (!id) {
  console.error('사용법: node scripts/calendar-check.js <subCalendarId>');
  console.error('  예: node scripts/calendar-check.js 7d8fff49-26c9-4ae6-bb74-bce57adf38b2');
  process.exit(1);
}

(async () => {
  const base = client.config();
  if (!base.token || !base.baseUrl) {
    console.error(`설정이 없어 실행할 수 없습니다: ${client.missing().join(', ')}`);
    process.exit(1);
  }
  const c = { ...base, subCalendarId: id };

  let events;
  try {
    // 넓게 잡는다 — 최근이 비어 있어도 그 캘린더가 무엇인지는 과거 일정으로 알 수 있다.
    const r = await client.requestEvents({ from: shift(-800), to: shift(400) }, c);
    events = (r.body && r.body.events) || [];
  } catch (e) {
    console.error(`조회 실패: ${e.message}`);
    process.exit(1);
  }

  console.log(`subCalendarId : ${id}`);
  console.log(`전체 이벤트   : ${events.length}건 (과거 800일 ~ 향후 400일)`);

  if (!events.length) {
    console.log('\n판정: ❌ 이 id 로는 일정이 하나도 없다. 개발자도구에서 다시 뜬다.');
    process.exitCode = 1;
    return;
  }

  const dates = events.map((e) => String(e.start || '').slice(0, 10)).filter(Boolean).sort();
  console.log(`기간          : ${dates[0]} ~ ${dates[dates.length - 1]}`);

  // 동기화 기본 조회 창(-30/+60)에 실제로 일정이 있는지 — 이번에 0건을 만든 지점이다.
  const from = shift(-30);
  const to = shift(60);
  const recent = dates.filter((d) => d >= from && d <= to).length;
  console.log(`최근 창       : ${recent}건  (${from} ~ ${to})`);

  // 제목 원문 대신 첫 대괄호 값만 — 파서가 여기서 인증종류를 읽는다.
  const bucket = new Map();
  for (const e of events) {
    const m = String(e.title || '').match(/\[([^\]]+)\]/);
    const k = m ? m[1].trim().toLowerCase() : '(대괄호 없음)';
    bucket.set(k, (bucket.get(k) || 0) + 1);
  }
  console.log('제목 첫 대괄호:');
  for (const [k, n] of [...bucket].sort((a, b) => b[1] - a[1])) console.log(`  ${k} : ${n}건`);

  const qe = events.filter((e) => /\[(xts|nts|avts)\]/i.test(String(e.title || ''))).length;
  console.log('');
  if (qe === 0) {
    console.log('판정: ❌ QE Schedule 캘린더가 아니다.');
    console.log('      제목이 [xTS]·[NTS]·[AVTS] 로 시작하는 일정이 하나도 없다.');
    console.log('      개발자도구에서 다른 요청(캘린더)을 골라 다시 확인한다.');
    process.exitCode = 1;
    return;
  }
  console.log(`판정: ✅ QE Schedule 캘린더로 보인다 ([xTS]·[NTS]·[AVTS] ${qe}건).`);
  if (recent === 0) {
    console.log('      다만 최근 창에는 일정이 0건이다 — 동기화해도 당장 들어올 게 없다.');
    console.log('      팀이 이 캘린더를 지금도 쓰는지 확인한다.');
  }
  console.log('');
  console.log('이 id 로 바꾸려면 config.json 의 confluence.subCalendarId 를 교체한다.');
})();
