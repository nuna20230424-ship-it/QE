// 대시보드 프런트 로직: 목록 조회/등록/수정/삭제, 보드·일정표·캘린더 뷰, 요약·이력
const STATUSES = ['예약대기', '예약확정', '진행중', '완료', '보류', '중단'];
const _now = new Date();

const state = {
  view: 'board',
  role: localStorage.getItem('role') || '의뢰자',
  name: localStorage.getItem('username') || '',
  items: [],
  cal: { y: _now.getFullYear(), m: _now.getMonth() }, // m: 0-based
  sort: { key: null, dir: 'asc' }, // 일정표 정렬 상태
  boardExpanded: new Set(), // 5개 초과 시 펼친 상태의 상태칼럼
  options: { models: [], testPurposes: [] }, // 입력 자동목록용 선택지 (필터와 무관한 전체 이력값)
  // 인증 통계 뷰: 주간(월~금) / 전체 누적 전환, weekOffset 0 = 이번 주
  certStats: { mode: 'week', weekOffset: 0, data: null, range: null },
  hiddenRequesters: [], // 의뢰자 제안에서 숨긴 이름 (의뢰 레코드는 보존)
  resources: null,      // Task 6. QE 전체 리소스 현황 (/api/resources 응답)
};

const BOARD_LIMIT = 5; // 보드 칼럼당 기본 노출 카드 수

const $ = (sel) => document.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, '0');
// 'YYYY-MM-DD'의 다음 날 문자열
function nextDay(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// ---- API ----
async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

// 변경 이력에 남길 작업자 표기
function actor() {
  const name = state.name.trim();
  return name ? `${name} (${state.role})` : state.role;
}

function buildQuery() {
  const p = new URLSearchParams();
  const cert = $('#filter-cert').value;
  const status = $('#filter-status').value;
  const q = $('#filter-q').value.trim();
  if (cert) p.set('cert_type', cert);
  if (status) p.set('status', status);
  if (q) p.set('q', q);
  return p.toString() ? `?${p}` : '';
}

async function load() {
  state.items = await api(`/api/requests${buildQuery()}`);
  await loadOptions();
  render();
  renderSummary();
}

// 모델명 자동목록: 한 번이라도 입력된 값 전체를 서버에서 받는다.
// state.items는 필터가 걸린 목록이므로 여기서 쓰면 값이 누락된다.
async function loadOptions() {
  try {
    const o = await api('/api/options');
    state.options.models = o.models || [];
    state.options.testPurposes = o.testPurposes || [];
  } catch { /* 목록을 못 받아도 직접 입력은 그대로 동작 */ }
}

// ---- 공통 ----
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));
const fmtDate = (d) => (d ? d : '—');
const fmtTs = (ts) => { try { return new Date(ts).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ts; } };
const certClass = (c) => (
  /netflix/i.test(c) ? 'netflix' : /google/i.test(c) ? 'google' : /amazon/i.test(c) ? 'amazon' : 'etc'
);

// ---- 요약 위젯 ----
async function renderSummary() {
  let s;
  try { s = await api('/api/stats'); } catch { return; }
  const open = (s.byStatus['예약대기'] || 0) + (s.byStatus['예약확정'] || 0) + (s.byStatus['진행중'] || 0);
  const testers = Object.entries(s.testerLoad).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([t, n]) => `${t} ${n}`).join(', ') || '—';
  const cards = [
    { k: '전체', v: s.total },
    { k: '대기/진행', v: open },
    { k: '완료', v: s.byStatus['완료'] || 0 },
    { k: '지연', v: s.overdue, warn: s.overdue > 0 },
    { k: '평균 소요일', v: s.avgLeadDays == null ? '—' : `${s.avgLeadDays}일` },
    { k: '테스터 부하(미완)', sub: testers },
  ];
  $('#summary').innerHTML = cards.map((c) => `
    <div class="sumcard ${c.warn ? 'warn' : ''}">
      <div class="k">${c.k}</div>
      ${c.v !== undefined ? `<div class="v">${c.v}</div>` : ''}
      ${c.sub ? `<div class="sub">${esc(c.sub)}</div>` : ''}
    </div>`).join('');
}

// ---- 보드 ----
// 진행차수(Round)와 판정을 한 문구로 조합: "진행차수 3차, Pass"
// 둘 중 하나만 있으면 있는 쪽만, 둘 다 없으면 빈 문자열.
function roundVerdictLabel(it) {
  const round = it.round ? `진행차수 ${it.round}차` : '';
  return [round, it.verdict || ''].filter(Boolean).join(', ');
}

// 판정 배지: 보드는 완료건만, 일정표 판정 컬럼은 값이 있으면 항상
const verdictChip = (it) => {
  const label = roundVerdictLabel(it);
  return label ? `<span class="verdict v-${it.verdict || 'none'}">${esc(label)}</span>` : '';
};
const verdictBadge = (it) => (it.status === '완료' ? verdictChip(it) : '');

// 일정 표기: 시작일 ~ 완료일 (없으면 예약확정일 → 희망일 단일)
function schedLabel(it) {
  const s = it.started_date, e = it.completed_date;
  if (s && e) return `${s} ~ ${e}`;
  if (s) return `${s} ~`;
  if (e) return `~ ${e}`;
  return it.scheduled_date || it.desired_date || '—';
}

function cardHtml(it) {
  const testInfo = [it.test_type, it.test_purpose, it.round ? `R${it.round}` : ''].filter(Boolean).join(' · ');
  const line1 = [it.fw_version ? `FW ${it.fw_version}` : '', testInfo].filter(Boolean).join(' · ') || '정보 미입력';
  return `
    <div class="card cs-${it.status}" data-id="${it.id}">
      <div class="card-top">
        <span class="model">${esc(it.model_name)}${verdictBadge(it)}</span>
        <span class="badge badge-${certClass(it.cert_type)}">${esc(it.cert_type)}</span>
      </div>
      <div class="meta">
        ${esc(line1)}<br>
        의뢰자 ${esc(it.requester) || '—'} · 테스터 ${esc(it.tester) || '—'}<br>
        일정 ${esc(schedLabel(it))}
      </div>
    </div>`;
}

function renderBoard() {
  $('#view-board').innerHTML = STATUSES.map((st) => {
    const list = state.items.filter((i) => i.status === st);
    const expanded = state.boardExpanded.has(st);
    const shown = expanded ? list : list.slice(0, BOARD_LIMIT);
    const cards = shown.map(cardHtml).join('');
    const hiddenN = list.length - shown.length;
    const toggle = list.length > BOARD_LIMIT
      ? `<button class="col-toggle" data-toggle="${st}">${expanded ? '접기 ▴' : `+ ${hiddenN}개 더보기 ▾`}</button>`
      : '';
    const body = list.length ? cards + toggle : '<div class="col-empty">항목 없음</div>';
    return `
      <div class="col">
        <div class="col-head">
          <span class="st-${st}"><span class="dot bg-${st}"></span> ${st}</span>
          <span class="count">${list.length}</span>
        </div>
        <div class="col-body">${body}</div>
      </div>`;
  }).join('');
}

// ---- 일정표 ----
// 컬럼별 정렬 키 (헤더 클릭 정렬용)
const SORT_KEYS = {
  date: (it) => it.scheduled_date || it.desired_date || '',
  cert: (it) => it.cert_type || '',
  test: (it) => it.test_type || '',
  model: (it) => it.model_name || '',
  round: (it) => it.round || '',
  requester: (it) => it.requester || '',
  tester: (it) => it.tester || '',
  status: (it) => String(STATUSES.indexOf(it.status)).padStart(2, '0'),
  verdict: (it) => it.verdict || '',
  comment: (it) => it.result || '',
};

