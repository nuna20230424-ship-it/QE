// 사내망에서 한 번 실행해 Confluence Team Calendars 실제 응답 형태를 확인하는 진단 스크립트
// 사용법: node scripts/confluence-probe.js
// 이 스크립트는 읽기만 한다 — 대시보드 DB를 건드리지 않는다.
const fs = require('fs');
const path = require('path');
const client = require('../confluence-client');

const SAMPLE = path.join(__dirname, '..', 'confluence-probe-sample.json');

// 값이 아니라 '어떤 키가 있는지'를 본다. 응답에 사내 일정 내용이 들어 있어 화면에는 키만 뿌린다.
function keysOf(obj, prefix = '', depth = 0, out = []) {
  if (obj === null || typeof obj !== 'object' || depth > 2) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    const kind = Array.isArray(v) ? `array(${v.length})` : (v === null ? 'null' : typeof v);
    out.push(`${p} : ${kind}`);
    if (Array.isArray(v) && v.length) keysOf(v[0], `${p}.0`, depth + 1, out);
    else if (v && typeof v === 'object') keysOf(v, p, depth + 1, out);
  }
  return out;
}

(async () => {
  const missing = client.missing();
  if (missing.length) {
    console.error('설정이 없어 실행할 수 없습니다:');
    for (const m of missing) console.error(`  - ${m}`);
    process.exit(1);
  }

  const c = client.config();
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const from = new Date(now); from.setDate(from.getDate() - 30);
  const to = new Date(now); to.setDate(to.getDate() + 60);

  console.log(`baseUrl        : ${c.baseUrl}`);
  console.log(`subCalendarId  : ${c.subCalendarId}`);
  console.log(`조회 기간      : ${ymd(from)} ~ ${ymd(to)}`);
  console.log('');

  let body;
  try {
    const r = await client.requestEvents({ from: ymd(from), to: ymd(to) });
    body = r.body;
    console.log(`요청 성공: ${r.url}`);
  } catch (err) {
    console.error(`요청 실패: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n최상위 키: ${Object.keys(body || {}).join(', ') || '(배열)'}`);
  const raws = Array.isArray(body) ? body : (body.events || []);
  console.log(`이벤트 수: ${raws.length}`);

  if (!raws.length) {
    console.log('\n이벤트가 없습니다. 기간이나 subCalendarId를 확인한다.');
    return;
  }

  console.log('\n첫 이벤트의 키 구조');
  for (const line of keysOf(raws[0])) console.log(`  ${line}`);

  fs.writeFileSync(SAMPLE, JSON.stringify(raws.slice(0, 3), null, 2), 'utf8');
  console.log(`\n앞 3건을 저장했다: ${SAMPLE}`);
  console.log('이 파일은 .gitignore 대상이다 (사내 일정 내용이 들어 있다).');
  console.log('\n다음 할 일 — 위 키 이름을 config.json confluence.fields 에 채운다.');
  console.log("  relatedPage : '관련 페이지 / 어디서'에 해당하는 키");
  console.log("  created     : 이벤트 생성일자에 해당하는 키");
})();
