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

function verdictBadge(v) {
  const map = { Pass: ['#e1ecff', '#1a56d6'], Fail: ['#fde2e0', '#d23227'], Drop: ['#eceef2', '#5b6473'] };
  const c = map[v] || ['#eef2f8', '#6b7686'];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-weight:700;font-size:12px;background:${c[0]};color:${c[1]};">${esc(v || '—')}</span>`;
}

const th = (t) => `<th style="text-align:left;padding:8px 10px;background:#f7f9fc;color:#6b7686;font-weight:700;border-bottom:1px solid #e2e7ef;font-size:12px;">${t}</th>`;
const td = (t) => `<td style="padding:8px 10px;border-bottom:1px solid #eef1f6;vertical-align:top;font-size:13px;">${t}</td>`;
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
    ${td(verdictBadge(r.verdict))}
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
      <div style="font-weight:700;color:#c0392b;">${modelOf(r)} <span style="font-weight:600;color:#6b7686;">· ${esc(r.cert_type)} · 테스터 ${dash(r.tester)}</span></div>
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

function buildHtml(title, data, generatedAt) {
  const rangeLabel = data.from === data.to ? data.from : `${data.from} ~ ${data.to}`;
  return `<div style="max-width:760px;margin:0 auto;padding:20px;font-family:'Malgun Gothic','맑은 고딕',-apple-system,sans-serif;color:#1f2733;line-height:1.6;">
    <h2 style="font-size:19px;margin:0 0 2px;">QE 인증 ${esc(title)}</h2>
    <p style="color:#6b7686;font-size:13px;margin:0;">대상 기간 · ${esc(rangeLabel)}</p>
    ${summaryLine(data.counts)}
    ${section('완료 모델 (Pass / Fail)', completedTable(data.completed))}
    ${failDetails(data.fail)}
    ${section('진행중 모델', inProgressTable(data.inProgress))}
    <p style="color:#9aa4b2;font-size:11px;margin-top:24px;">QE 인증 일정 대시보드 자동 생성${generatedAt ? ' · ' + esc(generatedAt) : ''}</p>
  </div>`;
}

function daily(now = new Date()) {
  const { from, to } = dayRange(now);
  const data = repo.reportData(from, to);
  return {
    period: 'daily', title: '일일 현황보고', data,
    subject: `[인증일정] 일일 현황보고 (${from})`,
    html: buildHtml('일일 현황보고', data, now.toLocaleString('ko-KR')),
  };
}

function weekly(now = new Date()) {
  const { from, to } = weekRange(now);
  const data = repo.reportData(from, to);
  return {
    period: 'weekly', title: '주간 현황보고', data,
    subject: `[인증일정] 주간 현황보고 (${from} ~ ${to})`,
    html: buildHtml('주간 현황보고', data, now.toLocaleString('ko-KR')),
  };
}

module.exports = { daily, weekly, weekRange, dayRange };
