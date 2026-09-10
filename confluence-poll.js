// Confluence QE Schedule 이벤트를 주기적으로 끌어와 대시보드에 반영하는 폴링 러너
const client = require('./confluence-client');
const sync = require('./confluence-sync');
const repo = require('./db');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

let timer = null;
let last = null;
// 폴링과 수동 버튼이 동시에 들어올 수 있다. 겹쳐 돌면 같은 이벤트를 두 번 반영하려 하고
// 삭제 판정이 서로 다른 순간의 목록을 보게 되므로 한 번에 하나만 돈다.
let running = false;

// 조회 기간. 삭제 판정이 이 기간 안에서만 일어나므로(P2 계약) 과거를 무리하게 넓게 잡지 않는다.
function rangeOf(now = new Date()) {
  const c = client.config();
  const from = new Date(now); from.setDate(from.getDate() - c.rangeBackDays);
  const to = new Date(now); to.setDate(to.getDate() + c.rangeAheadDays);
  return { from: ymd(from), to: ymd(to) };
}

// fetchEvents·range 를 주입할 수 있다. 스모크가 실제 Confluence를 호출하지 않고
// 집계·실패 격리를 검증하기 위한 이음새다.
// 모델명 → 의뢰자. config.json 의 명시 매핑이 1순위, 없으면 대시보드 이력의 최신 의뢰자.
// 둘 다 없으면 빈 문자열을 돌려주고, 동기화가 '매핑에 없는 모델' 경고를 남긴다.
function lookupRequester(model, map) {
  const m = map || client.config().requesterByModel || {};
  const name = String(m[model] || '').trim();
  return name || repo.requesterOfModel(model);
}

async function runOnce({ actor, fetchEvents, range: rangeIn } = {}) {
  if (running) return { ...(last || {}), busy: true };
  // 조회를 주입받았으면 설정 확인을 건너뛴다 — 주입한 쪽이 이미 조회 경로를 갖고 있다.
  if (!fetchEvents && !client.configured()) {
    last = {
      at: new Date().toISOString(), ok: false,
      reason: `Confluence 설정이 없어 동기화를 건너뜁니다: ${client.missing().join(', ')}`,
    };
    return last;
  }

  running = true;
  const range = rangeIn || rangeOf();
  try {
    const fetched = await (fetchEvents || client.fetchEvents)(range);
    const r = sync.syncEvents(fetched.events, { range, actor: actor || sync.ACTOR, lookupRequester });
    last = {
      at: new Date().toISOString(), ok: true, range,
      fetched: fetched.events.length,
      created: r.created, updated: r.updated, unchanged: r.unchanged, skipped: r.skipped, cancelled: r.cancelled,
      warnings: [...fetched.warnings, ...r.warnings], errors: r.errors,
    };
  } catch (err) {
    // 조회·반영이 실패해도 서버는 계속 떠 있어야 한다. 실패 사실만 남기고 다음 회차를 기다린다.
    last = { at: new Date().toISOString(), ok: false, reason: err.message, range };
  } finally {
    running = false;
  }
  return last;
}

function status() {
  const c = client.config();
  return {
    configured: client.configured(),
    missing: client.missing(),
    pollMinutes: c.pollMinutes,
    polling: !!timer,
    last,
  };
}

function start() {
  if (!client.configured()) {
    console.log(`[confluence] 설정 없음 → 동기화 생략 (${client.missing().join(', ')})`);
    return;
  }
  const min = client.config().pollMinutes;
  console.log(`[confluence] ${min}분 주기 동기화 시작`);
  runOnce().catch((e) => console.error('[confluence] 최초 동기화 오류:', e.message));
  timer = setInterval(() => {
    runOnce().catch((e) => console.error('[confluence] 동기화 오류:', e.message));
  }, min * 60000);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, status, start, stop, rangeOf, lookupRequester };
