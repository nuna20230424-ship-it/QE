// 일일/주간 현황보고 기간 계산 및 HTML 생성 (앱 뷰·이메일 본문 공용, 인라인 스타일)
const repo = require('./db');
const notify = require('./notify');   // 메일 링크에 쓸 baseUrl 조회
const assignees = require('./assignees');

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

// Word(Outlook 데스크톱)는 style 의 color 를 흘릴 때가 있지만 <font color> 속성은 확실히 먹는다.
// 배경에 bgcolor 를 함께 준 것과 같은 이유로, 글자색도 속성·스타일을 이중으로 건다.
const fontColor = (html, color) => `<font color="${color}" style="color:${color};">${html}</font>`;
// 배지와 뒤따르는 Test 표기를 한 줄에 붙여 둔다. Word 는 display:inline-table 을 무시해
// 배지를 블록으로 그리므로, 표 한 행에 두 칸으로 넣어야 줄이 갈라지지 않는다.
const certOf = (r) => {
  const t = [r.test_type, r.test_purpose].filter(Boolean).join(' ');
  if (!t) return certBadge(r.cert_type);
  return `<table cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">`
    + `<tr><td style="padding:0;">${certBadge(r.cert_type)}</td>`
    + `<td style="padding:0 0 0 6px;font-size:13px;white-space:nowrap;">${esc(t)}</td></tr></table>`;
};
const modelOf = (r) => esc(`${r.model_name}${r.fw_version ? ' (' + r.fw_version + ')' : ''}`);
// 담당 테스터 표기 — 메인 · 서브를 함께 적는다. 서브가 없으면 예전과 같은 한 명이다.
// 이 표기는 사내 화면용 본문(html)에만 들어간다. 자동발송 본문(mailHtml)은 집계와 링크만 담는다.
const testerOf = (r) => dash(assignees.listOf(r).join(' · '));
const compDate = (r) => r.completed_date || (r.completed_at ? r.completed_at.slice(0, 10) : '');

// 진행차수(Round) + 판정을 한 문구로 조합: "진행차수 3차, Pass"
const roundVerdictLabel = (r) => [r.round ? `진행차수 ${r.round}차` : '', r.verdict || ''].filter(Boolean).join(', ');

// Outlook 데스크톱은 Word 렌더러라 span·b 같은 인라인 요소의 background 와 border-radius 를
// 버린다. 확실히 존중하는 것은 표 셀의 bgcolor 속성이므로, 색이 실리는 조각은 전부
// 1칸짜리 표로 감싼다. display:inline-table 은 브라우저에서 기존처럼 줄 안에 놓이게 하고,
// Word 는 이 선언을 무시해 블록으로 그리지만 셀 하나만 차지하는 위치라 결과가 같다.
function tag(text, bg, color, radius = '999px') {
  return `<table cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;display:inline-table;">`
    + `<tr><td bgcolor="${bg}" style="background:${bg};color:${color};padding:2px 8px;border-radius:${radius};font-weight:700;font-size:12px;white-space:nowrap;">${fontColor(text, color)}</td></tr>`
    + `</table>`;
}

// 화면의 인증종류 배지(styles.css .badge-netflix 등)와 같은 색을 복사본에도 입힌다.
// 배경·글자색 값은 styles.css 쪽과 짝을 맞춰 둔 것이라 한쪽만 고치면 화면과 어긋난다.
const CERT_COLORS = {
  netflix: ['#fde8e8', '#c0392b'],
  google: ['#e8f0fe', '#1a73e8'],
  amazon: ['#fff1de', '#c77700'],
  etc: ['#eef2f8', '#6b7686'],
};
const certKind = (c) => (
  /netflix/i.test(c) ? 'netflix' : /google/i.test(c) ? 'google' : /amazon/i.test(c) ? 'amazon' : 'etc'
);
const certBadge = (c) => {
  const [bg, fg] = CERT_COLORS[certKind(c)];
  return tag(esc(c), bg, fg);
};

function verdictBadge(r) {
  const map = { Pass: ['#e1ecff', '#1a56d6'], Fail: ['#fde2e0', '#d23227'], Drop: ['#eceef2', '#5b6473'] };
  const c = map[r.verdict] || ['#eef2f8', '#6b7686'];
  return tag(esc(roundVerdictLabel(r) || '—'), c[0], c[1]);
}

