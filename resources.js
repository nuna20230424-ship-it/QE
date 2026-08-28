// QE 담당자별 업무 리소스(slot) 산정 — 미완 의뢰의 소요 slot을 영업일수로 환산한다
const holidays = require('./holidays');

// 인증 담당 인원. 화면에는 이 순서대로 항상 4명이 나오고, 건이 0이어도 행을 유지한다.
const MEMBERS = ['이은경', '조아라', '이해찬', '문유림'];

// 1 slot = 1명의 1일 업무량(person-day).
// 작업지시서 v5 Task 6 표:
//   xTS (IR, LR) 3 / xTS (MR, 파생) 2 / NTS (IR, LR, MR, 파생) 12 / ATVS 4
// 지시서의 `ATVS`는 DB의 `Amazon AVTS`로 본다(인증 3종 중 나머지가 이것 하나뿐이다).
// xTS는 MR·파생만 2로 두고 나머지는 3으로 잡는다 — test_type이 빈 구 데이터를 2로 세면
// 물량이 과소평가되고, UI 기본값이 IR이라는 점과도 어긋난다.
const XTS_LIGHT = ['MR', '파생'];

const SLOT_RULES = [
  { cert: 'Google xTS',  label: 'xTS (MR, 파생)',            slots: 2 },
  { cert: 'Google xTS',  label: 'xTS (IR, LR)',              slots: 3 },
  { cert: 'Netflix NTS', label: 'NTS (IR, LR, MR, 파생)',    slots: 12 },
  { cert: 'Amazon AVTS', label: 'ATVS',                      slots: 4 },
];

// 의뢰 한 건의 소요 slot. 규칙에 없는 인증종류는 null을 돌려주고 호출부가 `미정의`로 모은다.
// 조용히 0으로 세면 전체 물량이 틀리는데 아무도 알아채지 못한다.
function slotsOf(row) {
  const cert = String(row.cert_type || '').trim();
  const type = String(row.test_type || '').trim();
  if (cert === 'Google xTS')  return XTS_LIGHT.includes(type) ? 2 : 3;
  if (cert === 'Netflix NTS') return 12;
  if (cert === 'Amazon AVTS') return 4;
  return null;
}

// 그 건이 어느 규칙으로 계산됐는지 사람이 읽을 라벨 (화면 건별 상세에 쓴다)
function ruleLabelOf(row) {
  const cert = String(row.cert_type || '').trim();
  const type = String(row.test_type || '').trim();
  if (cert === 'Google xTS')  return XTS_LIGHT.includes(type) ? 'xTS (MR, 파생)' : 'xTS (IR, LR)';
  if (cert === 'Netflix NTS') return 'NTS (IR, LR, MR, 파생)';
  if (cert === 'Amazon AVTS') return 'ATVS';
  return '미정의';
}

const round1 = (n) => Math.round(n * 10) / 10;
// 분모가 0이면 0으로 돌려 0 나눗셈을 차단한다.
const pct = (n, d) => (d > 0 ? round1((n / d) * 100) : 0);

// 주간 가용 리소스의 기준 — 1명이 한 주에 소화하는 영업일 수.
// 전체 가용 = 인원수 × 5 slot 이고, 이 값을 100%로 놓는다.
const WEEK_BUSINESS_DAYS = 5;

// 리소스 산정 대상 상태. 가동률은 '확정된 업무'만 세므로 예약대기를 뺀다.
const COMMITTED = ['진행중', '예약확정'];
const WAITING = '예약대기';

// 팀원별 업무 부하 신호등. 1인 주간 가용(5 slot) 대비 사용률 기준.
//   안정  ≤ 80%   / 주의 ≤ 100%(가용 한도 임박) / 초과 > 100%(초과 할당)
const LOAD_LEVELS = { safe: 80, warn: 100 };
const loadLevelOf = (usagePct) => {
  if (usagePct === null) return null;
  if (usagePct <= LOAD_LEVELS.safe) return 'safe';
  if (usagePct <= LOAD_LEVELS.warn) return 'warn';
  return 'over';
};