function renderSchedule() {
  const root = $('#view-schedule');
  if (!state.items.length) { root.innerHTML = '<p class="col-empty">표시할 의뢰가 없습니다.</p>'; return; }

  let list = state.items;
  if (state.sort.key && SORT_KEYS[state.sort.key]) {
    const f = SORT_KEYS[state.sort.key];
    list = [...state.items].sort((a, b) => {
      const va = f(a), vb = f(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return state.sort.dir === 'asc' ? cmp : -cmp;
    });
  }
  const rows = list.map((it) => {
    const onlyDesired = !it.started_date && !it.completed_date && !it.scheduled_date && it.desired_date;
    const dateMark = onlyDesired ? ' <small>(희망)</small>' : '';
    const testInfo = [it.test_type, it.test_purpose].filter(Boolean).join(' / ');
    return `
      <tr data-id="${it.id}">
        <td>${esc(schedLabel(it))}${dateMark}</td>
        <td><span class="badge badge-${certClass(it.cert_type)}">${esc(it.cert_type)}</span></td>
        <td>${esc(testInfo) || '—'}</td>
        <td><strong>${esc(it.model_name)}</strong>${it.fw_version ? ` <small>${esc(it.fw_version)}</small>` : ''}</td>
        <td>${esc(it.round) || '—'}</td>
        <td>${esc(it.requester) || '—'}</td>
        <td>${esc(it.tester) || '—'}</td>
        <td><span class="status-pill st-${it.status}"><span class="dot bg-${it.status}"></span>${it.status}</span></td>
        <td>${verdictChip(it) || '—'}</td>
        <td class="cell-comment">${esc(it.result) || '—'}</td>
      </tr>`;
  }).join('');
  const ind = (k) => (state.sort.key === k ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  root.innerHTML = `
    <div class="sched-bar"><button id="btn-excel" class="btn">⤓ 엑셀 다운로드</button></div>
    <div class="table-wrap">
    <table>
      <thead><tr>
        <th data-sort="date">일정${ind('date')}</th>
        <th data-sort="cert">인증${ind('cert')}</th>
        <th data-sort="test">Test${ind('test')}</th>
        <th data-sort="model">모델 / FW${ind('model')}</th>
        <th data-sort="round">Round${ind('round')}</th>
        <th data-sort="requester">의뢰자${ind('requester')}</th>
        <th data-sort="tester">테스터${ind('tester')}</th>
        <th data-sort="status">상태${ind('status')}</th>
        <th data-sort="verdict">판정${ind('verdict')}</th>
        <th data-sort="comment">결과코멘트${ind('comment')}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

// 현재 일정표(필터 적용된 목록)를 CSV로 내려받기 (UTF-8 BOM → Excel에서 한글 정상)
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// UTF-8 BOM을 붙여 저장 (Excel이 BOM 없으면 한글을 깨뜨린다)
function saveCsv(lines, fname) {
  const csv = lines.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// ---- 보고 본문 복사 ----
// 메일 작성창에 붙여넣었을 때 표·색상·서식이 그대로 살아나도록 클립보드에 text/html을 함께 싣는다.
// 대시보드는 사내망 http로 열리고 navigator.clipboard는 보안 컨텍스트(https·localhost) 전용이라
// 아래 2번이 사실상 기본 경로다.
//   1) Clipboard API        — https·localhost 에서만
//   2) copy 이벤트 가로채기  — 클립보드에 실을 서식을 우리가 직접 지정한다. http 에서도 동작.
//   3) 화면 밖 선택 복사     — 1·2가 모두 막혔을 때의 최후 수단
// 2번을 기본으로 올린 이유. 3번은 브라우저가 선택 영역을 알아서 직렬화하는 방식인데, 뷰포트 밖
// (left:-99999px)에 있는 요소는 text/plain 만 실리는 경우가 있어 "붙여넣으면 서식이 통째로
// 사라지는" 증상이 난다. 실을 내용을 우리가 지정하면 그 변수를 없앨 수 있다.

// 붙여넣는 쪽(Outlook·Word 등)이 인코딩을 오해하지 않도록 charset 을 명시해 감싼다.
const clipHtml = (html) => `<meta charset="utf-8">${html}`;

// innerText·선택 복사는 화면에 붙은 요소에서만 제대로 동작한다(떼어 낸 요소의 innerText 는
// textContent 와 같아져 줄바꿈·표 구조가 사라진다). 보이지 않게 붙였다가 바로 걷어낸다.
function withHiddenHolder(html, fn) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  holder.setAttribute('style', 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;');
  document.body.appendChild(holder);
  try { return fn(holder); } finally { holder.remove(); }
}

function copyViaCopyEvent(html, plain) {
  let wrote = false;
  const onCopy = (e) => {
    if (!e.clipboardData) return;
    e.clipboardData.setData('text/html', clipHtml(html));
    e.clipboardData.setData('text/plain', plain);
    e.preventDefault();
    wrote = true;
  };
  // execCommand('copy')는 선택 영역이나 편집 가능 요소가 있어야 copy 이벤트를 낸다.
  const ta = document.createElement('textarea');
  ta.value = plain;
  ta.setAttribute('style', 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;');
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.addEventListener('copy', onCopy, true);
  try { document.execCommand('copy'); }
  finally {
    document.removeEventListener('copy', onCopy, true);
    ta.remove();
  }
  return wrote;
}

function copyViaSelection(html) {
  return withHiddenHolder(html, (holder) => {
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    return ok;
  });
}

async function copyRichHtml(html, plain) {
  if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([clipHtml(html)], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      })]);
      return;
    } catch (err) { /* 권한 거부 등. 아래 폴백으로 넘어간다. */ }
  }
  if (copyViaCopyEvent(html, plain)) return;
  if (copyViaSelection(html)) return;
  throw new Error('브라우저가 복사를 거부했습니다. 본문을 직접 드래그해 복사해 주세요.');
}

// 서식을 못 받는 메일 클라이언트를 위한 텍스트 대체본
function htmlToPlain(html) {
  return withHiddenHolder(html, (h) => h.innerText.replace(/\n{3,}/g, '\n\n').trim());
}

// period: daily | weekly | certstats. query는 통계 탭의 기간(?from=&to=).
async function copyReport(btn, period, query) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '복사 중…';
  try {
    const r = await api(`/api/report/${period}/copy${query || ''}`);
    await copyRichHtml(r.html, htmlToPlain(r.html));
    btn.textContent = '✓ 복사됨';
  } catch (err) {
    btn.textContent = orig;
    alert(`복사하지 못했습니다: ${err.message}`);
  }
  btn.disabled = false;
  setTimeout(() => { btn.textContent = orig; }, 2000);
}

function downloadExcel() {
  const cols = [
    ['예약/희망일', (it) => it.scheduled_date || it.desired_date],
    ['예약확정일', (it) => it.scheduled_date],
    ['시작일', (it) => it.started_date],
    ['완료일', (it) => it.completed_date],
    ['인증종류', (it) => it.cert_type],
    ['Test type', (it) => it.test_type],
    ['Test 목적', (it) => it.test_purpose],
    ['Round', (it) => it.round],
    ['모델명', (it) => it.model_name],
    ['FW', (it) => it.fw_version],
    ['의뢰자', (it) => it.requester],
    ['테스터', (it) => it.tester],
    ['상태', (it) => it.status],
    ['판정', (it) => it.verdict],
    ['진행사항', (it) => it.progress],
    ['결과코멘트', (it) => it.result],
    ['비고', (it) => it.note],
  ];
  const lines = [cols.map((c) => c[0])];
  for (const it of state.items) lines.push(cols.map((c) => c[1](it)));
  const t = new Date();
  saveCsv(lines, `인증일정_${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}.csv`);
}

// ---- 캘린더 ----
function renderCalendar() {
  const root = $('#view-calendar');
  const { y, m } = state.cal;
  const startDay = new Date(y, m, 1).getDay();      // 0=일
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const t = new Date();
  const todayStr = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;

  // 날짜별 의뢰 매핑: 시작일~완료일을 '테스트 기간'으로 펼쳐 표시.
  // 시작/완료가 없으면 예약확정일 → 희망일 순의 단일 날짜에 표시.
  const map = {};
  const addDay = (ds, it) => { (map[ds] = map[ds] || []).push(it); };
  for (const it of state.items) {
    const start = it.started_date || it.scheduled_date || it.desired_date;
    if (!start) continue;
    const end = (it.completed_date && it.completed_date >= start) ? it.completed_date : start;
    let ds = start;
    for (let guard = 0; guard < 400; guard++) { addDay(ds, it); if (ds === end) break; ds = nextDay(ds); }
  }

  const total = Math.ceil((startDay + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const dayNum = i - startDay + 1;
    if (dayNum < 1) { cells.push(`<div class="cal-cell other"><div class="cal-date">${prevDays + dayNum}</div></div>`); continue; }
    if (dayNum > daysInMonth) { cells.push(`<div class="cal-cell other"><div class="cal-date">${dayNum - daysInMonth}</div></div>`); continue; }
    const dateStr = `${y}-${pad2(m + 1)}-${pad2(dayNum)}`;
    const items = map[dateStr] || [];
    const chips = items.slice(0, 3).map((it) => {
      const label = [it.cert_type, it.test_type, it.model_name].filter(Boolean).join(' · ');
      const period = (it.started_date && it.completed_date) ? `\n테스트 기간 ${it.started_date} ~ ${it.completed_date}`
        : it.started_date ? `\n시작 ${it.started_date}` : '';
      const tip = `${it.cert_type} / ${[it.test_type, it.test_purpose].filter(Boolean).join(' ')} / ${it.model_name} (${it.status})${period}`;
      return `<div class="cal-chip bg-${it.status}" data-id="${it.id}" title="${esc(tip)}">${esc(label)}</div>`;
    }).join('');
    const more = items.length > 3 ? `<div class="cal-more">+${items.length - 3}건</div>` : '';
    cells.push(`<div class="cal-cell ${dateStr === todayStr ? 'today' : ''}"><div class="cal-date">${dayNum}</div>${chips}${more}</div>`);
  }
  const dow = ['일', '월', '화', '수', '목', '금', '토']
    .map((d, i) => `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`).join('');

  root.innerHTML = `
    <div class="cal-head">
      <button class="btn" data-cal-nav="prev">‹</button>
      <h2>${y}년 ${m + 1}월</h2>
      <button class="btn" data-cal-nav="next">›</button>
      <button class="btn" data-cal-nav="today">오늘</button>
    </div>
    <div class="cal-grid">${dow}${cells.join('')}</div>`;
}

// ---- 현황보고 (일일 / 주간) ----
async function renderReport(period) {
  const root = $(`#view-${period}`);
  root.innerHTML = '<p class="col-empty">불러오는 중…</p>';
  let r;
  try { r = await api(`/api/report/${period}`); }
  catch (err) { root.innerHTML = `<p class="col-empty">보고서를 불러오지 못했습니다: ${esc(err.message)}</p>`; return; }
  root.innerHTML = `
    <div class="report-bar">
      <button class="btn" data-report-refresh="${period}">↻ 새로고침</button>
      <button class="btn" data-report-send="${period}">✉ 지금 메일 발송</button>
      <button class="btn" data-report-copy="${period}">📋 본문 복사</button>
      <span class="report-hint">${period === 'daily' ? '매일 18:00' : '매주 금요일 18:00'} 자동 발송 · 메일에는 집계 수치와 대시보드 링크만 포함됩니다
        <br>본문 복사는 화면 그대로(모델명 · 담당자 · 코멘트 포함) 복사되므로 사내 수신자에게만 보내세요</span>
    </div>
    <div class="report-body">${r.html}</div>`;
}

// ---- 인증 통계 (모델 × 인증종류 × Test 목적) ----
// 지표: 결과(최신 판정) · 진행차수(최신 판정 건의 Round) · Fail 횟수 · Pass율 / Fail율.
// 미판정 건은 집계에서 빠지므로 분모는 판정 완료 건수이고 Pass율 + Fail율 = 100%다.
function rateBar(pass, fail) {
  return `<span class="rate-bar" title="Pass ${pass}% / Fail ${fail}%">
    <i class="rb-pass" style="width:${pass}%"></i><i class="rb-fail" style="width:${fail}%"></i>
  </span>`;
}

// 기준 주(offset 0 = 이번 주)의 월요일~금요일. label은 "8/24~8/28" 형식.
function weekRangeOf(offset) {
  const mon = new Date();
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + offset * 7);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const short = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  return { from: iso(mon), to: iso(fri), label: `${short(mon)}~${short(fri)}` };
}

// 결과 셀: Pass는 파란 볼드, Fail은 빨간 음영 + 흰 볼드 (지시서 4-3)
const resultCell = (v) => (v ? `<span class="res res-${v.toLowerCase()}">${esc(v)}</span>` : '—');

function certStatsTable(rows) {
  if (!rows.length) return '<p class="col-empty">집계할 판정 완료 의뢰가 없습니다.</p>';
  const body = rows.map((r) => `
    <tr>
      <td><strong>${esc(r.model_name)}</strong></td>
      <td><span class="badge badge-${certClass(r.cert_type)}">${esc(r.cert_type)}</span></td>
      <td>${resultCell(r.result)}</td>
      <td>${esc(r.test_purpose)}</td>
      <td class="num">${r.round}차</td>
      <td class="num">${r.pass}</td>
      <td class="num ${r.fail ? 'em-fail' : ''}">${r.fail}</td>
      <td class="num">${r.pass_rate}%</td>
      <td class="num ${r.fail ? 'em-fail' : ''}">${r.fail_rate}%</td>
      <td>${rateBar(r.pass_rate, r.fail_rate)}</td>
    </tr>`).join('');
  return `
    <div class="table-wrap">
    <table class="stats-table">
      <thead><tr>
        <th>모델명</th><th>인증종류</th><th>결과</th><th>Test 목적</th>
        <th class="num">진행차수</th>
        <th class="num">Pass</th><th class="num">Fail</th>
        <th class="num">Pass율</th><th class="num">Fail율</th>
        <th>비율</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
}

// 현재 화면에 뜬 통계를 CSV로 저장 (일정표와 동일하게 UTF-8 BOM → Excel 한글 정상)
function downloadCertStatsCsv() {
  const cs = state.certStats;
  if (!cs.data) return;
  const isWeek = !!cs.range;
  const period = isWeek ? `${cs.range.from} ~ ${cs.range.to} (월~금)` : '전체 기간 누적';
  const cols = [
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
  const t = cs.data.totals;
  const lines = [
    ['인증 통계', period],
    ['집계 대상', '판정 완료(Pass/Fail) 건만 — 미판정 건은 제외'],
    [],
    cols.map((c) => c[0]),
    ...cs.data.rows.map((r) => cols.map((c) => c[1](r))),
    [],
    ['합계', `모델 ${t.models}건`, '', '', `판정 ${t.judged}건`, t.pass, t.fail, t.pass_rate, t.fail_rate],
  ];
  const stamp = isWeek ? `${cs.range.from}_${cs.range.to}` : '전체누적';
  saveCsv(lines, `인증통계_${stamp}.csv`);
}

// 인증 통계 보고를 지금 메일로 보낸다. 대상은 지난주 월~금(월요일 자동발송과 동일).
async function sendCertStatsMail(btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '발송 중…';
  try {
    const res = await api('/api/report/certstats/send', { method: 'POST', body: '{}' });
    alert(res.sent
      ? '인증 통계 보고를 발송했습니다. (집계 + 대시보드 링크만 발송됩니다)'
      : '메일 설정(config.json)이 없어 발송하지 못했습니다.');
  } catch (err) { alert(err.message); }
  btn.disabled = false;
  btn.textContent = orig;
}

async function renderCertStats() {
  const root = $('#view-certstats');
  const cs = state.certStats;
  const isWeek = cs.mode === 'week';
  const wk = weekRangeOf(cs.weekOffset);
  root.innerHTML = '<p class="col-empty">불러오는 중…</p>';

  let s;
  try { s = await api(`/api/cert-stats${isWeek ? `?from=${wk.from}&to=${wk.to}` : ''}`); }
  catch (err) { root.innerHTML = `<p class="col-empty">통계를 불러오지 못했습니다: ${esc(err.message)}</p>`; return; }
  cs.data = s;
  cs.range = isWeek ? wk : null;

  const t = s.totals;
  const chips = [
    { k: '모델 수', v: t.models },
    { k: isWeek ? '주간 판정' : '누적 판정', v: t.judged },
    { k: 'Pass', v: t.pass },
    { k: 'Fail', v: t.fail, warn: t.fail > 0 },
    { k: '전체 Pass율', v: `${t.pass_rate}%` },
    { k: '전체 Fail율', v: `${t.fail_rate}%` },
  ].map((c) => `<div class="sumcard ${c.warn ? 'warn' : ''}"><div class="k">${c.k}</div><div class="v">${c.v}</div></div>`).join('');

  const nav = isWeek ? `
    <span class="week-nav">
      <button class="btn" data-stats-week="-1" title="이전 주">‹</button>
      <b class="week-label">${wk.label}</b><small>(월~금)</small>
      <button class="btn" data-stats-week="1" title="다음 주">›</button>
      ${cs.weekOffset !== 0 ? '<button class="btn" data-stats-week="0">이번 주</button>' : ''}
    </span>` : '';

  root.innerHTML = `
    <div class="report-bar">
      <span class="seg">
        <button class="seg-btn ${isWeek ? 'active' : ''}" data-stats-mode="week">주간</button>
        <button class="seg-btn ${isWeek ? '' : 'active'}" data-stats-mode="all">전체 누적</button>
      </span>
      ${nav}
      <span class="bar-right">
        <button class="btn" data-stats-excel="1">⤓ 엑셀 다운로드</button>
        <button class="btn" data-stats-send="1">✉ 지금 메일 발송</button>
        <button class="btn" data-stats-copy="1">📋 본문 복사</button>
        <button class="btn" data-stats-refresh="1">↻ 새로고침</button>
      </span>
    </div>
    <p class="report-hint stats-period">대상 기간 · ${isWeek ? `${wk.from} ~ ${wk.to} (월~금)` : '전체 기간 누적'}
      · 판정 완료(Pass/Fail) 건만 집계하며 미판정 건은 제외합니다. 진행차수는 최신 판정 건의 Round입니다.</p>
    <div class="summary stats-summary">${chips}</div>
    ${certStatsTable(s.rows)}`;
}

// ---- Task 5. 진행차수 자동 산출 ----
// 모델명 · Test 목적이 정해지는 순간 서버 이력을 조회해 차수를 채운다.
// 자동값은 제안일 뿐이라 사용자가 직접 고칠 수 있고, 한 번 고치면 다시 덮어쓰지 않는다.
const roundAuto = { seq: 0, key: null, info: null, touched: false };

const setRoundHint = (text) => { $('#round-hint').textContent = text; };
// Test 목적은 콤보(드롭다운 + 직접입력)라 select 값이 아니라 실제 입력값을 읽어야 한다.
const purposeValue = () => readCombo('test_purpose');
// Task 0: 진행차수는 인증종류·Test type·Test 목적·모델명 4가지가 모두 같을 때만 이어져야 한다.
const roundKeyOf = () => `${$(F.model_name).value.trim()}\u0000${$(F.cert_type).value}\u0000${$(F.test_type).value}\u0000${purposeValue()}`;

async function autoFillRound() {
  if ($(F.id).value) return;                    // 기존 의뢰 상세에서는 저장된 차수를 건드리지 않는다
  const key = roundKeyOf();
  if (key === roundAuto.key) return;            // 같은 조합이면 다시 조회하지 않는다
  roundAuto.key = key;

  const model = $(F.model_name).value.trim();
  if (!model) {
    roundAuto.info = null;
    $('#btn-round-info').classList.add('hidden');
    setRoundHint('인증종류·Test type·Test 목적·모델명을 고르면 자동으로 채워집니다.');
    return;
  }

  const seq = ++roundAuto.seq;                  // 늦게 도착한 응답이 최신 값을 덮지 않게 한다
  const input = $(F.round);
  $('#round-spin').classList.remove('hidden');
  input.readOnly = true;                        // 조회 중 중복 입력 차단
  try {
    // Task 0: 인증종류·Test type도 함께 넘겨 4가지 조건이 모두 일치하는 이력만 매칭한다.
    const q = `model_name=${encodeURIComponent(model)}&test_purpose=${encodeURIComponent(purposeValue())}`
      + `&cert_type=${encodeURIComponent($(F.cert_type).value)}&test_type=${encodeURIComponent($(F.test_type).value)}`;
    const info = await api(`/api/next-round?${q}`);
    if (seq !== roundAuto.seq) return;
    roundAuto.info = info;
    if (!roundAuto.touched) input.value = info.round;
    $('#btn-round-info').classList.toggle('hidden', !info.history.length);
    setRoundHint(roundAuto.touched ? `${info.reason} (직접 입력한 값을 유지합니다)` : info.reason);
  } catch (err) {
    if (seq === roundAuto.seq) setRoundHint(`이력을 불러오지 못했습니다: ${err.message}`);
  } finally {
    if (seq === roundAuto.seq) { $('#round-spin').classList.add('hidden'); input.readOnly = false; }
  }
}

// Task 6-1. 산출 근거 — '왜 4차인지'를 이전 차수 타임라인으로 보여준다.
function openRoundModal() {
  const info = roundAuto.info;
  if (!info) return;
  const purpose = purposeValue() || '(미지정)';
  const items = info.history.map((h) => `
    <li class="tl-item">
      <span class="tl-dot tl-${(h.verdict || '').toLowerCase()}"></span>
      <div class="tl-body">
        <div class="tl-line"><b>${h.round ? `${esc(h.round)}차` : '차수 미입력'}</b>
          ${resultCell(h.verdict)}<span class="tl-date">${esc(h.on_date)}</span></div>
        <div class="tl-meta">${esc(h.cert_type)}</div>
        ${h.result || h.progress ? `<div class="tl-note">${esc(h.result || h.progress)}</div>` : ''}
      </div>
    </li>`).join('');
  $('#round-modal-body').innerHTML = `
    <p class="round-why"><b>${esc($(F.model_name).value.trim())}</b> · ${esc($(F.cert_type).value)} · ${esc($(F.test_type).value)} · ${esc(purpose)}
      → 산출 <b>${info.round}차</b><br><span class="field-hint">${esc(info.reason)}</span></p>
    ${info.history.length
      ? `<ol class="timeline">${items}</ol>`
      : '<p class="col-empty">이전 판정 이력이 없습니다.</p>'}`;
  $('#round-modal').classList.remove('hidden');
}

const closeRoundModal = () => $('#round-modal').classList.add('hidden');

// ---- Task 6-2. 병목 경고 위젯 (현황 보드 상단) ----
// 반복 Fail로 차수가 높아진 조합과, 판정 없이 오래 머문 건을 리더가 먼저 보도록 끌어올린다.
async function renderBottlenecks() {
  const el = $('#bottlenecks');
  if (state.view !== 'board') { el.classList.add('hidden'); return; }
  let b;
  try { b = await api('/api/bottlenecks'); } catch { el.classList.add('hidden'); return; }
  if (!b.count) { el.classList.add('hidden'); return; }

  const rep = b.repeated.map((r) => `
    <li><span class="bn-badge bn-fail">${r.round}차</span>
      <b>${esc(r.model_name)}</b> · ${esc(r.cert_type)} · ${esc(r.test_purpose)}
      <span class="bn-sub">누적 Fail ${r.fail}회 · 최근 ${esc(r.last_date)}</span></li>`).join('');
  const stale = b.stale.map((r) => `
    <li data-id="${r.id}"><span class="bn-badge bn-stale">${r.days}일</span>
      <b>${esc(r.model_name)}</b> · ${esc(r.cert_type)} · ${esc(r.status)}
      <span class="bn-sub">${esc(r.since)}부터 미판정${r.tester ? ` · ${esc(r.tester)}` : ''}</span></li>`).join('');

  el.innerHTML = `
    <div class="bn-head">⚠ 확인이 필요한 건 ${b.count}건</div>
    ${b.repeated.length ? `<div class="bn-group"><h4>반복 Fail — ${b.roundThreshold}차 이상</h4><ul>${rep}</ul></div>` : ''}
    ${b.stale.length ? `<div class="bn-group"><h4>장기 미판정 — ${b.staleDays}일 초과</h4><ul>${stale}</ul></div>` : ''}`;
  el.classList.remove('hidden');
}

// ---- Task 6. QE 전체 리소스 현황 ----
// 1 slot = 1명의 1일 업무량이라 담당자에게 쌓인 slot 합계가 곧 그 사람의 소요 영업일수다.
// 기간을 자르지 않고 미완 물량 전체를 보되, 여유/초과는 4명 균등분담 기준선 대비로 표시한다.
const etaText = (r) => (r.eta ? `${r.eta}${r.eta_warning ? ' ⚠' : ''}` : '—');

// 1인 주간 가용(5 slot) 대비 여유/초과. 자동 할당이 채워 넣을 여유가 얼마인지 보는 칼럼이다.
function slackCell(r) {
  if (r.capacity === null) return '<span class="rs-dim">—</span>';
  if (r.over > 0) return `<span class="rs-over">${r.over} slot 초과</span><small class="rs-sub">다음 주로 밀림</small>`;
  if (r.free > 0) return `<span class="rs-slack">${r.free} slot 여유</span><small class="rs-sub">배정 가능</small>`;
  return '<span class="rs-even">가득</span>';
}

// 가용 100% 눈금이 찍힌 사용률 막대. 100%를 넘으면 넘친 만큼 빨강으로 이어 붙인다.
function usageBar(usagePct, label) {
  const inside = Math.min(100, Math.max(0, usagePct));
  const over = Math.max(0, Math.min(100, usagePct - 100));   // 200%까지만 눈에 보이게
  return `<span class="load-bar" title="${label || `가용의 ${usagePct}%`}">
    <i class="lb-fill" style="width:${inside / 2}%"></i>
    ${over > 0 ? `<i class="lb-fill lb-over" style="width:${over / 2}%"></i>` : ''}
    <i class="lb-mark" style="left:50%" title="가용 100%"></i>
  </span><small class="rs-sub">${usagePct}%</small>`;
}

// 일별 가용 리소스 현황. 주 단위로 묶어 소계를 얹는다.
// pool = 'cert'(인증 담당, 미배정 흡수) | 'other'(기타, 별도 리소스)
function dailyPlanTable(d, pool) {
  if (!d || !d.days.length) return '<p class="col-empty">일별 현황을 만들 영업일이 없습니다.</p>';

  const dayRow = (x) => {
    const cells = x.lane.map((a) => `<span class="dp-chip ${a.pending ? 'dp-pending' : ''}"
      title="${esc(a.tester)} · ${esc(a.model_name)}${a.pending ? ' (배정 예정)' : ''}">${esc(a.tester)}</span>`).join('');
    const idle = x.idle.map((n) => `<span class="dp-chip dp-idle" title="${esc(n)} — 이 날 비어 있음">${esc(n)}</span>`).join('');
    return `
      <tr class="${x.free === x.capacity ? 'dp-empty-day' : ''}">
        <td>${esc(x.date)} <small class="rs-dim">(${esc(x.weekday)})</small></td>
        <td class="num">${x.capacity}</td>
        <td class="num">${x.assigned}</td>
        <td class="num ${x.pending ? 'dp-pend-num' : ''}">${x.pending || '—'}</td>
        <td class="num"><b class="${x.free ? 'rs-slack' : ''}">${x.free}</b></td>
        <td>${usageBar(x.usage_pct)}</td>
        <td class="dp-lane">${cells}${idle}</td>
      </tr>`;
  };

  const body = d.weeks.map((w) => {
    const rows = d.days.filter((x) => x.date >= w.from && x.date <= w.to).map(dayRow).join('');
    return `
      <tr class="rs-group"><td colspan="7">${esc(w.label)} · 영업일 ${w.business_days}일 · 가용 ${w.capacity} slot
        · 사용 ${w.used} (${w.usage_pct}%) · 여유 <b>${w.free} slot</b>${w.pending ? ` · 배정예정 ${w.pending}` : ''}</td></tr>
      ${rows}`;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="stats-table dp-table">
        <thead><tr>
          <th>날짜</th><th class="num">가용</th><th class="num">배정</th><th class="num">배정예정</th>
          <th class="num">여유</th><th>사용률</th><th>담당 배치 / 여유 인원</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="field-hint">한 담당자는 하루 <b>1 slot</b>만 쓰므로 의뢰를 담당자별로 줄 세워 영업일에 이어 붙였습니다.
      시작은 <code>max(대표 일정, 기준일)</code>입니다. 흐린 이름은 그 날 <b>비어 있는 담당자</b>입니다.
      ${pool === 'cert'
        ? '<b class="dp-pend-num">배정예정</b>은 담당자 미정 건을 가장 빨리 비는 담당자 자리에 채워 본 <b>자동 할당 미리보기</b>입니다.'
        : '기타 테스터는 <b>별도 리소스</b>라 자동 할당 대상이 아니므로 배정예정이 없습니다.'}
      ${d.overflow ? `조회 구간(${d.horizon} 영업일)을 넘어간 물량이 <b>${d.overflow} slot</b> 있습니다.` : ''}
      ${d.excluded.slots ? `<b class="rs-over">이 풀에 속하지 않은 테스터(${d.excluded.testers.map(esc).join(' · ')})의
        ${d.excluded.slots} slot이 배치되지 않았습니다 — 집계 오류입니다.</b>` : ''}</p>`;
}

// 담당자 한 명의 건별 상세 (접힌 상태로 두고 필요할 때만 펼친다)
function resourceItems(items) {
  if (!items.length) return '<p class="col-empty">배정된 미완 의뢰가 없습니다.</p>';
  const SRC_TAG = { manual: '수동', auto: '자동', none: '미착수' };
  const body = items.map((it) => `
    <tr>
      <td>${esc(it.plan_date || '미정')}</td>
      <td><span class="badge badge-${certClass(it.cert_type)}">${esc(it.cert_type)}</span></td>
      <td>${esc(it.test_type || '—')}</td>
      <td><strong>${esc(it.model_name)}</strong></td>
      <td>${it.round ? `${esc(it.round)}차` : '—'}</td>
      <td>${esc(it.status)}</td>
      <td>${esc(it.rule)}</td>
      <td class="num">${it.plan_slots}</td>
      <td class="num">${it.consumed || '—'}</td>
      <td class="num"><b>${it.slots}</b></td>
      <td>
        <span class="pg-bar" title="${it.progress_pct}% 진행"><i style="width:${Math.min(100, it.progress_pct)}%"></i></span>
        <small class="rs-sub">${it.progress_pct}% · ${SRC_TAG[it.progress_source] || ''}${
          it.overrun_days ? ` · <b class="rs-over">${it.overrun_days}일 초과</b>` : ''}</small>
      </td>
    </tr>`).join('');
  return `
    <div class="table-wrap">
    <table class="stats-table rs-items">
      <thead><tr>
        <th>일정</th><th>인증종류</th><th>Test type</th><th>모델명</th>
        <th>차수</th><th>상태</th><th>적용 규칙</th>
        <th class="num">계획</th><th class="num">소화</th><th class="num">잔여</th><th>진행률</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>`;
}

function resourceRow(r) {
  const cls = r.group === 'unassigned' ? 'rs-unassigned' : '';
  return `
    <tr class="${cls}">
      <td><b>${esc(r.tester)}</b>${r.group === 'unassigned' ? '<span class="rs-tag">배정 필요</span>' : ''}</td>
      <td class="num">${r.count}</td>
      <td class="num"><b>${r.slots}</b>${(() => {
        const plan = r.items.reduce((a, i) => a + i.plan_slots, 0);
        return plan > r.slots ? `<small class="rs-sub">계획 ${plan}</small>` : '';
      })()}</td>
      <td class="num">${r.capacity === null ? '—' : r.capacity}</td>
      <td class="num">${r.days ? `${r.days}일` : '—'}</td>
      <td>${r.group === 'unassigned' ? '<span class="rs-dim">담당자 미정</span>' : etaText(r)}</td>
      <td>${slackCell(r)}</td>
      <td>${r.usage_pct === null ? '<span class="rs-dim">—</span>' : usageBar(r.usage_pct)}</td>
    </tr>
    <tr class="rs-detail-row">
      <td colspan="8">
        <details><summary>${esc(r.tester)} 건별 상세 ${r.count}건</summary>${resourceItems(r.items)}</details>
      </td>
    </tr>`;
}

// ---- 1. 실시간 리소스 가동률 ----
// 팀 전체의 1일 총 가용 slot 대비, 오늘 담당자를 점유 중인 확정 업무(진행중·예약확정) 비율.
// 예약대기는 아직 확정 전이라 가동률에서 빼고 별도로 알린다.
function utilizationPanel(u, compact) {
  // level은 서버가 정한다 — 계획 수요가 가용을 넘겼거나(과부하) 여유가 0이면 over(빨강).
  const lvl = u.level;
  // 막대는 100%를 절반 지점에 두고 그린다. 계획 수요가 100%를 넘으면 그만큼 빨강으로 이어 붙인다.
  const scale = u.demand_pct > 100 ? Math.min(200, u.demand_pct) : 100;
  const bar = (p) => Math.max(0, Math.min(100, (p / scale) * 100));
  const over = u.demand_pct > 100;
  return `
    <div class="util ${compact ? 'util-compact' : ''} util-${lvl}">
      <div class="util-main">
        <div class="util-head">
          <span class="util-title">실시간 리소스 가동률</span>
          <small>${esc(u.date)} 기준 · 1일 총 가용 ${u.capacity} slot</small>
          ${u.as_of_is_business_day ? '' : `<span class="util-note">오늘은 휴무${
            u.as_of_holiday ? `(${esc(u.as_of_holiday)})` : ''} — 다음 영업일 기준</span>`}
          ${over ? `<span class="util-tag">계획 과부하 ${u.demand_pct}%</span>` : ''}
        </div>
        ${u.no_plan_date.count ? `<div class="util-caveat">⚠ 계획 일정이 비어 있는 확정 업무
          <b>${u.no_plan_date.count}건 (${u.no_plan_date.slots} slot)</b>이 기준일로 계상됐습니다 —
          일정을 채우면 수요가 실제 날짜로 흩어집니다.</div>` : ''}
        <div class="util-track">
          <i class="ut-run" style="width:${bar(u.usage_pct)}%"></i>
          ${over ? `<i class="ut-over" style="width:${bar(u.demand_pct) - bar(100)}%;left:${bar(100)}%"></i>` : ''}
          ${scale > 100 ? `<i class="ut-mark" style="left:${bar(100)}%" title="가용 100%"></i>` : ''}
        </div>
        <div class="util-legend">
          <b>${u.usage_pct}%</b> 가동 · <b>${u.used}</b>/${u.capacity} slot 사용 중
          ${u.busy.length ? `<span class="util-names">${u.busy.map(esc).join(' · ')}</span>` : ''}
          ${over ? `<span class="util-over-t">계획상 ${u.demand} slot 필요 — ${u.demand_over} slot 초과${
            u.doubled.length ? ` (${u.doubled.map(esc).join(' · ')} 중복 배정)` : ''}</span>` : ''}
          ${u.waiting ? `<span class="util-wait">예약대기 ${u.waiting}건 대기</span>` : ''}
        </div>
      </div>
      <div class="util-free">
        <div class="uf-k">잔여 가용</div>
        <div class="uf-v">${u.free}<small>slot</small></div>
        <div class="uf-sub">${u.idle.length ? `${u.idle.map(esc).join(' · ')} 여유` : '여유 인원 없음'}</div>
      </div>
      ${u.week ? `
      <div class="util-week">
        <div class="uf-k">이번 주 ${esc(u.week.label)}</div>
        <div class="uf-v2">${u.week.usage_pct}<small>%</small></div>
        <div class="uf-sub">가용 ${u.week.capacity} · 여유 <b>${u.week.free} slot</b> (영업일 ${u.week.business_days}일)</div>
      </div>` : ''}
      ${compact ? '<div class="util-go">QE 리소스 탭 ▸</div>' : ''}
    </div>`;
}

// ---- 2. 팀원별 업무 부하도 (신호등) ----
const LEVEL_LABEL = { safe: '안정', warn: '주의', over: '초과' };

function workloadPanel(s) {
  const max = Math.max(s.week_business_days, ...s.rows.map((r) => r.slots));
  const bars = s.rows.map((r) => {
    const w = max > 0 ? Math.round((r.slots / max) * 100) : 0;
    const capMark = max > 0 ? Math.round((r.capacity / max) * 100) : 0;
    return `
      <div class="wl-row">
        <div class="wl-name"><i class="wl-dot wl-${r.level}"></i>${esc(r.tester)}</div>
        <div class="wl-bar"><i class="wl-fill wl-${r.level}" style="width:${w}%"></i>
          <i class="wl-cap" style="left:${capMark}%" title="주간 가용 ${r.capacity} slot"></i></div>
        <div class="wl-num"><b>${r.slots}</b><small>/${r.capacity} slot</small></div>
        <div class="wl-pct wl-t-${r.level}">${r.usage_pct}% · ${LEVEL_LABEL[r.level]}</div>
        <div class="wl-note">${r.over ? `${r.over} slot 초과` : `${r.free} slot 여유`}</div>
      </div>`;
  }).join('');
  return `
    <div class="wl">${bars}</div>
    <p class="field-hint">신호등 — <b class="wl-t-safe">안정</b> 가용의 ${s.load_levels.safe}% 이하 ·
      <b class="wl-t-warn">주의</b> ${s.load_levels.warn}% 이하(가용 한도 임박) ·
      <b class="wl-t-over">초과</b> ${s.load_levels.warn}% 초과(초과 할당).
      기준은 1인 주간 가용 <b>${s.week_business_days} slot</b>이고, 눈금이 그 위치입니다.</p>`;
}

// ---- 3. 진행 상태별 파이프라인 ----
const STAGE_CLASS = { 예약대기: 'st-wait', 예약확정: 'st-fixed', 진행중: 'st-prog' };

function pipelinePanel(p) {
  const cards = p.stages.map((st) => `
    <div class="pl-card ${STAGE_CLASS[st.status] || ''}">
      <div class="pl-k">${esc(st.status)}</div>
      <div class="pl-v">${st.count}<small>건</small></div>
      <div class="pl-slots">${st.slots} slot</div>
      ${st.unassigned ? `<div class="pl-sub">담당 미정 ${st.unassigned}건</div>` : '<div class="pl-sub">담당 배정 완료</div>'}
    </div>`).join('');

  const waiting = p.longest_waiting.length ? p.longest_waiting.map((w) => `
    <li>
      <span class="lw-days ${w.waiting_days >= 14 ? 'lw-hot' : ''}">${w.waiting_days ?? '?'}일 대기</span>
      <b>${esc(w.model_name)}</b> · ${esc(w.cert_type)} · ${w.slots} slot
      <span class="bn-sub">등록 ${esc(w.created_date || '—')}
        ${w.desired_date ? ` · 희망 ${esc(w.desired_date)}${w.desired_overdue ? ' (경과)' : ''}` : ''}
        ${w.tester ? ` · ${esc(w.tester)}` : ' · 담당 미정'}</span>
    </li>`).join('') : '<li class="rs-dim">예약대기 건이 없습니다.</li>';

  return `
    <div class="pl">${cards}</div>
    <div class="lw">
      <h5>가장 오래 대기 중 — 최우선 배정 필요</h5>
      <ul>${waiting}</ul>
    </div>`;
}

// ---- 4. 인증 타입별 점유 현황 (도넛) ----
const DONUT_COLORS = ['#2f6df6', '#e8a317', '#2faa61', '#6b46c1', '#8a93a3'];

function typeDonut(dist) {
  if (!dist.length) return '<p class="col-empty">점유 중인 인증이 없습니다.</p>';
  const R = 60, C = 2 * Math.PI * R;
  let acc = 0;
  const arcs = dist.map((t, i) => {
    const len = (t.share / 100) * C;
    const seg = `<circle class="dn-seg" r="${R}" cx="90" cy="90" fill="none"
      stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="26"
      stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-acc}"
      transform="rotate(-90 90 90)"><title>${esc(t.label)} ${t.share}%</title></circle>`;
    acc += len;
    return seg;
  }).join('');
  const total = dist.reduce((a, t) => a + t.slots, 0);
  const rows = dist.map((t, i) => `
    <tr>
      <td><i class="dn-key" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></i>${esc(t.label)}</td>
      <td class="num">${t.unit_slots}</td>
      <td class="num">${t.count}</td>
      <td class="num"><b>${t.slots}</b></td>
      <td class="num">${t.share}%</td>
    </tr>`).join('');
  return `
    <div class="dn-wrap">
      <svg class="dn" viewBox="0 0 180 180" role="img" aria-label="인증 타입별 리소스 점유 비율">
        <circle r="${R}" cx="90" cy="90" fill="none" stroke="#eef2f8" stroke-width="26"></circle>
        ${arcs}
        <text x="90" y="86" class="dn-t1">${total}</text>
        <text x="90" y="104" class="dn-t2">slot</text>
      </svg>
      <div class="table-wrap dn-table">
        <table class="stats-table">
          <thead><tr><th>Test Type</th><th class="num">건당</th><th class="num">건수</th>
            <th class="num">slot</th><th class="num">비중</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---- 5. 스마트 알림 위젯 ----
function alertsPanel(a) {
  if (!a.count) return '<p class="col-empty">지금 개입이 필요한 리스크가 없습니다.</p>';
  const group = (title, cls, body) => (body ? `<div class="sa-group ${cls}"><h5>${title}</h5><ul>${body}</ul></div>` : '');

  const over = a.overloaded.map((o) => `
    <li><span class="sa-badge sa-red">초과</span>
      <b>${esc(o.tester)}</b> ${o.slots}/${o.capacity} slot · <b>${o.usage_pct}%</b>
      <span class="bn-sub">주간 가용을 넘겨 다음 주로 밀립니다</span></li>`).join('');

  const conf = a.conflicts.map((c) => `
    <li><span class="sa-badge sa-red">충돌</span>
      <b>${esc(c.tester)}</b> · ${esc(c.from)} ~ ${esc(c.to)} <b>${c.overlap_days}일 중복</b>
      <span class="bn-sub">${c.items.map((i) => `${esc(i.model_name)}(${esc(i.cert_type)} ${i.slots}slot)`).join(' ↔ ')}</span></li>`).join('');

  const del = a.delays.map((d) => `
    <li><span class="sa-badge sa-amber">밀림</span>
      <b>${esc(d.model_name)}</b> · ${esc(d.tester)} · <b>${d.delay_days}일</b> 지연
      <span class="bn-sub">계획 ${esc(d.declared_date)} → 실제 착수 ${esc(d.actual_date)}${d.pending ? ' (배정예정)' : ''}</span></li>`).join('');

  const orun = a.overrun.map((o) => `
    <li><span class="sa-badge sa-amber">초과진행</span>
      <b>${esc(o.model_name)}</b> · ${esc(o.tester || '담당 미정')} · 예정 ${o.plan_slots}일을 <b>${o.overrun_days}일</b> 넘김
      <span class="bn-sub">${esc(o.started_date)} 착수 · ${o.consumed}일 소화 — 잔여를 1 slot으로 붙잡아 두고 있습니다</span></li>`).join('');

  const rel = a.releases.map((r) => `
    <li><span class="sa-badge sa-green">D-${r.d_day}</span>
      <b>${esc(r.tester)}</b> 리소스 확보 예정 · ${esc(r.date)}
      <span class="bn-sub">${esc(r.model_name)}(${esc(r.rule)} ${r.slots} slot) 종료</span></li>`).join('');

  return `
    <div class="sa">
      ${group('리소스 초과 할당', 'sa-c-red', over)}
      ${group('리소스 충돌 — 같은 담당자 일정 중복', 'sa-c-red', conf)}
      ${group('예정 초과 진행 — 계획 소요를 넘겨 진행 중', 'sa-c-amber', orun)}
      ${group('일정 밀림 — 계획일보다 늦게 착수', 'sa-c-amber', del)}
      ${group('일정 여유 — 곧 리소스가 확보됩니다', 'sa-c-green', rel)}
    </div>`;
}

async function renderResources() {
  const root = $('#view-resources');
  root.innerHTML = '<p class="col-empty">불러오는 중…</p>';

  let s;
  try { s = await api('/api/resources'); }
  catch (err) { root.innerHTML = `<p class="col-empty">리소스 현황을 불러오지 못했습니다: ${esc(err.message)}</p>`; return; }
  state.resources = s;

  const t = s.totals;
  const ot = s.others_totals;
  const hasOthers = s.other_members.length > 0;

  // 풀 하나의 요약 카드. 인증 담당과 기타는 별도 리소스라 가용·사용률을 섞지 않는다.
  const poolChips = (p, label, withUnassigned) => {
    const over = p.over_slots > 0;
    return [
      { k: `1주 가용 (100%)`, v: `${p.week_capacity} slot`, sub: `${label} ${p.headcount}명 × ${s.week_business_days}일` },
      { k: '잔여 소요', v: `${p.slots} slot`, sub: `${p.count}건 · 계획 ${p.plan_slots} 중 ${p.consumed_slots} 소화` },
      { k: '진행률', v: `${p.progress_pct}%`, sub: '계획 소요 대비 소화분' },
      { k: '사용률', v: `${p.usage_pct}%`, sub: '1주 가용 대비', warn: over },
      over
        ? { k: '초과', v: `${p.over_pct}%`, sub: `${p.over_slots} slot 넘침`, warn: true }
        : { k: '여유', v: `${p.free_pct}%`, sub: `${p.free_slots} slot 배정 가능` },
      { k: '소요 주수', v: `${p.weeks_needed}주`, sub: `1일 가용 ${p.daily_capacity} slot` },
      ...(withUnassigned
        ? [{ k: '미배정', v: `${p.unassigned_slots} slot`, sub: `1주 가용의 ${p.unassigned_pct}%`, warn: p.unassigned_slots > 0 }]
        : []),
      { k: '소진 예상', v: p.days ? `${p.days} 영업일` : '—', sub: '주말·공휴일 제외' },
      { k: '소진 완료일', v: p.eta || '—', sub: '전 인원 투입 기준', warn: !!p.eta_warning },
    ].map((c) => `<div class="sumcard ${c.warn ? 'warn' : ''}">
        <div class="k">${c.k}</div><div class="v">${c.v}</div><div class="sub">${c.sub}</div></div>`).join('');
  };

  const head = `<thead><tr>
      <th>담당자</th><th class="num">건수</th><th class="num">할당 slot</th><th class="num">주간 가용</th>
      <th class="num">소요 영업일</th><th>예상 소진일</th><th>여유 / 초과</th><th>가용 대비 사용률</th>
    </tr></thead>`;

  const rules = s.slot_rules.map((r) => `<li>${esc(r.label)} — <b>${r.slots} slot</b></li>`).join('');

  const undef = s.undefined_rules.length ? `
    <div class="bottlenecks">
      <div class="bn-head">⚠ slot 규칙이 없는 의뢰 ${s.undefined_rules.length}건 — 총 소요에서 빠져 있습니다</div>
      <ul>${s.undefined_rules.map((it) => `<li><b>${esc(it.model_name)}</b> · ${esc(it.cert_type)} · ${esc(it.status)}</li>`).join('')}</ul>
    </div>` : '';

  const warn = t.eta_warning ? `<p class="report-hint rs-warn">⚠ ${esc(t.eta_warning)}</p>` : '';

  root.innerHTML = `
    <div class="report-bar">
      <span class="rs-title">QE 전체 리소스 현황 <small>(${esc(s.as_of)} 기준)</small></span>
      <span class="bar-right"><button class="btn" data-rs-refresh="1">↻ 새로고침</button></span>
    </div>
    <p class="report-hint">대상 · 상태가 <b>예약대기 · 예약확정 · 진행중</b>인 의뢰 전체 (미완 ${s.overall.count}건 · ${s.overall.slots} slot).
      <b>인증 담당</b>과 <b>기타 테스터</b>는 <b>별도 리소스</b>로 관리하므로 가용·사용률을 섞지 않습니다.
      <b>1 slot = 1명의 1일 업무량</b>이라 할당 slot 합계가 그 담당자의 소요 영업일수입니다(주말·공휴일 제외).</p>
    ${warn}

    <h3 class="rs-section">1 · 실시간 리소스 가동률</h3>
    ${utilizationPanel(s.utilization, false)}
    <p class="field-hint">가동률은 <b>확정된 업무(진행중 · 예약확정)</b>만 셉니다. 예약대기는 아직 확정 전이라 제외하고
      아래 파이프라인에서 별도로 봅니다. 잔여 가용은 <b>신규 의뢰를 즉시 수용할 수 있는 slot</b>입니다.</p>

    <h3 class="rs-section">2 · 팀원별 업무 부하도 <small>${esc(s.members.join(' · '))}</small></h3>
    ${workloadPanel(s)}

    <h3 class="rs-section">3 · 진행 상태별 파이프라인</h3>
    ${pipelinePanel(s.pipeline)}

    <h3 class="rs-section">4 · 인증 타입별 점유 현황</h3>
    ${typeDonut(s.type_distribution)}

    <h3 class="rs-section">5 · 스마트 알림 ${s.alerts.count ? `<small>${s.alerts.count}건</small>` : ''}</h3>
    ${alertsPanel(s.alerts)}

    <h3 class="rs-section">인증 담당 리소스 상세 <small>주간 가용 기준</small></h3>
    <div class="summary stats-summary">${poolChips(t, '인증 담당', true)}</div>
    ${undef}

    <h4 class="rs-sub-section">일별 가용 현황 <small>향후 ${s.daily.horizon} 영업일</small></h4>
    ${dailyPlanTable(s.daily, 'cert')}

    <h4 class="rs-sub-section">담당자별 리소스 할당</h4>
    <div class="table-wrap">
      <table class="stats-table rs-table">
        ${head}
        <tbody>
          <tr class="rs-group"><td colspan="8">인증 담당 (${s.members.length}명)</td></tr>
          ${s.rows.map((r) => resourceRow(r)).join('')}
          <tr class="rs-group"><td colspan="8">미배정 — 자동 할당 대상</td></tr>
          ${resourceRow(s.unassigned)}
        </tbody>
      </table>
    </div>

    ${hasOthers ? `
    <h3 class="rs-section">기타 테스터 리소스 <small>${esc(s.other_members.join(' · '))} — 별도 관리</small></h3>
    <div class="summary stats-summary">${poolChips(ot, '기타', false)}</div>

    <h4 class="rs-sub-section">일별 가용 현황 <small>향후 ${s.others_daily.horizon} 영업일</small></h4>
    ${dailyPlanTable(s.others_daily, 'other')}

    <h4 class="rs-sub-section">세부내용 · 담당자별 리소스 할당</h4>
    <div class="table-wrap">
      <table class="stats-table rs-table">
        ${head}
        <tbody>
          <tr class="rs-group"><td colspan="8">기타 테스터 (${s.other_members.length}명)</td></tr>
          ${s.others.map((r) => resourceRow(r)).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <div class="rs-rules">
      <h4>Test Type별 소요 리소스 기준</h4>
      <ul>${rules}</ul>
      <p class="field-hint">공휴일은 <code>holidays.js</code> 상수 + <code>config.json</code> 의
        <code>holidays.add</code> / <code>holidays.remove</code> 로 관리합니다.</p>
    </div>`;
}

// 메인(현황 보드) 상단에는 실시간 리소스 가동률만 둔다.
// 팀원별 부하·파이프라인·타입 점유·알림은 QE 리소스 탭에서 본다.
async function renderResourceStrip() {
  const el = $('#resource-strip');
  if (state.view !== 'board') { el.classList.add('hidden'); return; }
  let s;
  try { s = await api('/api/resources?days=5'); } catch { el.classList.add('hidden'); return; }

  el.innerHTML = utilizationPanel(s.utilization, true);
  el.classList.remove('hidden');
}

const VIEWS = ['board', 'schedule', 'calendar', 'daily', 'weekly', 'certstats', 'resources'];

// 탭 버튼 클릭과 상단 요약 클릭이 같은 경로를 타도록 한 곳에 모았다.
function switchView(view) {
  if (!VIEWS.includes(view)) return;
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  render();
}

function render() {
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle('hidden', state.view !== v));
  const isReport = state.view === 'daily' || state.view === 'weekly';
  const isPanel = isReport || state.view === 'certstats' || state.view === 'resources';
  $('#summary').classList.toggle('hidden', isPanel);
  $('#board-clock').classList.toggle('hidden', state.view !== 'board');
  document.querySelector('.filters').classList.toggle('hidden', isPanel);
  renderBottlenecks();
  renderResourceStrip();
  if (state.view === 'board') renderBoard();
  else if (state.view === 'schedule') renderSchedule();
  else if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'certstats') renderCertStats();
  else if (state.view === 'resources') renderResources();
  else renderReport(state.view);
}

