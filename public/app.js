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
};

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
  render();
  renderSummary();
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
// 판정 배지: 보드는 완료건만, 일정표 판정 컬럼은 값이 있으면 항상
const verdictChip = (v) => (v ? `<span class="verdict v-${v}">${esc(v)}</span>` : '');
const verdictBadge = (it) => (it.status === '완료' && it.verdict ? verdictChip(it.verdict) : '');

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
    const body = list.length ? list.map(cardHtml).join('') : '<div class="col-empty">항목 없음</div>';
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
        <td>${verdictChip(it.verdict) || '—'}</td>
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
  const csv = lines.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const t = new Date();
  const fname = `인증일정_${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}.csv`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
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

function render() {
  $('#view-board').classList.toggle('hidden', state.view !== 'board');
  $('#view-schedule').classList.toggle('hidden', state.view !== 'schedule');
  $('#view-calendar').classList.toggle('hidden', state.view !== 'calendar');
  if (state.view === 'board') renderBoard();
  else if (state.view === 'schedule') renderSchedule();
  else renderCalendar();
}

// ---- 모달 ----
// 단순 1:1 필드 (requester·tester는 콤보라 별도 처리)
const F = {
  id: '#f-id', cert_type: '#f-cert_type', test_type: '#f-test_type', test_purpose: '#f-test_purpose', round: '#f-round',
  model_name: '#f-model_name', fw_version: '#f-fw_version',
  desired_date: '#f-desired_date', note: '#f-note',
  scheduled_date: '#f-scheduled_date', started_date: '#f-started_date', completed_date: '#f-completed_date',
  status: '#f-status', verdict: '#f-verdict', progress: '#f-progress', result: '#f-result',
};
const NEW_DEFAULTS = { cert_type: 'Netflix NTS', test_type: 'IR', test_purpose: '3PL', status: '예약대기' };

// ---- 콤보 박스(선택 + 직접입력) 헬퍼 ----
function buildRequesterOptions(currentVal) {
  const names = [...new Set(state.items.map((i) => i.requester).filter(Boolean))];
  if (currentVal && !names.includes(currentVal)) names.push(currentVal);
  names.sort();
  $('#f-requester-select').innerHTML = '<option value="">(미지정)</option>'
    + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
    + '<option value="__custom__">+ 직접 입력</option>';
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
  buildRequesterOptions(isNew ? '' : (item.requester || ''));
  setCombo('requester', isNew ? '' : (item.requester || ''));
  setCombo('tester', isNew ? '' : (item.tester || ''));
  applyRoleLock();
  loadHistory(isNew ? null : item.id);
  $('#modal').classList.remove('hidden');
}

function closeModal() { $('#modal').classList.add('hidden'); }

function readForm() {
  const out = { actor: actor() };
  for (const [k, sel] of Object.entries(F)) {
    if (k === 'id') continue;
    out[k] = $(sel).value;
  }
  out.requester = readCombo('requester');
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

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    state.view = t.dataset.view;
    render();
  }));

  ['#filter-cert', '#filter-status'].forEach((s) => $(s).addEventListener('change', load));
  let timer;
  $('#filter-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });

  $('#btn-new').addEventListener('click', () => openModal(null));
  $('#modal-close').addEventListener('click', closeModal);
  $('#btn-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  $('#req-form').addEventListener('submit', submitForm);
  $('#btn-delete').addEventListener('click', deleteItem);
  bindCombo('requester');
  bindCombo('tester');

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
load().catch((err) => alert(err.message));
