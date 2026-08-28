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

// 담당자 한 명의 집계 행을 만든다. slot 합계가 곧 소요 영업일수다(1 slot = 1명 1일).
// share      — 전체 미완 물량(=100%) 중 이 담당자가 지고 있는 몫
// delta_pct  — 균등분담선(100 ÷ 인원수) 대비 %p. 양수면 초과, 음수면 여유
function rowOf(name, group, items, asOf, total, baselinePct) {
  const slots = items.reduce((a, r) => a + r.slots, 0);
  const eta = slots > 0 ? holidays.nthBusinessDay(asOf, slots) : null;
  const share = pct(slots, total);
  // 물량이 0이면 쏠림이라는 개념 자체가 없다. '25%p 여유'처럼 오해를 주지 않게 편차를 0으로 둔다.
  const hasWork = total > 0 && baselinePct !== null;
  return {
    tester: name,
    group,                                  // member | other | unassigned
    count: items.length,
    slots,
    days: slots,                            // 1 slot = 1일이므로 변환 계수 1
    eta,                                    // 예상 소진일 (오늘부터 slots번째 영업일)
    eta_warning: holidays.coverageWarning(eta),
    share,                                  // 전체 100 중 점유율 (%)
    // 균등분담선 대비 편차. 기간 개념이 없어 '가용 대비 사용률'을 낼 수 없으므로
    // 전체 물량을 100으로 정규화하고 그 안에서의 쏠림을 정량화한다.
    delta_pct: baselinePct === null ? null : (hasWork ? round1(share - baselinePct) : 0),
    delta: baselinePct === null ? null : (hasWork ? round1((total * baselinePct) / 100 - slots) : 0),
    items,
  };
}

// 미완 의뢰 목록을 받아 전체·담당자별 리소스 현황을 낸다.
// asOf는 'YYYY-MM-DD'. 기간 개념을 두지 않고 남은 물량 전체를 소요 영업일수로 환산한다.
function summarize(openRows, asOf) {
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

  const totalSlots = items.reduce((a, r) => a + r.slots, 0);
  // 전체 미완 물량을 100%로 산정한다. 기간 개념이 없어 '가용 대비 사용률'을 낼 수 없으므로,
  // 전체를 100으로 정규화하고 균등분담선(100 ÷ 인원수) 대비 초과·여유를 %로 표기한다.
  const baselinePct = MEMBERS.length > 0 ? round1(100 / MEMBERS.length) : null;
  // 균등분담 기준선을 slot으로도 남긴다(재배정 시 "몇 slot을 옮기면 되는가"에 쓴다).
  const baseline = MEMBERS.length > 0 ? round1(totalSlots / MEMBERS.length) : null;

  const pick = (fn) => items.filter(fn);
  const memberRows = MEMBERS.map((n) => rowOf(n, 'member', pick((r) => r.tester === n), asOf, totalSlots, baselinePct));
  const unassigned = rowOf('미배정', 'unassigned', pick((r) => !r.tester), asOf, totalSlots, null);
  unassigned.eta = null;                    // 담당자가 없으면 소진일을 낼 수 없다
  unassigned.eta_warning = null;

  const otherNames = [...new Set(pick((r) => r.tester && !MEMBERS.includes(r.tester)).map((r) => r.tester))].sort();
  const otherRows = otherNames.map((n) => rowOf(n, 'other', pick((r) => r.tester === n), asOf, totalSlots, null));

  // 전체 소진 예상: 담당 4명이 하루 4 slot을 소화한다고 볼 때 필요한 영업일수.
  const dailyCapacity = MEMBERS.length;
  const totalDays = dailyCapacity > 0 ? Math.ceil(totalSlots / dailyCapacity) : null;
  const totalEta = totalDays > 0 ? holidays.nthBusinessDay(asOf, totalDays) : null;

  // 부하 편차 — 4명 중 최다와 최소의 차이. 재배정이 필요한지 한눈에 본다.
  const memberSlots = memberRows.map((r) => r.slots);
  const spread = memberSlots.length ? Math.max(...memberSlots) - Math.min(...memberSlots) : 0;
  const memberShares = memberRows.map((r) => r.share);
  const spreadPct = memberShares.length ? round1(Math.max(...memberShares) - Math.min(...memberShares)) : 0;
  // 균등분담선을 넘긴 담당자들의 초과분 합계(%p). 재배정으로 옮겨야 하는 물량의 크기다.
  const overloadPct = round1(memberRows.reduce((a, r) => a + Math.max(0, r.delta_pct || 0), 0));

  return {
    as_of: asOf,
    members: MEMBERS.slice(),
    slot_rules: SLOT_RULES,
    totals: {
      count: items.length,
      slots: totalSlots,
      assigned_slots: totalSlots - unassigned.slots,
      unassigned_slots: unassigned.slots,
      daily_capacity: dailyCapacity,
      days: totalDays,
      eta: totalEta,
      eta_warning: holidays.coverageWarning(totalEta),
      // 전체를 100%로 본 정량 지표
      total_pct: totalSlots > 0 ? 100 : 0,
      assigned_pct: pct(totalSlots - unassigned.slots, totalSlots),
      unassigned_pct: pct(unassigned.slots, totalSlots),
      others_pct: pct(otherRows.reduce((a, r) => a + r.slots, 0), totalSlots),
      baseline_pct: baselinePct,
      spread_pct: spreadPct,
      overload_pct: overloadPct,
      baseline,
      spread,
    },
    rows: memberRows,
    unassigned,
    others: otherRows,
    // 규칙에 없는 인증종류. 비어 있어야 정상이고, 비어 있지 않으면 그게 신호다.
    undefined_rules: undefinedRules,
  };
}

module.exports = { MEMBERS, SLOT_RULES, slotsOf, ruleLabelOf, summarize };
