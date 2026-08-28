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
ok('Pass 파란 볼드 (4-3)', w.html.includes('<b style="color:#1257c9;">Pass</b>'));
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

// 복사본은 화면 그대로(상세 포함) — 발송용 링크 본문과 달라야 한다.
ok('일일 복사본에 모델명 포함', dRep.html.includes('KM-100'));
ok('통계 복사본에 모델명 포함', copyAll.html.includes('KM-100'));
ok('복사본은 발송용 본문과 다름', dRep.html !== dRep.mailHtml && copyWk.html !== cRep.mailHtml);

// ---------- 스케줄러 자동발송이 실제로 넘기는 본문 ----------
// report.js의 mailHtml만 검증하면 스케줄러가 r.html을 넘겨도 통과한다. 호출 인자를 직접 가로채 확인한다.
head('스케줄러 자동발송 본문');
const notify = require('../notify');
const origSend = notify.sendReportMail;
const sent = [];
notify.sendReportMail = async (subject, html) => { sent.push({ subject, html }); };

(async () => {
  for (const k of ['daily', 'weekly', 'certstats']) await sched.sendNow(k);
  notify.sendReportMail = origSend;

  ok('세 보고 모두 발송 호출됨', sent.length === 3, String(sent.length));
  const byKey = { daily: dRep, weekly: wRep, certstats: cRep };
  ['daily', 'weekly', 'certstats'].forEach((k, i) => {
    const s = sent[i] || {};
    ok(`${k} 자동발송은 mailHtml 사용`, s.html === byKey[k].mailHtml);
    ok(`${k} 자동발송이 화면용 html이 아님`, s.html !== byKey[k].html);
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
