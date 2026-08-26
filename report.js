// 일일/주간 현황보고 기간 계산 및 HTML 생성 (앱 뷰·이메일 본문 공용, 인라인 스타일)
const repo = require('./db');

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// 이번 주 월~일
function weekRange(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (base.getDay() + 6) % 7; // 월=0 … 일=6
  const mon = new Date(base); mon.setDate(base.getDate() - offset);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: ymd(mon), to: ymd(sun) };
}
// 오늘 하루
function dayRange(now = new Date()) {
  const t = ymd(now);
  return { from: t, to: t };
}
// 이번 주 월~금 (주간업무보고의 모델별 인증 통계 섹션 기준. 본문 집계는 월~일 유지)
function workWeekRange(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (base.getDay() + 6) % 7;
  const mon = new Date(base); mon.setDate(base.getDate() - offset);
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  return { from: ymd(mon), to: ymd(fri) };
}

// 지난주 월~금. 월요일 아침 인증 통계 보고는 이번 주가 아직 비어 있어 지난주 실적을 싣는다.
function lastWorkWeekRange(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  base.setDate(base.getDate() - 7);
  return workWeekRange(base);
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));
const dash = (s) => (s !== null && s !== undefined && String(s).trim() ? esc(s) : '—');
const certOf = (r) => {
  const t = [r.test_type, r.test_purpose].filter(Boolean).join(' ');
  return esc(`${r.cert_type}${t ? ' / ' + t : ''}`);
};
const modelOf = (r) => esc(`${r.model_name}${r.fw_version ? ' (' + r.fw_version + ')' : ''}`);
const compDate = (r) => r.completed_date || (r.completed_at ? r.completed_at.slice(0, 10) : '');

// 진행차수(Round) + 판정을 한 문구로 조합: "진행차수 3차, Pass"
const roundVerdictLabel = (r) => [r.round ? `진행차수 ${r.round}차` : '', r.verdict || ''].filter(Boolean).join(', ');

function verdictBadge(r) {
  const map = { Pass: ['#e1ecff', '#1a56d6'], Fail: ['#fde2e0', '#d23227'], Drop: ['#eceef2', '#5b6473'] };
  const c = map[r.verdict] || ['#eef2f8', '#6b7686'];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-weight:700;font-size:12px;background:${c[0]};color:${c[1]};">${esc(roundVerdictLabel(r) || '—')}</span>`;
}

const th = (t) => `<th style="text-align:left;padding:8px 10px;background:#f7f9fc;color:#6b7686;font-weight:700;border-bottom:1px solid #e2e7ef;font-size:12px;">${t}</th>`;
const thNum = (t) => `<th style="text-align:right;padding:8px 10px;background:#f7f9fc;color:#6b7686;font-weight:700;border-bottom:1px solid #e2e7ef;font-size:12px;">${t}</th>`;
const td = (t) => `<td style="padding:8px 10px;border-bottom:1px solid #eef1f6;vertical-align:top;font-size:13px;">${t}</td>`;
const tdNum = (t) => `<td style="padding:8px 10px;border-bottom:1px solid #eef1f6;vertical-align:top;font-size:13px;text-align:right;">${t}</td>`;
const section = (title, inner) => `<h3 style="font-size:15px;margin:22px 0 8px;padding-bottom:5px;border-bottom:2px solid #e2e7ef;">${title}</h3>${inner}`;
const emptyLine = (t) => `<p style="color:#6b7686;margin:6px 0;">${t}</p>`;

function summaryLine(c) {
  const chip = (label, val, color) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:6px 12px;border-radius:8px;background:#f4f6fa;border:1px solid #e2e7ef;font-size:13px;"><b style="color:${color};font-size:16px;">${val}</b> ${label}</span>`;
  return `<div style="margin:14px 0 4px;">
    ${chip('완료', c.completed, '#2faa61')}
    ${chip('Pass', c.pass, '#1a56d6')}
    ${chip('Fail', c.fail, '#d23227')}
    ${chip('진행중', c.inProgress, '#e8a317')}
  </div>`;
}