// 담당자 한 명의 집계 행을 만든다. slot 합계가 곧 소요 영업일수다(1 slot = 1명 1일).
// usage_pct — 1인 주간 가용(5 slot)을 100%로 본 사용률. 100%를 넘으면 그만큼 다음 주로 밀린다.
// free      — 이번 주에 더 받을 수 있는 slot (자동 할당이 채워 넣을 여유)
function rowOf(name, group, items, asOf) {
  const slots = items.reduce((a, r) => a + r.slots, 0);
  const eta = slots > 0 ? holidays.nthBusinessDay(asOf, slots) : null;
  // 담당자 한 사람이면 인증 담당이든 기타든 주간 가용은 같다. 미배정만 사람이 없어 가용이 없다.
  const cap = group === 'unassigned' ? null : WEEK_BUSINESS_DAYS;
  return {
    tester: name,
    group,                                  // member | other | unassigned
    count: items.length,
    slots,
    days: slots,                            // 1 slot = 1일이므로 변환 계수 1
    eta,                                    // 예상 소진일 (오늘부터 slots번째 영업일)
    eta_warning: holidays.coverageWarning(eta),
    capacity: cap,                          // 1인 주간 가용 (사람이 있는 행만)
    usage_pct: cap === null ? null : pct(slots, cap),
    free: cap === null ? null : Math.max(0, cap - slots),
    over: cap === null ? null : Math.max(0, slots - cap),
    // 신호등 — safe(안정) | warn(주의, 한도 임박) | over(초과 할당)
    level: cap === null ? null : loadLevelOf(pct(slots, cap)),
    items,
  };
}