// ---- 모달 ----
// 단순 1:1 필드 (requester·tester·test_purpose는 콤보라 별도 처리)
const F = {
  id: '#f-id', cert_type: '#f-cert_type', test_type: '#f-test_type', round: '#f-round',
  model_name: '#f-model_name', fw_version: '#f-fw_version',
  desired_date: '#f-desired_date', note: '#f-note',
  scheduled_date: '#f-scheduled_date', started_date: '#f-started_date', completed_date: '#f-completed_date',
  remaining_slots: '#f-remaining_slots',
  status: '#f-status', verdict: '#f-verdict', progress: '#f-progress', result: '#f-result',
};
const NEW_DEFAULTS = { cert_type: 'Netflix NTS', test_type: 'IR', test_purpose: '3PL', status: '예약대기' };

// ---- 콤보 박스(선택 + 직접입력) 헬퍼 ----
// 의뢰자: 기존 이름을 datalist로 제공하되 자유롭게 수정·직접입력 가능한 입력 필드
// 숨김 처리된 이름은 제안에서 제외 (의뢰 레코드 자체는 유지)
function requesterSuggestions() {
  const hidden = new Set(state.hiddenRequesters);
  return [...new Set(state.items.map((i) => i.requester).filter(Boolean))]
    .filter((n) => !hidden.has(n))
    .sort();
}