function completedTable(rows) {
  if (!rows.length) return emptyLine('완료된 모델이 없습니다.');
  const body = rows.map((r) => `<tr>
    ${td(certOf(r))}
    ${td('<strong>' + modelOf(r) + '</strong>')}
    ${td(dash(r.tester))}
    ${td(verdictBadge(r))}
    ${td(dash(compDate(r)))}
  </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e7ef;">
    <thead><tr>${th('인증 / Test')}${th('모델 (FW)')}${th('테스터')}${th('판정')}${th('완료일')}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

function failDetails(rows) {
  if (!rows.length) return '';
  const items = rows.map((r) => `
    <div style="border:1px solid #f3c9c4;background:#fdf6f5;border-left:4px solid #d23227;border-radius:8px;padding:10px 14px;margin:8px 0;">
      <div style="font-weight:700;color:#c0392b;">${modelOf(r)} <span style="font-weight:600;color:#6b7686;">· ${esc(r.cert_type)} · ${esc(roundVerdictLabel(r) || 'Fail')} · 테스터 ${dash(r.tester)}</span></div>
      <div style="margin-top:6px;"><span style="color:#6b7686;font-weight:700;">진행사항</span> ${dash(r.progress)}</div>
      <div style="margin-top:4px;"><span style="color:#6b7686;font-weight:700;">결과코멘트</span> ${dash(r.result)}</div>
    </div>`).join('');
  return section('Fail 상세 (진행/결과 코멘트)', items);
}

function inProgressTable(rows) {
  if (!rows.length) return emptyLine('진행중인 모델이 없습니다.');
  const body = rows.map((r) => {
    const sched = r.started_date ? `${r.started_date} ~` : (r.scheduled_date || r.desired_date || '—');
    return `<tr>
      ${td(certOf(r))}
      ${td('<strong>' + modelOf(r) + '</strong>')}
      ${td(dash(r.tester))}
      ${td(esc(sched))}
      ${td(dash(r.progress))}
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e7ef;">
    <thead><tr>${th('인증 / Test')}${th('모델 (FW)')}${th('테스터')}${th('일정')}${th('진행사항')}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

// ---- 모델별 인증 통계 (주간업무보고 전용 섹션) ----
// 지표: 결과(최신 판정) · Test 목적 · 진행차수(최신 판정 건의 Round) · Pass/Fail 횟수 · Pass율/Fail율.
// 미판정 건은 집계에서 제외하므로 분모는 판정 완료 건수이고 Pass율 + Fail율 = 100%다.
// 메일 클라이언트가 <style>을 제거하므로 결과 강조도 인라인 스타일로 넣는다.
const resultCell = (v) => (
  v === 'Pass' ? '<b style="color:#1257c9;">Pass</b>'
    : v === 'Fail' ? '<b style="background:#d23227;color:#ffffff;padding:1px 7px;border-radius:3px;">Fail</b>'
      : '—'
);

function certStatsTable(rows) {
  if (!rows.length) return emptyLine('해당 주차에 판정이 끝난 인증 의뢰가 없습니다.');
  const body = rows.map((r) => `<tr>
    ${td('<strong>' + esc(r.model_name) + '</strong>')}
    ${td(esc(r.cert_type))}
    ${td(resultCell(r.result))}
    ${td(esc(r.test_purpose))}
    ${tdNum(r.round + '차')}
    ${tdNum(r.pass)}
    ${tdNum(r.fail ? `<b style="color:#d23227;">${r.fail}</b>` : 0)}
    ${tdNum(r.pass_rate + '%')}
    ${tdNum(r.fail ? `<b style="color:#d23227;">${r.fail_rate}%</b>` : '0%')}
  </tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e7ef;">
    <thead><tr>${th('모델명')}${th('인증종류')}${th('결과')}${th('Test 목적')}${thNum('진행차수')}${thNum('Pass')}${thNum('Fail')}${thNum('Pass율')}${thNum('Fail율')}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

function certStatsSection(now = new Date(), range = null) {
  const { from, to } = range || workWeekRange(now);
  const s = repo.certStats({ from, to });
  const t = s.totals;
  const head = `<p style="color:#6b7686;font-size:12px;margin:6px 0 10px;">
    대상 주차 ${esc(from)} ~ ${esc(to)} (월~금) · 모델 ${t.models}건 · 판정 ${t.judged}건 ·
    Pass ${t.pass} / Fail ${t.fail} · Pass율 ${t.pass_rate}% · Fail율 ${t.fail_rate}%
    <br>판정 완료(Pass/Fail) 건만 집계하며 미판정 건은 제외합니다. 진행차수는 최신 판정 건의 Round입니다.
  </p>`;
  return section('모델별 인증 현황 (진행차수 · Pass/Fail 통계)', head + certStatsTable(s.rows));
}

// 보고 메일 공통 겉틀. 일일·주간·인증통계 세 보고가 같은 서식을 쓰도록 한 곳에 둔다.
function shell(title, rangeLabel, body, generatedAt) {
  return `<div style="max-width:760px;margin:0;padding:20px;font-family:'Malgun Gothic','맑은 고딕',-apple-system,sans-serif;color:#1f2733;line-height:1.6;">
    <h2 style="font-size:19px;margin:0 0 2px;">QE 인증 ${esc(title)}</h2>
    <p style="color:#6b7686;font-size:13px;margin:0;">대상 기간 · ${esc(rangeLabel)}</p>
    ${body}
    <p style="color:#9aa4b2;font-size:11px;margin-top:24px;">QE 인증 일정 대시보드 자동 생성${generatedAt ? ' · ' + esc(generatedAt) : ''}</p>
  </div>`;
}

function buildHtml(title, data, generatedAt, extra) {
  const rangeLabel = data.from === data.to ? data.from : `${data.from} ~ ${data.to}`;
  const body = `${summaryLine(data.counts)}
    ${section('완료 모델 (Pass / Fail)', completedTable(data.completed))}
    ${failDetails(data.fail)}
    ${section('진행중 모델', inProgressTable(data.inProgress))}
    ${extra || ''}`;
  return shell(title, rangeLabel, body, generatedAt);
}

// ---- 엑셀(CSV) 첨부 ----
// 화면의 '⤓ 엑셀 다운로드'와 같은 UTF-8 BOM CSV 서식. Excel에서 바로 열린다.
const csvCell = (v) => {
  const t = String(v ?? '');
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csvBuffer = (lines) => Buffer.from(
  '\uFEFF' + lines.map((r) => r.map(csvCell).join(',')).join('\r\n'), 'utf8'
);

// 일일·주간 보고 첨부: 본문의 '완료 모델' / '진행중 모델' 표와 같은 항목
const REPORT_COLS = [
  ['인증종류', (r) => r.cert_type],
  ['Test type', (r) => r.test_type],
  ['Test 목적', (r) => r.test_purpose],
  ['진행차수', (r) => (r.round ? `${r.round}차` : '')],
  ['모델명', (r) => r.model_name],
  ['FW', (r) => r.fw_version],
  ['의뢰자', (r) => r.requester],
  ['테스터', (r) => r.tester],
  ['상태', (r) => r.status],
  ['판정', (r) => r.verdict],
  ['시작일', (r) => r.started_date],
  ['완료일', (r) => compDate(r)],
  ['진행사항', (r) => r.progress],
  ['결과코멘트', (r) => r.result],
];

function reportCsvBuffer(title, data) {
  const head = REPORT_COLS.map((c) => c[0]);
  const rows = (list) => list.map((r) => REPORT_COLS.map((c) => c[1](r)));
  return csvBuffer([
    [title, data.from === data.to ? data.from : `${data.from} ~ ${data.to}`],
    ['집계', `완료 ${data.counts.completed} (Pass ${data.counts.pass} / Fail ${data.counts.fail}) · 진행중 ${data.counts.inProgress}`],
    [],
    ['[완료 모델]'], head, ...rows(data.completed),
    [],
    ['[진행중 모델]'], head, ...rows(data.inProgress),
  ]);
}

// 인증 통계 첨부: 화면 '인증 통계' 탭의 엑셀 다운로드와 칼럼·머리말이 같다.
const STATS_COLS = [
  ['모델명', (r) => r.model_name],
  ['인증종류', (r) => r.cert_type],
  ['결과', (r) => r.result],
  ['Test 목적', (r) => r.test_purpose],
  ['진행차수', (r) => r.round],
  ['Pass', (r) => r.pass],
  ['Fail', (r) => r.fail],
  ['Pass율(%)', (r) => r.pass_rate],
  ['Fail율(%)', (r) => r.fail_rate],
];

function certStatsCsvBuffer(range, s) {
  const t = s.totals;
  return csvBuffer([
    ['인증 통계', range ? `${range.from} ~ ${range.to} (월~금)` : '전체 기간 누적'],
    ['집계 대상', '판정 완료(Pass/Fail) 건만 — 미판정 건은 제외'],
    [],
    STATS_COLS.map((c) => c[0]),
    ...s.rows.map((r) => STATS_COLS.map((c) => c[1](r))),
    [],
    ['합계', `모델 ${t.models}건`, '', '', `판정 ${t.judged}건`, t.pass, t.fail, t.pass_rate, t.fail_rate],
  ]);
}

function daily(now = new Date()) {
  const { from, to } = dayRange(now);
  const data = repo.reportData(from, to);
  return {
    period: 'daily', title: '일일 현황보고', data,
    subject: `[인증일정] 일일 현황보고 (${from})`,
    html: buildHtml('일일 현황보고', data, now.toLocaleString('ko-KR')),
    attachments: [{ filename: `일일현황보고_${from}.csv`, content: reportCsvBuffer('일일 현황보고', data) }],
  };
}

function weekly(now = new Date()) {
  const { from, to } = weekRange(now);
  const data = repo.reportData(from, to);
  const wk = workWeekRange(now);
  return {
    period: 'weekly', title: '주간 현황보고', data,
    subject: `[인증일정] 주간 현황보고 (${from} ~ ${to})`,
    html: buildHtml('주간 현황보고', data, now.toLocaleString('ko-KR'), certStatsSection(now)),
    // 본문이 월~일 집계 + 월~금 인증통계 두 부분이라 첨부도 두 개로 나눈다.
    attachments: [
      { filename: `주간현황보고_${from}_${to}.csv`, content: reportCsvBuffer('주간 현황보고', data) },
      { filename: `인증통계_${wk.from}_${wk.to}.csv`, content: certStatsCsvBuffer(wk, repo.certStats(wk)) },
    ],
  };
}

// 인증 통계 단독 보고 (월요일 아침 발송). 대상은 지난주 월~금.
function certStats(now = new Date()) {
  const range = lastWorkWeekRange(now);
  const s = repo.certStats(range);
  const rangeLabel = `${range.from} ~ ${range.to} (월~금)`;
  return {
    period: 'certstats', title: '인증 통계 보고', range, data: s,
    subject: `[인증일정] 주간 인증 통계 (${range.from} ~ ${range.to})`,
    html: shell('인증 통계 보고', rangeLabel, certStatsSection(now, range), now.toLocaleString('ko-KR')),
    attachments: [{ filename: `인증통계_${range.from}_${range.to}.csv`, content: certStatsCsvBuffer(range, s) }],
  };
}

module.exports = { daily, weekly, certStats, weekRange, dayRange, workWeekRange, lastWorkWeekRange, certStatsSection };
