// Confluence Team Calendars의 QE Schedule 이벤트를 받아 동기화가 쓰는 정규 형태로 접는 클라이언트
const fs = require('fs');
const path = require('path');

require('./env').load();

// Team Calendars 이벤트 조회 경로. **사내망 밖이라 실물 응답으로 확인하지 못했다** —
// scripts/confluence-probe.js 로 한 번 찍어 보고 확정한다.
const EVENTS_PATH = '/rest/calendar-services/1.0/calendar/events.json';

// 정규 형태의 각 칸이 응답의 어느 키에서 오는지. 점 표기로 중첩·배열 인덱스를 쓸 수 있다
// (예: 'invitees.0.displayName'). config.json 의 confluence.fields 로 덮어쓴다.
// relatedPage·created 는 Team Calendars 커스텀 필드라 키 이름을 모른다. 비워 두면 그 칸을
// 채우지 않고 경고를 남긴다 — 추측한 키로 조용히 엉뚱한 값을 넣지 않는다.
const DEFAULT_FIELDS = {
  id: 'id',
  title: 'title',
  invitees: 'invitees',
  start: 'start',
  end: 'end',
  relatedPage: '',
  created: '',
};

function config() {
  const p = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(p)) {
    try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')).confluence || {}; }
    catch { cfg = {}; }
  }
  const num = (v, dflt) => (Number.isFinite(Number(v)) ? Number(v) : dflt);
  return {
    baseUrl: String(cfg.baseUrl || '').replace(/\/+$/, ''),
    subCalendarId: String(cfg.subCalendarId || ''),
    timeZone: cfg.timeZone || 'Asia/Seoul',
    pollMinutes: num(cfg.pollMinutes, 5) > 0 ? num(cfg.pollMinutes, 5) : 5,
    rangeBackDays: num(cfg.rangeBackDays, 30),
    rangeAheadDays: num(cfg.rangeAheadDays, 60),
    fields: { ...DEFAULT_FIELDS, ...(cfg.fields || {}) },
    // 지시서의 [모델명-의뢰자 DB]. 여기 없는 모델은 대시보드 이력에서 찾는다(confluence-poll).
    requesterByModel: cfg.requesterByModel || {},
    // PAT는 지시서대로 .env(환경변수)에만 둔다. config.json·코드·로그에 값을 남기지 않는다.
    token: process.env.CONFLUENCE_PAT || '',
  };
}

// 무엇이 없어서 못 도는지까지 돌려준다 — 화면에 'PAT 없음'과 '캘린더 id 없음'이 구분돼야 손볼 데를 안다.
function missing() {
  const c = config();
  const out = [];
  if (!c.token) out.push('CONFLUENCE_PAT 환경변수(.env)');
  if (!c.baseUrl) out.push('config.json confluence.baseUrl');
  if (!c.subCalendarId) out.push('config.json confluence.subCalendarId');
  return out;
}

const configured = () => missing().length === 0;

// 'YYYY-MM-DD' → 그 날짜의 로컬(KST) 자정을 가리키는 ISO 인스턴트.
// 개발자도구로 확인한 실제 요청이 start·end 를 'YYYY-MM-DDTHH:mm:ssZ' 로 보낸다.
// 날짜만 보내면 서버가 어떻게 해석하는지 알 수 없으므로 관측한 형식에 맞춘다.
// UTC 자정이 아니라 '로컬 자정의 인스턴트'를 쓴다 — KST 기준 하루가 밀리지 않게.
function toInstant(v, { endOfDay = false } = {}) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.includes('T')) return s;   // 이미 인스턴트면 그대로 보낸다
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // 종료일은 그 날 전체를 포함해야 하므로 다음 날 자정까지 잡는다.
  if (endOfDay) d.setDate(d.getDate() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// 'a.0.b' 같은 점 표기로 중첩 값을 꺼낸다. 중간이 비면 undefined.
function dig(obj, keyPath) {
  if (!keyPath) return undefined;
  let cur = obj;
  for (const seg of String(keyPath).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// 파싱 함수들은 문자열을 받는다. 초대자처럼 배열·객체로 오는 칸을 사람이 읽는 문자열로 접는다.
function toText(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(', ');
  if (typeof v === 'object') return String(v.displayName || v.name || v.fullName || v.email || '').trim();
  return String(v).trim();
}

// 응답 이벤트 하나 → 정규 형태. 매핑이 비었거나 응답에 키가 없으면 경고로 남긴다.
function normalizeEvent(raw, fields = DEFAULT_FIELDS) {
  const event = {};
  const warnings = [];
  for (const [target, source] of Object.entries(fields)) {
    if (!source) {
      warnings.push(`응답 필드 매핑이 비어 있어 ${target}을 채우지 못했습니다 (config.json confluence.fields).`);
      event[target] = '';
      continue;
    }
    const v = dig(raw, source);
    if (v === undefined) warnings.push(`응답에 '${source}' 키가 없습니다 (${target}).`);
    event[target] = toText(v);
  }
  return { event, warnings };
}

// 이벤트 조회 원본. 진단 스크립트가 응답 형태를 확인할 때도 이 함수를 쓴다.
async function requestEvents({ from, to } = {}, cfg) {
  // 설정을 인자로 받을 수 있게 뒀다 — 스모크가 실 config.json·환경변수에 의존하면
  // 나중에 실제 설정이 채워지는 순간 기대값이 뒤집힌다.
  const c = cfg || config();
  if (!(c.token && c.baseUrl && c.subCalendarId)) throw new Error(`Confluence 설정이 없습니다: ${missing().join(', ')}`);
  const q = [
    `subCalendarId=${encodeURIComponent(c.subCalendarId)}`,
    `userTimeZoneId=${encodeURIComponent(c.timeZone)}`,
    from ? `start=${encodeURIComponent(toInstant(from))}` : '',
    to ? `end=${encodeURIComponent(toInstant(to, { endOfDay: true }))}` : '',
  ].filter(Boolean).join('&');
  const url = `${c.baseUrl}${EVENTS_PATH}?${q}`;
  // 토큰은 헤더에만 넣는다. url은 로그·오류 메시지에 실릴 수 있어 비밀을 태우지 않는다.
  const res = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Confluence 응답 ${res.status} ${res.statusText} (${url})`);
  return { url, body: await res.json() };
}

// 응답 → 정규 이벤트 배열. 같은 경고가 이벤트 수만큼 쌓이지 않게 중복을 접는다.
function normalizeBody(body, fields = DEFAULT_FIELDS) {
  const raws = Array.isArray(body) ? body : (body && Array.isArray(body.events) ? body.events : null);
  if (!raws) throw new Error('응답에서 events 배열을 찾지 못했습니다.');
  const events = [];
  const seen = new Set();
  const warnings = [];
  for (const raw of raws) {
    const r = normalizeEvent(raw, fields);
    events.push(r.event);
    for (const w of r.warnings) if (!seen.has(w)) { seen.add(w); warnings.push(w); }
  }
  return { events, warnings };
}

async function fetchEvents(range, cfg) {
  const c = cfg || config();
  const { body } = await requestEvents(range, c);
  return normalizeBody(body, c.fields);
}

module.exports = { config, missing, configured, toInstant, dig, toText, normalizeEvent, normalizeBody, requestEvents, fetchEvents, DEFAULT_FIELDS, EVENTS_PATH };