function buildRequesterOptions() {
  $('#requester-list').innerHTML = requesterSuggestions().map((n) => `<option value="${esc(n)}"></option>`).join('');
}

// 서버에서 숨긴 의뢰자 목록 로드
async function loadHiddenRequesters() {
  try {
    const r = await api('/api/requesters/hidden');
    state.hiddenRequesters = r.hidden || [];
  } catch { state.hiddenRequesters = []; }
}

// 의뢰자 관리 팝오버 렌더 (제안 목록: 삭제 / 숨긴 목록: 복원)
function renderRequesterManager() {
  const pop = $('#requester-manage');
  if (!pop || pop.classList.contains('hidden')) return;
  const visible = requesterSuggestions();
  const hidden = [...state.hiddenRequesters].sort();
  const visHtml = visible.length
    ? visible.map((n) => `<li><span>${esc(n)}</span><button type="button" class="rm-del" data-name="${esc(n)}">삭제</button></li>`).join('')
    : '<li class="rm-empty">표시할 의뢰자가 없습니다.</li>';
  const hidHtml = hidden.length
    ? `<div class="rm-hidden"><p class="rm-title">숨긴 의뢰자</p><ul>${
        hidden.map((n) => `<li><span>${esc(n)}</span><button type="button" class="rm-restore" data-name="${esc(n)}">복원</button></li>`).join('')
      }</ul></div>`
    : '';
  pop.innerHTML = `<p class="rm-title">의뢰자 목록</p><ul>${visHtml}</ul>${hidHtml}`;
}