// bgcolor 속성을 style 과 함께 둔다. Word 는 style 의 background 를 셀에서도 흘릴 때가 있어
// 속성 쪽이 최후의 보루다.
const th = (t) => `<th bgcolor="#f7f9fc" style="text-align:left;padding:8px 10px;background:#f7f9fc;color:#6b7686;font-weight:700;border-bottom:1px solid #e2e7ef;font-size:12px;">${t}</th>`;
const thNum = (t) => `<th bgcolor="#f7f9fc" style="text-align:right;padding:8px 10px;background:#f7f9fc;color:#6b7686;font-weight:700;border-bottom:1px solid #e2e7ef;font-size:12px;">${t}</th>`;
const td = (t) => `<td style="padding:8px 10px;border-bottom:1px solid #eef1f6;vertical-align:top;font-size:13px;">${t}</td>`;
const tdNum = (t) => `<td style="padding:8px 10px;border-bottom:1px solid #eef1f6;vertical-align:top;font-size:13px;text-align:right;">${t}</td>`;
const section = (title, inner) => `<h3 style="font-size:15px;margin:22px 0 8px;padding-bottom:5px;border-bottom:2px solid #e2e7ef;">${title}</h3>${inner}`;
const emptyLine = (t) => `<p style="color:#6b7686;margin:6px 0;">${t}</p>`;

// 칩도 배경이 있어 표 셀로 만든다. 칩 사이 간격은 Word 가 무시하는 border-spacing 대신
// 빈 셀(스페이서)로 벌린다 — 옛날 메일 HTML 방식이지만 어디서나 같게 나온다.
const chip = (label, val, color) => `<td bgcolor="#f4f6fa" style="background:#f4f6fa;border:1px solid #e2e7ef;border-radius:8px;padding:6px 12px;font-size:13px;white-space:nowrap;"><b style="color:${color};font-size:16px;">${fontColor(val, color)}</b> ${label}</td>`;
const chipGap = '<td style="width:8px;font-size:0;line-height:0;">&nbsp;</td>';

function summaryLine(c) {
  return `<table cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;margin:14px 0 4px;"><tr>
    ${chip('완료', c.completed, '#2faa61')}${chipGap}
    ${chip('Pass', c.pass, '#1a56d6')}${chipGap}
    ${chip('Fail', c.fail, '#d23227')}${chipGap}
    ${chip('진행중', c.inProgress, '#e8a317')}
  </tr></table>`;
}

