// Confluence QE Schedule 이벤트를 인증 대시보드 의뢰 레코드로 반영하는 매핑·동기화 계층
const repo = require('./db');
const parse = require('./confluence-parse');

// Confluence REST 응답을 그대로 받지 않고 아래 정규 형태로 한 번 접어서 받는다.
// Team Calendars 응답의 실제 필드명은 사내망 밖이라 확인하지 못했고, 그 변환은 클라이언트(P3)의 몫이다.
//   { id, title, invitees, start, end, relatedPage, created }

const ACTOR = 'Confluence 동기화';

// 상태 기본값. 사람이 고른 값이 아니므로 빈 칸과 같게 취급한다.
const DEFAULT_STATUS = '예약대기';

const isBlank = (v) => String(v ?? '').trim() === '';

// 지시서 §3 필드 매핑. 이벤트 하나 → 대시보드 필드 + 경고.
// 예약확정일(scheduled_date)은 아예 매핑하지 않는다 — 지시서가 덮어쓰기를 금지한 수동 입력 칸이다.
function mapEvent(event, { lookupRequester } = {}) {
  const ev = event || {};
  const warnings = [];
  const push = (r) => { warnings.push(...r.warnings); return r; };

  const title = push(parse.parseTitle(ev.title));
  const person = push(parse.parsePerson(ev.invitees));
  const start = push(parse.parseDate(ev.start));
  const end = push(parse.parseDate(ev.end));
  const created = push(parse.parseDate(ev.created));

  const fields = {
    cert_type: title.cert_type,
    test_type: title.test_type,
    test_purpose: title.test_purpose,
    model_name: title.model_name,
    round: title.round,
    status: title.status,
    verdict: title.verdict,
    tester: person.name,
    started_date: start.date,
    completed_date: end.date,
    note: String(ev.relatedPage ?? '').trim(),
    desired_date: created.date,
  };

  // 모델명 → 의뢰자 룩업(P4). 매핑표가 아직 없어 주입식으로 두고, 못 찾으면 비운 채 경고만 남긴다.
  if (lookupRequester && fields.model_name) {
    const requester = String(lookupRequester(fields.model_name) ?? '').trim();
    if (requester) fields.requester = requester;
    else warnings.push(`모델명-의뢰자 매핑에 없는 모델입니다: ${fields.model_name}`);
  }

  return { fields, warnings };
}

// 대시보드에 이미 값이 있는 칸은 사람 입력으로 보고 건드리지 않는다 — 빈 칸만 채운다.
// 예외는 status 하나다. DEFAULT '예약대기'로 채워져 있어 그냥 두면 영원히 '값이 있는 칸'이 되고
// Confluence 제목의 진행·결과가 신규 생성 이후로는 한 번도 반영되지 않는다.
// 기본값 그대로면 사람이 고른 게 아니므로 빈 칸과 같게 본다.
function fillBlanks(current, fields) {
  const patch = {};
  for (const [k, v] of Object.entries(fields)) {
    if (isBlank(v)) continue;
    const cur = current[k];
    const blank = k === 'status' ? (isBlank(cur) || cur === DEFAULT_STATUS) : isBlank(cur);
    if (blank && String(cur ?? '') !== String(v)) patch[k] = v;
  }
  return patch;
}

// 이벤트 한 건 반영. 신규면 생성, 이미 있으면 빈 칸만 채운다.
function upsertEvent(event, opts = {}) {
  const eventId = String((event || {}).id ?? '').trim();
  const { fields, warnings } = mapEvent(event, opts);
  const actor = opts.actor || ACTOR;

  if (!eventId) return { action: 'skipped', eventId: '', reason: '이벤트 id가 없습니다.', warnings };
  // 필수 칸을 파싱하지 못하면 빈 의뢰를 만들지 않고 건너뛴다.
  if (!fields.cert_type || !fields.model_name) {
    return { action: 'skipped', eventId, reason: '인증종류 또는 모델명을 파싱하지 못했습니다.', warnings };
  }

  const cur = repo.getByConfluenceEventId(eventId);
  if (!cur) {
    const row = repo.create({ ...fields, confluence_event_id: eventId }, actor);
    return { action: 'created', eventId, id: row.id, warnings };
  }

  const patch = fillBlanks(cur, fields);
  if (!Object.keys(patch).length) return { action: 'unchanged', eventId, id: cur.id, warnings };
  repo.update(cur.id, patch, actor);
  return { action: 'updated', eventId, id: cur.id, changed: Object.keys(patch), warnings };
}

// Confluence에서 사라진 이벤트 — 레코드를 지우지 않고 '중단'으로 돌려 보관한다.
// 완료·중단 건은 건드리지 않는다. 끝난 일을 되돌리면 통계·보고가 뒤집힌다.
// range는 필수다. 조회 기간을 모른 채 돌리면 이번에 받아 오지 않은 기간의 건까지 전부 중단이 된다.
function cancelMissing(events, { range, actor } = {}) {
  if (!range || (!range.from && !range.to)) throw new Error('조회 기간(range) 없이는 삭제 이벤트를 반영할 수 없습니다.');
  const alive = new Set((events || []).map((e) => String((e || {}).id ?? '').trim()).filter(Boolean));
  const out = [];
  for (const row of repo.confluenceRowsInRange(range)) {
    if (alive.has(String(row.confluence_event_id))) continue;
    if (row.status === '완료' || row.status === '중단') continue;
    repo.update(row.id, { status: '중단' }, actor || ACTOR);
    out.push({ id: row.id, eventId: row.confluence_event_id });
  }
  return out;
}

// 이벤트 목록 한 회차를 통째로 반영한다. 한 건이 터져도 나머지는 계속 간다 —
// 동기화는 여러 건을 묶어 처리하므로 한 건 때문에 회차 전체가 멈추면 안 된다.
function syncEvents(events, opts = {}) {
  const result = { created: 0, updated: 0, unchanged: 0, skipped: 0, cancelled: 0, warnings: [], errors: [] };
  for (const event of events || []) {
    const tag = String((event || {}).id ?? '?');
    try {
      const r = upsertEvent(event, opts);
      if (r.action === 'created') result.created += 1;
      else if (r.action === 'updated') result.updated += 1;
      else if (r.action === 'unchanged') result.unchanged += 1;
      else result.skipped += 1;
      if (r.reason) result.warnings.push(`[${tag}] ${r.reason}`);
      for (const w of r.warnings) result.warnings.push(`[${tag}] ${w}`);
    } catch (err) {
      result.errors.push(`[${tag}] ${err.message}`);
    }
  }

  if (opts.range) {
    try { result.cancelled = cancelMissing(events, opts).length; }
    catch (err) { result.errors.push(`삭제 이벤트 반영 실패: ${err.message}`); }
  } else {
    result.warnings.push('조회 기간이 없어 삭제된 이벤트 반영을 건너뜁니다.');
  }

  return result;
}

module.exports = { mapEvent, fillBlanks, upsertEvent, cancelMissing, syncEvents, ACTOR, DEFAULT_STATUS };