// Test 목적: 이전에 직접 입력된 값을 기본 목록 뒤, '+ 직접 입력' 앞에 끼워 넣는다.
// HTML의 기본 옵션을 그대로 두고 동적 항목만 data-dyn으로 표시해 매번 갈아끼운다.
function buildPurposeOptions() {
  const sel = $('#f-test_purpose-select');
  sel.querySelectorAll('option[data-dyn]').forEach((o) => o.remove());
  const fixed = new Set([...sel.options].map((o) => o.value));
  const customOpt = sel.querySelector('option[value="__custom__"]');
  for (const v of state.options.testPurposes) {
    if (fixed.has(v)) continue;
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    o.dataset.dyn = '1';
    sel.insertBefore(o, customOpt);
  }
}

// 모델명: 이전에 한 번이라도 입력된 값을 datalist로 노출 (직접 입력도 그대로 가능)
function buildModelOptions() {
  $('#model-list').innerHTML = state.options.models.map((n) => `<option value="${esc(n)}"></option>`).join('');
}

function setCombo(prefix, value) {
  const sel = $(`#f-${prefix}-select`);
  const custom = $(`#f-${prefix}-custom`);
  const inList = [...sel.options].some((o) => o.value === value && o.value !== '__custom__' && o.value !== '');
  if (value && !inList) {
    sel.value = '__custom__';
    custom.value = value;
    custom.classList.remove('hidden');
  } else {
    sel.value = value || '';
    custom.value = '';
    custom.classList.add('hidden');
  }
}

