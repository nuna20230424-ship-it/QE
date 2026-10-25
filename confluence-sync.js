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
  // 희망일정 — Team Calendars 이벤트 응답에는 생성일자 키가 아예 없다(2026-09-16 실물 확인).
  // 사용자 결정에 따라 이벤트 시작일로 대체한다. created 가 매핑돼 오면 그쪽을 우선한다.
  const created = ev.created ? push(parse.parseDate(ev.created)) : start;

  // 여러 캘린더에서 합친 일정(mergeAcrossCalendars)은 나머지 담당자가 서브 테스터가 된다.
  // 담당자 칸이 빈 캘린더도 있어 빈 이름은 경고 없이 건너뛴다.
  const subs = [];
  for (const text of ev.coInvitees || []) {
    const name = parse.parsePerson(text).name;
    if (name && name !== person.name && !subs.includes(name)) subs.push(name);
  }

  const fields = {
    cert_type: title.cert_type,
    test_type: title.test_type,
    test_purpose: title.test_purpose,
    model_name: title.model_name,
    round: title.round,
    fw_version: title.fw_version,
    status: title.status,
    verdict: title.verdict,
    tester: person.name,
    tester_sub: subs.join(', '),
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

// 모델명 표기 흔들림을 흡수한다. `HCN_KSTB1157` · `HCN KSTB1157` · `HCN-KSTB1157` 은 같은 모델이다.
const normModel = (s) => String(s ?? '').toLowerCase().replace(/[\s_/+\-.]/g, '');

const shiftDay = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// 같은 일정을 사람이 먼저 입력해 둔 건을 찾는다. 이벤트 id 로만 중복을 보면 수기 의뢰와 겹쳐
// 또 만든다 — 2026-09-18 운영에서 8건 중 5건이 그렇게 중복됐다.
//   모델명(표기 정규화) + 인증종류 + 시작일(±1일) 이 맞으면 같은 건으로 본다.
// 차수가 양쪽에 다 있고 다르면 다른 회차다. 같은 거리에 후보가 둘 이상이면 판정하지 않는다 —
// 엉뚱한 건에 갖다 붙이는 것이 중복을 하나 더 만드는 것보다 고치기 어렵다.
// aliveIds(이번 회차에 받은 이벤트 id 전체)를 주면, 이미 이어져 있지만 그 이벤트가 사라진 의뢰도 후보다.
// 여러 캘린더에서 합친 일정의 대표 이벤트가 지워지면 남은 이벤트가 새 대표가 되는데, 의뢰에는 지워진 id 가
// 남아 있어 id 로는 못 찾는다. 이것을 후보에서 빼면 새 의뢰가 생기고 원래 의뢰는 중단된다.
function findMergeTarget(fields, { tolerance = 1, aliveIds } = {}) {
  const start = fields.started_date;
  const want = normModel(fields.model_name);
  if (!start || !fields.cert_type || want.length < 4) return null;

  const rows = repo.mergeCandidates({
    cert_type: fields.cert_type,
    from: shiftDay(start, -tolerance),
    to: shiftDay(start, tolerance),
    withLinked: !!aliveIds,
  }).filter((r) => {
    const eid = String(r.confluence_event_id || '').trim();
    return !eid || (aliveIds && !aliveIds.has(eid));
  });

  const hits = rows.filter((r) => {
    const got = normModel(r.model_name);
    if (got.length < 4) return false;
    if (!(got === want || got.includes(want) || want.includes(got))) return false;
    if (fields.round && r.round && Number(fields.round) !== Number(r.round)) return false;
    return true;
  });
  if (!hits.length) return null;

  const dist = (r) => Math.abs((new Date(`${r.start_date}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000);
  const best = Math.min(...hits.map(dist));
  const tied = hits.filter((r) => dist(r) === best);
  if (tied.length > 1) return { ambiguous: tied.map((r) => r.id) };
  return { row: tied[0] };
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

  // 합친 일정은 구성 이벤트 id 중 어느 것으로든 이미 이어져 있을 수 있다. 대표 id 가 아닌 것으로
  // 이어져 있으면 대표 id 로 옮긴다 — 대표가 아닌 이벤트가 나중에 지워져도 '사라진 일정' 으로 중단되지 않게.
  // 대표 이벤트 자체가 지워진 경우는 findMergeTarget 의 aliveIds 가 잡는다.
  let cur = null;
  for (const id of event.ids || [eventId]) {
    cur = repo.getByConfluenceEventId(id);
    if (cur) break;
  }
  if (cur && String(cur.confluence_event_id) !== eventId) cur = repo.attachConfluenceEvent(cur.id, eventId, actor);
  if (!cur) {
    // 이벤트 id 로 못 찾았어도 사람이 먼저 입력해 둔 같은 건이 있을 수 있다. 있으면 새로 만들지 않고
    // 그 행에 이벤트 id 를 붙여 이후 회차부터 제대로 이어지게 한다.
    const match = findMergeTarget(fields, opts);
    if (match && match.ambiguous) {
      warnings.push(`같은 건으로 볼 의뢰가 여럿이라 판정하지 않았습니다 (id ${match.ambiguous.join(', ')}). 새로 만듭니다.`);
    } else if (match && match.row) {
      cur = repo.attachConfluenceEvent(match.row.id, eventId, actor);
      warnings.push(match.row.confluence_event_id
        ? `사라진 이벤트에 이어져 있던 의뢰를 이 이벤트로 옮겨 붙였습니다 (id ${match.row.id}, ${match.row.model_name}).`
        : `이미 있던 의뢰에 이어 붙였습니다 (id ${match.row.id}, ${match.row.model_name}).`);
    }
  }
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

// 같은 테스트를 담당자마다 자기 하위 캘린더에 올린다 — `Netflix_KSTB6277 2nd` 11-02 가 세 캘린더에
// 있었다(2026-10-25). 제목의 '>' 앞과 시작일이 같으면 한 건으로 합친다 (사용자 결정: 테스터는 메인 + 서브).
//   대표 = 가장 먼저 만든 이벤트(id 앞 타임스탬프가 가장 이른 것). 그 담당자가 메인이고 id 가 레코드에 남는다.
//   제목 = 진행·결과가 가장 많이 나간 것. 한 사람만 '> Failed' 로 고쳐 둔 경우가 있다.
const STATUS_RANK = { 완료: 3, 중단: 3, 보류: 2, 진행중: 2, 예약확정: 1 };
const rankOf = (ev) => STATUS_RANK[parse.parseTitle(ev.title).status] || 0;

// 시작일은 ±1일까지 같은 일정으로 본다 — 같은 테스트를 한 사람은 10-01, 다른 사람은 10-02 로 올린 경우가
// 운영에 있다(TIVO_TMIS 1st, LG U+_UHD5K 2nd). 수기 의뢰와 합칠 때(findMergeTarget)와 같은 폭이다.
// 묶음의 기준일은 묶음에서 가장 이른 시작일이라, 하루씩 이어진 사슬이 끝없이 늘어나지 않는다.
function mergeAcrossCalendars(events, { tolerance = 1 } = {}) {
  const keyed = [];
  const loose = [];
  for (const ev of events || []) {
    const head = String((ev || {}).title ?? '').split('>')[0].replace(/\s+/g, ' ').trim().toLowerCase();
    const day = parse.parseDate((ev || {}).start).date;
    if (!head || !day) loose.push(ev);
    else keyed.push({ ev, head, day });
  }
  keyed.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : String(a.ev.id) < String(b.ev.id) ? -1 : 1));
  const clusters = [];
  for (const k of keyed) {
    const hit = clusters.find((c) => c.head === k.head && k.day <= shiftDay(c.day, tolerance));
    if (hit) hit.members.push(k.ev);
    else clusters.push({ head: k.head, day: k.day, members: [k.ev] });
  }
  const merged = [];
  const unique = [...loose, ...clusters.map((c) => c.members)].map((members) => {
    if (!Array.isArray(members)) return members;
    if (members.length === 1) return members[0];
    members.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    const best = members.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));
    merged.push({ id: String(members[0].id), title: best.title, count: members.length });
    return {
      ...members[0],
      title: best.title,
      ids: members.map((m) => String(m.id)),
      coInvitees: members.slice(1).map((m) => m.invitees),
    };
  });
  return { events: unique, merged };
}

// 이벤트 목록 한 회차를 통째로 반영한다. 한 건이 터져도 나머지는 계속 간다 —
// 동기화는 여러 건을 묶어 처리하므로 한 건 때문에 회차 전체가 멈추면 안 된다.
function syncEvents(events, opts = {}) {
  const result = { created: 0, updated: 0, unchanged: 0, skipped: 0, cancelled: 0, warnings: [], errors: [] };
  const { events: unique, merged } = mergeAcrossCalendars(events);
  for (const m of merged) result.warnings.push(`[${m.id}] 캘린더 ${m.count}곳의 같은 일정을 1건으로 합쳤습니다: ${m.title}`);
  // '사라진 일정' 판정(cancelMissing)은 합치기 전 목록을 그대로 쓴다 — 구성 이벤트 id 가 모두 살아 있어야 한다.
  // 사라진 이벤트에 이어진 의뢰를 다시 붙이는 것(aliveIds)은 기간 전체를 받은 회차에서만 한다.
  // 일부만 넘긴 호출에서 하면 목록에 없는 모든 이벤트가 '사라진' 것으로 보인다.
  const runOpts = opts.range
    ? { ...opts, aliveIds: new Set((events || []).map((e) => String((e || {}).id ?? '').trim()).filter(Boolean)) }
    : opts;
  for (const event of unique) {
    const tag = String((event || {}).id ?? '?');
    try {
      const r = upsertEvent(event, runOpts);
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

module.exports = { mapEvent, fillBlanks, upsertEvent, cancelMissing, mergeAcrossCalendars, syncEvents, ACTOR, DEFAULT_STATUS };
