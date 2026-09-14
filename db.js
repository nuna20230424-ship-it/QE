// 인증업무 의뢰 데이터를 보관하는 SQLite 데이터 계층 (이력·타임스탬프·통계 포함)
const path = require('path');
const Database = require('better-sqlite3');
const holidays = require('./holidays');
const assignees = require('./assignees');

// 운영은 data.db 고정. DB_PATH는 스모크 테스트가 실 DB를 건드리지 않게 하는 용도.
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cert_type      TEXT NOT NULL,            -- 인증 종류 (Netflix NTS | Google xTS | Amazon AVTS)
    test_type      TEXT,                     -- Test type (IR | LR | MR | 파생)
    test_purpose   TEXT,                     -- Test 목적 (3PL | Official | Pre-Test | 양산 | self)
    round          TEXT,                     -- Round (1~5)
    model_name     TEXT NOT NULL,            -- 모델명
    fw_version     TEXT,                     -- FW 버전
    requester      TEXT,                     -- 의뢰자 (개발 PL)
    note           TEXT,                     -- 비고
    desired_date   TEXT,                     -- 희망 일정 (의뢰자 입력)
    scheduled_date TEXT,                     -- 예약 확정 일정 (테스터 입력)
    tester         TEXT,                     -- 담당 테스터 (메인)
    tester_sub     TEXT,                     -- 서브 담당 테스터 (콤마 구분, 없는 경우가 대부분)
    status         TEXT NOT NULL DEFAULT '예약대기',  -- 진행 상태 (… | 중단)
    progress       TEXT,                     -- 진행 사항 메모
    result         TEXT,                     -- 결과 코멘트
    verdict        TEXT,                     -- 판정 (Pass | Fail | Drop)
    started_date   TEXT,                     -- 시작일 (테스터 입력)
    completed_date TEXT,                     -- 완료일 (테스터 입력)
    remaining_slots TEXT,                    -- 잔여 slot 수동 보정 (비우면 시작일 기준 자동 차감)
    confirmed_at   TEXT,                     -- 예약확정 시각
    started_at     TEXT,                     -- 진행시작 시각
    completed_at   TEXT,                     -- 완료 시각
    confluence_event_id TEXT,                 -- Confluence QE Schedule 이벤트 id (동기화로 들어온 건만)
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    ts     TEXT NOT NULL,   -- 변경 시각
    actor  TEXT,            -- 변경자 (이름/역할)
    action TEXT NOT NULL,   -- 등록 | 수정 | 삭제
    detail TEXT             -- 변경 내용 요약
  )
`);

// 의뢰자 드롭다운 제안에서 숨길 이름 목록 (의뢰 레코드는 보존, 제안에서만 제거)
db.exec(`
  CREATE TABLE IF NOT EXISTS hidden_requesters (
    name      TEXT PRIMARY KEY,   -- 숨긴 의뢰자 이름
    hidden_at TEXT NOT NULL,      -- 숨긴 시각
    actor     TEXT               -- 숨긴 작업자
  )