function readCombo(prefix) {
  const sel = $(`#f-${prefix}-select`);
  const custom = $(`#f-${prefix}-custom`);
  return sel.value === '__custom__' ? custom.value.trim() : sel.value;
}

function bindCombo(prefix) {
  $(`#f-${prefix}-select`).addEventListener('change', (e) => {
    $(`#f-${prefix}-custom`).classList.toggle('hidden', e.target.value !== '__custom__');
  });
}

function applyRoleLock() {
  const isNew = !$(F.id).value;
  const reqGroup = document.querySelector('.group-requester');
  const testGroup = document.querySelector('.group-tester');
  if (isNew) { reqGroup.disabled = false; testGroup.disabled = true; }
  else { reqGroup.disabled = state.role !== '의뢰자'; testGroup.disabled = state.role !== '테스터'; }
}

async function loadHistory(id) {
  const box = $('#history-box');
  if (!id) { box.classList.add('hidden'); return; }
  try {
    const hist = await api(`/api/requests/${id}/history`);
    $('#history-list').innerHTML = hist.length
      ? hist.map((h) => `<li><span class="h-meta">${fmtTs(h.ts)} · ${esc(h.actor)} · ${esc(h.action)}</span><br>${esc(h.detail)}</li>`).join('')
      : '<li class="h-meta">이력 없음</li>';
    box.classList.remove('hidden');
  } catch { box.classList.add('hidden'); }
}