// 일별 가용 리소스 현황.
// 배치 규칙 — 한 담당자는 하루에 1 slot만 쓴다(직렬). 그래서 담당자별로 큐를 만들어
// 대표 일정(plan_date) 순으로 영업일에 이어 붙인다. 시작은 max(plan_date, 기준일)이다.
// 미배정 건은 가장 빨리 비는 담당자 자리에 `배정 예정`으로 채워 넣는다 — 자동 할당의 미리보기다.
// 리소스 풀 하나(인증 담당 4명 또는 기타 테스터)의 일별 가용 현황.
// members 밖의 테스터에게 걸린 건은 이 풀의 가용을 쓰지 않으므로 excluded로 빼서 명시한다
// (호출부가 이미 걸러 넘기므로 정상이면 0이고, 0이 아니면 그게 신호다).
// absorbUnassigned가 true인 풀만 담당자 미정 건을 '배정 예정'으로 흡수한다.
function dailyPlanOf(items, asOf, horizon, members = MEMBERS, absorbUnassigned = true) {
  const own = (items || []).filter((r) => !r.tester || members.includes(r.tester));
  const excludedItems = (items || []).filter((r) => r.tester && !members.includes(r.tester));
  const excluded = {
    count: excludedItems.length,
    slots: excludedItems.reduce((a, r) => a + r.slots, 0),
    testers: [...new Set(excludedItems.map((r) => r.tester))].sort(),
  };

  const days = holidays.businessDaysFrom(asOf, horizon);
  if (!days.length || !members.length) return { days: [], weeks: [], horizon: 0, overflow: 0, excluded };

  const idxOf = new Map(days.map((d, i) => [d, i]));
  // plan_date가 과거이거나 비어 있으면 오늘부터, 조회 구간보다 늦으면 구간 밖으로 본다.
  const startIndexOf = (planDate) => {
    if (!planDate || planDate <= asOf) return 0;
    if (idxOf.has(planDate)) return idxOf.get(planDate);
    const after = days.findIndex((d) => d >= planDate);  // 계획일이 주말·공휴일이면 다음 영업일
    return after === -1 ? days.length : after;
  };

  // days[i] 에 배치된 작업들. { tester, id, model_name, status, pending }
  const lanes = days.map(() => []);
  const cursor = new Map(members.map((n) => [n, 0]));    // 담당자별 다음 빈 영업일 인덱스
  let overflow = 0;                                      // 조회 구간을 넘어간 slot
  // 배치 기록 — 계획 시작(declared)과 실제 배치 시작(actual)을 함께 남긴다.
  // 둘이 어긋나면 그게 '일정이 밀린 건'이고, 같은 담당자의 declared 구간이 겹치면 '리소스 충돌'이다.
  const placements = [];

  const place = (tester, item, fromIdx, pending) => {
    const at0 = Math.max(cursor.get(tester), fromIdx);
    let at = at0;
    for (let k = 0; k < item.slots; k += 1, at += 1) {
      if (at >= days.length) { overflow += item.slots - k; break; }
      lanes[at].push({ tester, id: item.id, model_name: item.model_name, status: item.status, pending });
    }
    cursor.set(tester, Math.min(at, days.length));
    placements.push({
      tester, item, pending, slots: item.slots,
      declared_idx: fromIdx, actual_idx: at0,
      declared_date: days[fromIdx] || null,
      actual_date: days[at0] || null,
      end_idx: at0 + item.slots - 1,
      end_date: days[Math.min(at0 + item.slots - 1, days.length - 1)] || null,
    });
  };

  const byPlan = (a, b) => String(a.plan_date || '').localeCompare(String(b.plan_date || '')) || a.id - b.id;

  // 1단계 — 담당자가 정해진 건
  for (const name of members) {
    for (const it of own.filter((r) => r.tester === name).sort(byPlan)) {
      place(name, it, startIndexOf(it.plan_date), false);
    }
  }
  // 2단계 — 미배정 건을 가장 빨리 비는 담당자에게 (자동 할당 미리보기).
  // 기타 풀은 자동 할당 대상이 아니므로 흡수하지 않는다.
  if (absorbUnassigned) {
    for (const it of own.filter((r) => !r.tester).sort(byPlan)) {
      const from = startIndexOf(it.plan_date);
      const pickName = members.reduce((best, n) => (
        Math.max(cursor.get(n), from) < Math.max(cursor.get(best), from) ? n : best), members[0]);
      place(pickName, it, from, true);
    }
  }

  const capacity = members.length;
  const dayRows = days.map((date, i) => {
    const lane = lanes[i];
    const assigned = lane.filter((x) => !x.pending).length;
    const pending = lane.filter((x) => x.pending).length;
    const used = assigned + pending;
    // 가동률은 확정된 업무(진행중·예약확정)만 센다. 예약대기는 아직 확정 전이라 뺀다.
    const committed = lane.filter((x) => COMMITTED.includes(x.status)).length;
    return {
      date,
      weekday: '일월화수목금토'[new Date(`${date}T00:00:00`).getDay()],
      capacity,
      assigned,
      pending,
      used,
      committed,
      waiting: lane.filter((x) => x.status === WAITING).length,
      free: Math.max(0, capacity - used),
      free_committed: Math.max(0, capacity - committed),   // 즉시 수용 가능한 잔여 slot
      usage_pct: pct(used, capacity),
      committed_pct: pct(committed, capacity),
      idle: members.filter((n) => !lane.some((x) => x.tester === n)),   // 그날 비어 있는 담당자
      busy_committed: members.filter((n) => lane.some((x) => x.tester === n && COMMITTED.includes(x.status))),
      lane,
    };
  });

  // 주 단위 소계. 공휴일이 든 주는 영업일이 적어 가용도 줄어든다.
  const weekMap = new Map();
  for (const d of dayRows) {
    const w = holidays.weekOf(d.date);
    if (!weekMap.has(w.from)) weekMap.set(w.from, { ...w, business_days: 0, capacity: 0, assigned: 0, pending: 0, used: 0 });
    const acc = weekMap.get(w.from);
    acc.business_days += 1;
    acc.capacity += d.capacity;
    acc.assigned += d.assigned;
    acc.pending += d.pending;
    acc.used += d.used;
  }
  const weeks = [...weekMap.values()].map((w) => ({
    ...w,
    free: Math.max(0, w.capacity - w.used),
    usage_pct: pct(w.used, w.capacity),
  }));

  // ---- 스마트 알림 재료 ----
  // 리소스 충돌 — 같은 담당자의 '계획 일정'이 서로 겹치는 조합.
  // 직렬 큐 배치는 겹침을 자동으로 밀어내므로 배치 결과만 보면 충돌이 보이지 않는다.
  // 그래서 배치 전의 declared 구간으로 판정한다.
  const conflicts = [];
  for (const name of members) {
    const mine = placements.filter((p) => p.tester === name && p.declared_idx < days.length)
      .sort((a, b) => a.declared_idx - b.declared_idx);
    for (let i = 1; i < mine.length; i += 1) {
      const prev = mine[i - 1];
      const cur = mine[i];
      const prevEnd = prev.declared_idx + prev.slots - 1;
      if (cur.declared_idx <= prevEnd) {
        conflicts.push({
          tester: name,
          from: days[cur.declared_idx],
          to: days[Math.min(prevEnd, days.length - 1)],
          overlap_days: prevEnd - cur.declared_idx + 1,
          items: [prev, cur].map((p) => ({
            id: p.item.id, model_name: p.item.model_name, cert_type: p.item.cert_type,
            status: p.item.status, slots: p.slots, declared_date: p.declared_date,
          })),
        });
      }
    }
  }

  // 일정 밀림 — 직렬 배치 결과가 계획일보다 늦게 시작하는 건 (충돌의 결과이자 지연 신호)
  const delays = placements
    .filter((p) => p.actual_idx > p.declared_idx && p.declared_idx < days.length)
    .map((p) => ({
      tester: p.tester, id: p.item.id, model_name: p.item.model_name, status: p.item.status,
      declared_date: p.declared_date, actual_date: p.actual_date,
      delay_days: p.actual_idx - p.declared_idx, pending: p.pending,
    }))
    .sort((a, b) => b.delay_days - a.delay_days);

  // 리소스 확보 예정 — 담당자가 busy → idle로 바뀌는 첫 시점과 그때 끝나는 건.
  // "D-2: 이해찬 리소스 확보 예정"을 만들기 위한 재료다.
  const releases = [];
  for (const name of members) {
    const busyOn = dayRows.map((d) => d.lane.some((x) => x.tester === name));
    if (!busyOn[0]) continue;                       // 지금 비어 있으면 알릴 것이 없다
    const at = busyOn.findIndex((b, i) => i > 0 && !b && busyOn[i - 1]);
    if (at === -1) continue;                        // 구간 내에 끝나지 않는다
    const ending = placements
      .filter((p) => p.tester === name && p.end_idx === at - 1)
      .sort((a, b) => b.slots - a.slots)[0];
    if (!ending) continue;
    releases.push({
      tester: name,
      date: dayRows[at].date,
      d_day: at,                                   // 영업일 기준 D-N
      slots: ending.slots,
      id: ending.item.id,
      model_name: ending.item.model_name,
      cert_type: ending.item.cert_type,
      rule: ending.item.rule,
    });
  }
  releases.sort((a, b) => a.d_day - b.d_day);

  return { days: dayRows, weeks, horizon: days.length, overflow, excluded, conflicts, delays, releases };
}