function completedTable(rows) {
  if (!rows.length) return emptyLine('완료된 모델이 없습니다.');
  const body = rows.map((r) => `<tr>
    ${td(certOf(r))}
    ${td('<strong>' + modelOf(r) + '</strong>')}
    ${td(testerOf(r))}
    ${td(verdictBadge(r))}
    ${td(dash(compDate(r)))}
  </tr>`).join('');
  return `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e7ef;">
    <thead><tr>${th('인증 / Test')}${th('모델 (FW)')}${th('테스터')}${th('판정')}${th('완료일')}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

function failDetails(rows) {
  if (!rows.length) return '';
  const items = rows.map((r) => `
    <table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;margin:8px 0;">
      <tr>
        <td width="4" bgcolor="#d23227" style="width:4px;background:#d23227;font-size:0;line-height:0;">&nbsp;</td>
        <td bgcolor="#fdf6f5" style="background:#fdf6f5;border:1px solid #f3c9c4;border-left:none;padding:10px 14px;font-size:13px;">
          <div style="font-weight:700;color:#c0392b;">${fontColor(modelOf(r), '#c0392b')} <span style="font-weight:600;color:#6b7686;">· ${esc(r.cert_type)} · ${esc(roundVerdictLabel(r) || 'Fail')} · 테스터 ${testerOf(r)}</span></div>
          <div style="margin-top:6px;"><span style="color:#6b7686;font-weight:700;">진행사항</span> ${dash(r.progress)}</div>
          <div style="margin-top:4px;"><span style="color:#6b7686;font-weight:700;">결과코멘트</span> ${dash(r.result)}</div>
        </td>
      </tr>
    </table>`).join('');
  return section('Fail 상세 (진행/결과 코멘트)', items);
}

function inProgressTable(rows) {
  if (!rows.length) return emptyLine('진행중인 모델이 없습니다.');
  const body = rows.map((r) => {
    const sched = r.started_date ? `${r.started_date} ~` : (r.scheduled_date || r.desired_date || '—');
    return `<tr>
      ${td(certOf(r))}
      ${td('<strong>' + modelOf(r) + '</strong>')}
      ${td(testerOf(r))}
      ${td(esc(sched))}
      ${td(dash(r.progress))}
    </tr>`;
  }).join('');
  return `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e7ef;">
    <thead><tr>${th('인증 / Test')}${th('모델 (FW)')}${th('테스터')}${th('일정')}${th('진행사항')}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

// ---- 모델별 인증 통계 (주간업무보고 전용 섹션) ----
// 지표: 결과(최신 판정) · Test 목적 · 진행차수(최신 판정 건의 Round) · Pass/Fail 횟수 · Pass율/Fail율.
// 미판정 건은 집계에서 제외하므로 분모는 판정 완료 건수이고 Pass율 + Fail율 = 100%다.
// 메일 클라이언트가 <style>을 제거하므로 결과 강조도 인라인 스타일로 넣는다.
const resultCell = (v) => (
  v === 'Pass' ? `<b style="color:#1257c9;font-weight:800;">${fontColor('Pass', '#1257c9')}</b>`
    : v === 'Fail' ? tag('Fail', '#d23227', '#ffffff', '3px')
      : '—'
);

// Fail 은 칸 자체를 빨갛게 칠하고 글씨를 흰색으로 둔다.
// 배지(중첩 표)로 두면 Word 가 그 표를 흘리면서 안쪽 흰 글씨 지정까지 같이 버려
// 붙여넣기에서 검은 글씨로 나온다. 실제 셀의 bgcolor 는 Word 가 가장 확실히 그리는 구조다.
const tdResult = (v) => (
  v !== 'Fail' ? td(resultCell(v))
    : `<td bgcolor="#d23227" align="center" style="padding:8px 10px;border-bottom:1px solid #eef1f6;`
      + `vertical-align:top;font-size:13px;background:#d23227;color:#ffffff;font-weight:800;text-align:center;">`
      + `<b><font color="#ffffff" style="color:#ffffff;">Fail</font></b></td>`
);

function certStatsTable(rows) {
  if (!rows.length) return emptyLine('해당 주차에 판정이 끝난 인증 의뢰가 없습니다.');
  const body = rows.map((r) => `<tr>
    ${td('<strong>' + esc(r.model_name) + '</strong>')}
    ${td(certBadge(r.cert_type))}
    ${tdResult(r.result)}
    ${td(esc(r.completed_date) || '-')}
    ${td(esc(r.test_purpose))}
    ${tdNum(r.round + '차')}
    ${tdNum(r.pass)}
    ${tdNum(r.fail ? `<b style="color:#d23227;">${fontColor(r.fail, '#d23227')}</b>` : 0)}
    ${tdNum(r.pass_rate + '%')}
    ${tdNum(r.fail ? `<b style="color:#d23227;">${fontColor(r.fail_rate + '%', '#d23227')}</b>` : '0%')}
  </tr>`).join('');
  return `<table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e7ef;">
    <thead><tr>${th('모델명')}${th('인증종류')}${th('결과')}${th('인증완료일')}${th('Test 목적')}${thNum('진행차수')}${thNum('Pass')}${thNum('Fail')}${thNum('Pass율')}${thNum('Fail율')}</tr></thead>
    <tbody>${body}</tbody></table>`;
}

// label 예: "주차 2026-08-24 ~ 2026-08-28 (월~금)" · "기간 전체 누적"
function statsBlock(s, label) {
  const t = s.totals;
  const head = `<p style="color:#6b7686;font-size:12px;margin:6px 0 10px;">
    대상 ${esc(label)} · 모델 ${t.models}건 · 판정 ${t.judged}건 ·
    Pass ${t.pass} / Fail ${t.fail} · Pass율 ${t.pass_rate}% · Fail율 ${t.fail_rate}%
    <br>판정 완료(Pass/Fail) 건만 집계하며 미판정 건은 제외합니다. 진행차수는 최신 판정 건의 Round입니다.
  </p>`;
  return section('모델별 인증 현황 (진행차수 · Pass/Fail 통계)', head + certStatsTable(s.rows));
}

function certStatsSection(now = new Date(), range = null) {
  const { from, to } = range || workWeekRange(now);
  return statsBlock(repo.certStats({ from, to }), `주차 ${from} ~ ${to} (월~금)`);
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

// ---- 발송용 본문 (링크 전용) ----
// 사내 자료가 사외 메일함에 남지 않도록, 메일에는 집계 수치와 대시보드 링크만 싣는다.
// 모델명·담당자 실명·결함 코멘트는 사내망 대시보드에서만 볼 수 있다. 첨부도 붙이지 않는다.
const MAIL_NOTE = '사내 자료 보호를 위해 이 메일에는 집계 수치만 담겨 있습니다. '
  + '모델명 · 담당자 · 결과 코멘트 등 상세 내용은 사내 대시보드에서 확인하세요.';

// 인증 통계용 요약 칩 (건수·비율만)
function statsSummaryLine(t) {
  return `<div style="margin:14px 0 4px;">
    ${chip('모델', t.models, '#1f2733')}
    ${chip('판정', t.judged, '#1f2733')}
    ${chip('Pass', t.pass, '#1a56d6')}
    ${chip('Fail', t.fail, '#d23227')}
    ${chip('Pass율', t.pass_rate + '%', '#1a56d6')}
    ${chip('Fail율', t.fail_rate + '%', '#d23227')}
  </div>`;
}

function dashboardLink(hint) {
  const url = notify.baseUrl();
  if (!url) {
    return `<p style="color:#6b7686;font-size:13px;margin:16px 0 0;">
      사내 대시보드에서 확인하세요${hint ? ` (${esc(hint)})` : ''}.
      <br><span style="color:#c1793a;">※ config.json에 baseUrl이 없어 링크를 넣지 못했습니다.</span>
    </p>`;
  }
  return `<div style="margin:18px 0 6px;">
    <a href="${esc(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#2f6df6;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;">대시보드 열기</a>
    <div style="color:#6b7686;font-size:12px;margin-top:7px;">${esc(url)}${hint ? ` · ${esc(hint)}` : ''}</div>
  </div>`;
}

function mailBody(title, rangeLabel, summaryHtml, hint, generatedAt) {
  const body = `${summaryHtml}${dashboardLink(hint)}
    <p style="color:#9aa4b2;font-size:12px;margin:16px 0 0;line-height:1.6;">${MAIL_NOTE}</p>`;
  return shell(title, rangeLabel, body, generatedAt);
}

function daily(now = new Date()) {
  const { from, to } = dayRange(now);
  const data = repo.reportData(from, to);
  return {
    period: 'daily', title: '일일 현황보고', data,
    subject: `[인증일정] 일일 현황보고 (${from})`,
    // html: 사내망 화면용(전체) / mailHtml: 발송용(집계 + 링크만)
    html: buildHtml('일일 현황보고', data, now.toLocaleString('ko-KR')),
    mailHtml: mailBody('일일 현황보고', from, summaryLine(data.counts), '일일보고 탭', now.toLocaleString('ko-KR')),
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
    mailHtml: mailBody('주간 현황보고', `${from} ~ ${to}`, summaryLine(data.counts), '주간보고 탭', now.toLocaleString('ko-KR')),
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
    html: shell('통계 보고', rangeLabel, certStatsSection(now, range), now.toLocaleString('ko-KR')),
    mailHtml: mailBody('통계 보고', rangeLabel, statsSummaryLine(s.totals), '인증 통계 탭', now.toLocaleString('ko-KR')),
  };
}

// ---- 복사용 본문 ----
// 대시보드 '인증 통계' 탭을 메일 작성창에 그대로 붙여넣기 위한 본문.
// 탭에서 고른 기간을 그대로 쓰며, range가 null이면 전체 기간 누적이다.
// 화면과 동일한 상세(모델명 포함)라 사내 수신자 전용이다. mailHtml(집계+링크)과는 용도가 다르다.
function certStatsCopy(range, now = new Date()) {
  const rangeLabel = range ? `${range.from} ~ ${range.to} (월~금)` : '전체 기간 누적';
  const block = statsBlock(repo.certStats(range), range ? `주차 ${range.from} ~ ${range.to} (월~금)` : '기간 전체 누적');
  return {
    period: 'certstats',
    subject: `[인증일정] 인증 통계 (${rangeLabel})`,
    html: shell('통계 보고', rangeLabel, block, now.toLocaleString('ko-KR')),
  };
}

module.exports = {
  daily, weekly, certStats, certStatsCopy,
  weekRange, dayRange, workWeekRange, lastWorkWeekRange, certStatsSection,
};
