// 인증 통계·진행차수 표기·모델명 목록화에 대한 스모크 테스트 (임시 DB 사용, 실 data.db 무영향)
const fs = require('fs');
const os = require('os');
const path = require('path');

// db.js를 require하기 전에 임시 DB 경로를 지정해야 한다.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-smoke-'));
process.env.DB_PATH = path.join(TMP, 'test.db');

const repo = require('../db');
const report = require('../report');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' → ' + extra : ''}`); }
};
const head = (t) => console.log(`\n[${t}]`);

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const now = new Date();
const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const mon = new Date(base); mon.setDate(base.getDate() - ((base.getDay() + 6) % 7));
const thisWeek = (n) => { const d = new Date(mon); d.setDate(mon.getDate() + n); return ymd(d); };
const lastWeek = (n) => { const d = new Date(mon); d.setDate(mon.getDate() - 7 + n); return ymd(d); };
const daysAgo = (n) => { const d = new Date(base); d.setDate(base.getDate() - n); return ymd(d); };

// ---------- 0. 빈 DB: 0 나눗셈 방어 ----------
head('0. 빈 DB (Divide by Zero 방어)');
const empty = repo.certStats(null);
ok('rows 비어 있음', empty.rows.length === 0);
ok('판정 건수 0', empty.totals.judged === 0, String(empty.totals.judged));
ok('pass_rate 0 (NaN/Infinity 아님)', empty.totals.pass_rate === 0, String(empty.totals.pass_rate));
ok('fail_rate 0 (NaN/Infinity 아님)', empty.totals.fail_rate === 0, String(empty.totals.fail_rate));
ok('modelNames 빈 배열', repo.modelNames().length === 0);
ok('testPurposes 빈 배열', repo.testPurposes().length === 0);

// ---------- 픽스처 ----------
// KM-100 / Google xTS  / 3PL   : 3건 (1차 Pass, 3차 Fail, 4차 미판정) — 이번 주
// KM-100 / Netflix NTS / 3PL   : 1건 (2차 Pass)                       — 이번 주
// KM-100 / Google xTS  / MR    : 1건 (1차 Pass)                       — 이번 주 (Test 목적으로 행이 갈리는지)
// KM-200 / Google xTS  / 3PL   : 2건 (1차 Fail, 2차 Fail)             — 지난 주 (주차 필터에서 빠져야 함)
// KM-300 / Amazon AVTS / 양산  : 1건 (미판정, Round 미입력)            — 이번 주 (집계에서 통째로 빠져야 함)
const mk = (d) => {
  const r = repo.create({
    cert_type: d.cert_type, test_type: d.test_type || '', model_name: d.model_name, test_purpose: d.purpose,
    round: d.round, requester: 'PL', desired_date: d.start,
  }, '테스트');
  return repo.update(r.id, {
    started_date: d.start, completed_date: d.end || '', status: d.status,
    verdict: d.verdict || '', progress: d.progress || '', result: d.result || '', tester: '이해찬',
  }, '테스트');
};
mk({ cert_type: 'Google xTS', model_name: 'KM-100', purpose: '3PL', round: '1', start: thisWeek(0), end: thisWeek(1), status: '완료', verdict: 'Pass' });
mk({ cert_type: 'Google xTS', model_name: 'KM-100', purpose: '3PL', round: '3', start: thisWeek(1), end: thisWeek(2), status: '완료', verdict: 'Fail', progress: '2일차 중단', result: 'DRM 재생 실패' });
mk({ cert_type: 'Google xTS', model_name: 'KM-100', purpose: '3PL', round: '4', start: thisWeek(3), status: '진행중' });
mk({ cert_type: 'Netflix NTS', model_name: 'KM-100', purpose: '3PL', round: '2', start: thisWeek(0), end: thisWeek(0), status: '완료', verdict: 'Pass' });
mk({ cert_type: 'Google xTS', model_name: 'KM-100', purpose: 'MR', round: '1', start: thisWeek(1), end: thisWeek(1), status: '완료', verdict: 'Pass' });
mk({ cert_type: 'Google xTS', model_name: 'KM-200', purpose: '3PL', round: '1', start: lastWeek(0), end: lastWeek(1), status: '완료', verdict: 'Fail' });
mk({ cert_type: 'Google xTS', model_name: 'KM-200', purpose: '3PL', round: '2', start: lastWeek(2), end: lastWeek(3), status: '완료', verdict: 'Fail' });
mk({ cert_type: 'Amazon AVTS', model_name: 'KM-300', purpose: '양산', round: '', start: thisWeek(2), status: '예약확정' });
// Task 6 병목 경고용. 날짜를 주차와 무관하게 고정해 오늘이 무슨 요일이든 같은 결과가 나오게 한다.
mk({ cert_type: 'Netflix NTS', model_name: 'KM-400', purpose: 'Official', round: '', start: daysAgo(40), status: '진행중' });
mk({ cert_type: 'Google xTS', model_name: 'KM-500', purpose: '3PL', round: '5', start: daysAgo(21), end: daysAgo(20), status: '완료', verdict: 'Fail' });

// ---------- Task 2. 모델명 자동 목록화 ----------
head('Task 2. 모델명 DISTINCT 목록');
const models = repo.modelNames();
ok('중복 제거 (KM-100 4건 → 1개)', models.filter((m) => m === 'KM-100').length === 1, JSON.stringify(models));
ok('모델 5개 전부 노출', models.length === 5, JSON.stringify(models));
ok('이름순 정렬', JSON.stringify(models) === JSON.stringify([...models].sort()), JSON.stringify(models));

const purposes = repo.testPurposes();
ok('Test 목적 중복 제거 (3PL 4건 → 1개)', purposes.filter((v) => v === '3PL').length === 1, JSON.stringify(purposes));
ok('입력된 목적 전부 노출', JSON.stringify(purposes) === JSON.stringify(['3PL', 'MR', 'Official', '양산']), JSON.stringify(purposes));
ok('빈 목적은 제외', !purposes.some((v) => !v));

// ---------- Task 4-1. 미판정 제외 + 누적 통계 ----------
head('Task 4-1. 미판정 제외 · 누적 통계');
const all = repo.certStats(null);
const row = (m, c, p) => all.rows.find((r) => r.model_name === m && r.cert_type === c && r.test_purpose === p);
const x = row('KM-100', 'Google xTS', '3PL');
ok('미판정 4차 제외 → 판정 2건', x.judged === 2, String(x.judged));
ok('Fail 횟수 = 1', x.fail === 1, String(x.fail));
ok('Pass율 = 50% (1/2)', x.pass_rate === 50, String(x.pass_rate));
ok('Pass율 + Fail율 = 100%', x.pass_rate + x.fail_rate === 100, `${x.pass_rate}+${x.fail_rate}`);
ok('미판정 전용 건은 행 자체가 없음 (KM-300)', !all.rows.some((r) => r.model_name === 'KM-300'));
ok('max_round(최근 Round 입력) 필드 제거', x.max_round === undefined);
ok('pending(미판정) 필드 제거', x.pending === undefined);
ok('총계 판정 건수 = 7', all.totals.judged === 7, String(all.totals.judged));
ok('총계 모델 수 = 3 (판정 있는 모델만)', all.totals.models === 3, String(all.totals.models));
ok('빈 DB가 아니어도 0 나눗셈 없음', Number.isFinite(all.totals.pass_rate));

// ---------- Task 4-2. 결과 · Test 목적 컬럼 ----------
head('Task 4-2. 결과 · Test 목적 분리');
ok('결과 = 최신 판정 (3차 Fail이 최신)', x.result === 'Fail', String(x.result));
ok('진행차수 = 최신 판정 건의 Round', x.round === 3, String(x.round));
ok('Test 목적으로 행 분리 (3PL vs MR)', !!row('KM-100', 'Google xTS', 'MR'));
ok('MR 행은 1차 Pass', row('KM-100', 'Google xTS', 'MR').result === 'Pass' && row('KM-100', 'Google xTS', 'MR').round === 1);
ok('인증종류로도 행 분리 유지', row('KM-100', 'Netflix NTS', '3PL').round === 2);
ok('Fail만 있는 조합은 Fail율 100%', row('KM-200', 'Google xTS', '3PL').fail_rate === 100);
ok('인증완료일 = 최신 판정 건의 completed_date', x.completed_date === thisWeek(2), x.completed_date);
ok('MR 행 인증완료일도 그 건의 completed_date', row('KM-100', 'Google xTS', 'MR').completed_date === thisWeek(1));

// ---------- Task 4-3 / 주차(월~금) 필터 ----------
head('Task 4. 주차 월~금 필터');
const wk = report.workWeekRange(now);
ok('월요일 시작', new Date(`${wk.from}T00:00:00`).getDay() === 1, wk.from);
ok('금요일 종료', new Date(`${wk.to}T00:00:00`).getDay() === 5, wk.to);
const wkStats = repo.certStats(wk);
ok('지난주 건(KM-200) 제외', !wkStats.rows.some((r) => r.model_name === 'KM-200'));
ok('3주 전 건(KM-500) 제외', !wkStats.rows.some((r) => r.model_name === 'KM-500'));
ok('이번주 KM-100/xTS/3PL 판정 2건', wkStats.rows.find((r) => r.model_name === 'KM-100' && r.cert_type === 'Google xTS' && r.test_purpose === '3PL').judged === 2);
ok('이번주 판정 건수 = 4', wkStats.totals.judged === 4, String(wkStats.totals.judged));

// ---------- Task 5. 진행차수 자동 산출 ----------
head('Task 5. 진행차수 자동 산출');
// 직전(최신) 건이 4차 진행중(미판정)이므로 Pass가 아니라서 이어진다 — 미판정도 "Pass가 아닌 경우"에 포함.
const n1 = repo.nextRound('KM-100', '3PL', 'Google xTS', '');
ok('직전 4차 미판정 → 5차', n1.round === 5, String(n1.round));
ok('근거 basis = pending', n1.basis === 'pending', n1.basis);
ok('근거 문구에 차수 포함', n1.reason.includes('4차'), n1.reason);
const n2 = repo.nextRound('KM-100', 'MR', 'Google xTS', '');
ok('직전 Pass → 1차 리셋', n2.round === 1 && n2.basis === 'pass', `${n2.round}/${n2.basis}`);
const n3 = repo.nextRound('KM-999', '3PL', 'Google xTS', '');
ok('이력 없음 → 1차', n3.round === 1 && n3.basis === 'new', `${n3.round}/${n3.basis}`);
ok('이력 없음 → history 빈 배열', n3.history.length === 0);
ok('미판정만 있어도 이력으로 잡혀 2차로 이어짐', repo.nextRound('KM-300', '양산', 'Amazon AVTS', '').round === 2);
ok('직전 2차 Fail → 3차', repo.nextRound('KM-200', '3PL', 'Google xTS', '').round === 3);
ok('모델명 공백 → 1차 (조회 안 함)', repo.nextRound('  ', '3PL', 'Google xTS', '').round === 1);
ok('history는 최신순', n1.history[0].round === '4' && n1.history[0].verdict === '', JSON.stringify(n1.history[0]));
ok('history에 미판정 건도 포함', n1.history.some((h) => !h.verdict));
// Task 0: 인증종류가 다르면(Netflix NTS 2차 Pass) 이력에 섞이면 안 된다.
ok('history는 인증종류까지 일치해야 함 (1·3·4차 3건)', n1.history.length === 3, String(n1.history.length));
ok('history에 다른 인증종류 없음', n1.history.every((h) => h.cert_type === 'Google xTS'));
// cert_type 없이 조회하면(구버전 호출) 매칭되는 이력이 없어 1차로 나와야 한다 — 서버에서 필수값으로 막지만 db 계층도 안전해야 함.
ok('cert_type 없이 조회 → 매칭 실패로 1차', repo.nextRound('KM-100', '3PL', '', '').round === 1);

// ---------- Task 0. 진행차수 산출 원인 분석·수정 회귀 테스트 ----------
head('Task 0. 진행차수 4가지 조건 동시 매칭 · Pass가 아닌 경우 판정');
// 인증종류가 다르면 이력이 섞이면 안 된다 (기존 버그: 모델명·Test 목적 2개만 비교).
const t700a = mk({ cert_type: 'Netflix NTS', model_name: 'KM-700', purpose: '3PL', test_type: 'IR', round: '1', start: thisWeek(0), end: thisWeek(0), status: '완료', verdict: 'Fail' });
const t700b = mk({ cert_type: 'Google xTS', model_name: 'KM-700', purpose: '3PL', test_type: 'IR', round: '9', start: thisWeek(3), end: thisWeek(3), status: '완료', verdict: 'Fail' });
const r700 = repo.nextRound('KM-700', '3PL', 'Netflix NTS', 'IR');
ok('인증종류가 다른 9차 Fail에 안 딸려감 → 2차', r700.round === 2, String(r700.round));
ok('history에 다른 인증종류 없음', r700.history.every((h) => h.cert_type === 'Netflix NTS'));

// Test type이 다르면 이력이 섞이면 안 된다.
const t800a = mk({ cert_type: 'Google xTS', model_name: 'KM-800', purpose: '3PL', test_type: 'IR', round: '2', start: thisWeek(0), end: thisWeek(0), status: '완료', verdict: 'Fail' });
const t800b = mk({ cert_type: 'Google xTS', model_name: 'KM-800', purpose: '3PL', test_type: 'LR', round: '7', start: thisWeek(3), end: thisWeek(3), status: '완료', verdict: 'Fail' });
const r800 = repo.nextRound('KM-800', '3PL', 'Google xTS', 'IR');
ok('Test type이 다른 7차 Fail에 안 딸려감 → 3차', r800.round === 3, String(r800.round));

// 직전 판정이 Drop(Pass 아님)이어도 차수가 이어져야 한다 (기존 버그: Fail만 검사해 Drop을 Pass처럼 취급).
const t900 = mk({ cert_type: 'Google xTS', model_name: 'KM-900', purpose: 'Official', test_type: 'IR', round: '2', start: thisWeek(0), end: thisWeek(0), status: '완료', verdict: 'Drop' });
const r900 = repo.nextRound('KM-900', 'Official', 'Google xTS', 'IR');
ok('직전 Drop → 1차로 리셋되지 않고 3차로 이어짐', r900.round === 3 && r900.basis === 'drop', `${r900.round}/${r900.basis}`);
ok('Drop 건도 history에 포함(통계용 JUDGED와 달리)', r900.history.some((h) => h.verdict === 'Drop'));

// 직전 건이 아직 판정 전(미판정)이어도 Pass가 아니므로 차수가 이어져야 한다.
const t950 = mk({ cert_type: 'Google xTS', model_name: 'KM-950', purpose: 'Official', test_type: 'IR', round: '4', start: thisWeek(0), status: '진행중' });
const r950 = repo.nextRound('KM-950', 'Official', 'Google xTS', 'IR');
ok('직전 미판정 → 1차로 리셋되지 않고 5차로 이어짐', r950.round === 5 && r950.basis === 'pending', `${r950.round}/${r950.basis}`);
ok('미판정 건도 history에 포함', r950.history.some((h) => !h.verdict));

// 이후 통계·리포트 총계(정확한 건수 비교)에 영향 없도록 회귀용 픽스처는 정리한다.
for (const t of [t700a, t700b, t800a, t800b, t900, t950]) repo.remove(t.id, '테스트');

// ---------- Task 6. 병목 경고 ----------
head('Task 6. 병목 경고');
const bn = repo.bottlenecks();
ok('반복 Fail 5차 이상 = KM-500 1건', bn.repeated.length === 1 && bn.repeated[0].model_name === 'KM-500', JSON.stringify(bn.repeated));
ok('장기 미판정(14일 초과) = KM-400 1건', bn.stale.length === 1 && bn.stale[0].model_name === 'KM-400', JSON.stringify(bn.stale));
ok('경과일수 계산 (40일 내외)', bn.stale[0].days >= 39 && bn.stale[0].days <= 41, String(bn.stale[0].days));
ok('판정 끝난 건은 장기 미판정에서 제외', !bn.stale.some((r) => r.model_name === 'KM-500'));
ok('최근 진행중 건은 경고 대상 아님', !bn.stale.some((r) => r.model_name === 'KM-100'));
ok('count = repeated + stale', bn.count === bn.repeated.length + bn.stale.length);
ok('임계값을 낮추면 대상이 늘어남', repo.bottlenecks({ roundThreshold: 2 }).repeated.length === 3, String(repo.bottlenecks({ roundThreshold: 2 }).repeated.length));

// ---------- Task 3 / 4. 리포트 렌더 ----------
head('Task 3 / 4. 리포트 HTML');
const w = report.weekly(now);
ok('"진행차수 1차, Pass" 표기', w.html.includes('진행차수 1차, Pass'));
ok('"진행차수 3차, Fail" 표기', w.html.includes('진행차수 3차, Fail'));
ok('인증 통계 섹션 포함', w.html.includes('모델별 인증 현황'));
ok('주차 범위(월~금) 표기', w.html.includes(`${wk.from} ~ ${wk.to}`));
ok('결과 컬럼 헤더 추가', w.html.includes('>결과</th>'));
ok('Test 목적 컬럼 헤더 추가', w.html.includes('>Test 목적</th>'));
ok('미판정 컬럼 헤더 삭제', !w.html.includes('>미판정</th>'));
ok('Pass 파란 볼드 (4-3)', /<b [^>]*color:#1257c9[^>]*>[^<]*<font color="#1257c9"[^>]*>Pass</.test(w.html));
ok('Fail 빨간 음영 볼드 (4-3)', w.html.includes('background:#d23227;color:#ffffff'));
ok('Fail 상세에 결과 코멘트 유지', w.html.includes('DRM 재생 실패'));
ok('본문 집계 구간은 월~일 유지', report.weekRange(now).to !== wk.to);
ok('일일보고에는 통계 섹션 없음', !report.daily(now).html.includes('모델별 인증 현황'));

// ---------- 보고 메일: 스케줄 · 링크 전용 본문 · 인증통계 단독 보고 ----------
head('보고 메일 스케줄 · 링크 전용 본문');
const sched = require('../scheduler');
const job = (k) => sched.JOBS.find((j) => j.key === k);
ok('일일보고 = 매일 18시', job('daily').hour === 18 && job('daily').days === null);
ok('주간보고 = 금요일 18시', job('weekly').hour === 18 && JSON.stringify(job('weekly').days) === '[5]');
ok('인증통계 = 월요일 9시', job('certstats').hour === 9 && JSON.stringify(job('certstats').days) === '[1]');

// 다음 발송 시각 계산 (요일·시각이 맞는 시점으로 넘어가는지)
const nextAt = (k, from) => new Date(from.getTime() + sched.msUntilNext(job(k), from));
const wed = new Date(2026, 7, 26, 10, 0, 0);          // 2026-08-26 수 10:00
ok('수 10시 → 일일보고는 당일 18시', (() => { const d = nextAt('daily', wed); return d.getDate() === 26 && d.getHours() === 18; })());
ok('수 10시 → 주간보고는 금 18시', (() => { const d = nextAt('weekly', wed); return d.getDay() === 5 && d.getDate() === 28 && d.getHours() === 18; })());
ok('수 10시 → 인증통계는 다음 월 9시', (() => { const d = nextAt('certstats', wed); return d.getDay() === 1 && d.getDate() === 31 && d.getHours() === 9; })());
const friLate = new Date(2026, 7, 28, 19, 0, 0);      // 금 19시 (그날 18시는 이미 지남)
ok('금 19시 → 주간보고는 다음 주 금', (() => { const d = nextAt('weekly', friLate); return d.getDay() === 5 && d.getDate() === 4 && d.getMonth() === 8; })());
const monEarly = new Date(2026, 7, 31, 8, 0, 0);      // 월 8시
ok('월 8시 → 인증통계는 당일 9시', (() => { const d = nextAt('certstats', monEarly); return d.getDate() === 31 && d.getHours() === 9; })());

// 발송 본문은 링크 전용 — 사내 자료가 사외 메일함에 남지 않아야 한다.
const dRep = report.daily(now);
const wRep = report.weekly(now);
const cRep = report.certStats(now);
const mails = [dRep, wRep, cRep];
ok('첨부 없음 (사내 자료 반출 방지)', mails.every((r) => !r.attachments));
ok('세 보고 모두 mailHtml 제공', mails.every((r) => typeof r.mailHtml === 'string' && r.mailHtml.length > 0));

// 픽스처의 민감 값이 메일 본문에 한 글자도 없어야 한다.
const SECRETS = ['KM-100', 'KM-200', 'KM-300', 'KM-400', 'KM-500', '이해찬', 'PL', 'DRM 재생 실패'];
for (const r of mails) {
  const hit = SECRETS.filter((v) => r.mailHtml.includes(v));
  ok(`${r.period} 메일에 모델명·실명·결함코멘트 없음`, hit.length === 0, hit.join(', '));
}
ok('일일 메일에 집계 수치는 포함', dRep.mailHtml.includes('완료') && dRep.mailHtml.includes('Fail'));
ok('통계 메일에 Pass율 포함', cRep.mailHtml.includes('Pass율'));
ok('메일에 대시보드 안내 문구', mails.every((r) => r.mailHtml.includes('대시보드')));
ok('메일에 사내자료 보호 안내', mails.every((r) => r.mailHtml.includes('사내 자료 보호')));

// 화면용 html은 종전대로 상세를 담는다 (사내망에서만 열람)
ok('화면용 html에는 상세 유지', dRep.html.includes('KM-100') || wRep.html.includes('KM-100'));
ok('화면용과 발송용이 다른 본문', mails.every((r) => r.html !== r.mailHtml));

// 수신자 기본값에 개인 Gmail이 없어야 한다
const notifySrc = fs.readFileSync(path.join(__dirname, '..', 'notify.js'), 'utf8');
ok('기본 수신자에 개인 Gmail 없음', !/DEFAULT_REPORT_TO[^;]*gmail\.com/i.test(notifySrc));

// 인증통계 단독 보고는 '지난주' 월~금
const lw = report.lastWorkWeekRange(now);
ok('지난주 월요일 시작', new Date(`${lw.from}T00:00:00`).getDay() === 1, lw.from);
ok('지난주 금요일 종료', new Date(`${lw.to}T00:00:00`).getDay() === 5, lw.to);
ok('이번 주보다 7일 앞', new Date(wk.from) - new Date(lw.from) === 7 * 86400000);
ok('제목에 지난주 기간', cRep.subject.includes(`${lw.from} ~ ${lw.to}`), cRep.subject);
ok('본문에 통계 섹션', cRep.html.includes('모델별 인증 현황'));
ok('본문은 기존 보고 서식(겉틀) 사용', cRep.html.includes('QE 인증 일정 대시보드 자동 생성'));
ok('인증통계 본문에 현황보고 표는 없음', !cRep.html.includes('완료 모델 (Pass / Fail)'));

// ---------- 복사용 본문 (메일 작성창 붙여넣기) ----------
head('복사용 본문');
const copyWk = report.certStatsCopy({ from: wk.from, to: wk.to }, now);
const copyAll = report.certStatsCopy(null, now);
ok('통계 복사본에 대상 주차 표기', copyWk.html.includes(`대상 주차 ${wk.from} ~ ${wk.to}`));
ok('통계 복사본 전체 누적 표기', copyAll.html.includes('대상 기간 전체 누적'));
ok('통계 복사본 제목에 기간', copyWk.subject.includes(`${wk.from} ~ ${wk.to}`), copyWk.subject);
ok('통계 복사본에 통계 표 포함', copyWk.html.includes('모델별 인증 현황'));
ok('전체 누적이 주간보다 판정 건수 많거나 같음',
  repo.certStats(null).totals.judged >= repo.certStats({ from: wk.from, to: wk.to }).totals.judged);

// 주간보고 안의 통계 섹션과 같은 서식이어야 붙여넣기 결과가 동일하다.
ok('주간보고 통계 섹션과 동일 서식', copyWk.html.includes(report.certStatsSection(now, wk)));

// 메일 클라이언트는 <style>·class를 버리므로 복사본은 전부 인라인 스타일이어야 한다.
const copyables = [dRep.html, wRep.html, copyWk.html, copyAll.html];
ok('복사본에 class 속성 없음 (서식 유실 방지)', copyables.every((h) => !/ class=/.test(h)));
ok('복사본에 style 속성 있음', copyables.every((h) => h.includes('style=')));
ok('복사본에 <style> 블록 없음', copyables.every((h) => !h.includes('<style')));

// Outlook 데스크톱은 Word 렌더러라 span·b 같은 인라인 요소의 background 와 border-radius 를
// 버린다. 색이 실리는 조각은 전부 표 셀 + bgcolor 속성이어야 붙여넣기에서 살아남는다.
ok('색 있는 조각에 bgcolor 속성', copyables.every((h) => h.includes('bgcolor=')));
ok('인라인 요소에 background 없음', copyables.every((h) => !/<(span|b)s[^>]*background/.test(h)));
ok('표에 cellspacing 속성 (Word 는 style 로 못 받음)', copyables.every((h) => !h.includes('<table') || h.includes('cellspacing="0"')));

// 인증종류 배지 색은 화면(styles.css .badge-*)과 복사본(report.js CERT_COLORS)에 각각 적힌다.
// 한쪽만 고치면 "붙여넣으면 화면과 색이 다르다"가 되므로 두 값이 같은지 묶어 둔다.
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const certColors = [['netflix', '#fde8e8', '#c0392b'], ['google', '#e8f0fe', '#1a73e8'], ['amazon', '#fff1de', '#c77700']];
ok('인증종류 배지 색이 화면과 동일', certColors.every(([, bg, fg]) => css.includes(bg) && css.includes(fg)));
ok('복사본 인증종류에 배지 색 적용', certColors.some(([, bg]) => copyAll.html.includes('bgcolor="' + bg + '"')));
// Word 는 style 의 color 를 흘릴 수 있어 font 속성과 이중으로 건다.
ok('글자색은 font 속성과 style 이중 지정', copyables.every((h) => /<font color="[^"]+" style="color:/.test(h) || !h.includes('<font')));

// Fail 은 배지(중첩 표)가 아니라 셀 자체를 칠해야 한다. Word 가 중첩 표를 흘리면서
// 안쪽 흰 글씨 지정까지 버려 붙여넣기에서 검은 글씨가 되는 것을 막는다.
ok('Fail 칸은 셀 자체에 빨간 bgcolor', copyAll.html.includes('<td bgcolor="#d23227"'));
ok('Fail 글씨는 흰색', /<td bgcolor="#d23227"[^>]*>s*<b><font color="#ffffff"/.test(copyAll.html));

// 복사본은 화면 그대로(상세 포함) — 발송용 링크 본문과 달라야 한다.
ok('일일 복사본에 모델명 포함', dRep.html.includes('KM-100'));
ok('통계 복사본에 모델명 포함', copyAll.html.includes('KM-100'));
ok('복사본은 발송용 본문과 다름', dRep.html !== dRep.mailHtml && copyWk.html !== cRep.mailHtml);

// 클립보드 경로 회귀 방지. 서버가 인라인 스타일 본문을 잘 만들어도, 클라이언트가 클립보드에
// text/html 을 싣지 않으면 붙여넣기에서 서식이 통째로 날아간다(사내망 http = 비보안 컨텍스트라
// Clipboard API 가 막히고, 뷰포트 밖 요소를 선택해 복사하면 text/plain 만 실릴 수 있다).
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
ok('클립보드에 text/html 직접 지정', appJs.includes("setData('text/html'"));
ok('클립보드에 text/plain 대체본 동봉', appJs.includes("setData('text/plain'"));
ok('텍스트 대체본을 화면에 붙인 요소에서 추출', appJs.includes('withHiddenHolder(html, (h) => h.innerText'));

// ---------- Task 6. 영업일 계산 (주말·공휴일 제외) ----------
head('Task 6-A. 영업일 계산');
const holidays = require('../holidays');

ok('2026-08-28(금)은 영업일', holidays.isBusinessDay('2026-08-28'));
ok('2026-08-29(토)은 영업일 아님', !holidays.isBusinessDay('2026-08-29'));
ok('2026-08-30(일)은 영업일 아님', !holidays.isBusinessDay('2026-08-30'));
ok('2026-01-01(신정)은 영업일 아님', !holidays.isBusinessDay('2026-01-01'));
ok('신정 이름 조회', holidays.holidayName('2026-01-01') === '신정', String(holidays.holidayName('2026-01-01')));
ok('평일 공휴일 아님', holidays.holidayName('2026-08-28') === null);

// 8/28(금) 기준 1번째 영업일은 당일, 2번째는 주말을 건너뛴 8/31(월)
ok('1번째 영업일 = 당일', holidays.nthBusinessDay('2026-08-28', 1) === '2026-08-28', String(holidays.nthBusinessDay('2026-08-28', 1)));
ok('2번째 영업일 = 주말 건너뛴 월요일', holidays.nthBusinessDay('2026-08-28', 2) === '2026-08-31', String(holidays.nthBusinessDay('2026-08-28', 2)));
// 토요일 기준이면 첫 영업일이 월요일로 밀린다
ok('토요일 기준 1번째 영업일 = 월요일', holidays.nthBusinessDay('2026-08-29', 1) === '2026-08-31', String(holidays.nthBusinessDay('2026-08-29', 1)));
// 공휴일을 건너뛰는지 — 12/24(목) 기준 2번째 영업일은 성탄절(12/25 금)을 지나 12/28(월)
ok('공휴일을 건너뛴다', holidays.nthBusinessDay('2026-12-24', 2) === '2026-12-28', String(holidays.nthBusinessDay('2026-12-24', 2)));
ok('slot 0이면 null', holidays.nthBusinessDay('2026-08-28', 0) === null);
ok('음수 slot이면 null', holidays.nthBusinessDay('2026-08-28', -3) === null);
ok('잘못된 날짜면 null', holidays.nthBusinessDay('2026/08/28', 3) === null);

// 등록되지 않은 연도로 넘어가면 화면에 경고를 띄워야 한다 (지어낸 날짜를 확정값처럼 보이지 않게)
// 기준일은 로컬 날짜여야 한다. toISOString()은 UTC라 KST(UTC+9)에서 00:00~09:00에 하루 뒤처진다.
const pad = (n) => String(n).padStart(2, '0');
const localYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
ok('today()는 로컬 날짜', holidays.today() === localYmd(new Date()), holidays.today());
ok('shiftDays(0) = today()', holidays.shiftDays(0) === holidays.today());
ok('shiftDays(-1)은 하루 전', holidays.shiftDays(-1) === localYmd(new Date(Date.now() - 86400000)));
// UTC 경계 재현 — KST 오전 6시는 UTC로 전날 21시다. UTC로 날짜를 뽑으면 하루 뒤처진다.
const boundary = new Date('2026-08-28T21:00:00Z');
if (boundary.getTimezoneOffset() < 0) {          // UTC보다 동쪽(KST 등)에서만 성립
  ok('UTC 방식은 하루 뒤처짐 (재현)', boundary.toISOString().slice(0, 10) === '2026-08-28');
  ok('로컬 방식은 정확 (수정 확인)', localYmd(boundary) === '2026-08-29', localYmd(boundary));
} else {
  ok('UTC 경계 검증 건너뜀 (TZ가 UTC 이서)', true);
  ok('UTC 경계 검증 건너뜀 2', true);
}

ok('등록 연도는 경고 없음', holidays.coverageWarning('2026-12-25') === null);
ok('미등록 연도는 경고 있음', typeof holidays.coverageWarning('2030-01-05') === 'string');
ok('경고에 연도 명시', String(holidays.coverageWarning('2030-01-05')).includes('2030'));

// ---------- Task 6. slot 규칙 ----------
head('Task 6-B. Test Type별 소요 slot');
const resources = require('../resources');
const slots = (cert, type) => resources.slotsOf({ cert_type: cert, test_type: type });

ok('xTS IR = 3 slot', slots('Google xTS', 'IR') === 3, String(slots('Google xTS', 'IR')));
ok('xTS LR = 3 slot', slots('Google xTS', 'LR') === 3, String(slots('Google xTS', 'LR')));
ok('xTS MR = 2 slot', slots('Google xTS', 'MR') === 2, String(slots('Google xTS', 'MR')));
ok('xTS 파생 = 2 slot', slots('Google xTS', '파생') === 2, String(slots('Google xTS', '파생')));
// 구 데이터의 빈 test_type을 2로 세면 물량이 과소평가된다 → 3으로 잡는다
ok('xTS test_type 미입력 = 3 slot (과소평가 방지)', slots('Google xTS', '') === 3, String(slots('Google xTS', '')));
['IR', 'LR', 'MR', '파생', ''].forEach((t) => {
  ok(`NTS ${t || '(빈값)'} = 12 slot`, slots('Netflix NTS', t) === 12, String(slots('Netflix NTS', t)));
});
ok('Amazon AVTS(=지시서 ATVS) = 4 slot', slots('Amazon AVTS', 'IR') === 4, String(slots('Amazon AVTS', 'IR')));
ok('AVTS는 test_type과 무관', slots('Amazon AVTS', '파생') === 4);
// 규칙에 없는 인증종류는 0으로 세지 않고 null → 호출부가 '미정의'로 모은다
ok('규칙 없는 인증종류는 null', slots('알 수 없는 인증', 'IR') === null);
ok('적용 규칙 라벨 — xTS 경량', resources.ruleLabelOf({ cert_type: 'Google xTS', test_type: 'MR' }) === 'xTS (MR, 파생)');
ok('적용 규칙 라벨 — 미정의', resources.ruleLabelOf({ cert_type: '없는 인증', test_type: 'IR' }) === '미정의');

// ---------- Task 6. 담당자별 집계 ----------
head('Task 6-C. 담당자별 리소스 집계');
const AS_OF = '2026-08-28';   // 금요일, 공휴일 아님
const RS = (rows) => resources.summarize(rows, AS_OF);

// 빈 입력: 0 나눗셈·NaN이 새지 않아야 한다
const rsEmpty = RS([]);
ok('빈 입력 총 slot 0', rsEmpty.totals.slots === 0);
ok('빈 입력 소요 주수 0 (NaN 아님)', rsEmpty.totals.weeks_needed === 0, String(rsEmpty.totals.weeks_needed));
ok('빈 입력 소진 예상 0', rsEmpty.totals.days === 0, String(rsEmpty.totals.days));
ok('빈 입력 소진일 null (지어낸 날짜 아님)', rsEmpty.totals.eta === null);
ok('빈 입력에도 담당 4명 행 유지', rsEmpty.rows.length === 4, String(rsEmpty.rows.length));
ok('빈 입력 담당자 순서 고정', rsEmpty.rows.map((r) => r.tester).join(',') === '이은경,조아라,이해찬,문유림');
ok('빈 입력 미정의 없음', rsEmpty.undefined_rules.length === 0);
// 1주 가용은 물량과 무관하게 인원수 × 5로 정해진다 (4명 → 20 slot = 100%)
ok('1주 가용 20 slot (4명 × 5일)', rsEmpty.totals.week_capacity === 20, String(rsEmpty.totals.week_capacity));
ok('1일 가용 4 slot', rsEmpty.totals.daily_capacity === 4);
ok('빈 입력 사용률 0% (NaN 아님)', rsEmpty.totals.usage_pct === 0, String(rsEmpty.totals.usage_pct));
ok('빈 입력 여유 100%', rsEmpty.totals.free_pct === 100, String(rsEmpty.totals.free_pct));
ok('빈 입력 초과 0%', rsEmpty.totals.over_pct === 0);
ok('빈 입력 여유 slot = 가용 전량', rsEmpty.totals.free_slots === 20, String(rsEmpty.totals.free_slots));
ok('빈 입력 소요 주수 0', rsEmpty.totals.weeks_needed === 0);
ok('빈 입력 담당자 여유 = 5 slot', rsEmpty.rows.every((r) => r.free === 5 && r.over === 0), JSON.stringify(rsEmpty.rows.map((r) => r.free)));
ok('빈 입력 담당자 사용률 0%', rsEmpty.rows.every((r) => r.usage_pct === 0));
// 일별 현황: 물량이 없어도 가용 자체는 나와야 한다 (자동 할당이 어디에 넣을지 보는 화면)
ok('빈 입력에도 일별 행 생성', rsEmpty.daily.days.length === 20, String(rsEmpty.daily.days.length));
ok('빈 입력 일별 여유 = 가용 전량', rsEmpty.daily.days.every((d) => d.free === 4 && d.used === 0));
ok('빈 입력 일별 여유 인원 4명', rsEmpty.daily.days.every((d) => d.idle.length === 4));
ok('빈 입력 주 소계 생성', rsEmpty.daily.weeks.length >= 4, String(rsEmpty.daily.weeks.length));
ok('빈 입력 구간 초과 물량 0', rsEmpty.daily.overflow === 0);

// 픽스처: NTS 12(이은경) + xTS IR 3(조아라) + AVTS 4(미배정) + xTS MR 2(김지윤=기타) + 미정의 1건
const OPEN = [
  { id: 1, cert_type: 'Netflix NTS', test_type: 'IR',  model_name: 'RS-100', status: '진행중',   tester: '이은경', plan_date: '2026-08-26' },
  { id: 2, cert_type: 'Google xTS',  test_type: 'IR',  model_name: 'RS-200', status: '예약확정', tester: '조아라', plan_date: '2026-08-27' },
  { id: 3, cert_type: 'Amazon AVTS', test_type: 'LR',  model_name: 'RS-300', status: '예약대기', tester: '',       plan_date: '2026-09-01' },
  { id: 4, cert_type: 'Google xTS',  test_type: 'MR',  model_name: 'RS-400', status: '진행중',   tester: '김지윤', plan_date: '2026-08-28' },
  { id: 5, cert_type: '없는 인증',    test_type: 'IR',  model_name: 'RS-500', status: '예약대기', tester: '이은경', plan_date: '2026-09-02' },
];
const rs = RS(OPEN);
const rowOf = (n) => rs.rows.find((r) => r.tester === n);

ok('미정의 1건 분리', rs.undefined_rules.length === 1, String(rs.undefined_rules.length));
// overall = 두 풀 합. 미정의 건(0 slot 규칙 없음)은 여기서도 빠진다.
ok('전체 물량 21 slot (인증 19 + 기타 2)', rs.overall.slots === 21, String(rs.overall.slots));
ok('전체 건수 4건 (미정의 제외)', rs.overall.count === 4, String(rs.overall.count));
ok('이은경 12 slot (미정의 건 제외)', rowOf('이은경').slots === 12, String(rowOf('이은경').slots));
ok('조아라 3 slot', rowOf('조아라').slots === 3, String(rowOf('조아라').slots));
ok('이해찬 0 slot (건 없어도 행 유지)', rowOf('이해찬').slots === 0);
ok('문유림 0 slot', rowOf('문유림').slots === 0);
ok('미배정 4 slot', rs.unassigned.slots === 4, String(rs.unassigned.slots));

// ---- 두 풀 분리: 기타 물량이 인증 담당 풀의 100%에 섞이면 사용률이 왜곡된다 ----
ok('인증 담당 풀 = 12+3+4 = 19 slot (기타 제외)', rs.totals.slots === 19, String(rs.totals.slots));
ok('인증 담당 풀 3건', rs.totals.count === 3, String(rs.totals.count));
ok('인증 담당 배정분 = 19 - 미배정 4 = 15', rs.totals.assigned_slots === 15, String(rs.totals.assigned_slots));
ok('인증 담당 미배정 4 slot', rs.totals.unassigned_slots === 4);
ok('인증 담당 인원 4명', rs.totals.headcount === 4);

ok('4명 외 테스터는 기타로', rs.others.length === 1 && rs.others[0].tester === '김지윤');
ok('기타 2 slot', rs.others[0].slots === 2, String(rs.others[0].slots));
ok('기타 명단 노출', rs.other_members.join(',') === '김지윤', rs.other_members.join(','));
ok('기타 풀 2 slot · 1건', rs.others_totals.slots === 2 && rs.others_totals.count === 1,
  `${rs.others_totals.slots} slot / ${rs.others_totals.count}건`);
ok('기타 풀 인원 1명 → 1주 가용 5 slot', rs.others_totals.headcount === 1 && rs.others_totals.week_capacity === 5,
  `${rs.others_totals.headcount}명 / ${rs.others_totals.week_capacity} slot`);
ok('기타 풀 사용률 40% (2/5)', rs.others_totals.usage_pct === 40, String(rs.others_totals.usage_pct));
ok('기타 풀 여유 3 slot', rs.others_totals.free_slots === 3, String(rs.others_totals.free_slots));
ok('기타 풀은 미배정 개념 없음', rs.others_totals.unassigned_slots === 0);
// 두 풀 합 = 전체 물량 (어느 쪽에서도 사라지지 않는다)
ok('인증 풀 + 기타 풀 = 전체 물량', rs.totals.slots + rs.others_totals.slots === rs.overall.slots,
  `${rs.totals.slots} + ${rs.others_totals.slots} vs ${rs.overall.slots}`);

// 1 slot = 1명 1일 → 할당 slot 합계가 그 담당자의 소요 영업일수 (변환 계수 1)
ok('소요 영업일 = 할당 slot', rs.rows.every((r) => r.days === r.slots));
// 이은경 12 slot → 8/28(금)부터 12번째 영업일 = 9/14(월)
ok('이은경 예상 소진일 = 12번째 영업일', rowOf('이은경').eta === holidays.nthBusinessDay(AS_OF, 12), String(rowOf('이은경').eta));
ok('건 없는 담당자는 소진일 null', rowOf('이해찬').eta === null);
ok('미배정은 소진일 산출하지 않음', rs.unassigned.eta === null);

// 인증 담당 1주 가용(4명 × 5일 = 20 slot)을 100%로 산정. 풀 소요 19 slot → 95%
ok('1주 가용 20 slot', rs.totals.week_capacity === 20, String(rs.totals.week_capacity));
ok('사용률 95% (19/20)', rs.totals.usage_pct === 95, String(rs.totals.usage_pct));
ok('여유 5% (1 slot)', rs.totals.free_pct === 5 && rs.totals.free_slots === 1,
  `${rs.totals.free_pct}% / ${rs.totals.free_slots} slot`);
ok('100% 미만이면 초과는 0', rs.totals.over_pct === 0 && rs.totals.over_slots === 0);
ok('미배정 = 1주 가용의 20% (4/20)', rs.totals.unassigned_pct === 20, String(rs.totals.unassigned_pct));

// 담당자별 = 1인 주간 가용(5 slot) 대비
ok('담당자 주간 가용 5 slot', rs.rows.every((r) => r.capacity === 5));
ok('이은경 사용률 240% (12/5)', rowOf('이은경').usage_pct === 240, String(rowOf('이은경').usage_pct));
ok('이은경 7 slot 초과', rowOf('이은경').over === 7 && rowOf('이은경').free === 0,
  `over ${rowOf('이은경').over} / free ${rowOf('이은경').free}`);
ok('조아라 사용률 60% (3/5)', rowOf('조아라').usage_pct === 60, String(rowOf('조아라').usage_pct));
ok('조아라 2 slot 여유', rowOf('조아라').free === 2 && rowOf('조아라').over === 0);
ok('이해찬 5 slot 전량 여유', rowOf('이해찬').free === 5);
// 미배정만 사람이 없어 개인 가용 개념이 없다. 기타 테스터는 사람이 있으니 가용을 갖는다.
ok('미배정은 가용 없음(null)', rs.unassigned.capacity === null && rs.unassigned.usage_pct === null);
ok('기타 테스터도 주간 가용 5 slot', rs.others[0].capacity === 5, String(rs.others[0].capacity));
ok('기타 테스터 사용률 40% (2/5)', rs.others[0].usage_pct === 40, String(rs.others[0].usage_pct));
ok('기타 테스터 3 slot 여유', rs.others[0].free === 3 && rs.others[0].over === 0);

// 인증 담당 풀 소진 예상: 4명이 하루 4 slot 소화 → ceil(19/4) = 5 영업일
ok('1일 가용 = 담당 인원수', rs.totals.daily_capacity === 4);
ok('인증 담당 풀 소진 5 영업일', rs.totals.days === 5, String(rs.totals.days));
ok('인증 담당 풀 소진일 = 5번째 영업일', rs.totals.eta === holidays.nthBusinessDay(AS_OF, 5), String(rs.totals.eta));
// 기타 풀은 1명이 하루 1 slot → ceil(2/1) = 2 영업일
ok('기타 풀 소진 2 영업일', rs.others_totals.days === 2, String(rs.others_totals.days));
ok('건별 상세에 적용 규칙 표기', rowOf('이은경').items[0].rule === 'NTS (IR, LR, MR, 파생)');

// ---------- Task 6. 일별 가용 리소스 현황 ----------
head('Task 6-E. 일별 배치와 가용');
const MEMBERS_LIST = resources.MEMBERS;
// AS_OF = 2026-08-28(금). 영업일은 8/28 → 8/31 → 9/1 → 9/2 ...
const dp = rs.daily;
ok('기본 조회 구간 20 영업일', dp.horizon === 20, String(dp.horizon));
ok('첫 영업일이 기준일', dp.days[0].date === AS_OF, dp.days[0].date);
ok('주말을 건너뛴다', dp.days[1].date === '2026-08-31', dp.days[1].date);
ok('요일 표기', dp.days[0].weekday === '금' && dp.days[1].weekday === '월',
  `${dp.days[0].weekday}/${dp.days[1].weekday}`);
ok('일별 가용 = 인원수', dp.days.every((d) => d.capacity === 4));
ok('여유 = 가용 - 사용', dp.days.every((d) => d.free === Math.max(0, d.capacity - d.used)));
ok('사용이 가용을 넘지 않는다 (1인 1일 1slot 직렬)', dp.days.every((d) => d.used <= d.capacity),
  JSON.stringify(dp.days.filter((d) => d.used > d.capacity).map((d) => d.date)));
ok('여유 인원 = 그날 배치 안 된 담당자', dp.days.every((d) => d.idle.length === 4 - d.used));

// 이은경 12 slot(NTS, 계획 8/26 → 과거라 기준일부터) → 8/28부터 12영업일 연속 점유
const eun = (date) => (dp.days.find((d) => d.date === date) || { lane: [] }).lane.some((x) => x.tester === '이은경');
ok('이은경 첫날 점유', eun(AS_OF));
ok('이은경 12영업일째 점유', eun(holidays.nthBusinessDay(AS_OF, 12)));
ok('이은경 13영업일째는 해제', !eun(holidays.nthBusinessDay(AS_OF, 13)));

// 미배정 AVTS 4 slot(계획 9/1) → 가장 빨리 비는 담당자에게 '배정 예정'으로 채워진다
const pendingDays = dp.days.filter((d) => d.pending > 0);
ok('미배정 건이 배정예정으로 채워짐', pendingDays.length === 4, String(pendingDays.length));
ok('배정예정은 계획일(9/1) 이후부터', pendingDays[0].date >= '2026-09-01', pendingDays[0].date);
ok('배정예정은 여유 있는 담당자에게', pendingDays.every((d) => d.lane.filter((x) => x.pending).length === 1));
ok('배정예정 담당자는 이은경이 아니다 (가장 빨리 비는 쪽)',
  pendingDays.every((d) => d.lane.filter((x) => x.pending).every((x) => x.tester !== '이은경')),
  JSON.stringify(pendingDays.map((d) => d.lane.filter((x) => x.pending).map((x) => x.tester))));

// 주 소계: 공휴일이 든 주는 영업일이 줄어 가용도 줄어야 한다
ok('주 소계 가용 = 영업일 × 인원', dp.weeks.every((w) => w.capacity === w.business_days * 4));
ok('주 소계 사용 = 일별 합', dp.weeks.reduce((a, w) => a + w.used, 0) === dp.days.reduce((a, d) => a + d.used, 0));
ok('주 소계 사용률 NaN 아님', dp.weeks.every((w) => Number.isFinite(w.usage_pct)));
const w1 = dp.weeks[0];
ok('첫 주는 8/28 하루뿐 (금요일 기준일)', w1.business_days === 1 && w1.capacity === 4,
  `${w1.business_days}일 / ${w1.capacity} slot`);

// 기타 테스터는 별도 풀이므로 인증 담당 일별에 섞이지 않고, 제외분도 남지 않아야 한다
ok('인증 담당 일별에 기타 테스터 없음', dp.days.every((d) => d.lane.every((x) => MEMBERS_LIST.includes(x.tester))));
ok('인증 담당 풀에 제외분 없음 (풀 분리로 해소)', dp.excluded.slots === 0 && dp.excluded.count === 0,
  `${dp.excluded.count}건 / ${dp.excluded.slots} slot`);

// 배치분 + 구간초과 = 풀 물량 (물량이 조용히 사라지지 않는다)
const placed = dp.days.reduce((a, d) => a + d.used, 0);
ok('배치분 + 구간초과 = 인증 담당 풀 물량', placed + dp.overflow === rs.totals.slots,
  `${placed} + ${dp.overflow} vs ${rs.totals.slots}`);

// 기타 풀 일별 — 별도 가용(인원 1명 = 1 slot/day)이고 자동 할당 대상이 아니다
const odp = rs.others_daily;
ok('기타 풀 일별 생성', odp && odp.days.length === 20, String(odp && odp.days.length));
ok('기타 풀 일별 가용 = 기타 인원 1', odp.days.every((d) => d.capacity === 1));
ok('기타 풀에 배정예정 없음 (자동 할당 대상 아님)', odp.days.every((d) => d.pending === 0));
ok('기타 풀 레인은 기타 테스터만', odp.days.every((d) => d.lane.every((x) => x.tester === '김지윤')));
ok('기타 풀 제외분 없음', odp.excluded.slots === 0);
const oPlaced = odp.days.reduce((a, d) => a + d.used, 0);
ok('기타 배치분 + 구간초과 = 기타 풀 물량', oPlaced + odp.overflow === rs.others_totals.slots,
  `${oPlaced} + ${odp.overflow} vs ${rs.others_totals.slots}`);
ok('두 풀 배치분 합 = 전체 물량',
  placed + dp.overflow + oPlaced + odp.overflow === rs.overall.slots,
  `${placed + dp.overflow} + ${oPlaced + odp.overflow} vs ${rs.overall.slots}`);
// 기타 풀은 인원이 없으면 만들지 않는다
ok('기타 인원 0명이면 기타 일별 null', resources.summarize([], AS_OF, 10).others_daily === null);

// 공휴일이 든 주는 가용이 줄어드는지 — 추석(9/24,9/25,9/28)이 낀 주로 확인
head('Task 6-F. 공휴일이 든 주의 가용 감소');
const chuseok = resources.summarize([], '2026-09-21', 10).daily;   // 9/21(월) 시작
const wkChuseok = chuseok.weeks.find((w) => w.from === '2026-09-21');
ok('추석 주 영업일 3일 (9/21~23)', wkChuseok.business_days === 3, String(wkChuseok.business_days));
ok('추석 주 가용 12 slot (3일 × 4명)', wkChuseok.capacity === 12, String(wkChuseok.capacity));
ok('추석 연휴(9/24·25) 행 없음', !chuseok.days.some((d) => d.date === '2026-09-24' || d.date === '2026-09-25'));
ok('추석 대체공휴일(9/28) 행 없음', !chuseok.days.some((d) => d.date === '2026-09-28'));
ok('9/29(화)는 영업일', chuseok.days.some((d) => d.date === '2026-09-29'));

// 조회 구간 제한: 물량이 구간을 넘으면 overflow로 잡아야 한다 (조용히 버리지 않는다)
// 4명 각각 NTS 12 slot = 48 slot 인데 구간은 5 영업일(가용 20 slot)뿐이다.
const bigLoad = ['이은경', '조아라', '이해찬', '문유림'].map((n, i) => ({
  id: 100 + i, cert_type: 'Netflix NTS', test_type: 'IR', model_name: `BIG-${i}`,
  status: '진행중', tester: n, plan_date: '2026-08-28',
}));
const rsBig = resources.summarize(bigLoad, AS_OF, 5);
ok('구간 5일로 좁히면 초과 물량 발생', rsBig.daily.overflow > 0, String(rsBig.daily.overflow));
ok('좁은 구간에서도 배치분 + 초과 = 전체',
  rsBig.daily.days.reduce((a, d) => a + d.used, 0) + rsBig.daily.overflow === rsBig.totals.slots,
  `${rsBig.daily.days.reduce((a, d) => a + d.used, 0)} + ${rsBig.daily.overflow} vs ${rsBig.totals.slots}`);

// ---------- Task 6. 대시보드 5개 위젯 ----------
// 별도 픽스처로 다섯 지표를 한 번에 검증한다 (DB를 건드리지 않는 순수 함수).
head('Task 6-G. 대시보드 위젯 (가동률·부하·파이프라인·타입·알림)');
const DASH = [
  // 이은경 — NTS 12(진행중, 계획 과거) + xTS IR 3(예약확정, 9/1) = 15 slot → 300% 초과 + 일정 충돌
  { id: 1, cert_type: 'Netflix NTS', test_type: 'IR', model_name: 'D-100', status: '진행중', tester: '이은경', plan_date: '2026-08-26', created_at: '2026-08-01T00:00:00Z' },
  { id: 2, cert_type: 'Google xTS', test_type: 'IR', model_name: 'D-200', status: '예약확정', tester: '이은경', plan_date: '2026-09-01', created_at: '2026-08-10T00:00:00Z' },
  // 미배정 AVTS 4(예약대기, 희망일 경과) → 최장 대기 + 자동 할당 대상
  { id: 3, cert_type: 'Amazon AVTS', test_type: 'LR', model_name: 'D-300', status: '예약대기', tester: '', plan_date: '2026-09-01', desired_date: '2026-08-20', created_at: '2026-07-20T00:00:00Z' },
  // 문유림 — xTS MR 2(진행중, 오늘 시작) → D-2에 리소스 확보
  { id: 4, cert_type: 'Google xTS', test_type: 'MR', model_name: 'D-400', status: '진행중', tester: '문유림', plan_date: '2026-08-28', created_at: '2026-08-25T00:00:00Z' },
];
const ds = resources.summarize(DASH, AS_OF, 20);

// 1. 실시간 가동률 — 1일 총 가용(4) 대비 오늘 점유 중인 확정 업무
const u = ds.utilization;
ok('가동률 기준일 = 기준일', u.date === AS_OF, u.date);
ok('1일 총 가용 = 인원수 4', u.capacity === 4, String(u.capacity));
ok('오늘 점유 2 slot (이은경 NTS + 문유림 xTS)', u.used === 2, String(u.used));
ok('가동률 50%', u.usage_pct === 50, String(u.usage_pct));
ok('잔여 가용 2 slot', u.free === 2, String(u.free));
ok('점유 담당자 = 이은경·문유림', u.busy.join(',') === '이은경,문유림', u.busy.join(','));
ok('여유 담당자 = 조아라·이해찬', u.idle.join(',') === '조아라,이해찬', u.idle.join(','));
// 예약대기는 확정 전이라 가동률에서 빠진다 (D-300은 9/1 계획이라 오늘 자체에도 없음)
ok('오늘 예약대기 점유 0', u.waiting === 0, String(u.waiting));
ok('이번 주 보조 지표 존재', u.week && u.week.label === '8/24~8/28', JSON.stringify(u.week && u.week.label));
// 빈 입력이어도 가용은 나오고 잔여가 전량이어야 한다
const uEmpty = resources.summarize([], AS_OF, 10).utilization;
ok('빈 입력 가동률 0%', uEmpty.usage_pct === 0);
ok('빈 입력 잔여 = 가용 전량 4', uEmpty.free === 4, String(uEmpty.free));
ok('빈 입력 여유 인원 4명', uEmpty.idle.length === 4);
ok('빈 입력 신호 safe', uEmpty.level === 'safe', uEmpty.level);

// 1-b. 100% 초과 표기 — 배치 가동률은 하루 1인 1slot 규칙 때문에 구조적으로 100%를 넘을 수 없다.
// 초과는 '계획 기준 수요(demand)'로만 드러난다. 이것이 빨강 표기의 근거다.
const jam = ['이은경', '조아라', '이해찬', '문유림', '이은경', '조아라'].map((n, i) => ({
  id: 200 + i, cert_type: 'Google xTS', test_type: 'MR', model_name: `J-${i}`,
  status: '진행중', tester: n, plan_date: AS_OF,
}));
const uj = resources.summarize(jam, AS_OF, 10).utilization;
ok('배치 가동률은 100% 이하 유지', uj.usage_pct <= 100, String(uj.usage_pct));
ok('배치 가동률 100% (4명 전원 점유)', uj.usage_pct === 100, String(uj.usage_pct));
ok('계획 수요 6 slot (겹침 허용)', uj.demand === 6, String(uj.demand));
ok('계획 수요 150% — 100% 초과', uj.demand_pct === 150, String(uj.demand_pct));
ok('초과분 2 slot', uj.demand_over === 2, String(uj.demand_over));
ok('중복 배정 담당자 = 이은경·조아라', uj.doubled.slice().sort().join(',') === '이은경,조아라', uj.doubled.join(','));
ok('100% 초과면 빨강(over)', uj.level === 'over', uj.level);
ok('잔여 가용 0 slot', uj.free === 0, String(uj.free));

// 여유가 0이면(가득) 계획 초과가 없어도 빨강 — 신규를 즉시 못 받는 상태다
const full = ['이은경', '조아라', '이해찬', '문유림'].map((n, i) => ({
  id: 300 + i, cert_type: 'Google xTS', test_type: 'MR', model_name: `F-${i}`,
  status: '진행중', tester: n, plan_date: AS_OF,
}));
const uf = resources.summarize(full, AS_OF, 10).utilization;
ok('가득이면 100%', uf.usage_pct === 100 && uf.free === 0);
ok('가득이지만 계획 초과는 없음 (겹침 없음)', uf.demand_over === 0, String(uf.demand_over));
ok('가득도 빨강(over) — 신규 수용 불가', uf.level === 'over', uf.level);

// 80% 경계 — 4명 중 3명 점유 = 75% → safe
const three = ['이은경', '조아라', '이해찬'].map((n, i) => ({
  id: 400 + i, cert_type: 'Google xTS', test_type: 'MR', model_name: `T-${i}`,
  status: '진행중', tester: n, plan_date: AS_OF,
}));
const u3 = resources.summarize(three, AS_OF, 10).utilization;
ok('3/4 = 75% → safe', u3.usage_pct === 75 && u3.level === 'safe', `${u3.usage_pct}% ${u3.level}`);
ok('3/4일 때 잔여 1 slot', u3.free === 1);

// 예약대기는 가동률에도 계획 수요에도 들어가지 않는다 (확정 업무만)
const waitOnly = [{ id: 500, cert_type: 'Netflix NTS', test_type: 'IR', model_name: 'W-1',
  status: '예약대기', tester: '이은경', plan_date: AS_OF }];
const uw = resources.summarize(waitOnly, AS_OF, 10).utilization;
ok('예약대기만 있으면 가동률 0%', uw.usage_pct === 0, String(uw.usage_pct));
ok('예약대기는 계획 수요에도 제외', uw.demand === 0, String(uw.demand));
ok('예약대기는 waiting으로 별도 계상', uw.waiting === 1, String(uw.waiting));
ok('예약대기만이면 신호 safe', uw.level === 'safe', uw.level);

// 데이터 누락이 거짓 과부하로 보이지 않게 함께 알린다
const noPlan = [1, 2, 3, 4, 5].map((i) => ({
  id: 600 + i, cert_type: 'Google xTS', test_type: 'MR', model_name: `NP-${i}`,
  status: '예약확정', tester: ['이은경', '조아라', '이해찬', '문유림', '이은경'][i - 1], plan_date: '',
}));
const unp = resources.summarize(noPlan, AS_OF, 5).utilization;
ok('계획일 미입력 건은 기준일로 계상돼 초과가 뜬다', unp.demand_pct === 125 && unp.level === 'over',
  `${unp.demand_pct}% ${unp.level}`);
ok('계획일 미입력 건수·slot을 함께 알림', unp.no_plan_date.count === 5 && unp.no_plan_date.slots === 10,
  JSON.stringify(unp.no_plan_date));
ok('계획일이 있으면 미입력 경고 없음', resources.summarize(full, AS_OF, 5).utilization.no_plan_date.count === 0);

// 기준일이 휴일이면 다음 영업일로 넘어간다 — 화면이 '오늘'로 오해하지 않게 알린다
const sat = resources.summarize(full, '2026-08-29', 5).utilization;   // 토요일
ok('토요일은 영업일 아님 표시', sat.as_of_is_business_day === false);
ok('토요일 조회 시 기준일이 다음 월요일', sat.date === '2026-08-31', sat.date);
const chu = resources.summarize(full, '2026-09-25', 5).utilization;   // 추석
ok('공휴일은 영업일 아님 표시', chu.as_of_is_business_day === false);
ok('공휴일 이름 노출', chu.as_of_holiday === '추석', String(chu.as_of_holiday));
ok('영업일 조회는 휴무 표시 없음', resources.summarize(full, AS_OF, 5).utilization.as_of_is_business_day === true);

// 2. 팀원별 업무 부하도 (신호등)
const dRow = (n) => ds.rows.find((r) => r.tester === n);
ok('신호등 임계 80/100', ds.load_levels.safe === 80 && ds.load_levels.warn === 100,
  JSON.stringify(ds.load_levels));
ok('이은경 15 slot → 300% → over(초과)', dRow('이은경').usage_pct === 300 && dRow('이은경').level === 'over',
  `${dRow('이은경').usage_pct}% ${dRow('이은경').level}`);
ok('문유림 2 slot → 40% → safe(안정)', dRow('문유림').level === 'safe', dRow('문유림').level);
ok('조아라 0 slot → safe', dRow('조아라').level === 'safe');
// 임계 경계 — 80%(4 slot) safe, 100%(5 slot) warn, 그 위 over
ok('80% 경계는 safe', resources.loadLevelOf(80) === 'safe');
ok('80.1%는 warn', resources.loadLevelOf(80.1) === 'warn');
ok('100% 경계는 warn', resources.loadLevelOf(100) === 'warn');
ok('100.1%는 over', resources.loadLevelOf(100.1) === 'over');
ok('가용 없는 행은 신호등 없음', ds.unassigned.level === null);

// 3. 진행 상태별 파이프라인
const stage = (st) => ds.pipeline.stages.find((x) => x.status === st);
ok('파이프라인 3단계 순서', ds.pipeline.stages.map((x) => x.status).join(',') === '예약대기,예약확정,진행중',
  ds.pipeline.stages.map((x) => x.status).join(','));
ok('예약대기 1건 4 slot', stage('예약대기').count === 1 && stage('예약대기').slots === 4,
  `${stage('예약대기').count}건 ${stage('예약대기').slots} slot`);
ok('예약확정 1건 3 slot', stage('예약확정').count === 1 && stage('예약확정').slots === 3);
ok('진행중 2건 14 slot', stage('진행중').count === 2 && stage('진행중').slots === 14,
  `${stage('진행중').count}건 ${stage('진행중').slots} slot`);
ok('예약대기 중 담당 미정 1건', stage('예약대기').unassigned === 1);
ok('단계별 slot 합 = 풀 물량', ds.pipeline.stages.reduce((a, x) => a + x.slots, 0) === ds.totals.slots,
  `${ds.pipeline.stages.reduce((a, x) => a + x.slots, 0)} vs ${ds.totals.slots}`);
// 최장 대기 — 등록 2026-07-20 → 2026-08-28까지 39일
const waitList = ds.pipeline.longest_waiting;
ok('최장 대기 1건 노출', waitList.length === 1, String(waitList.length));
ok('최장 대기 = D-300', waitList[0].model_name === 'D-300', waitList[0].model_name);
ok('대기 39일 계산', waitList[0].waiting_days === 39, String(waitList[0].waiting_days));
ok('희망일 경과 표시', waitList[0].desired_overdue === true);
ok('최장 대기는 최대 2건', resources.summarize(DASH, AS_OF, 20).pipeline.longest_waiting.length <= 2);

// 4. 인증 타입별 점유 현황
const td = ds.type_distribution;
ok('타입 4종 노출 (건 있는 것만)', td.length === 4, String(td.length));
ok('slot 많은 순 정렬', td[0].label === 'NTS (IR, LR, MR, 파생)' && td[0].slots === 12,
  `${td[0].label} ${td[0].slots}`);
ok('NTS 비중 57.1% (12/21)', td[0].share === 57.1, String(td[0].share));
ok('타입 slot 합 = 풀 물량', td.reduce((a, x) => a + x.slots, 0) === ds.totals.slots,
  `${td.reduce((a, x) => a + x.slots, 0)} vs ${ds.totals.slots}`);
ok('비중 합 ≈ 100%', Math.abs(td.reduce((a, x) => a + x.share, 0) - 100) < 0.5,
  String(td.reduce((a, x) => a + x.share, 0)));
ok('건당 소요 slot 병기', td.find((x) => x.label === 'ATVS').unit_slots === 4);
ok('건 없는 타입은 제외', resources.summarize([], AS_OF, 10).type_distribution.length === 0);

// 5. 스마트 알림
const al = ds.alerts;
ok('초과 할당 경고 = 이은경', al.overloaded.length === 1 && al.overloaded[0].tester === '이은경',
  JSON.stringify(al.overloaded));
// 리소스 충돌 — 직렬 배치는 겹침을 밀어내므로 '계획 일정' 기준으로 판정해야 잡힌다
ok('리소스 충돌 1건 감지', al.conflicts.length === 1, String(al.conflicts.length));
ok('충돌 담당자 = 이은경', al.conflicts[0].tester === '이은경');
ok('충돌 대상 2건 명시', al.conflicts[0].items.length === 2 &&
  al.conflicts[0].items.map((i) => i.model_name).join(',') === 'D-100,D-200',
  JSON.stringify(al.conflicts[0].items.map((i) => i.model_name)));
ok('충돌 중복 일수 산출', al.conflicts[0].overlap_days === 10, String(al.conflicts[0].overlap_days));
// 일정 밀림 — D-200은 계획 9/1인데 이은경 NTS가 안 끝나 9/15로 밀린다
ok('일정 밀림 감지', al.delays.some((d) => d.model_name === 'D-200' && d.delay_days === 10),
  JSON.stringify(al.delays.map((d) => `${d.model_name}:${d.delay_days}`)));
ok('밀림은 최대 5건', al.delays.length <= 5);
// 일정 여유 — 문유림 xTS MR 2 slot이 8/28·8/31 점유 → 9/1(D-2)에 확보
ok('리소스 확보 예정 감지', al.releases.some((r) => r.tester === '문유림' && r.d_day === 2),
  JSON.stringify(al.releases.map((r) => `${r.tester}:D-${r.d_day}`)));
ok('확보 예정은 D-day 순', al.releases.every((r, i) => i === 0 || al.releases[i - 1].d_day <= r.d_day));
ok('확보되는 건과 slot 명시', al.releases[0].model_name === 'D-400' && al.releases[0].slots === 2,
  `${al.releases[0].model_name} ${al.releases[0].slots}`);
ok('알림 건수 합계', al.count === al.conflicts.length + al.delays.length + al.releases.length + al.overloaded.length,
  String(al.count));
// 충돌이 없는 조합에서는 경고도 없어야 한다 (거짓 경보 방지)
const clean = resources.summarize([
  { id: 9, cert_type: 'Google xTS', test_type: 'MR', model_name: 'C-1', status: '진행중', tester: '조아라', plan_date: '2026-08-28' },
], AS_OF, 20);
ok('충돌 없으면 경고 없음', clean.alerts.conflicts.length === 0);
ok('밀림 없으면 경고 없음', clean.alerts.delays.length === 0);
ok('초과 없으면 경고 없음', clean.alerts.overloaded.length === 0);
ok('빈 입력이면 알림 0건', resources.summarize([], AS_OF, 10).alerts.count === 0);

// ---------- Task 6. 진행률 반영 (잔여 slot) ----------
head('Task 6-I. 진행률 반영 — 소화분을 뺀 잔여로 계상');
// 영업일 차이 계산: from 포함, to 제외
ok('영업일 차 — 같은 날은 0', holidays.businessDaysBetween('2026-08-28', '2026-08-28') === 0);
ok('영업일 차 — 금→월은 1 (금 하루)', holidays.businessDaysBetween('2026-08-28', '2026-08-31') === 1,
  String(holidays.businessDaysBetween('2026-08-28', '2026-08-31')));
ok('영업일 차 — 8/31→9/14은 10', holidays.businessDaysBetween('2026-08-31', '2026-09-14') === 10,
  String(holidays.businessDaysBetween('2026-08-31', '2026-09-14')));
ok('영업일 차 — 공휴일 제외 (12/24→12/28은 1)', holidays.businessDaysBetween('2026-12-24', '2026-12-28') === 1,
  String(holidays.businessDaysBetween('2026-12-24', '2026-12-28')));
ok('영업일 차 — 역순이면 0', holidays.businessDaysBetween('2026-09-14', '2026-08-31') === 0);
ok('영업일 차 — 잘못된 날짜면 0', holidays.businessDaysBetween('2026/08/31', '2026-09-14') === 0);

const PG_AS = '2026-09-14';   // 월요일
const pgRows = [
  // NTS 12 slot · 8/31(월) 착수 → 8/31~9/11 = 10 영업일 소화 → 잔여 2
  { id: 1, cert_type: 'Netflix NTS', test_type: 'IR', model_name: 'P-1', status: '진행중', tester: '이은경', plan_date: '2026-08-31', started_date: '2026-08-31' },
  // 오늘 착수 → 소화 0, 잔여 전량
  { id: 2, cert_type: 'Google xTS', test_type: 'IR', model_name: 'P-2', status: '진행중', tester: '조아라', plan_date: PG_AS, started_date: PG_AS },
  // xTS MR 2 slot · 8/24 착수 → 15 영업일 경과 = 예정 13일 초과, 잔여는 1로 유지
  { id: 3, cert_type: 'Google xTS', test_type: 'MR', model_name: 'P-3', status: '진행중', tester: '이해찬', plan_date: '2026-08-24', started_date: '2026-08-24' },
  // 수동 보정 3 → 자동 계산을 이긴다
  { id: 4, cert_type: 'Netflix NTS', test_type: 'LR', model_name: 'P-4', status: '진행중', tester: '문유림', plan_date: '2026-09-01', started_date: '2026-09-01', remaining_slots: '3' },
  // 미착수(예약확정, started_date 없음) → 전량 잔여
  { id: 5, cert_type: 'Amazon AVTS', test_type: 'LR', model_name: 'P-5', status: '예약확정', tester: '이은경', plan_date: '2026-09-21' },
];
const pg = resources.summarize(pgRows, PG_AS, 20);
const pgItem = (m) => [...pg.rows.flatMap((r) => r.items), ...pg.unassigned.items].find((i) => i.model_name === m);

ok('자동 차감 — NTS 12 중 10 소화 → 잔여 2', pgItem('P-1').slots === 2 && pgItem('P-1').consumed === 10,
  `잔여 ${pgItem('P-1').slots} / 소화 ${pgItem('P-1').consumed}`);
ok('계획 소요는 보존 (plan_slots 12)', pgItem('P-1').plan_slots === 12);
ok('진행률 83.3%', pgItem('P-1').progress_pct === 83.3, String(pgItem('P-1').progress_pct));
ok('산출 근거 auto', pgItem('P-1').progress_source === 'auto');

ok('오늘 착수는 소화 0 (당일은 진행 중)', pgItem('P-2').consumed === 0 && pgItem('P-2').slots === 3,
  `소화 ${pgItem('P-2').consumed} / 잔여 ${pgItem('P-2').slots}`);

// 예정 초과 — 잔여를 0으로 만들면 진행중인 건이 리소스에서 조용히 사라진다
ok('예정 초과 시 잔여 최소 1 유지', pgItem('P-3').slots === 1, String(pgItem('P-3').slots));
ok('초과 일수 13일', pgItem('P-3').overrun_days === 13, String(pgItem('P-3').overrun_days));
ok('진행률은 100%로 상한', pgItem('P-3').progress_pct === 100, String(pgItem('P-3').progress_pct));
ok('초과 진행 알림에 포함', pg.alerts.overrun.length === 1 && pg.alerts.overrun[0].model_name === 'P-3',
  JSON.stringify(pg.alerts.overrun.map((o) => o.model_name)));
ok('알림 건수에 초과 진행 반영', pg.alerts.count >= 1);

ok('수동 보정이 자동을 이긴다 (잔여 3)', pgItem('P-4').slots === 3 && pgItem('P-4').progress_source === 'manual',
  `잔여 ${pgItem('P-4').slots} [${pgItem('P-4').progress_source}]`);
ok('수동 보정 시 소화 = 계획 - 잔여', pgItem('P-4').consumed === 9, String(pgItem('P-4').consumed));
ok('수동 보정은 초과 일수 없음', pgItem('P-4').overrun_days === 0);

ok('미착수 건은 전량 잔여', pgItem('P-5').slots === 4 && pgItem('P-5').consumed === 0,
  `잔여 ${pgItem('P-5').slots} / 소화 ${pgItem('P-5').consumed}`);
ok('미착수 산출 근거 none', pgItem('P-5').progress_source === 'none');

// 총계는 잔여 기준이어야 한다 — 그게 '남은 업무량'의 정의다
ok('총계 계획 33 slot (12+3+2+12+4)', pg.totals.plan_slots === 33, String(pg.totals.plan_slots));
ok('총계 잔여 13 slot (2+3+1+3+4)', pg.totals.slots === 13, String(pg.totals.slots));
ok('총계 소화 21 slot (10+0+2+9+0)', pg.totals.consumed_slots === 21, String(pg.totals.consumed_slots));
ok('잔여 + 소화 ≤ 계획 (초과분은 상한 처리)', pg.totals.slots + pg.totals.consumed_slots <= pg.totals.plan_slots + 1,
  `${pg.totals.slots} + ${pg.totals.consumed_slots} vs ${pg.totals.plan_slots}`);
ok('총 진행률 63.6% (21/33)', pg.totals.progress_pct === 63.6, String(pg.totals.progress_pct));
ok('담당자별도 잔여 기준', pg.rows.find((r) => r.tester === '이은경').slots === 6,
  String(pg.rows.find((r) => r.tester === '이은경').slots));   // P-1 잔여 2 + P-5 4

// 일별 배치도 잔여만 점유해야 한다 — 예전에는 과거 착수 건이 오늘부터 전량 재점유했다
const pgDaily = pg.daily;
ok('일별 배치 총합 = 잔여 물량', pgDaily.days.reduce((a, d) => a + d.used, 0) + pgDaily.overflow === pg.totals.slots,
  `${pgDaily.days.reduce((a, d) => a + d.used, 0)} + ${pgDaily.overflow} vs ${pg.totals.slots}`);
// 이은경 P-1은 잔여 2일만 점유하고 3번째 영업일에는 풀린다
const eunBusy = pgDaily.days.map((d) => d.lane.some((x) => x.tester === '이은경'));
ok('과거 착수 건은 잔여 2일만 점유', eunBusy[0] && eunBusy[1], JSON.stringify(eunBusy.slice(0, 4)));

// 진행률 반영 전후 비교 — 같은 데이터에서 착수일을 지우면 물량이 계획 전량으로 돌아간다
const noStart = pgRows.map((r) => ({ ...r, started_date: '', remaining_slots: '' }));
ok('착수일이 없으면 계획 전량이 잔여 (33)',
  resources.summarize(noStart, PG_AS, 20).totals.slots === 33,
  String(resources.summarize(noStart, PG_AS, 20).totals.slots));

// 수동 보정 경계 — 계획보다 크거나 음수면 범위로 잘라낸다
const clamp = (v) => resources.summarize([{ id: 1, cert_type: 'Google xTS', test_type: 'MR',
  model_name: 'C-1', status: '진행중', tester: '이은경', plan_date: PG_AS, remaining_slots: v }], PG_AS, 5)
  .rows.find((r) => r.tester === '이은경').items[0].slots;
ok('수동 보정 상한 = 계획 소요(2)', clamp('9') === 2, String(clamp('9')));
ok('수동 보정 하한 0', clamp('-5') === 0, String(clamp('-5')));
ok('수동 보정 0은 허용 (완료 처리 전 단계)', clamp('0') === 0, String(clamp('0')));
ok('수동 보정 비수치는 무시하고 자동', clamp('abc') === 2, String(clamp('abc')));

// ---------- Task 6. 리소스 산정 대상 조회 ----------
head('Task 6-D. openRequests 대상 필터');
const OPEN_STATUS = ['예약대기', '예약확정', '진행중'];
const openRows = repo.openRequests();
ok('미완 상태만 조회', openRows.every((r) => OPEN_STATUS.includes(r.status)), openRows.map((r) => r.status).join(','));
ok('완료 건 미포함', openRows.every((r) => r.status !== '완료'));
ok('중단·보류 미포함', openRows.every((r) => r.status !== '중단' && r.status !== '보류'));
ok('대표 일정(plan_date) 포함', openRows.every((r) => 'plan_date' in r));
// 실제 DB 픽스처로 돌려도 예외 없이 집계된다 (요약 계약 확인)
const rsLive = resources.summarize(openRows, AS_OF);
ok('실 픽스처 집계 시 담당 4명 행', rsLive.rows.length === 4);
ok('실 픽스처 총 slot이 음수 아님', rsLive.totals.slots >= 0, String(rsLive.totals.slots));
ok('실 픽스처 사용률 NaN 아님', Number.isFinite(rsLive.totals.usage_pct), String(rsLive.totals.usage_pct));
ok('실 픽스처 일별 현황 생성', rsLive.daily.days.length > 0 && rsLive.daily.days.every((d) => d.used <= d.capacity));

// ---------- Task 6-J. 일정 조정 필요 (예약대기 희망 일정 기준) ----------
head('Task 6-J. 일정 조정 필요');
// AS_OF = 2026-08-28(금). NTS/IR = 12 slot, xTS/MR = 2 slot.
const RK = (rows) => resources.summarize(rows, AS_OF, 20).schedule_risks;
const busy = (id, tester, model) => ({
  id, cert_type: 'Netflix NTS', test_type: 'IR', model_name: model,
  status: '진행중', tester, plan_date: AS_OF,
});
const waiting = (id, model, tester, desired) => ({
  id, cert_type: 'Google xTS', test_type: 'MR', model_name: model,
  status: '예약대기', tester: tester || '', plan_date: desired, desired_date: desired,
});

// 1) 아무도 안 바쁘면 희망일에 그대로 들어간다
ok('여유가 있으면 조정 필요 없음', RK([waiting(1, 'KM-100', '', '2026-09-01')]).count === 0);

// 2) 담당자 겹침 — 이은경만 12 slot 점유, 나머지 3명은 비어 있다
const rkBusy = RK([busy(1, '이은경', 'KM-8500'), waiting(2, 'KM-100', '이은경', '2026-09-01')]);
ok('담당자 겹침 1건 감지', rkBusy.count === 1 && rkBusy.tester_busy === 1, JSON.stringify(rkBusy.count));
const rb = rkBusy.items[0];
ok('겹침 사유 = tester_busy', rb.reason === 'tester_busy', rb.reason);
ok('희망일 = desired_date', rb.desired_date === '2026-09-01', rb.desired_date);
ok('가능일이 희망일보다 뒤', rb.available_date > rb.desired_date, `${rb.desired_date}→${rb.available_date}`);
ok('밀린 영업일 수 > 0', rb.delay_days > 0, String(rb.delay_days));
ok('희망일에 비는 담당자 3명', rb.free_testers.length === 3, JSON.stringify(rb.free_testers));
ok('본인은 대안에서 제외', !rb.free_testers.includes('이은경'));
ok('막고 있는 건을 짚는다', rb.blocking && rb.blocking.model_name === 'KM-8500',
  JSON.stringify(rb.blocking));

// 3) 팀 포화 — 4명 전원이 같은 날부터 12 slot 점유
const rkFull = RK([
  ...MEMBERS_LIST.map((t, i) => busy(i + 1, t, `B-${i}`)),
  waiting(9, 'TX-1100', '', '2026-09-01'),
]);
ok('팀 포화 1건 감지', rkFull.count === 1 && rkFull.team_full === 1, JSON.stringify(rkFull));
ok('포화 사유 = team_full', rkFull.items[0].reason === 'team_full', rkFull.items[0].reason);
ok('포화면 대안 담당자 없음', rkFull.items[0].free_testers.length === 0);
ok('미배정 건은 자동 배정 예정 표시', rkFull.items[0].pending === true);

// 4) 대상은 예약대기뿐 — 확정 업무가 밀리는 것은 여기서 다루지 않는다(alerts·delays 소관)
const rkFixed = RK([
  busy(1, '이은경', 'KM-8500'),
  { id: 2, cert_type: 'Google xTS', test_type: 'MR', model_name: 'KM-100',
    status: '예약확정', tester: '이은경', plan_date: '2026-09-01' },
]);
ok('예약확정 건은 대상 아님', rkFixed.count === 0, JSON.stringify(rkFixed.count));

// 5) 정렬 — 희망일이 이른 건이 먼저
const rkSort = RK([
  busy(1, '이은경', 'KM-8500'),
  waiting(2, 'LATE', '이은경', '2026-09-08'),
  waiting(3, 'EARLY', '이은경', '2026-09-01'),
]);
ok('희망일 순 정렬', rkSort.items[0].model_name === 'EARLY',
  rkSort.items.map((r) => r.model_name).join(','));

// 6) 요약 카운트가 목록과 어긋나지 않는다
ok('요약 카운트 = 목록 길이', rkSort.count === rkSort.items.length);
ok('사유별 합 = 전체', rkSort.tester_busy + rkSort.team_full === rkSort.count);
ok('조회 구간을 함께 알린다', rkSort.horizon === 20, String(rkSort.horizon));

// ---------- Task 7. 메인 / 서브 담당 테스터 ----------
// 한 건에 담당자가 2인 이상이면 그 건의 업무량을 인원수로 나눠 각자에게 계상한다(분담).
// 팀 총 물량은 그대로이고 개인 부하와 소요 기간만 갈린다.
head('Task 7-A. 담당자 명단·분담 규칙');
const assignees = require('../assignees');

ok('서브가 없으면 메인 한 명', assignees.listOf({ tester: '이은경', tester_sub: '' }).join(',') === '이은경');
ok('메인 + 서브 순서 유지', assignees.listOf({ tester: '이은경', tester_sub: '조아라' }).join(',') === '이은경,조아라');
ok('서브 여러 명 (콤마 구분)',
  assignees.listOf({ tester: '이은경', tester_sub: '조아라, 이해찬' }).join(',') === '이은경,조아라,이해찬');
ok('공백·빈 조각은 버린다',
  assignees.listOf({ tester: '이은경', tester_sub: ' 조아라 , , ' }).join(',') === '이은경,조아라');
// 같은 사람이 메인·서브에 겹쳐 들어오면 부하가 두 번 잡히고 분담 몫도 실제보다 작아진다
ok('메인이 서브에 또 들어와도 한 번만',
  assignees.listOf({ tester: '이은경', tester_sub: '이은경, 조아라' }).join(',') === '이은경,조아라');
ok('서브끼리 중복도 한 번만',
  assignees.listOf({ tester: '이은경', tester_sub: '조아라, 조아라' }).join(',') === '이은경,조아라');
ok('담당자가 없으면 빈 배열', assignees.listOf({ tester: '', tester_sub: '' }).length === 0);
// 메인이 비고 서브만 있는 비정상 입력도 담당자로는 세어야 리소스에서 사라지지 않는다
ok('메인이 비어도 서브는 담당자', assignees.listOf({ tester: '', tester_sub: '조아라' }).join(',') === '조아라');

ok('12 slot 2인 → 6/6', assignees.split(12, 2).join(',') === '6,6');
ok('홀수는 메인이 하나 더 (3 slot 2인 → 2/1)', assignees.split(3, 2).join(',') === '2,1');
ok('4 slot 3인 → 2/1/1', assignees.split(4, 3).join(',') === '2,1,1');
ok('단독이면 전량', assignees.split(12, 1).join(',') === '12');
ok('0 slot도 NaN 없이 0', assignees.split(0, 2).join(',') === '0,0');
// 분담 때문에 팀 총 물량이 늘거나 줄면 모든 집계가 틀어진다
[[12, 2], [3, 2], [4, 3], [7, 4], [1, 3], [2, 5]].forEach(([total, n]) => {
  ok(`분담 합 = 원래 물량 (${total} slot ${n}인)`,
    assignees.split(total, n).reduce((a, b) => a + b, 0) === total,
    assignees.split(total, n).join(','));
});

head('Task 7-B. 분담이 실시간 리소스 가동률에 잡히는가');
const SUB_AS = '2026-08-28';   // 금요일, 공휴일 아님
const nts = (extra) => [{
  id: 1, cert_type: 'Netflix NTS', test_type: 'IR', model_name: 'SUB-100',
  status: '진행중', tester: '이은경', plan_date: SUB_AS, ...extra,
}];
const solo = resources.summarize(nts({ tester_sub: '' }), SUB_AS, 20);
const duo = resources.summarize(nts({ tester_sub: '조아라' }), SUB_AS, 20);
const who = (rs, n) => rs.rows.find((r) => r.tester === n);

ok('단독이면 메인이 12 slot 전량', who(solo, '이은경').slots === 12, String(who(solo, '이은경').slots));
ok('단독이면 서브 후보는 0 slot', who(solo, '조아라').slots === 0);
ok('2인이면 메인 6 slot', who(duo, '이은경').slots === 6, String(who(duo, '이은경').slots));
ok('2인이면 서브 6 slot', who(duo, '조아라').slots === 6, String(who(duo, '조아라').slots));
// 분담은 나누는 것이지 늘리는 것이 아니다 — 팀 총량과 건수는 그대로여야 한다
ok('팀 총 slot 불변 (12)', duo.totals.slots === solo.totals.slots && duo.totals.slots === 12,
  `${duo.totals.slots} vs ${solo.totals.slots}`);
ok('의뢰 건수 불변 (1건)', duo.totals.count === 1, String(duo.totals.count));
ok('전체 물량도 1건 12 slot', duo.overall.count === 1 && duo.overall.slots === 12,
  `${duo.overall.count}건 / ${duo.overall.slots} slot`);
ok('파이프라인 건수도 1건', duo.pipeline.stages.find((x) => x.status === '진행중').count === 1);
ok('타입 분포 건수도 1건', duo.type_distribution[0].count === 1, String(duo.type_distribution[0].count));

// 소요 기간 — 12영업일이 6영업일로 준다. 이것이 분담을 쓰는 이유다.
ok('단독 소진 12영업일', who(solo, '이은경').eta === holidays.nthBusinessDay(SUB_AS, 12), String(who(solo, '이은경').eta));
ok('2인 소진 6영업일', who(duo, '이은경').eta === holidays.nthBusinessDay(SUB_AS, 6), String(who(duo, '이은경').eta));
ok('2인이면 서브도 같은 소진일', who(duo, '조아라').eta === who(duo, '이은경').eta);

// ---- 요청 2번의 핵심: 실시간 리소스 가동률에 두 사람이 모두 잡혀야 한다 ----
ok('단독이면 오늘 1명 점유', solo.utilization.used === 1, String(solo.utilization.used));
ok('2인이면 오늘 2명 점유', duo.utilization.used === 2, String(duo.utilization.used));
ok('가동률 25% → 50%', solo.utilization.usage_pct === 25 && duo.utilization.usage_pct === 50,
  `${solo.utilization.usage_pct}% → ${duo.utilization.usage_pct}%`);
ok('점유 인원에 서브 포함', duo.utilization.busy.includes('이은경') && duo.utilization.busy.includes('조아라'),
  duo.utilization.busy.join(','));
ok('서브는 여유 인원에서 빠진다', !duo.utilization.idle.includes('조아라'), duo.utilization.idle.join(','));
ok('여유 slot도 2 줄어든다', duo.utilization.free === 2 && solo.utilization.free === 3,
  `${duo.utilization.free} / ${solo.utilization.free}`);
// 일별 배치 — 6영업일 동안 둘이 나란히 점유하고 7일째 함께 풀린다
const busyOn = (rs, n, k) => (rs.daily.days.find((d) => d.date === holidays.nthBusinessDay(SUB_AS, k)) || { lane: [] })
  .lane.some((x) => x.tester === n);
ok('6영업일째 둘 다 점유', busyOn(duo, '이은경', 6) && busyOn(duo, '조아라', 6));
ok('7영업일째 둘 다 해제', !busyOn(duo, '이은경', 7) && !busyOn(duo, '조아라', 7));

head('Task 7-C. 분담 몫 나누기 (홀수·3인·기타 풀·중복)');
const share = (rows) => resources.summarize(rows, SUB_AS, 20);
const odd = share([{
  id: 1, cert_type: 'Google xTS', test_type: 'IR', model_name: 'SUB-200',
  status: '예약확정', tester: '이은경', tester_sub: '조아라', plan_date: SUB_AS,
}]);
ok('3 slot 2인 → 메인 2', odd.rows.find((r) => r.tester === '이은경').slots === 2,
  String(odd.rows.find((r) => r.tester === '이은경').slots));
ok('3 slot 2인 → 서브 1', odd.rows.find((r) => r.tester === '조아라').slots === 1,
  String(odd.rows.find((r) => r.tester === '조아라').slots));
ok('홀수 분담도 합은 3 slot', odd.totals.slots === 3, String(odd.totals.slots));

const trio = share([{
  id: 1, cert_type: 'Netflix NTS', test_type: 'IR', model_name: 'SUB-300',
  status: '진행중', tester: '이은경', tester_sub: '조아라, 이해찬', plan_date: SUB_AS,
}]);
ok('3인 분담 4/4/4', ['이은경', '조아라', '이해찬']
  .every((n) => trio.rows.find((r) => r.tester === n).slots === 4),
  trio.rows.map((r) => `${r.tester}:${r.slots}`).join(','));
ok('3인이어도 팀 총량 12 slot', trio.totals.slots === 12, String(trio.totals.slots));
ok('3인 모두 오늘 점유', trio.utilization.used === 3, String(trio.utilization.used));

// 메인이 서브에 또 적혀 있으면 그 사람 부하가 두 배로 잡힌다 — 명단 단계에서 막는다
const dup = share(nts({ tester_sub: '이은경' }));
ok('메인 중복 입력은 단독과 같다', dup.rows.find((r) => r.tester === '이은경').slots === 12,
  String(dup.rows.find((r) => r.tester === '이은경').slots));
ok('메인 중복 입력해도 총량 12 slot', dup.totals.slots === 12, String(dup.totals.slots));

// 메인이 인증 담당, 서브가 기타 테스터면 한 건의 몫이 두 풀에 갈린다
const mixed = share(nts({ tester_sub: '김지윤' }));
ok('기타 테스터 서브는 기타 풀로', mixed.other_members.join(',') === '김지윤', mixed.other_members.join(','));
ok('인증 담당 풀은 메인 몫 6 slot', mixed.totals.slots === 6, String(mixed.totals.slots));
ok('기타 풀은 서브 몫 6 slot', mixed.others_totals.slots === 6, String(mixed.others_totals.slots));
ok('두 풀 합 = 원래 12 slot', mixed.totals.slots + mixed.others_totals.slots === 12);
ok('두 풀 모두 같은 1건으로 센다', mixed.totals.count === 1 && mixed.others_totals.count === 1,
  `${mixed.totals.count} / ${mixed.others_totals.count}`);

head('Task 7-E. 기준 인원(4명)을 넘긴 실인원 과부하 표시');
// 인증 담당 4명이 각자 단독 건으로 오늘 전원 점유되고, 기타 풀도 1명 함께 뛰는 상황.
// slot·가동률 집계는 풀을 안 섞지만, "오늘 실제로 몇 명이 뛰는가"는 기준 4명을 넘겨 알려야 한다.
const fullTeam = ['이은경', '조아라', '이해찬', '문유림'].map((n, i) => ({
  id: i + 1, cert_type: 'Google xTS', test_type: 'MR', model_name: `HC-${i}`,
  status: '진행중', tester: n, plan_date: SUB_AS,
}));
const withOther = share([...fullTeam, {
  id: 5, cert_type: 'Google xTS', test_type: 'MR', model_name: 'HC-4',
  status: '진행중', tester: '조진원', plan_date: SUB_AS,
}]);
const noOther = share(fullTeam);
ok('기타 없이 4명이면 기준 그대로', noOther.utilization.total_used === 4 && noOther.utilization.total_pct === 100,
  `${noOther.utilization.total_used} / ${noOther.utilization.total_pct}%`);
ok('기타 없이 4명이면 초과 아님', noOther.utilization.total_over === 0);
ok('기타 1명 합류하면 실인원 5명', withOther.utilization.total_used === 5, String(withOther.utilization.total_used));
ok('실인원 가동률 125%', withOther.utilization.total_pct === 125, String(withOther.utilization.total_pct));
ok('기준 대비 1명 초과', withOther.utilization.total_over === 1, String(withOther.utilization.total_over));
ok('기타 점유 인원 명단에 노출', withOther.utilization.other_busy.join(',') === '조진원',
  withOther.utilization.other_busy.join(','));
ok('인증 담당 풀 자체 used는 그대로 4', withOther.utilization.used === 4, String(withOther.utilization.used));
ok('실인원 초과는 level을 over로 올린다', withOther.utilization.level === 'over', withOther.utilization.level);

// 분담 건이 '건' 단위 경고에서 인원수만큼 중복되면 안 된다
const risky = share([
  { id: 1, cert_type: 'Netflix NTS', test_type: 'IR', model_name: 'BLOCK', status: '진행중',
    tester: '이은경', tester_sub: '조아라', plan_date: SUB_AS },
  { id: 2, cert_type: 'Google xTS', test_type: 'IR', model_name: 'LATE', status: '예약대기',
    tester: '이은경', tester_sub: '조아라', desired_date: SUB_AS, plan_date: SUB_AS },
]);
ok('밀린 분담 건은 1건으로', risky.schedule_risks.count === 1, String(risky.schedule_risks.count));
ok('일정 조정 목록에 중복 없음', risky.schedule_risks.items.filter((r) => r.id === 2).length === 1,
  String(risky.schedule_risks.items.length));
ok('지연 목록에도 중복 없음', risky.alerts.delays.filter((r) => r.id === 2).length === 1,
  risky.alerts.delays.map((r) => `${r.id}/${r.tester}`).join(','));

head('Task 7-D. 서브 담당자 저장·이력·집계');
const subReq = repo.create({
  cert_type: 'Netflix NTS', test_type: 'IR', model_name: 'SUB-DB', test_purpose: '3PL',
  requester: 'PL', tester: '이은경', tester_sub: '조아라',
}, '테스트');
ok('등록 시 서브 저장', subReq.tester_sub === '조아라', String(subReq.tester_sub));
ok('메인은 그대로', subReq.tester === '이은경');
const subUpd = repo.update(subReq.id, { tester_sub: '조아라, 이해찬' }, '테스트');
ok('수정 시 서브 갱신', subUpd.tester_sub === '조아라, 이해찬', String(subUpd.tester_sub));
ok('변경 이력에 서브 테스터 라벨',
  repo.history(subReq.id).some((h) => String(h.detail).includes('서브 테스터')),
  repo.history(subReq.id).map((h) => h.detail).join(' | '));
// 서브를 비우는 것도 수정이다 — 지워지지 않으면 부하가 계속 남는다
ok('서브를 비울 수 있다', repo.update(subReq.id, { tester_sub: '' }, '테스트').tester_sub === '');

const subOpen = repo.create({
  cert_type: 'Google xTS', test_type: 'IR', model_name: 'SUB-OPEN', test_purpose: '3PL',
  requester: 'PL', tester: '이은경', tester_sub: '조아라',
}, '테스트');
ok('openRequests가 서브를 넘긴다',
  (repo.openRequests().find((r) => r.id === subOpen.id) || {}).tester_sub === '조아라');
// 요약 위젯의 테스터 부하도 리소스 화면과 같은 인원을 가리켜야 한다
ok('테스터 부하에 서브 포함', (repo.stats().testerLoad['조아라'] || 0) > 0,
  JSON.stringify(repo.stats().testerLoad));
repo.remove(subReq.id, '테스트');
repo.remove(subOpen.id, '테스트');

// ---------- 스케줄러 자동발송이 실제로 넘기는 본문 ----------
// report.js의 mailHtml만 검증하면 스케줄러가 r.html을 넘겨도 통과한다. 호출 인자를 직접 가로채 확인한다.
head('스케줄러 자동발송 본문');
const notify = require('../notify');
const origSend = notify.sendReportMail;
const sent = [];
notify.sendReportMail = async (subject, html) => { sent.push({ subject, html }); };


// ---------- Confluence 제목·담당자·날짜 파싱 ----------
head('Confluence 제목 파싱 (지시서 §4)');
const cparse = require('../confluence-parse');

const ex1 = cparse.parseTitle('[xTS][Pre] O2_KSTB7268] 1st > Passed');
ok('예시1 인증종류 Google xTS', ex1.cert_type === 'Google xTS', ex1.cert_type);
ok('예시1 Test 목적 Pre-Test', ex1.test_purpose === 'Pre-Test', ex1.test_purpose);
ok('예시1 Test type 없음', ex1.test_type === '', ex1.test_type);
ok('예시1 모델명 O2_KSTB7268 (짝 없는 ] 제거)', ex1.model_name === 'O2_KSTB7268', ex1.model_name);
ok('예시1 회차 1 (1st → 1)', ex1.round === '1', ex1.round);
ok('예시1 상태 완료 · 판정 Pass', ex1.status === '완료' && ex1.verdict === 'Pass', `${ex1.status}/${ex1.verdict}`);
ok('예시1 경고 없음', ex1.warnings.length === 0, ex1.warnings.join(' | '));

const ex2 = cparse.parseTitle('[xTS][IR][Pre-test] O2_KSTB7268 > In-Progress');
ok('예시2 Test type IR', ex2.test_type === 'IR', ex2.test_type);
ok('예시2 Test 목적 Pre-Test', ex2.test_purpose === 'Pre-Test', ex2.test_purpose);
ok('예시2 회차 없음', ex2.round === '', ex2.round);
ok('예시2 상태 진행중 · 판정 없음', ex2.status === '진행중' && ex2.verdict === '', `${ex2.status}/${ex2.verdict}`);
ok('예시2 경고 없음', ex2.warnings.length === 0, ex2.warnings.join(' | '));

ok('NTS → Netflix NTS', cparse.parseTitle('[NTS][MR] KM-100 2nd > Failed').cert_type === 'Netflix NTS');
ok('AVTS → Amazon AVTS', cparse.parseTitle('[AVTS][양산] KM-300 > Passed').cert_type === 'Amazon AVTS');
ok('소문자 인증종류도 받는다', cparse.parseTitle('[nts] KM-100 > Passed').cert_type === 'Netflix NTS');
ok('Failed → 완료 · Fail', (() => { const r = cparse.parseTitle('[NTS] KM-100 > Failed'); return r.status === '완료' && r.verdict === 'Fail'; })());
ok('Dropped → 중단 · Drop', (() => { const r = cparse.parseTitle('[NTS] KM-100 > Dropped'); return r.status === '중단' && r.verdict === 'Drop'; })());
ok('3차 표기도 회차로 읽는다', cparse.parseTitle('[NTS][3PL] KM-100 3차 > Passed').round === '3');
ok('[MR] 단독은 Test type', cparse.parseTitle('[xTS][MR] KM-100 > Passed').test_type === 'MR');
ok('[IR][MR]이면 MR은 Test 목적으로 내려간다', (() => { const r = cparse.parseTitle('[xTS][IR][MR] KM-100 > Passed'); return r.test_type === 'IR' && r.test_purpose === 'MR'; })());

// 해석 못한 값은 경고로 남기고 필드를 비운다 (조용히 틀린 값을 넣지 않는다)
const unknownCert = cparse.parseTitle('[ZZZ][Pre] KM-100 > Passed');
ok('알 수 없는 인증종류는 비우고 경고', unknownCert.cert_type === '' && unknownCert.warnings.some((w) => w.includes('인증종류')));
const noGt = cparse.parseTitle('[xTS][Pre] KM-100 1st');
ok("'>' 없으면 상태 비우고 경고", noGt.status === '' && noGt.warnings.some((w) => w.includes("'>'")));
ok("'>' 없어도 모델명·회차는 읽는다", noGt.model_name === 'KM-100' && noGt.round === '1');
const badStatus = cparse.parseTitle('[xTS] KM-100 > 어쩌구');
ok('모르는 상태는 비우고 경고', badStatus.status === '' && badStatus.warnings.some((w) => w.includes('상태를 알 수 없습니다')));
const badTag = cparse.parseTitle('[xTS][이상한값] KM-100 > Passed');
ok('분류 못한 대괄호는 경고', badTag.warnings.some((w) => w.includes('분류하지 못한')));
const junk = cparse.parseTitle('[xTS] KM-100 1st 잡토큰 > Passed');
ok('모델명 뒤 잡토큰은 경고', junk.warnings.some((w) => w.includes('해석하지 못한')));
ok('빈 제목은 경고', cparse.parseTitle('').warnings.length > 0);
ok('대괄호 없는 제목은 경고', cparse.parseTitle('KM-100 > Passed').warnings.some((w) => w.includes('대괄호')));

head('Confluence 담당자·날짜 파싱 (지시서 §3)');
ok('한글 성명 추출', cparse.parsePerson('Haechan.lee 이해찬 (haechan)').name === '이해찬');
const idOnly = cparse.parsePerson('Haechan.lee (haechan)');
ok('한글 없으면 괄호 ID + 경고', idOnly.name === 'haechan' && idOnly.warnings.length === 1, idOnly.name);
ok('괄호도 없으면 첫 토큰 + 경고', cparse.parsePerson('haechan.lee').name === 'haechan.lee');
ok('빈 담당자는 경고', cparse.parsePerson('').warnings.length === 1);

ok("'2026. 9. 7.' → 2026-09-07", cparse.parseDate('2026. 9. 7.').date === '2026-09-07');
ok("'2026.09.07' → 2026-09-07", cparse.parseDate('2026.09.07').date === '2026-09-07');
ok('ISO 날짜는 그대로', cparse.parseDate('2026-09-07').date === '2026-09-07');
ok('ISO 날짜시각은 로컬 날짜로 환산', cparse.parseDate('2026-09-07T15:00:00Z').date === ymd(new Date('2026-09-07T15:00:00Z')));
ok('빈 날짜는 경고 없이 빈 값', (() => { const r = cparse.parseDate(''); return r.date === '' && r.warnings.length === 0; })());
ok('해석 불가 날짜는 경고', (() => { const r = cparse.parseDate('내일'); return r.date === '' && r.warnings.length === 1; })());

// ---------- Confluence 필드 매핑 · 동기화 Upsert ----------
// 주의: 이 섹션은 공용 임시 DB에 레코드를 만든다. 위쪽 보고 본문 비교 테스트는 앞서 떠 둔
// 스냅숏(dRep 등)과 재생성 본문을 문자열로 맞춰 보므로, 섹션 끝에서 만든 레코드를 전부 지운다.
head('Confluence 필드 매핑 (지시서 §3)');
const csync = require('../confluence-sync');

const ev1 = {
  id: 'evt-1001',
  title: '[xTS][IR][Pre-test] O2_KSTB7268 > In-Progress',
  invitees: 'Haechan.lee 이해찬 (haechan)',
  start: '2026. 9. 7.',
  end: '2026. 9. 9.',
  relatedPage: 'https://jira.kaonmedia.com/browse/KG25040-492',
  created: '2026-09-07',
};
const RANGE = { from: '2026-09-01', to: '2026-09-30' };

const m1 = csync.mapEvent(ev1);
ok('인증종류 매핑', m1.fields.cert_type === 'Google xTS', m1.fields.cert_type);
ok('모델명 매핑', m1.fields.model_name === 'O2_KSTB7268', m1.fields.model_name);
ok('담당 테스터는 한글 성명', m1.fields.tester === '이해찬', m1.fields.tester);
ok('시작 → 시작일', m1.fields.started_date === '2026-09-07', m1.fields.started_date);
ok('종료 → 완료일', m1.fields.completed_date === '2026-09-09', m1.fields.completed_date);
ok('관련 페이지 → 비고', m1.fields.note === 'https://jira.kaonmedia.com/browse/KG25040-492', m1.fields.note);
ok('이벤트 생성일자 → 희망일정', m1.fields.desired_date === '2026-09-07', m1.fields.desired_date);
ok('예약확정일은 아예 매핑하지 않는다', !('scheduled_date' in m1.fields));
ok('매핑 경고 없음', m1.warnings.length === 0, m1.warnings.join(' | '));

const withLookup = csync.mapEvent(ev1, { lookupRequester: (model) => (model === 'O2_KSTB7268' ? '김개발' : '') });
ok('모델명-의뢰자 룩업 적용', withLookup.fields.requester === '김개발', withLookup.fields.requester);
const noLookup = csync.mapEvent(ev1, { lookupRequester: () => '' });
ok('룩업 미등록 모델은 경고', noLookup.warnings.some((w) => w.includes('모델명-의뢰자 매핑에 없는')));
ok('룩업 미등록이면 의뢰자를 비운다', !noLookup.fields.requester);

head('Confluence 동기화 Upsert (빈 칸만 채우기)');
const s1 = csync.syncEvents([ev1], { range: RANGE });
ok('신규 이벤트는 생성', s1.created === 1 && s1.updated === 0, JSON.stringify(s1));
const r1 = repo.getByConfluenceEventId('evt-1001');
ok('이벤트 id가 레코드에 남는다', r1 && r1.confluence_event_id === 'evt-1001');
ok('생성 시 상태는 제목에서 온다', r1.status === '진행중', r1.status);
ok('생성 시 담당 테스터가 들어간다', r1.tester === '이해찬', r1.tester);
ok('생성 이력의 작업자는 동기화', repo.history(r1.id).some((h) => h.actor === csync.ACTOR));

const s2 = csync.syncEvents([ev1], { range: RANGE });
ok('같은 이벤트 재동기화는 변경 없음', s2.unchanged === 1 && s2.created === 0, JSON.stringify(s2));

// 사람이 고친 칸은 덮지 않는다
repo.update(r1.id, { tester: '조아라', scheduled_date: '2026-09-08', progress: '1차 확인 완료' }, '테스터');
const s3 = csync.syncEvents([ev1], { range: RANGE });
const r1b = repo.getByConfluenceEventId('evt-1001');
ok('사람이 바꾼 담당 테스터를 유지', r1b.tester === '조아라', r1b.tester);
ok('사람이 넣은 예약확정일을 유지', r1b.scheduled_date === '2026-09-08', r1b.scheduled_date);
ok('사람이 쓴 진행사항을 유지', r1b.progress === '1차 확인 완료', r1b.progress);
ok('덮을 게 없으면 변경 없음으로 집계', s3.unchanged === 1, JSON.stringify(s3));

// 비어 있던 칸은 채운다 — In-Progress → Passed 로 바뀌면 판정이 들어온다
const ev1pass = { ...ev1, title: '[xTS][IR][Pre-test] O2_KSTB7268 3차 > Passed' };
const s4 = csync.syncEvents([ev1pass], { range: RANGE });
const r1c = repo.getByConfluenceEventId('evt-1001');
ok('비어 있던 판정은 채운다', r1c.verdict === 'Pass', r1c.verdict);
ok('비어 있던 회차는 채운다', r1c.round === '3', r1c.round);
ok('이미 값이 있는 상태는 그대로 (결정의 결과)', r1c.status === '진행중', r1c.status);
ok('채운 건은 수정으로 집계', s4.updated === 1, JSON.stringify(s4));

// 상태 기본값 '예약대기'는 사람이 고른 값이 아니므로 빈 칸으로 본다
const ev2 = { id: 'evt-1002', title: '[NTS][MR] KM-900', invitees: '이은경', start: '', end: '', relatedPage: '', created: '2026-09-08' };
csync.syncEvents([ev2]);
const r2 = repo.getByConfluenceEventId('evt-1002');
ok("'>' 없는 제목은 기본 상태로 생성", r2.status === '예약대기', r2.status);
csync.syncEvents([{ ...ev2, title: '[NTS][MR] KM-900 > Passed' }]);
const r2b = repo.getByConfluenceEventId('evt-1002');
ok('기본 상태는 동기화가 덮는다', r2b.status === '완료', r2b.status);
ok('덮을 때 판정도 함께 들어온다', r2b.verdict === 'Pass', r2b.verdict);

// 파싱 실패 건은 빈 의뢰를 만들지 않고 건너뛴다
const bad = csync.syncEvents([{ id: 'evt-1003', title: '[ZZZ] > Passed' }]);
ok('인증종류·모델명을 못 읽으면 건너뛴다', bad.skipped === 1 && bad.created === 0, JSON.stringify(bad));
ok('건너뛴 이유를 경고로 남긴다', bad.warnings.some((w) => w.includes('파싱하지 못했습니다')));
ok('건너뛴 이벤트는 레코드가 없다', !repo.getByConfluenceEventId('evt-1003'));
const noId = csync.syncEvents([{ title: '[xTS][Pre] KM-901 > Passed' }]);
ok('이벤트 id가 없으면 건너뛴다', noId.skipped === 1 && noId.created === 0, JSON.stringify(noId));

head('Confluence 삭제 이벤트 → 중단 보관');
// 완료된 건은 되돌리지 않는다
const ev3 = { id: 'evt-1004', title: '[AVTS][양산] KM-902 > Passed', invitees: '문유림', start: '2026-09-10', end: '2026-09-10', relatedPage: '', created: '2026-09-10' };
csync.syncEvents([ev3]);
ok('완료 상태로 생성', repo.getByConfluenceEventId('evt-1004').status === '완료');

const s5 = csync.syncEvents([], { range: RANGE });
ok('사라진 이벤트는 중단으로 보관', repo.getByConfluenceEventId('evt-1001').status === '중단');
ok('레코드를 지우지는 않는다', !!repo.getByConfluenceEventId('evt-1001'));
ok('완료 건은 중단으로 바꾸지 않는다', repo.getByConfluenceEventId('evt-1004').status === '완료');
ok('중단 처리 건수를 집계', s5.cancelled === 1, String(s5.cancelled));
ok('중단 이력의 작업자는 동기화', repo.history(repo.getByConfluenceEventId('evt-1001').id).some((h) => h.actor === csync.ACTOR && String(h.detail).includes('중단')));

const s6 = csync.syncEvents([], { range: RANGE });
ok('이미 중단된 건은 다시 건드리지 않는다', s6.cancelled === 0, String(s6.cancelled));

const s7 = csync.syncEvents([ev1]);
ok('조회 기간이 없으면 삭제 반영을 건너뛴다', s7.cancelled === 0 && s7.warnings.some((w) => w.includes('조회 기간이 없어')));
let threw = '';
try { csync.cancelMissing([], {}); } catch (e) { threw = e.message; }
ok('기간 없이 삭제 반영을 직접 호출하면 거부', threw.includes('조회 기간'), threw);

// 섹션 정리 — 위 보고 본문 스냅숏 비교가 깨지지 않게 동기화로 만든 레코드를 전부 지운다.
for (const row of repo.confluenceRowsInRange({})) repo.remove(row.id, 'smoke 정리');
ok('동기화 레코드 정리 완료', repo.confluenceRowsInRange({}).length === 0, String(repo.confluenceRowsInRange({}).length));

// ---------- .env 로더 · Confluence 클라이언트 · 폴링 ----------
head('.env 로더 (의존성 없는 최소 구현)');
const cenv = require('../env');
const envFile = path.join(TMP, 'env-test');
fs.writeFileSync(envFile, [
  '# 주석은 건너뛴다',
  '',
  'QE_TEST_PAT="abc123"',
  'QE_TEST_QUOTED=xyz',
  'QE_TEST_EMPTY=',
  '잘못된줄',
  'QE_TEST_PRESET=fromfile',
].join('\n'), 'utf8');
process.env.QE_TEST_PRESET = 'fromenv';
const envKeys = cenv.load(envFile);
ok('따옴표를 벗긴다', process.env.QE_TEST_PAT === 'abc123', process.env.QE_TEST_PAT);
ok('따옴표 없는 값도 읽는다', process.env.QE_TEST_QUOTED === 'xyz', process.env.QE_TEST_QUOTED);
ok('빈 값도 읽는다', process.env.QE_TEST_EMPTY === '', JSON.stringify(process.env.QE_TEST_EMPTY));
ok('= 없는 줄은 건너뛴다', !envKeys.includes('잘못된줄'));
ok('주석·빈 줄은 키가 되지 않는다', !envKeys.some((k) => k.startsWith('#') || k === ''));
ok('기존 환경변수가 파일보다 우선', process.env.QE_TEST_PRESET === 'fromenv', process.env.QE_TEST_PRESET);
ok('덮지 않은 키는 결과에 없다', !envKeys.includes('QE_TEST_PRESET'));
ok('값이 아니라 키 이름만 돌려준다', envKeys.every((k) => !String(k).includes('abc123')));
ok('없는 파일은 빈 배열', cenv.load(path.join(TMP, 'no-such-env')).length === 0);

head('Confluence 클라이언트 (정규화)');
const cclient = require('../confluence-client');
// 실 config.json·환경변수에 의존하지 않도록 설정을 직접 만들어 넘긴다.
// 나중에 실제 설정이 채워져도 이 테스트의 기대값이 뒤집히지 않게 하려는 것이다.
const CFG = {
  baseUrl: 'https://confluence.example.invalid', subCalendarId: 'cal-1', timeZone: 'Asia/Seoul',
  pollMinutes: 5, rangeBackDays: 30, rangeAheadDays: 60,
  fields: { ...cclient.DEFAULT_FIELDS }, token: 'test-token',
};

ok('dig 중첩 값', cclient.dig({ a: { b: 'v' } }, 'a.b') === 'v');
ok('dig 배열 인덱스', cclient.dig({ a: [{ b: 'v' }] }, 'a.0.b') === 'v');
ok('dig 없는 키는 undefined', cclient.dig({ a: 1 }, 'a.b.c') === undefined);
ok('dig 빈 경로는 undefined', cclient.dig({ a: 1 }, '') === undefined);
ok('toText 문자열은 트림', cclient.toText('  x  ') === 'x');
ok('toText 객체는 displayName', cclient.toText({ displayName: '이해찬', name: 'haechan' }) === '이해찬');
ok('toText 객체 fallback은 name', cclient.toText({ name: 'haechan' }) === 'haechan');
ok('toText 배열은 콤마로 잇는다', cclient.toText([{ displayName: '이해찬' }, { name: '이은경' }]) === '이해찬, 이은경');
ok('toText null은 빈 문자열', cclient.toText(null) === '');

const nev = cclient.normalizeEvent({ id: 'e1', title: 't', invitees: '이해찬', start: '2026-09-07', end: '2026-09-07' }, CFG.fields);
ok('매핑이 빈 칸은 채우지 않는다', nev.event.relatedPage === '' && nev.event.created === '');
ok('매핑이 빈 칸은 경고로 남는다', nev.warnings.filter((w) => w.includes('매핑이 비어 있어')).length === 2, nev.warnings.join(' | '));
const missKey = cclient.normalizeEvent({ id: 'e1' }, { id: 'id', title: 'title' });
ok('응답에 없는 키는 경고', missKey.warnings.some((w) => w.includes('키가 없습니다')), missKey.warnings.join(' | '));
ok('루트가 배열인 응답도 받는다', cclient.normalizeBody([{ id: 'e1', title: 't' }], { id: 'id', title: 'title' }).events.length === 1);
let bodyErr = '';
try { cclient.normalizeBody({ nope: 1 }, CFG.fields); } catch (e) { bodyErr = e.message; }
ok('events 배열이 없으면 예외', bodyErr.includes('events 배열'), bodyErr);
const dupWarn = cclient.normalizeBody({ events: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { id: 'id', title: 'title' });
ok('같은 경고는 이벤트 수만큼 쌓지 않는다', dupWarn.warnings.length === 1, String(dupWarn.warnings.length));

// 'YYYY-MM-DD' → 로컬 자정의 ISO 인스턴트. 기대값을 하드코딩하면 머신 타임존에 묶이므로
// 테스트 쪽에서도 같은 방식으로 계산해 비교한다.
const noMs = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
ok('날짜는 로컬 자정 인스턴트로 바뀐다', cclient.toInstant('2026-09-01') === noMs(new Date(2026, 8, 1)), cclient.toInstant('2026-09-01'));
ok('종료일은 다음 날 자정까지 잡는다', cclient.toInstant('2026-09-30', { endOfDay: true }) === noMs(new Date(2026, 8, 31)), cclient.toInstant('2026-09-30', { endOfDay: true }));
ok('밀리초는 붙이지 않는다', /T\d{2}:\d{2}:\d{2}Z$/.test(cclient.toInstant('2026-09-01')), cclient.toInstant('2026-09-01'));
ok('이미 인스턴트면 그대로 보낸다', cclient.toInstant('2026-06-26T00:00:00Z') === '2026-06-26T00:00:00Z');
ok('빈 값은 빈 문자열', cclient.toInstant('') === '');
ok('해석 못 하는 값은 그대로 둔다', cclient.toInstant('내일') === '내일');

head('Confluence 폴링 러너 (설정·기간)');
const cpoll = require('../confluence-poll');
const pr = cpoll.rangeOf(new Date(2026, 8, 10, 12, 0, 0));
ok('조회 기간은 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(pr.from) && /^\d{4}-\d{2}-\d{2}$/.test(pr.to), `${pr.from}~${pr.to}`);
ok('조회 기간은 과거→미래 순', pr.from < pr.to, `${pr.from}~${pr.to}`);
const pst = cpoll.status();
ok('상태에 설정 여부가 있다', typeof pst.configured === 'boolean');
ok('상태에 부족한 설정 목록이 있다', Array.isArray(pst.missing));
ok('상태에 폴링 주기가 있다', Number(pst.pollMinutes) > 0, String(pst.pollMinutes));

// ---------- 모델명 → 의뢰자 룩업 (지시서의 [모델명-의뢰자 DB]) ----------
head('모델명-의뢰자 룩업');
// 기대값을 하드코딩하지 않고 이력에서 계산한다 — 픽스처가 바뀌어도 의미가 유지되게.
const kmRows = repo.list({}).filter((r) => r.model_name === 'KM-100' && String(r.requester || '').trim());
const kmLatest = kmRows.length ? kmRows.reduce((a, b) => (a.id > b.id ? a : b)).requester : '';
ok('이력에서 그 모델의 최신 의뢰자를 찾는다', repo.requesterOfModel('KM-100') === kmLatest, `${repo.requesterOfModel('KM-100')} vs ${kmLatest}`);
ok('없는 모델은 빈 문자열', repo.requesterOfModel('없는모델-zzz') === '');
ok('빈 모델명은 빈 문자열', repo.requesterOfModel('') === '');
ok('config 명시 매핑이 이력보다 우선', cpoll.lookupRequester('KM-100', { 'KM-100': '박PL' }) === '박PL');
ok('명시 매핑에 없으면 이력으로 내려간다', cpoll.lookupRequester('KM-100', { 'KM-999': '박PL' }) === kmLatest);
ok('둘 다 없으면 빈 문자열', cpoll.lookupRequester('없는모델-zzz', {}) === '');

// 동기화가 실제로 의뢰자를 채우는지 (upsertEvent는 동기 함수라 여기서 바로 확인한다)
const evReq = {
  id: 'evt-req-1', title: '[xTS][3PL] KM-100 5차 > Passed', invitees: '이은경',
  start: '2026-09-11', end: '2026-09-11', relatedPage: '', created: '2026-09-11',
};
const upReq = csync.upsertEvent(evReq, { lookupRequester: (m) => cpoll.lookupRequester(m, {}) });
ok('신규 생성 시 의뢰자를 이력에서 채운다', repo.get(upReq.id).requester === kmLatest, repo.get(upReq.id).requester);
const evUnknown = { id: 'evt-req-2', title: '[xTS][3PL] 처음보는모델 > Passed', invitees: '이은경', start: '', end: '', relatedPage: '', created: '' };
const upUnknown = csync.upsertEvent(evUnknown, { lookupRequester: (m) => cpoll.lookupRequester(m, {}) });
ok('찾지 못한 모델은 경고를 남긴다', upUnknown.warnings.some((w) => w.includes('모델명-의뢰자 매핑에 없는')), upUnknown.warnings.join(' | '));
ok('찾지 못해도 의뢰는 만든다', repo.get(upUnknown.id) && !repo.get(upUnknown.id).requester);

// 섹션 정리 — 아래 보고 본문 비교가 앞서 떠 둔 스냅숏과 어긋나지 않게 한다.
for (const row of repo.confluenceRowsInRange({})) repo.remove(row.id, 'smoke 정리');
ok('룩업 섹션 레코드 정리 완료', repo.confluenceRowsInRange({}).length === 0);
(async () => {
  // ---------- Confluence 조회·폴링 (비동기) ----------
  head('Confluence 조회 (fetch 스텁 — 사내망을 부르지 않는다)');
  const realFetch = global.fetch;
  let seen = { url: '', headers: {} };
  global.fetch = async (url, opt) => {
    seen = { url, headers: (opt || {}).headers || {} };
    return {
      ok: true, status: 200,
      json: async () => ({ events: [{ id: 'e1', title: '[NTS][3PL] KM-950 > Passed', invitees: [{ displayName: '이은경' }], start: '2026-09-05', end: '2026-09-05' }] }),
    };
  };
  const fx = await cclient.fetchEvents({ from: '2026-09-01', to: '2026-09-30' }, CFG);
  ok('주입 설정으로 이벤트를 정규화한다', fx.events.length === 1 && fx.events[0].invitees === '이은경', JSON.stringify(fx.events[0]));
  ok('토큰은 URL에 실리지 않는다', !seen.url.includes('test-token'), seen.url);
  ok('토큰은 Authorization 헤더로 간다', String(seen.headers.Authorization || '').includes('test-token'));
  // 실제 Confluence 요청은 start·end 를 ISO 인스턴트로 보낸다 (2026-09-10 개발자도구 확인).
  const expStart = encodeURIComponent(cclient.toInstant('2026-09-01'));
  const expEnd = encodeURIComponent(cclient.toInstant('2026-09-30', { endOfDay: true }));
  ok('조회 기간은 ISO 인스턴트로 실린다', seen.url.includes(`start=${expStart}`) && seen.url.includes(`end=${expEnd}`), seen.url);
  ok('날짜만 보내지 않는다', !seen.url.includes('start=2026-09-01&'), seen.url);
  ok('캘린더 id가 쿼리에 실린다', seen.url.includes('subCalendarId=cal-1'), seen.url);

  global.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  let httpErr = '';
  try { await cclient.fetchEvents({}, CFG); } catch (e) { httpErr = e.message; }
  ok('실패 응답은 상태코드를 담아 던진다', httpErr.includes('401'), httpErr);
  ok('본문을 못 읽어도 상태코드는 보고한다', httpErr.includes('Confluence 응답 401'), httpErr);

  // 401 의 실제 이유는 대개 본문에 있다. HTML 로그인 페이지가 오는 경우가 많아 태그를 지운다.
  global.fetch = async () => ({
    ok: false, status: 401, statusText: '',
    text: async () => '<html><body><h1>Login required</h1>  <p>PAT is disabled</p></body></html>',
  });
  let bodyHint = '';
  try { await cclient.fetchEvents({}, CFG); } catch (e) { bodyHint = e.message; }
  ok('오류 본문 앞부분을 함께 알려 준다', bodyHint.includes('본문: Login required PAT is disabled'), bodyHint);
  ok('본문의 HTML 태그는 지운다', !bodyHint.includes('<html>'), bodyHint);

  // 토큰이 이 인스턴스에서 먹는지 가르는 최소 호출
  let authUrl = '';
  global.fetch = async (url) => {
    authUrl = url;
    return { ok: true, status: 200, text: async () => '{"username":"k251110","displayName":"조건희"}' };
  };
  const auth = await cclient.checkAuth(CFG);
  ok('토큰 점검은 user/current 를 부른다', authUrl.endsWith('/rest/api/user/current'), authUrl);
  ok('토큰 점검이 계정을 읽는다', auth.ok === true && auth.who === 'k251110', JSON.stringify(auth));
  ok('계정이 잎히면 인증된 것으로 본다', auth.authenticated === true && auth.anonymous === false, JSON.stringify(auth));

  // 익명 열람이 켜져 있으면 토큰을 무시하고도 200 이 온다.
  // 상태코드만 보고 '토큰 정상'으로 오진했던 자리다 (2026-09-10).
  global.fetch = async () => ({
    ok: true, status: 200,
    text: async () => '{"type":"anonymous","username":null,"displayName":"Anonymous"}',
  });
  const authAnon = await cclient.checkAuth(CFG);
  ok('200 이어도 익명이면 인증 실패로 본다', authAnon.authenticated === false, JSON.stringify(authAnon));
  ok('익명 여부를 따로 돌려준다', authAnon.anonymous === true && authAnon.ok === true, JSON.stringify(authAnon));
  global.fetch = async () => ({ ok: false, status: 401, statusText: '', text: async () => 'no' });
  const authBad = await cclient.checkAuth(CFG);
  ok('토큰 점검 실패는 상태코드로 돌려준다', authBad.ok === false && authBad.status === 401, JSON.stringify(authBad));
  global.fetch = realFetch;

  let cfgErr = '';
  try { await cclient.requestEvents({}, { token: '', baseUrl: '', subCalendarId: '' }); } catch (e) { cfgErr = e.message; }
  ok('설정이 없으면 조회하지 않는다', cfgErr.includes('설정이 없습니다'), cfgErr);

  // 토큰에 비ASCII가 있으면 fetch가 'Cannot convert argument to a ByteString' 이라는
  // 알아보기 힘든 오류를 낸다. 그 전에 한국어로 잡아 준다 (2026-09-10 실제로 밟은 함정).
  let phErr = '';
  try { await cclient.requestEvents({}, { ...CFG, token: '실제토큰값' }); } catch (e) { phErr = e.message; }
  ok('한글 자리표시자는 요청 전에 잡는다', phErr.includes('쓸 수 없는 문자'), phErr);
  ok('몇 번째 글자인지 알려 준다', phErr.includes("1번째 글자 '실'"), phErr);
  ok('ByteString 원문 오류를 노출하지 않는다', !phErr.includes('ByteString'), phErr);
  let spErr = '';
  try { await cclient.requestEvents({}, { ...CFG, token: 'abc def' }); } catch (e) { spErr = e.message; }
  ok('토큰 중간 공백도 잡는다', spErr.includes('쓸 수 없는 문자'), spErr);

  // 붙여넣기에 따라오는 앞뒤 공백은 config 단계에서 벗긴다
  const savedPat = process.env.CONFLUENCE_PAT;
  process.env.CONFLUENCE_PAT = '  MDk4NzY1NDMyMQ==  ';
  ok('토큰 앞뒤 공백은 벗긴다', cclient.config().token === 'MDk4NzY1NDMyMQ==', JSON.stringify(cclient.config().token));
  if (savedPat === undefined) delete process.env.CONFLUENCE_PAT; else process.env.CONFLUENCE_PAT = savedPat;

  head('Confluence 폴링 (조회 주입)');
  const pRange = { from: '2026-09-01', to: '2026-09-30' };
  const pEvent = { id: 'poll-1', title: '[NTS][3PL] KM-951 > Passed', invitees: '이은경', start: '2026-09-05', end: '2026-09-05', relatedPage: '', created: '2026-09-05' };
  const okRun = await cpoll.runOnce({ range: pRange, fetchEvents: async () => ({ events: [pEvent], warnings: ['조회 경고 1건'] }) });
  ok('주입 조회로 동기화가 돈다', okRun.ok === true && okRun.created === 1, JSON.stringify(okRun));
  ok('조회 건수를 집계한다', okRun.fetched === 1, String(okRun.fetched));
  ok('조회 경고와 동기화 경고를 합친다', okRun.warnings.includes('조회 경고 1건'), okRun.warnings.join(' | '));

  const failRun = await cpoll.runOnce({ range: pRange, fetchEvents: async () => { throw new Error('조회 실패'); } });
  ok('조회 실패는 그 회차만 실패로 남긴다', failRun.ok === false && failRun.reason === '조회 실패', JSON.stringify(failRun));
  ok('실패 후에도 상태를 읽을 수 있다', !!(cpoll.status().last && cpoll.status().last.ok === false));

  // 폴링 테스트가 만든 레코드 정리 — 아래 보고 본문 비교가 앞서 떠 둔 스냅숏과 어긋나지 않게 한다.
  for (const row of repo.confluenceRowsInRange({})) repo.remove(row.id, 'smoke 정리');
  ok('폴링 레코드 정리 완료', repo.confluenceRowsInRange({}).length === 0);

  for (const k of ['daily', 'weekly', 'certstats']) await sched.sendNow(k);
  notify.sendReportMail = origSend;

  ok('세 보고 모두 발송 호출됨', sent.length === 3, String(sent.length));
  const byKey = { daily: dRep, weekly: wRep, certstats: cRep };
  // 본문 푸터에는 `자동 생성 · <생성 시각>`이 박혀 있다. 스케줄러는 발송 시점의 시각으로 본문을
  // 다시 만들므로, 앞에서 만들어 둔 기대값과 초 단위가 어긋나면 문자열 비교가 깨진다(테스트가
  // 길어질수록 자주 걸린다). 검증 의도는 '어느 본문을 보냈는가'이므로 시각만 지우고 비교한다.
  const stripTs = (h) => String(h).replace(/자동 생성[^<]*/g, '자동 생성');
  ['daily', 'weekly', 'certstats'].forEach((k, i) => {
    const s = sent[i] || {};
    ok(`${k} 자동발송은 mailHtml 사용`, stripTs(s.html) === stripTs(byKey[k].mailHtml));
    ok(`${k} 자동발송이 화면용 html이 아님`, stripTs(s.html) !== stripTs(byKey[k].html));
    const hit = SECRETS.filter((v) => String(s.html).includes(v));
    ok(`${k} 자동발송에 모델명·실명·결함코멘트 없음`, hit.length === 0, hit.join(', '));
  });

  // 정리 실패가 테스트 결과를 뒤집지 않도록 분리한다. 임시 폴더가 남아도 OS가 회수한다.
  repo.close();
  try { fs.rmSync(TMP, { recursive: true, force: true }); }
  catch (e) { console.log(`
  (임시 폴더 정리 실패, 무시함: ${e.code} ${TMP})`); }

  console.log(`
===== PASS ${pass} / FAIL ${fail} =====`);
  process.exit(fail ? 1 : 0);
})();