// 미완 의뢰 목록을 받아 전체·담당자별·일별 리소스 현황을 낸다.
// asOf는 'YYYY-MM-DD'. horizon은 일별 현황을 몇 영업일까지 볼지(기본 20일 = 4주).
// 전체 가용 = 인원수 × 5 slot(1주)을 100%로 놓고 사용률·여유·초과를 %로 낸다.
function summarize(openRows, asOf, horizon = 20) {
  const items = [];
  const undefinedRules = [];

  for (const r of openRows || []) {
    const slots = slotsOf(r);
    const item = {
      id: r.id,
      cert_type: r.cert_type,
      test_type: r.test_type || '',
      test_purpose: r.test_purpose || '',
      model_name: r.model_name,
      round: r.round || '',
      status: r.status,
      tester: String(r.tester || '').trim(),
      plan_date: r.plan_date || '',
      desired_date: r.desired_date || '',
      created_at: r.created_at || '',
      rule: ruleLabelOf(r),
      slots: slots === null ? 0 : slots,
    };
    if (slots === null) undefinedRules.push(item);
    else items.push(item);
  }

  const pick = (fn) => items.filter(fn);

  // ---- 리소스 풀을 둘로 나눈다 ----
  // 인증 담당(4명)과 기타 테스터는 별도 리소스로 관리하므로 가용·사용률을 섞지 않는다.
  // 기타 물량이 인증 담당 풀의 100%에 섞이면 사용률이 왜곡된다.
  const otherNames = [...new Set(pick((r) => r.tester && !MEMBERS.includes(r.tester)).map((r) => r.tester))].sort();
  const certItems = pick((r) => !r.tester || MEMBERS.includes(r.tester));
  const otherItems = pick((r) => r.tester && !MEMBERS.includes(r.tester));

  const memberRows = MEMBERS.map((n) => rowOf(n, 'member', pick((r) => r.tester === n), asOf));
  const unassigned = rowOf('미배정', 'unassigned', pick((r) => !r.tester), asOf);
  unassigned.eta = null;                    // 담당자가 없으면 소진일을 낼 수 없다
  unassigned.eta_warning = null;

  const otherRows = otherNames.map((n) => rowOf(n, 'other', pick((r) => r.tester === n), asOf));

  // 풀 하나의 총계. 1주 가용(인원수 × 5 slot)을 100%로 놓는다.
  const totalsOf = (poolItems, poolMembers, unassignedSlots) => {
    const slots = poolItems.reduce((a, r) => a + r.slots, 0);
    const dailyCapacity = poolMembers.length;
    const weekCapacity = dailyCapacity * WEEK_BUSINESS_DAYS;
    const usagePct = pct(slots, weekCapacity);
    const days = dailyCapacity > 0 ? Math.ceil(slots / dailyCapacity) : null;
    const eta = days > 0 ? holidays.nthBusinessDay(asOf, days) : null;
    return {
      headcount: dailyCapacity,
      count: poolItems.length,
      slots,
      assigned_slots: slots - unassignedSlots,
      unassigned_slots: unassignedSlots,
      daily_capacity: dailyCapacity,          // 1일 가용 slot (= 인원수)
      week_capacity: weekCapacity,            // 1주 가용 slot = 100% 기준
      // 1주 가용을 100%로 본 정량 지표
      usage_pct: usagePct,
      free_pct: Math.max(0, round1(100 - usagePct)),
      over_pct: Math.max(0, round1(usagePct - 100)),
      free_slots: Math.max(0, weekCapacity - slots),
      over_slots: Math.max(0, slots - weekCapacity),
      weeks_needed: weekCapacity > 0 ? round1(slots / weekCapacity) : 0,
      unassigned_pct: pct(unassignedSlots, weekCapacity),
      days,
      eta,
      eta_warning: holidays.coverageWarning(eta),
    };
  };

  // 인증 담당 풀은 미배정 건을 자동 할당 대상으로 흡수한다. 기타 풀은 흡수하지 않는다.
  const daily = dailyPlanOf(certItems, asOf, horizon, MEMBERS, true);
  const othersDaily = otherNames.length
    ? dailyPlanOf(otherItems, asOf, horizon, otherNames, false)
    : null;

  // ---- 1. 실시간 리소스 가동률 ----
  // 팀 전체의 1일 총 가용 slot(= 인원수) 대비, 오늘 실제로 담당자를 점유하고 있는
  // 확정 업무(진행중·예약확정)의 비율. 예약대기는 아직 확정 전이라 가동률에서 뺀다.
  const today = daily.days[0] || null;
  const thisWeek = daily.weeks[0] || null;
  const utilization = {
    date: today ? today.date : asOf,
    capacity: MEMBERS.length,                              // 1일 총 가용 slot
    used: today ? today.committed : 0,                     // 오늘 점유 중인 확정 업무
    free: today ? today.free_committed : MEMBERS.length,   // 즉시 수용 가능한 잔여 slot
    usage_pct: today ? today.committed_pct : 0,
    waiting: today ? today.waiting : 0,                    // 오늘 일정에 걸린 예약대기 건
    busy: today ? today.busy_committed : [],
    idle: today ? today.idle : MEMBERS.slice(),
    // 이번 주 보조 지표 (남은 영업일 기준)
    week: thisWeek ? {
      label: thisWeek.label, business_days: thisWeek.business_days,
      capacity: thisWeek.capacity, used: thisWeek.used,
      free: thisWeek.free, usage_pct: thisWeek.usage_pct,
    } : null,
  };

  // ---- 3. 진행 상태별 파이프라인 ----
  // 인증 담당 풀 기준. 상태별 건수·slot과, 예약대기로 가장 오래 머문 건을 뽑는다.
  const STATUS_ORDER = ['예약대기', '예약확정', '진행중'];
  const dayOf = (ts) => String(ts || '').slice(0, 10);
  const daysBetween = (from, to) => (from && to
    ? Math.max(0, Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000))
    : null);

  const pipeline = {
    stages: STATUS_ORDER.map((st) => {
      const rows = certItems.filter((r) => r.status === st);
      return {
        status: st,
        count: rows.length,
        slots: rows.reduce((a, r) => a + r.slots, 0),
        unassigned: rows.filter((r) => !r.tester).length,
      };
    }),
    // 가장 오래 대기 중인 건 — 등록일로부터 며칠 지났는지. 최우선 배정 대상이다.
    longest_waiting: certItems
      .filter((r) => r.status === WAITING)
      .map((r) => ({
        id: r.id, model_name: r.model_name, cert_type: r.cert_type, rule: r.rule,
        slots: r.slots, tester: r.tester, desired_date: r.desired_date,
        created_date: dayOf(r.created_at),
        waiting_days: daysBetween(dayOf(r.created_at), asOf),
        // 희망일이 이미 지났으면 배정이 늦은 것이다
        desired_overdue: !!(r.desired_date && r.desired_date < asOf),
      }))
      .sort((a, b) => (b.waiting_days || 0) - (a.waiting_days || 0))
      .slice(0, 2),
  };

  // ---- 4. 인증 타입별 점유 현황 ----
  // 어떤 인증이 리소스를 가장 많이 먹고 있는지. 도넛 차트의 원본 데이터다.
  const poolSlots = certItems.reduce((a, r) => a + r.slots, 0);
  const typeDistribution = SLOT_RULES.map((rule) => {
    const rows = certItems.filter((r) => r.rule === rule.label);
    const slots = rows.reduce((a, r) => a + r.slots, 0);
    return {
      label: rule.label, unit_slots: rule.slots,
      count: rows.length, slots, share: pct(slots, poolSlots),
    };
  }).filter((t) => t.count > 0).sort((a, b) => b.slots - a.slots);

  // ---- 5. 스마트 알림 ----
  const alerts = {
    conflicts: daily.conflicts,
    delays: daily.delays.slice(0, 5),
    releases: daily.releases,
    overloaded: memberRows.filter((r) => r.level === 'over')
      .map((r) => ({ tester: r.tester, slots: r.slots, capacity: r.capacity, usage_pct: r.usage_pct })),
    count: daily.conflicts.length + Math.min(daily.delays.length, 5) + daily.releases.length
      + memberRows.filter((r) => r.level === 'over').length,
  };

  return {
    as_of: asOf,
    members: MEMBERS.slice(),
    other_members: otherNames,
    slot_rules: SLOT_RULES,
    week_business_days: WEEK_BUSINESS_DAYS,
    load_levels: LOAD_LEVELS,
    // 두 풀을 합친 전체 물량. 풀별 사용률과 섞이지 않게 건수·slot만 둔다.
    overall: {
      count: items.length,
      slots: items.reduce((a, r) => a + r.slots, 0),
    },
    utilization,
    pipeline,
    type_distribution: typeDistribution,
    alerts,
    totals: totalsOf(certItems, MEMBERS, unassigned.slots),
    others_totals: totalsOf(otherItems, otherNames, 0),
    daily,
    others_daily: othersDaily,
    rows: memberRows,
    unassigned,
    others: otherRows,
    // 규칙에 없는 인증종류. 비어 있어야 정상이고, 비어 있지 않으면 그게 신호다.
    undefined_rules: undefinedRules,
  };
}

module.exports = {
  MEMBERS, SLOT_RULES, WEEK_BUSINESS_DAYS, LOAD_LEVELS, COMMITTED,
  slotsOf, ruleLabelOf, loadLevelOf, summarize, dailyPlan: dailyPlanOf,
};