`);

// 기존 DB 호환: 신규 컬럼 누락 시 보강 (request_item 컬럼은 미사용 처리)
const existingCols = db.prepare('PRAGMA table_info(requests)').all().map((c) => c.name);
for (const name of ['test_type', 'test_purpose', 'round', 'verdict', 'started_date', 'completed_date', 'remaining_slots', 'confirmed_at', 'started_at', 'completed_at', 'tester_sub', 'confluence_event_id']) {
  if (!existingCols.includes(name)) db.exec(`ALTER TABLE requests ADD COLUMN ${name} TEXT`);
}

// 모델별 통계 집계(GROUP BY)와 모델명 목록(DISTINCT)이 전체 스캔을 타지 않도록 인덱스 보강
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_model_cert ON requests (model_name, cert_type)');
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_completed_date ON requests (completed_date)');
// Confluence 이벤트 한 건이 의뢰 두 건으로 갈라지지 않게 막는다.
// 수동 등록 건은 이 칸이 비어 있으므로 부분 인덱스로 제외한다(SQLite는 부분 유니크 인덱스를 지원한다).
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_confluence_event ON requests (confluence_event_id) WHERE confluence_event_id IS NOT NULL AND confluence_event_id <> ''");

const nowIso = () => new Date().toISOString();

const ALLOWED = [
  'cert_type', 'test_type', 'test_purpose', 'round', 'model_name', 'fw_version', 'requester', 'note',
  'desired_date', 'scheduled_date', 'tester', 'tester_sub', 'status', 'progress', 'result', 'verdict', 'started_date', 'completed_date',
  'remaining_slots',
];

// 사람이 읽을 변경요약용 한글 라벨
const LABELS = {
  cert_type: '인증종류', test_type: 'Test type', test_purpose: 'Test 목적', round: 'Round', model_name: '모델명',
  fw_version: 'FW', requester: '의뢰자', note: '비고', desired_date: '희망일정',
  scheduled_date: '예약일정', tester: '테스터', tester_sub: '서브 테스터', status: '상태', progress: '진행사항', result: '결과',
  verdict: '판정', started_date: '시작일', completed_date: '완료일',
  remaining_slots: '잔여 slot',
};

// 의뢰가 "진행된" 것으로 볼 기간 판정용 대표 시작/종료일.
// 시작일 → 예약확정일 → 희망일 순으로 대체하고, 종료일은 완료일 우선.
const ACT_START = "COALESCE(NULLIF(started_date,''), NULLIF(scheduled_date,''), NULLIF(desired_date,''))";
const ACT_END = "COALESCE(NULLIF(completed_date,''), NULLIF(started_date,''), NULLIF(scheduled_date,''), NULLIF(desired_date,''))";

// 의뢰 하나의 대표 진행일(YYYY-MM-DD). 완료일 → 시작일 → 예약일 → 희망일 → 등록일 순.
const ACT_DATE = `substr(COALESCE(NULLIF(completed_date,''), NULLIF(started_date,''), NULLIF(scheduled_date,''), NULLIF(desired_date,''), created_at), 1, 10)`;
// "가장 최근 건"을 고르기 위한 정렬키. 대표 진행일이 같으면 id가 큰 쪽(나중 등록)이 최신.
const SORT_KEY = `(${ACT_DATE} || '#' || printf('%010d', id))`;
// Test 목적 미입력 건도 한 그룹으로 묶이도록 정규화한다.
const PURPOSE = `COALESCE(NULLIF(TRIM(test_purpose),''), '(미지정)')`;
// 진행차수. TEXT 컬럼이라 문자열로 정렬하면 '10차'가 '2차'보다 앞서므로 정수로 맞춘다.
// 미입력 건은 0으로 묶어 한 행이 되게 한다.
const ROUND = `CAST(COALESCE(NULLIF(TRIM(round),''), '0') AS INTEGER)`;
// 통계 대상: 판정이 끝난 건(Pass/Fail)만. '미판정'과 Drop은 지시서 4-1에 따라 산출에서 제외한다.
const JUDGED = `verdict IN ('Pass','Fail')`;
// 비율(%) 계산. 분모가 0이면 0으로 반환해 0 나눗셈을 차단한다.
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

function logHistory(requestId, actor, action, detail) {
  db.prepare('INSERT INTO history (request_id, ts, actor, action, detail) VALUES (?,?,?,?,?)')
    .run(requestId, nowIso(), actor || '알수없음', action, detail || '');
}

// 모델(프로젝트) × 인증종류 × Test 목적 × 진행차수별 통계.
// 미판정·Drop 건은 집계에서 빠지므로 분모는 판정 완료 건수이고 Pass율 + Fail율 = 100%가 된다.
// 차수를 그룹 키에 넣어 같은 모델이라도 차수마다 행이 따로 선다 — 2차 Fail과 3차 Pass가 한 줄로
// 합쳐지면서 이전 차수의 결과·인증완료일이 최신 판정 값으로 덮이던 문제를 없앤다.
// MAX(SORT_KEY)와 함께 쓴 bare column(verdict 등)은 최댓값을 만든 행의 값을 돌려주는 SQLite 규칙에 기댄다.
function certStatsOf(range) {
  const cond = [JUDGED];
  if (range) cond.push(`${ACT_START} IS NOT NULL`, `${ACT_START} <= @to`, `MAX(${ACT_END}, ${ACT_START}) >= @from`);
  const rows = db.prepare(`
    SELECT model_name, cert_type, ${PURPOSE} AS test_purpose, ${ROUND} AS round_no,
           COUNT(*)                                          AS judged,
           SUM(CASE WHEN verdict = 'Pass' THEN 1 ELSE 0 END) AS pass,
           SUM(CASE WHEN verdict = 'Fail' THEN 1 ELSE 0 END) AS fail,
           MAX(${SORT_KEY})                                  AS latest_key,
           verdict                                           AS result,
           ${ACT_DATE}                                       AS last_date,
           completed_date                                    AS raw_completed_date,
           completed_at                                      AS raw_completed_at
    FROM requests
    WHERE ${cond.join(' AND ')}
    GROUP BY model_name, cert_type, ${PURPOSE}, ${ROUND}
    ORDER BY model_name COLLATE NOCASE, cert_type, test_purpose, round_no
  `).all(range || {});

  // 차수까지 갈랐어도 같은 차수를 두 번 이상 판정한 건이 있으면 그 행은 여전히 합쳐진다
  // (결과·인증완료일이 최신 판정 값으로 덮인다). 그런 행만 판정 내역을 따로 달아 펼쳐 볼 수 있게 한다.
  const trailKey = (r) => JSON.stringify([r.model_name, r.cert_type, r.test_purpose, r.round_no]);
  const trails = new Map();
  for (const t of db.prepare(`
    SELECT model_name, cert_type, ${PURPOSE} AS test_purpose, ${ROUND} AS round_no,
           verdict, ${ACT_DATE} AS on_date
    FROM requests
    WHERE ${cond.join(' AND ')}
    ORDER BY ${SORT_KEY}
  `).all(range || {})) {
    const key = trailKey(t);
    const list = trails.get(key) || [];
    list.push({ round: t.round_no || null, verdict: t.verdict, date: t.on_date });
    trails.set(key, list);
  }

  const out = rows.map((r) => ({
    model_name: r.model_name,
    cert_type: r.cert_type,
    test_purpose: r.test_purpose,
    result: r.result,                            // 이 차수의 판정 (같은 차수를 여러 번 돌았으면 최신 건)
    round: r.round_no || r.judged,               // 진행차수 = 그룹 키 (미입력 시 판정 횟수로 대체)
    last_date: r.last_date,
    // 인증완료일 = 최신 판정 건의 완료일(테스터 입력 completed_date, 없으면 상태 전환 시각 completed_at)
    completed_date: r.raw_completed_date || (r.raw_completed_at ? r.raw_completed_at.slice(0, 10) : ''),
    judged: r.judged,
    pass: r.pass,
    fail: r.fail,
    pass_rate: pct(r.pass, r.judged),
    fail_rate: pct(r.fail, r.judged),
    // 이 행에 합쳐진 판정 내역. 보통 1건이고, 같은 차수를 두 번 이상 판정했을 때만 2건 이상이 된다.
    rounds: trails.get(trailKey(r)) || [],
  }));

  const sum = (k) => out.reduce((a, r) => a + r[k], 0);
  const judged = sum('judged');
  return {
    range: range || null,
    rows: out,
    totals: {
      models: new Set(out.map((r) => r.model_name)).size,
      judged,
      pass: sum('pass'),
      fail: sum('fail'),
      pass_rate: pct(sum('pass'), judged),
      fail_rate: pct(sum('fail'), judged),
    },
  };
}

// (인증종류 × Test type × Test 목적 × 모델명) 조합의 의뢰 이력을 최신순으로.
// 진행차수 산출과 ⓘ 히스토리가 함께 쓴다.
// Task 0 원인 분석: 기존 코드는 모델명·Test 목적 2개만 비교해 인증종류·Test type이 달라도
// 같은 이력으로 묶었다. 지시서가 "4가지 조건 동시 매칭"을 명시해 두 조건을 WHERE에 추가한다.
// 판정이 아직 없는(미판정, verdict='') 건도 포함한다 — "Pass만 아니면 차수를 잇는다"는
// 조건에서 미판정도 Pass가 아니므로, 직전 건이 미판정이면 그 이력이 통째로 사라져선 안 된다.
function roundHistoryOf(modelName, testPurpose, certType, testType) {
  const model = String(modelName || '').trim();
  if (!model) return [];
  return db.prepare(`
    SELECT id, cert_type, ${PURPOSE} AS test_purpose, round, verdict, status,
           ${ACT_DATE} AS on_date, progress, result
    FROM requests
    WHERE TRIM(model_name) = @model AND ${PURPOSE} = @purpose
      AND TRIM(cert_type) = @cert_type AND TRIM(COALESCE(test_type,'')) = @test_type
    ORDER BY ${SORT_KEY} DESC
  `).all({
    model,
    purpose: String(testPurpose || '').trim() || '(미지정)',
    cert_type: String(certType || '').trim(),
    test_type: String(testType || '').trim(),
  });
}

// Task 5. 신규 의뢰의 진행차수 자동 산출.
//   직전 판정이 Pass가 아니면(Fail·Drop 등) → 직전 차수 + 1 / Pass 이거나 이력이 없으면 → 1차
// Task 0 원인 분석: 기존 코드는 `prev.verdict === 'Fail'`만 검사해 Drop을 Pass와 같이 취급(1차로
// 리셋)했다. 지시서 문면("Pass가 아닌 경우")대로 부정 조건(`!== 'Pass'`)으로 바꾼다.
function nextRoundOf(modelName, testPurpose, certType, testType) {
  const history = roundHistoryOf(modelName, testPurpose, certType, testType);
  const prev = history[0] || null;
  if (!prev) {
    return { round: 1, basis: 'new', reason: '이전 의뢰 이력이 없어 1차로 시작합니다.', prev: null, history };
  }
  if (prev.verdict !== 'Pass') {
    const prevRound = Number(prev.round) || history.length;
    const verdictLabel = prev.verdict || '미판정';
    const basis = prev.verdict === 'Fail' ? 'fail' : (prev.verdict === 'Drop' ? 'drop' : 'pending');
    return {
      round: prevRound + 1,
      basis,
      reason: `직전 의뢰(${prev.on_date}, ${prevRound}차)의 판정이 ${verdictLabel}이므로 ${prevRound + 1}차로 이어집니다.`,
      prev,
      history,
    };
  }
  return {
    round: 1,
    basis: 'pass',
    reason: `직전 의뢰(${prev.on_date})가 Pass로 종료되어 1차부터 다시 시작합니다.`,
    prev,
    history,
  };
}

// Task 6-2. QA 리더가 먼저 봐야 할 리스크 2종.
//   반복 Fail   — 최신 판정이 Fail이면서 진행차수가 임계 이상인 조합
//   장기 미판정 — 판정 없이 임계 일수를 넘긴 채 아직 종료되지 않은 건
function bottlenecksOf({ roundThreshold = 5, staleDays = 14 } = {}) {
  const repeated = certStatsOf(null).rows
    .filter((r) => r.result === 'Fail' && r.round >= roundThreshold)
    .map((r) => ({
      model_name: r.model_name, cert_type: r.cert_type, test_purpose: r.test_purpose,
      round: r.round, fail: r.fail, last_date: r.last_date,
    }));

  // 로컬 날짜 기준. UTC로 계산하면 KST 00:00~09:00에 하루 뒤처진다.
  const limit = holidays.shiftDays(-staleDays);
  const stale = db.prepare(`
    SELECT id, model_name, cert_type, ${PURPOSE} AS test_purpose, round, status, tester,
           ${ACT_START} AS since,
           CAST(julianday('now') - julianday(${ACT_START}) AS INTEGER) AS days
    FROM requests
    WHERE (verdict IS NULL OR TRIM(verdict) = '')
      AND status NOT IN ('완료', '보류', '중단')
      AND ${ACT_START} IS NOT NULL AND ${ACT_START} <= @limit
    ORDER BY since
  `).all({ limit });

  return { roundThreshold, staleDays, repeated, stale, count: repeated.length + stale.length };
}

module.exports = {
  list({ cert_type, status, q } = {}) {
    let sql = 'SELECT * FROM requests WHERE 1=1';
    const params = {};
    if (cert_type) { sql += ' AND cert_type = @cert_type'; params.cert_type = cert_type; }
    if (status)    { sql += ' AND status = @status';       params.status = status; }
    if (q)         { sql += ' AND (model_name LIKE @q OR requester LIKE @q)'; params.q = `%${q}%`; }
    sql += " ORDER BY (COALESCE(NULLIF(scheduled_date,''), NULLIF(desired_date,'')) IS NULL),"
         + " COALESCE(NULLIF(scheduled_date,''), NULLIF(desired_date,'')), id DESC";
    return db.prepare(sql).all(params);
  },

  get(id) {
    return db.prepare('SELECT * FROM requests WHERE id = ?').get(id);
  },

  // 그 모델의 가장 최근 의뢰자. 의뢰자가 빈 건은 건너뛴다.
  // 지시서가 말하는 [모델명-의뢰자 DB]를 별도로 두지 않고 대시보드 이력을 쓴다 — 근거는 context-notes.
  requesterOfModel(modelName) {
    const model = String(modelName ?? '').trim();
    if (!model) return '';
    const row = db.prepare(
      "SELECT requester FROM requests WHERE model_name = ? AND COALESCE(requester,'') <> '' ORDER BY id DESC LIMIT 1"
    ).get(model);
    return row ? row.requester : '';
  },

  // Confluence 이벤트 id로 이미 동기화된 의뢰를 찾는다. 없으면 undefined.
  getByConfluenceEventId(eventId) {
    const id = String(eventId ?? '').trim();
    if (!id) return undefined;
    return db.prepare('SELECT * FROM requests WHERE confluence_event_id = ?').get(id);
  },

  // 동기화로 들어온 의뢰 중 조회 기간에 걸친 것들. Confluence에서 사라진 이벤트를 찾는 데 쓴다.
  // 기간을 넘기지 않으면 동기화 건 전체를 돌려준다.
  confluenceRowsInRange({ from, to } = {}) {
    let sql = "SELECT * FROM requests WHERE confluence_event_id IS NOT NULL AND confluence_event_id <> ''";
    const params = {};
    if (from) { sql += ` AND ${ACT_DATE} >= @from`; params.from = from; }
    if (to)   { sql += ` AND ${ACT_DATE} <= @to`;   params.to = to; }
    return db.prepare(sql).all(params);
  },

  create(d, actor) {
    const ts = nowIso();
    const row = {
      cert_type: d.cert_type,
      test_type: d.test_type || '',
      test_purpose: d.test_purpose || '',
      round: d.round || '',
      model_name: d.model_name,
      fw_version: d.fw_version || '',
      requester: d.requester || '',
      note: d.note || '',
      desired_date: d.desired_date || '',
      scheduled_date: d.scheduled_date || '',
      tester: d.tester || '',
      tester_sub: d.tester_sub || '',
      status: d.status || '예약대기',
      progress: d.progress || '',
      result: d.result || '',
      verdict: d.verdict || '',
      started_date: d.started_date || '',
      completed_date: d.completed_date || '',
      remaining_slots: d.remaining_slots || '',
      confirmed_at: '', started_at: '', completed_at: '',
      confluence_event_id: d.confluence_event_id || '',
      created_at: ts, updated_at: ts,
    };
    const info = db.prepare(`INSERT INTO requests
      (cert_type, test_type, test_purpose, round, model_name, fw_version, requester, note, desired_date,
       scheduled_date, tester, tester_sub, status, progress, result, verdict, started_date, completed_date, remaining_slots, confirmed_at, started_at, completed_at, confluence_event_id, created_at, updated_at)
      VALUES
      (@cert_type, @test_type, @test_purpose, @round, @model_name, @fw_version, @requester, @note, @desired_date,
       @scheduled_date, @tester, @tester_sub, @status, @progress, @result, @verdict, @started_date, @completed_date, @remaining_slots, @confirmed_at, @started_at, @completed_at, @confluence_event_id, @created_at, @updated_at)`)
      .run(row);
    logHistory(info.lastInsertRowid, actor, '등록', `${d.cert_type} / ${d.model_name}`);
    return this.get(info.lastInsertRowid);
  },

  update(id, d, actor) {
    const cur = this.get(id);
    if (!cur) return null;
    const merged = { ...cur };
    const changes = [];
    for (const k of ALLOWED) {
      if (k in d && String(d[k] ?? '') !== String(cur[k] ?? '')) {
        changes.push(`${LABELS[k] || k}: ${cur[k] || '∅'} → ${d[k] || '∅'}`);
        merged[k] = d[k];
      }
    }
    // 상태 전환 시각 자동 기록 (최초 1회)
    const ts = nowIso();
    if (merged.status === '예약확정' && !merged.confirmed_at) merged.confirmed_at = ts;
    if (merged.status === '진행중'   && !merged.started_at)   merged.started_at = ts;
    if (merged.status === '완료'     && !merged.completed_at) merged.completed_at = ts;
    merged.updated_at = ts;

    db.prepare(`UPDATE requests SET
      cert_type=@cert_type, test_type=@test_type, test_purpose=@test_purpose, round=@round,
      model_name=@model_name, fw_version=@fw_version,
      requester=@requester, note=@note, desired_date=@desired_date, scheduled_date=@scheduled_date,
      tester=@tester, tester_sub=@tester_sub, status=@status, progress=@progress, result=@result,
      verdict=@verdict, started_date=@started_date, completed_date=@completed_date, remaining_slots=@remaining_slots,
      confirmed_at=@confirmed_at, started_at=@started_at, completed_at=@completed_at, updated_at=@updated_at
      WHERE id=@id`).run(merged);

    if (changes.length) logHistory(id, actor, '수정', changes.join(', '));
    return this.get(id);
  },

  remove(id, actor) {
    const cur = this.get(id);
    if (!cur) return false;
    db.prepare('DELETE FROM requests WHERE id = ?').run(id);
    logHistory(id, actor, '삭제', `${cur.cert_type} / ${cur.model_name}`);
    return true;
  },

  history(requestId) {
    return db.prepare('SELECT * FROM history WHERE request_id = ? ORDER BY id DESC').all(requestId);
  },

  // 파일 핸들 해제. 테스트가 임시 DB를 지우려면 필요하다(Windows는 열린 파일 삭제를 막는다).
  close() {
    db.close();
  },

  // Task 6. 리소스 산정 대상 — 아직 끝나지 않은 의뢰(예약대기·예약확정·진행중).
  // 완료·보류·중단은 담당자의 남은 업무량이 아니므로 제외한다.
  // 정렬은 대표 일정 순(미정은 뒤로)이라 화면에서 임박한 건이 위에 온다.
  openRequests() {
    return db.prepare(`
      SELECT id, cert_type, test_type, test_purpose, round, model_name, fw_version,
             requester, tester, tester_sub, status, desired_date, scheduled_date, started_date, remaining_slots, created_at,
             ${ACT_START} AS plan_date
      FROM requests
      WHERE status IN ('예약대기', '예약확정', '진행중')
      ORDER BY (plan_date IS NULL), plan_date, id
    `).all();
  },

  // 한 번이라도 입력된 모델명 목록. DISTINCT로 중복을 제거해 콤보박스에 그대로 쓴다.
  modelNames() {
    return db.prepare(
      "SELECT DISTINCT model_name FROM requests WHERE model_name IS NOT NULL AND TRIM(model_name) <> '' ORDER BY model_name COLLATE NOCASE"
    ).all().map((r) => r.model_name);
  },

  // 한 번이라도 입력된 Test 목적 목록. 직접입력한 값이 다음 의뢰의 드롭다운에 뜨게 한다.
  testPurposes() {
    return db.prepare(
      "SELECT DISTINCT TRIM(test_purpose) AS v FROM requests WHERE test_purpose IS NOT NULL AND TRIM(test_purpose) <> '' ORDER BY v COLLATE NOCASE"
    ).all().map((r) => r.v);
  },

  // range가 있으면 대표 진행구간이 그 기간과 겹치는 건만 집계한다.
  certStats: certStatsOf,

  // Task 5. 진행차수 자동 산출과 그 근거가 되는 판정 이력.
  nextRound: nextRoundOf,
  roundHistory: roundHistoryOf,

  // Task 6-2. 반복 Fail · 장기 미판정 경고.
  bottlenecks: bottlenecksOf,

  // ---- 의뢰자 제안 목록 관리 (숨김) ----
  hiddenRequesters() {
    return db.prepare('SELECT name FROM hidden_requesters ORDER BY name').all().map((r) => r.name);
  },

  hideRequester(name, actor) {
    const n = String(name ?? '').trim();
    if (!n) return false;
    db.prepare('INSERT OR IGNORE INTO hidden_requesters (name, hidden_at, actor) VALUES (?,?,?)')
      .run(n, nowIso(), actor || '알수없음');
    return true;
  },

  unhideRequester(name) {
    const info = db.prepare('DELETE FROM hidden_requesters WHERE name = ?').run(String(name ?? '').trim());
    return info.changes > 0;
  },


  // 요약 통계
  stats() {
    const all = db.prepare('SELECT * FROM requests').all();
    const byStatus = {};
    const byCert = {};
    // 미완료(완료/보류 제외) 기준 테스터 부하. 서브 담당자도 그 건에 붙어 있으므로 함께 센다
    // — 여기서 빠지면 리소스 화면과 요약 위젯이 서로 다른 인원을 가리킨다.
    const testerLoad = {};
    let overdue = 0;
    const leadDays = [];
    // 지연(overdue) 판정 기준일. 로컬 날짜여야 한다 — UTC면 KST 00:00~09:00에 하루 뒤처져
    // 어제 지난 예약확정일이 아직 지연으로 잡히지 않는다.
    const today = holidays.today();

    for (const r of all) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byCert[r.cert_type] = (byCert[r.cert_type] || 0) + 1;
      if (!['완료', '보류', '중단'].includes(r.status)) {
        for (const n of assignees.listOf(r)) testerLoad[n] = (testerLoad[n] || 0) + 1;
      }
      // 지연: 예약 확정일이 지났는데 아직 진행중으로 전환되지 않은 건 (예약대기/예약확정 상태로 잔류)
      if (r.scheduled_date && r.scheduled_date < today && (r.status === '예약대기' || r.status === '예약확정')) {
        overdue += 1;
      }
      if (r.completed_at && r.created_at) {
        const d = (new Date(r.completed_at) - new Date(r.created_at)) / 86400000;
        if (d >= 0) leadDays.push(d);
      }
    }
    const avgLead = leadDays.length
      ? Math.round((leadDays.reduce((a, b) => a + b, 0) / leadDays.length) * 10) / 10
      : null;
    return { total: all.length, byStatus, byCert, testerLoad, overdue, avgLeadDays: avgLead };
  },

  // 일일/주간 현황보고용 집계.
  // 완료: 완료일(completed_date, 없으면 completed_at 날짜)이 [from,to]에 드는 '완료' 건.
  // 진행중: 기간과 무관하게 현재 상태가 '진행중'인 건 전체(스냅샷 성격).
  reportData(from, to) {
    const all = db.prepare('SELECT * FROM requests').all();
    const compDate = (r) => r.completed_date || (r.completed_at ? r.completed_at.slice(0, 10) : '');
    const inRange = (d) => d && d >= from && d <= to;

    const completed = all
      .filter((r) => r.status === '완료' && inRange(compDate(r)))
      .sort((a, b) => (compDate(a) < compDate(b) ? -1 : 1));
    const inProgress = all
      .filter((r) => r.status === '진행중')
      .sort((a, b) => ((a.started_date || '') < (b.started_date || '') ? -1 : 1));

    const pass = completed.filter((r) => r.verdict === 'Pass');
    const fail = completed.filter((r) => r.verdict === 'Fail');
    const etc = completed.filter((r) => r.verdict !== 'Pass' && r.verdict !== 'Fail');

    return {
      from, to,
      counts: {
        completed: completed.length,
        pass: pass.length, fail: fail.length, etc: etc.length,
        inProgress: inProgress.length,
      },
      completed, inProgress, fail,
    };
  },
};
