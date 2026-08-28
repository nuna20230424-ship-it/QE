// 한국 공휴일 상수와 영업일(주말·공휴일 제외) 계산 — 리소스 소요일수 산출용
const fs = require('fs');
const path = require('path');

// ⚠ 이 목록은 코드 상수다. 음력 기반 공휴일(설·추석·부처님오신날)과 대체공휴일은
// 정부 관보로 확정되는 값이라, 운용 전에 반드시 공고와 대조해야 한다.
// 사내 창립기념일이나 정상근무 전환은 config.json 의 holidays.add / holidays.remove 로 덮어쓴다.
// 등록되지 않은 연도는 주말만 제외하므로, 그 연도로 계산이 넘어가면 화면에 경고를 띄운다.
const BASE = {
  2026: [
    ['2026-01-01', '신정'],
    ['2026-02-16', '설 연휴'],
    ['2026-02-17', '설날'],
    ['2026-02-18', '설 연휴'],
    ['2026-03-02', '삼일절 대체공휴일'],   // 3/1 일요일
    ['2026-05-01', '근로자의날'],          // 법정공휴일은 아니나 통상 휴무. 근무 시 remove
    ['2026-05-05', '어린이날'],
    ['2026-05-25', '부처님오신날 대체공휴일'], // 5/24 일요일
    ['2026-06-03', '지방선거일'],
    ['2026-08-17', '광복절 대체공휴일'],   // 8/15 토요일
    ['2026-09-24', '추석 연휴'],
    ['2026-09-25', '추석'],
    ['2026-09-28', '추석 대체공휴일'],     // 9/26 토요일
    ['2026-10-05', '개천절 대체공휴일'],   // 10/3 토요일
    ['2026-10-09', '한글날'],
    ['2026-12-25', '성탄절'],
  ],
};

// 상수에 등록된 연도. 계산이 이 범위를 벗어나면 정확도를 보증하지 못한다.
const KNOWN_YEARS = Object.keys(BASE).map(Number).sort();

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function loadOverride() {
  const p = path.join(__dirname, 'config.json');
  if (!fs.existsSync(p)) return { add: [], remove: [] };
  try {
    const h = (JSON.parse(fs.readFileSync(p, 'utf8')) || {}).holidays || {};
    const arr = (v) => (Array.isArray(v) ? v.filter((d) => YMD.test(d)) : []);
    return { add: arr(h.add), remove: arr(h.remove) };
  } catch {
    return { add: [], remove: [] };
  }
}

// 상수 + config 오버라이드를 합친 최종 공휴일 맵 (YYYY-MM-DD → 이름)
function buildMap() {
  const map = new Map();
  for (const list of Object.values(BASE)) for (const [d, name] of list) map.set(d, name);
  const ov = loadOverride();
  for (const d of ov.add) map.set(d, '사내 지정 휴일');
  for (const d of ov.remove) map.delete(d);
  return map;
}

let MAP = buildMap();

// config.json 을 다시 읽어 공휴일 맵을 갱신한다 (테스트와 운용 중 설정 변경용).
const reload = () => { MAP = buildMap(); return MAP.size; };

const isHoliday = (ymd) => MAP.has(ymd);
const holidayName = (ymd) => MAP.get(ymd) || null;

// 토·일이 아니고 공휴일도 아닌 날.
function isBusinessDay(ymd) {
  const day = new Date(`${ymd}T00:00:00`).getDay();
  if (day === 0 || day === 6) return false;
  return !isHoliday(ymd);
}

const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 오늘 날짜(서버 로컬 기준).
// `toISOString().slice(0,10)`은 UTC 날짜라 KST(UTC+9)에서는 00:00~09:00 사이에 하루 뒤처진다.
// 아침 출근 시간대가 정확히 그 구간이므로 날짜 기준은 반드시 로컬로 계산한다.
const today = () => toYmd(new Date());

// 오늘로부터 n일 전/후(로컬 기준) 날짜
function shiftDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

// from(포함)부터 영업일을 세어 n번째 영업일의 날짜. n<=0이면 null.
// n=1이면 from 이 영업일일 때 from 자신, 아니면 그 다음 영업일이다.
// 무한 루프 방지를 위해 최대 10년(3660일)까지만 전진한다.
function nthBusinessDay(from, n) {
  if (!YMD.test(String(from)) || !Number.isFinite(n) || n <= 0) return null;
  const d = new Date(`${from}T00:00:00`);
  let left = Math.ceil(n);
  for (let guard = 0; guard < 3660; guard += 1) {
    const ymd = toYmd(d);
    if (isBusinessDay(ymd)) {
      left -= 1;
      if (left === 0) return ymd;
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

// from(포함)부터 영업일 n개를 순서대로 돌려준다. 일별 가용 현황의 가로축이 된다.
function businessDaysFrom(from, n) {
  if (!YMD.test(String(from)) || !Number.isFinite(n) || n <= 0) return [];
  const out = [];
  const d = new Date(`${from}T00:00:00`);
  for (let guard = 0; guard < 3660 && out.length < n; guard += 1) {
    const ymd = toYmd(d);
    if (isBusinessDay(ymd)) out.push(ymd);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

// 그 날이 속한 주의 월요일~금요일 (일별 현황을 주 단위로 묶는 데 쓴다)
function weekOf(ymd) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const mon = toYmd(d);
  d.setDate(d.getDate() + 4);
  const fri = toYmd(d);
  const short = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  return { from: mon, to: fri, label: `${short(mon)}~${short(fri)}` };
}

// 계산 결과가 공휴일 미등록 연도에 걸리는지. 걸리면 주말만 제외한 값이라 오차가 있다.
function coverageWarning(ymd) {
  if (!ymd || !YMD.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  if (KNOWN_YEARS.includes(y)) return null;
  return `${y}년 공휴일이 등록되지 않아 주말만 제외한 값입니다. config.json 의 holidays.add 에 추가하세요.`;
}

module.exports = {
  isHoliday,
  holidayName,
  isBusinessDay,
  nthBusinessDay,
  businessDaysFrom,
  weekOf,
  today,
  shiftDays,
  coverageWarning,
  reload,
  knownYears: () => KNOWN_YEARS.slice(),
  // 화면·테스트가 현재 적용된 공휴일을 확인할 수 있게 노출
  all: () => [...MAP.entries()].sort().map(([date, name]) => ({ date, name })),
};
