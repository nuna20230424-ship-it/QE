// 의뢰 한 건의 담당 테스터(메인 + 서브) 명단과 slot 분담 규칙을 정의하는 공용 모듈

// 서브 담당자는 한 칸에 콤마로 이어 저장한다. 줄바꿈·세미콜론으로 붙여 넣어도 받아 준다.
const SPLIT = /[,;\n]/;

// 자유 입력 문자열 → 이름 배열. 공백만 남은 조각과 중복은 버린다.
function parse(text) {
  const out = [];
  for (const raw of String(text ?? '').split(SPLIT)) {
    const name = raw.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// 의뢰 한 건의 담당자 명단. [메인, ...서브] 순서를 지킨다.
// 서브에 메인과 같은 이름이 들어와도 한 번만 센다 — 두 번 세면 그 사람 부하가 부풀고
// 분담 몫도 실제보다 작아진다.
// 아무도 없으면 빈 배열을 돌려주고, 호출부가 '미배정'으로 다룬다.
function listOf(row) {
  const main = String(row && row.tester ? row.tester : '').trim();
  const names = main ? [main] : [];
  for (const n of parse(row && row.tester_sub)) if (!names.includes(n)) names.push(n);
  return names;
}

// 총 slot을 담당자 수로 나눈 분담 몫. 나머지는 메인부터 한 개씩 얹는다.
//   12 slot / 2인 → 6, 6      (NTS 를 둘이 나눠 6영업일에 끝낸다)
//    3 slot / 2인 → 2, 1      (홀수는 메인이 하나 더 가져간다)
// 합은 언제나 total 과 같다 — 팀 총 물량이 분담 때문에 늘거나 줄면 안 된다.
function split(total, count) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const rest = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < rest ? 1 : 0));
}

module.exports = { parse, listOf, split };