function openModal(item) {
  const isNew = !item;
  $('#modal-title').textContent = isNew ? '의뢰요청' : `의뢰 #${item.id}`;
  $('#btn-delete').classList.toggle('hidden', isNew);
  for (const [k, sel] of Object.entries(F)) {
    $(sel).value = isNew ? (NEW_DEFAULTS[k] ?? '') : (item[k] ?? '');
  }
  buildRequesterOptions();
  buildModelOptions();
  $('#f-requester').value = isNew ? '' : (item.requester || '');
  buildPurposeOptions();
  setCombo('test_purpose', isNew ? NEW_DEFAULTS.test_purpose : (item.test_purpose || ''));
  setCombo('tester', isNew ? '' : (item.tester || ''));

  // 진행차수 자동 산출 상태 초기화. 신규 등록일 때만 이력을 조회한다.
  roundAuto.key = null;
  roundAuto.info = null;
  roundAuto.touched = false;
  $('#btn-round-info').classList.add('hidden');
  $('#round-spin').classList.add('hidden');
  setRoundHint(isNew
    ? '인증종류·Test type·Test 목적·모델명을 고르면 자동으로 채워집니다.'
    : '저장된 진행차수입니다. 필요하면 직접 수정할 수 있습니다.');
  if (isNew) autoFillRound();

  applyRoleLock();
  loadHistory(isNew ? null : item.id);
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
  $('#requester-manage').classList.add('hidden');
}

