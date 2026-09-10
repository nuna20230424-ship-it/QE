// Confluence QE Schedule 캘린더 이벤트의 텍스트 필드를 대시보드 필드로 옮기는 파싱 순수 함수 모음

// 인증종류 — 제목의 첫 번째 대괄호 값 (대소문자 무시)
const CERT_TYPES = {
  xts: 'Google xTS',
  nts: 'Netflix NTS',
  avts: 'Amazon AVTS',
};

// Test type — 대시보드 드롭다운과 같은 4종
const TEST_TYPES = ['IR', 'LR', 'MR', '파생'];

// Test 목적 — 대시보드 드롭다운 6종 + 지시서 예시에 나온 축약 표기(Pre, Pre-test)
const TEST_PURPOSES = {
  '3pl': '3PL',
  official: 'Official',
  pre: 'Pre-Test',
  'pre-test': 'Pre-Test',
  pretest: 'Pre-Test',
  양산: '양산',
  self: 'self',
  mr: 'MR',
};

// '>' 뒤 상태 문자열 → 대시보드의 (상태, 판정) 한 쌍.
// 제목은 사람이 자유 입력하므로 지시서 예시의 영문 표기와 대시보드 자체 한글 라벨을 함께 받는다.
const STATUSES = {
  passed: { status: '완료', verdict: 'Pass' },
  pass: { status: '완료', verdict: 'Pass' },
  failed: { status: '완료', verdict: 'Fail' },
  fail: { status: '완료', verdict: 'Fail' },
  'in-progress': { status: '진행중', verdict: '' },
  inprogress: { status: '진행중', verdict: '' },
  dropped: { status: '중단', verdict: 'Drop' },
  drop: { status: '중단', verdict: 'Drop' },
  예약확정: { status: '예약확정', verdict: '' },
  진행중: { status: '진행중', verdict: '' },
  완료: { status: '완료', verdict: '' },
  보류: { status: '보류', verdict: '' },
  중단: { status: '중단', verdict: 'Drop' },
};

const norm = (s) => String(s ?? '').trim();
const key = (s) => norm(s).toLowerCase();
const pad2 = (n) => String(n).padStart(2, '0');

// 제목 앞머리에 붙어 있는 [..] 토큰을 순서대로 떼어 낸다.
function splitBrackets(title) {
  const tags = [];
  let rest = norm(title);
  let m;
  while ((m = rest.match(/^\[([^\]]*)\]\s*/))) {
    tags.push(m[1].trim());
    rest = rest.slice(m[0].length);
  }
  return { tags, rest };
}

// 회차 표기 — 1st / 2nd / 3차 / 4 를 모두 숫자만 남긴다.
const ROUND = /^(\d{1,2})\s*(?:st|nd|rd|th|차)?$/i;

// '무엇을'(제목) 한 줄 → 인증종류·Test type·Test 목적·모델명·회차·상태·판정.
// 해석하지 못한 조각은 값을 비우고 warnings에 남긴다 — 조용히 틀린 값을 넣지 않는다.
function parseTitle(title) {
  const warnings = [];
  const out = {
    cert_type: '', test_type: '', test_purpose: '', model_name: '',
    round: '', status: '', verdict: '', title: norm(title),
  };
  if (!out.title) {
    warnings.push('제목이 비어 있습니다.');
    return { ...out, warnings };
  }

  const { tags, rest } = splitBrackets(out.title);
  if (!tags.length) warnings.push('대괄호 토큰이 없어 인증종류를 알 수 없습니다.');

  // 1. 인증종류 — 첫 번째 대괄호
  if (tags.length) {
    const cert = CERT_TYPES[key(tags[0])];
    if (cert) out.cert_type = cert;
    else warnings.push(`인증종류를 알 수 없습니다: [${tags[0]}]`);
  }

  // 2. Test type / Test 목적 — 두 번째 이후 대괄호.
  //    IR/LR/MR/파생이면 type, 아니면 목적으로 본다. MR은 양쪽에 다 있어 먼저 비어 있는 칸이 가져간다.
  for (const tag of tags.slice(1)) {
    const t = TEST_TYPES.find((v) => v.toLowerCase() === key(tag));
    if (t && !out.test_type) { out.test_type = t; continue; }
    const p = TEST_PURPOSES[key(tag)];
    if (p && !out.test_purpose) { out.test_purpose = p; continue; }
    warnings.push(`분류하지 못한 대괄호 값: [${tag}]`);
  }

  // 3. 모델명·회차 — '>' 앞. 지시서 예시 1처럼 짝 없는 ']'가 섞여 있어도 떼어 낸다.
  const gt = rest.indexOf('>');
  const left = (gt >= 0 ? rest.slice(0, gt) : rest).replace(/[[\]]/g, ' ').trim();
  const statusRaw = gt >= 0 ? rest.slice(gt + 1).trim() : '';
  if (gt < 0) warnings.push("'>' 구분자가 없어 진행·결과를 알 수 없습니다.");

  const tokens = left.split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    warnings.push('모델명을 찾지 못했습니다.');
  } else {
    out.model_name = tokens[0];
    for (const tk of tokens.slice(1)) {
      const r = tk.match(ROUND);
      if (r && !out.round) out.round = String(Number(r[1]));
      else warnings.push(`모델명 뒤에 해석하지 못한 값: ${tk}`);
    }
  }

  // 4. 진행·결과 — '>' 뒤
  if (statusRaw) {
    const s = STATUSES[key(statusRaw)];
    if (s) { out.status = s.status; out.verdict = s.verdict; }
    else warnings.push(`상태를 알 수 없습니다: ${statusRaw}`);
  } else if (gt >= 0) {
    warnings.push("'>' 뒤 상태 문자열이 비어 있습니다.");
  }

  return { ...out, warnings };
}

// '누구와' — 'Haechan.lee 이해찬 (haechan)' 처럼 영문 ID·한글 성명·괄호 ID가 섞여 온다.
// 대시보드 담당 테스터 칸은 한글 성명을 쓰므로 그것을 우선하고, 없으면 괄호 ID·첫 토큰으로 내려간다.
function parsePerson(text) {
  const s = norm(text);
  if (!s) return { name: '', warnings: ['담당자 필드가 비어 있습니다.'] };
  const ko = s.match(/[가-힣]{2,5}/);
  if (ko) return { name: ko[0], warnings: [] };
  const paren = s.match(/\(([^)]+)\)/);
  if (paren) {
    const name = paren[1].trim();
    return { name, warnings: [`한글 성명이 없어 ID를 사용합니다: ${name}`] };
  }
  const first = s.split(/\s+/)[0];
  return { name: first, warnings: [`한글 성명이 없어 첫 토큰을 사용합니다: ${first}`] };
}

// 시작·종료·생성일자 — '2026. 9. 7.' 와 ISO 문자열을 모두 'YYYY-MM-DD'로 맞춘다.
// 시각·타임존이 붙은 ISO는 Date로 돌려 로컬(KST) 날짜를 쓴다 — UTC 문자열을 그대로 자르면 하루 밀린다.
function parseDate(text) {
  const s = norm(text);
  if (!s) return { date: '', warnings: [] };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:/.test(s)) {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return { date: '', warnings: [`날짜 형식을 알 수 없습니다: ${s}`] };
    return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, warnings: [] };
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, warnings: [] };
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return { date: '', warnings: [`날짜 형식을 알 수 없습니다: ${s}`] };
  return { date: `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`, warnings: [] };
}

module.exports = { parseTitle, parsePerson, parseDate, CERT_TYPES, TEST_TYPES, TEST_PURPOSES, STATUSES };
