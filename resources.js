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
    capacity: cap,                          // 1인 주간 가용 (담당 4명만 해당)
    usage_pct: cap === null ? null : pct(slots, cap),
    free: cap === null ? null : Math.max(0, cap - slots),
    over: cap === null ? null : Math.max(0, slots - cap),
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

  // days[i] 에 배치된 작업들. { tester, id, model_name, pending }
  const lanes = days.map(() => []);
  const cursor = new Map(members.map((n) => [n, 0]));    // 담당자별 다음 빈 영업일 인덱스
  let overflow = 0;                                      // 조회 구간을 넘어간 slot

  const place = (tester, item, fromIdx, pending) => {
    let at = Math.max(cursor.get(tester), fromIdx);
    for (let k = 0; k < item.slots; k += 1, at += 1) {
      if (at >= days.length) { overflow += item.slots - k; break; }
      lanes[at].push({ tester, id: item.id, model_name: item.model_name, pending });
    }
    cursor.set(tester, Math.min(at, days.length));
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
    return {
      date,
      weekday: '일월화수목금토'[new Date(`${date}T00:00:00`).getDay()],
      capacity,
      assigned,
      pending,
      used,
      free: Math.max(0, capacity - used),
      usage_pct: pct(used, capacity),
      idle: members.filter((n) => !lane.some((x) => x.tester === n)),   // 그날 비어 있는 담당자
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

  return { days: dayRows, weeks, horizon: days.length, overflow, excluded };
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

  return {
    as_of: asOf,
    members: MEMBERS.slice(),
    other_members: otherNames,
    slot_rules: SLOT_RULES,
    week_business_days: WEEK_BUSINESS_DAYS,
    // 두 풀을 합친 전체 물량. 풀별 사용률과 섞이지 않게 건수·slot만 둔다.
    overall: {
      count: items.length,
      slots: items.reduce((a, r) => a + r.slots, 0),
    },
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

module.exports = { MEMBERS, SLOT_RULES, WEEK_BUSINESS_DAYS, slotsOf, ruleLabelOf, summarize, dailyPlan: dailyPlanOf };