function readForm() {
  const out = { actor: actor() };
  for (const [k, sel] of Object.entries(F)) {
    if (k === 'id') continue;
    out[k] = $(sel).value;
  }
  out.requester = $('#f-requester').value.trim();
  out.test_purpose = purposeValue();
  out.tester = readCombo('tester');
  return out;
}

async function submitForm(e) {
  e.preventDefault();
  const id = $(F.id).value;
  const payload = readForm();
  try {
    if (id) await api(`/api/requests/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    else await api('/api/requests', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    await load();
  } catch (err) { alert(err.message); }
}

async function deleteItem() {
  const id = $(F.id).value;
  if (!id) return;
  if (!confirm('이 의뢰를 삭제하시겠습니까?')) return;
  try {
    await api(`/api/requests/${id}?actor=${encodeURIComponent(actor())}`, { method: 'DELETE' });
    closeModal();
    await load();
  } catch (err) { alert(err.message); }
}

// 의뢰자 제안 목록 관리 동작
async function hideRequesterName(name) {
  if (!name) return;
  if (!confirm(`'${name}'을(를) 의뢰자 제안 목록에서 삭제할까요?\n(기존 의뢰 건은 그대로 유지됩니다)`)) return;
  try {
    const r = await api('/api/requesters/hidden', {
      method: 'POST',
      body: JSON.stringify({ name, actor: actor() }),
    });
    state.hiddenRequesters = r.hidden || [];
    buildRequesterOptions();
    renderRequesterManager();
  } catch (err) { alert(err.message); }
}

async function restoreRequesterName(name) {
  if (!name) return;
  try {
    const r = await api(`/api/requesters/hidden/${encodeURIComponent(name)}`, { method: 'DELETE' });
    state.hiddenRequesters = r.hidden || [];
    buildRequesterOptions();
    renderRequesterManager();
  } catch (err) { alert(err.message); }
}

function toggleRequesterManager(force) {
  const pop = $('#requester-manage');
  const show = force !== undefined ? force : pop.classList.contains('hidden');
  pop.classList.toggle('hidden', !show);
  if (show) renderRequesterManager();
}

// ---- 이벤트 ----
function bind() {
  $('#role-select').value = state.role;
  $('#role-select').addEventListener('change', (e) => {
    state.role = e.target.value;
    localStorage.setItem('role', state.role);
  });
  $('#user-name').value = state.name;
  $('#user-name').addEventListener('input', (e) => {
    state.name = e.target.value;
    localStorage.setItem('username', state.name);
  });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

  ['#filter-cert', '#filter-status'].forEach((s) => $(s).addEventListener('change', load));
  let timer;
  $('#filter-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });

  $('#btn-new').addEventListener('click', () => openModal(null));
  $('#modal-close').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#req-form').addEventListener('submit', submitForm);
  $('#btn-delete').addEventListener('click', deleteItem);
  bindCombo('test_purpose');
  bindCombo('tester');

  // Task 5. 인증종류·Test type·Test 목적·모델명이 바뀌면 진행차수를 다시 산출 (타이핑은 250ms 디바운스)
  let roundTimer;
  $(F.model_name).addEventListener('input', () => {
    clearTimeout(roundTimer);
    roundTimer = setTimeout(autoFillRound, 250);
  });
  $(F.cert_type).addEventListener('change', autoFillRound);
  $(F.test_type).addEventListener('change', autoFillRound);
  $('#f-test_purpose-select').addEventListener('change', autoFillRound);
  $('#f-test_purpose-custom').addEventListener('input', () => {
    clearTimeout(roundTimer);
    roundTimer = setTimeout(autoFillRound, 250);
  });
  // 사용자가 직접 고친 차수는 이후 자동값이 덮어쓰지 않는다
  $(F.round).addEventListener('input', () => { roundAuto.touched = true; });
  $('#btn-round-info').addEventListener('click', openRoundModal);
  $('#round-modal-close').addEventListener('click', closeRoundModal);
  $('#round-modal').addEventListener('click', (e) => { if (e.target.id === 'round-modal') closeRoundModal(); });

  // 병목 경고에서 장기 미판정 건 클릭 → 상세 (필터에 걸려 목록에 없을 수 있어 직접 조회)
  $('#bottlenecks').addEventListener('click', async (e) => {
    const el = e.target.closest('[data-id]');
    if (!el) return;
    try { openModal(await api(`/api/requests/${el.dataset.id}`)); }
    catch (err) { alert(err.message); }
  });

  // 의뢰자 제안 목록 관리 (열기/닫기 + 삭제/복원)
  $('#btn-requester-manage').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleRequesterManager();
  });
  $('#requester-manage').addEventListener('click', (e) => {
    const del = e.target.closest('.rm-del');
    const res = e.target.closest('.rm-restore');
    if (del) { hideRequesterName(del.dataset.name); return; }
    if (res) { restoreRequesterName(res.dataset.name); return; }
  });
  // 팝오버 바깥 클릭 시 닫기
  document.addEventListener('click', (e) => {
    const pop = $('#requester-manage');
    if (pop && !pop.classList.contains('hidden')
        && !e.target.closest('#requester-manage') && !e.target.closest('#btn-requester-manage')) {
      pop.classList.add('hidden');
    }
  });

  // 보드 칼럼 "더보기/접기" 토글
  $('#view-board').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    e.stopPropagation();
    const st = btn.dataset.toggle;
    if (state.boardExpanded.has(st)) state.boardExpanded.delete(st);
    else state.boardExpanded.add(st);
    renderBoard();
  });

  // 현황보고 새로고침 / 즉시 발송
  ['daily', 'weekly'].forEach((p) => {
    $(`#view-${p}`).addEventListener('click', async (e) => {
      if (e.target.closest('[data-report-refresh]')) { renderReport(p); return; }
      const copyBtn = e.target.closest('[data-report-copy]');
      if (copyBtn) { copyReport(copyBtn, p); return; }
      const sendBtn = e.target.closest('[data-report-send]');
      if (!sendBtn) return;
      sendBtn.disabled = true;
      const orig = sendBtn.textContent;
      sendBtn.textContent = '발송 중…';
      try {
        const res = await api(`/api/report/${p}/send`, { method: 'POST', body: '{}' });
        alert(res.sent ? '현황보고 메일을 발송했습니다.' : '메일 설정(config.json)이 없어 발송하지 못했습니다.');
      } catch (err) { alert(err.message); }
      sendBtn.disabled = false;
      sendBtn.textContent = orig;
    });
  });

  // Task 6. QE 리소스: 새로고침 · 상단 한 줄 요약 클릭 시 탭 이동
  $('#view-resources').addEventListener('click', (e) => {
    if (e.target.closest('[data-rs-refresh]')) renderResources();
  });
  $('#resource-strip').addEventListener('click', () => switchView('resources'));

  // 인증 통계: 주간/누적 전환 · 주 이동 · 엑셀 다운로드 · 새로고침
  $('#view-certstats').addEventListener('click', (e) => {
    const mode = e.target.closest('[data-stats-mode]');
    if (mode) {
      state.certStats.mode = mode.dataset.statsMode;
      state.certStats.weekOffset = 0;
      renderCertStats();
      return;
    }
    const wk = e.target.closest('[data-stats-week]');
    if (wk) {
      const step = Number(wk.dataset.statsWeek);
      state.certStats.weekOffset = step === 0 ? 0 : state.certStats.weekOffset + step;
      renderCertStats();
      return;
    }
    const copy = e.target.closest('[data-stats-copy]');
    if (copy) {
      const r = state.certStats.range;
      copyReport(copy, 'certstats', r ? `?from=${r.from}&to=${r.to}` : '');
      return;
    }
    if (e.target.closest('[data-stats-excel]')) { downloadCertStatsCsv(); return; }
    const send = e.target.closest('[data-stats-send]');
    if (send) { sendCertStatsMail(send); return; }
    if (e.target.closest('[data-stats-refresh]')) renderCertStats();
  });

  // 일정표 엑셀 다운로드 + 컬럼 정렬
  $('#view-schedule').addEventListener('click', (e) => {
    if (e.target.closest('#btn-excel')) { downloadExcel(); return; }
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const k = th.dataset.sort;
      if (state.sort.key === k) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort.key = k; state.sort.dir = 'asc'; }
      renderSchedule();
    }
  });

  // 캘린더 월 이동
  $('#view-calendar').addEventListener('click', (e) => {
    const nav = e.target.closest('[data-cal-nav]');
    if (!nav) return;
    const act = nav.dataset.calNav;
    if (act === 'today') { state.cal = { y: _now.getFullYear(), m: _now.getMonth() }; }
    else {
      let { y, m } = state.cal;
      m += act === 'next' ? 1 : -1;
      if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
      state.cal = { y, m };
    }
    renderCalendar();
  });

  // 카드/행/캘린더칩 클릭 → 상세
  document.querySelector('main').addEventListener('click', (e) => {
    const el = e.target.closest('[data-id]');
    if (!el) return;
    const item = state.items.find((i) => i.id === Number(el.dataset.id));
    if (item) openModal(item);
  });
}

bind();
loadHiddenRequesters();
load().catch((err) => alert(err.message));

// 1분마다 자동 새로고침 (편집 중 모달이 열려 있으면 건너뜀)
setInterval(() => {
  if (!$('#modal').classList.contains('hidden')) return;
  load().catch(() => {});
}, 60000);

// 현황 보드 상단 실시간 시계 (1초 단위)
function renderClock() {
  const el = $('#board-clock');
  if (!el) return;
  const t = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const date = `${t.getFullYear()}년 ${t.getMonth() + 1}월 ${t.getDate()}일 (${days[t.getDay()]})`;
  const time = `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
  el.innerHTML = `<span class="clock-date">${date}</span><span class="clock-time">${time}</span>`;
}
renderClock();
setInterval(renderClock, 1000);
