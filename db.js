// 인증업무 의뢰 데이터를 보관하는 SQLite 데이터 계층 (이력·타임스탬프·통계 포함)
const path = require('path');
const Database = require('better-sqlite3');

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
    tester         TEXT,                     -- 담당 테스터
    status         TEXT NOT NULL DEFAULT '예약대기',  -- 진행 상태 (… | 중단)
    progress       TEXT,                     -- 진행 사항 메모
    result         TEXT,                     -- 결과 코멘트
    verdict        TEXT,                     -- 판정 (Pass | Fail | Drop)
    started_date   TEXT,                     -- 시작일 (테스터 입력)
    completed_date TEXT,                     -- 완료일 (테스터 입력)
    confirmed_at   TEXT,                     -- 예약확정 시각
    started_at     TEXT,                     -- 진행시작 시각
    completed_at   TEXT,                     -- 완료 시각
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

// 기존 DB 호환: 신규 컬럼 누락 시 보강 (request_item 컬럼은 미사용 처리)
const existingCols = db.prepare('PRAGMA table_info(requests)').all().map((c) => c.name);
for (const name of ['test_type', 'test_purpose', 'round', 'verdict', 'started_date', 'completed_date', 'confirmed_at', 'started_at', 'completed_at']) {
  if (!existingCols.includes(name)) db.exec(`ALTER TABLE requests ADD COLUMN ${name} TEXT`);
}

// 모델별 통계 집계(GROUP BY)와 모델명 목록(DISTINCT)이 전체 스캔을 타지 않도록 인덱스 보강
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_model_cert ON requests (model_name, cert_type)');
db.exec('CREATE INDEX IF NOT EXISTS idx_requests_completed_date ON requests (completed_date)');

const nowIso = () => new Date().toISOString();

const ALLOWED = [
  'cert_type', 'test_type', 'test_purpose', 'round', 'model_name', 'fw_version', 'requester', 'note',
  'desired_date', 'scheduled_date', 'tester', 'status', 'progress', 'result', 'verdict', 'started_date', 'completed_date',
];

// 사람이 읽을 변경요약용 한글 라벨
const LABELS = {
  cert_type: '인증종류', test_type: 'Test type', test_purpose: 'Test 목적', round: 'Round', model_name: '모델명',
  fw_version: 'FW', requester: '의뢰자', note: '비고', desired_date: '희망일정',
  scheduled_date: '예약일정', tester: '테스터', status: '상태', progress: '진행사항', result: '결과',
  verdict: '판정', started_date: '시작일', completed_date: '완료일',
};

// 의뢰가 "진행된" 것으로 볼 기간 판정용 대표 시작/종료일.
// 시작일 → 예약확정일 → 희망일 순으로 대체하고, 종료일은 완료일 우선.
const ACT_START = "COALESCE(NULLIF(started_date,''), NULLIF(scheduled_date,''), NULLIF(desired_date,''))";
const ACT_END = "COALESCE(NULLIF(completed_date,''), NULLIF(started_date,''), NULLIF(scheduled_date,''), NULLIF(desired_date,''))";

// 비율(%) 계산. 분모가 0이면 0으로 반환해 0 나눗셈을 차단한다.
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

function logHistory(requestId, actor, action, detail) {
  db.prepare('INSERT INTO history (request_id, ts, actor, action, detail) VALUES (?,?,?,?,?)')
    .run(requestId, nowIso(), actor || '알수없음', action, detail || '');
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
      status: d.status || '예약대기',
      progress: d.progress || '',
      result: d.result || '',
      verdict: d.verdict || '',
      started_date: d.started_date || '',
      completed_date: d.completed_date || '',
      confirmed_at: '', started_at: '', completed_at: '',
      created_at: ts, updated_at: ts,
    };
    const info = db.prepare(`INSERT INTO requests
      (cert_type, test_type, test_purpose, round, model_name, fw_version, requester, note, desired_date,
       scheduled_date, tester, status, progress, result, verdict, started_date, completed_date, confirmed_at, started_at, completed_at, created_at, updated_at)
      VALUES
      (@cert_type, @test_type, @test_purpose, @round, @model_name, @fw_version, @requester, @note, @desired_date,
       @scheduled_date, @tester, @status, @progress, @result, @verdict, @started_date, @completed_date, @confirmed_at, @started_at, @completed_at, @created_at, @updated_at)`)
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
      tester=@tester, status=@status, progress=@progress, result=@result,
      verdict=@verdict, started_date=@started_date, completed_date=@completed_date,
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

  // 한 번이라도 입력된 모델명 목록. DISTINCT로 중복을 제거해 콤보박스에 그대로 쓴다.
  modelNames() {
    return db.prepare(
      "SELECT DISTINCT model_name FROM requests WHERE model_name IS NOT NULL AND TRIM(model_name) <> '' ORDER BY model_name COLLATE NOCASE"
    ).all().map((r) => r.model_name);
  },

  // 모델(프로젝트) × 인증종류별 통계. range가 있으면 대표 진행구간이 기간과 겹치는 건만 집계.
  // 집계는 SQL GROUP BY로 처리해 행 전체를 앱으로 끌어오지 않는다.
  certStats(range) {
    const where = range
      ? `WHERE ${ACT_START} IS NOT NULL AND ${ACT_START} <= @to AND MAX(${ACT_END}, ${ACT_START}) >= @from`
      : '';
    const rows = db.prepare(`
      SELECT model_name, cert_type,
             COUNT(*)                                                   AS total,
             SUM(CASE WHEN verdict = 'Pass' THEN 1 ELSE 0 END)          AS pass,
             SUM(CASE WHEN verdict = 'Fail' THEN 1 ELSE 0 END)          AS fail,
             SUM(CASE WHEN verdict = 'Drop' THEN 1 ELSE 0 END)          AS drop_cnt,
             SUM(CASE WHEN status = '완료' THEN 1 ELSE 0 END)            AS completed,
             MAX(CAST(NULLIF(round,'') AS INTEGER))                     AS max_round
      FROM requests
      ${where}
      GROUP BY model_name, cert_type
      ORDER BY model_name COLLATE NOCASE, cert_type
    `).all(range || {});

    const out = rows.map((r) => ({
      ...r,
      max_round: r.max_round || 0,
      pending: r.total - r.pass - r.fail - r.drop_cnt,
      pass_rate: pct(r.pass, r.total),
      fail_rate: pct(r.fail, r.total),
    }));

    const sum = (k) => out.reduce((a, r) => a + r[k], 0);
    const total = sum('total');
    return {
      range: range || null,
      rows: out,
      totals: {
        models: new Set(out.map((r) => r.model_name)).size,
        total,
        pass: sum('pass'),
        fail: sum('fail'),
        pass_rate: pct(sum('pass'), total),
        fail_rate: pct(sum('fail'), total),
      },
    };
  },

  // 요약 통계
  stats() {
    const all = db.prepare('SELECT * FROM requests').all();
    const byStatus = {};
    const byCert = {};
    const testerLoad = {}; // 미완료(완료/보류 제외) 기준 테스터 부하
    let overdue = 0;
    const leadDays = [];
    const today = nowIso().slice(0, 10);

    for (const r of all) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      byCert[r.cert_type] = (byCert[r.cert_type] || 0) + 1;
      if (!['완료', '보류', '중단'].includes(r.status)) {
        if (r.tester) testerLoad[r.tester] = (testerLoad[r.tester] || 0) + 1;
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
