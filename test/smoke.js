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
ok('미정의 건은 총 소요에서 제외', rs.totals.slots === 21, String(rs.totals.slots));   // 12+3+4+2
ok('미정의 건은 건수에서도 제외', rs.totals.count === 4, String(rs.totals.count));
ok('이은경 12 slot (미정의 건 제외)', rowOf('이은경').slots === 12, String(rowOf('이은경').slots));
ok('조아라 3 slot', rowOf('조아라').slots === 3, String(rowOf('조아라').slots));
ok('이해찬 0 slot (건 없어도 행 유지)', rowOf('이해찬').slots === 0);
ok('문유림 0 slot', rowOf('문유림').slots === 0);
ok('미배정 4 slot', rs.unassigned.slots === 4, String(rs.unassigned.slots));
ok('미배정도 총 소요에 포함', rs.totals.unassigned_slots === 4);
ok('배정분 = 총계 - 미배정', rs.totals.assigned_slots === 17, String(rs.totals.assigned_slots));
ok('4명 외 테스터는 기타로', rs.others.length === 1 && rs.others[0].tester === '김지윤');
ok('기타 2 slot', rs.others[0].slots === 2, String(rs.others[0].slots));

// 1 slot = 1명 1일 → 할당 slot 합계가 그 담당자의 소요 영업일수 (변환 계수 1)
ok('소요 영업일 = 할당 slot', rs.rows.every((r) => r.days === r.slots));
// 이은경 12 slot → 8/28(금)부터 12번째 영업일 = 9/14(월)
ok('이은경 예상 소진일 = 12번째 영업일', rowOf('이은경').eta === holidays.nthBusinessDay(AS_OF, 12), String(rowOf('이은경').eta));
ok('건 없는 담당자는 소진일 null', rowOf('이해찬').eta === null);
ok('미배정은 소진일 산출하지 않음', rs.unassigned.eta === null);

// 1주 가용(4명 × 5일 = 20 slot)을 100%로 산정. 총 소요 21 slot → 105%
ok('1주 가용 20 slot', rs.totals.week_capacity === 20, String(rs.totals.week_capacity));
ok('사용률 105% (21/20)', rs.totals.usage_pct === 105, String(rs.totals.usage_pct));
ok('초과 5% (1 slot)', rs.totals.over_pct === 5 && rs.totals.over_slots === 1,
  `${rs.totals.over_pct}% / ${rs.totals.over_slots} slot`);
ok('초과 시 여유는 0', rs.totals.free_pct === 0 && rs.totals.free_slots === 0);
ok('소요 주수 1.1주', rs.totals.weeks_needed === 1.1, String(rs.totals.weeks_needed));
ok('미배정 = 1주 가용의 20% (4/20)', rs.totals.unassigned_pct === 20, String(rs.totals.unassigned_pct));

// 담당자별 = 1인 주간 가용(5 slot) 대비
ok('담당자 주간 가용 5 slot', rs.rows.every((r) => r.capacity === 5));
ok('이은경 사용률 240% (12/5)', rowOf('이은경').usage_pct === 240, String(rowOf('이은경').usage_pct));
ok('이은경 7 slot 초과', rowOf('이은경').over === 7 && rowOf('이은경').free === 0,
  `over ${rowOf('이은경').over} / free ${rowOf('이은경').free}`);
ok('조아라 사용률 60% (3/5)', rowOf('조아라').usage_pct === 60, String(rowOf('조아라').usage_pct));
ok('조아라 2 slot 여유', rowOf('조아라').free === 2 && rowOf('조아라').over === 0);
ok('이해찬 5 slot 전량 여유', rowOf('이해찬').free === 5);
// 미배정·기타는 개인 가용 개념이 없다
ok('미배정은 가용 없음(null)', rs.unassigned.capacity === null && rs.unassigned.usage_pct === null);
ok('기타 테스터도 가용 없음(null)', rs.others[0].capacity === null && rs.others[0].free === null);

// 전체 소진 예상: 4명이 하루 4 slot 소화 → ceil(21/4) = 6 영업일
ok('1일 가용 = 담당 인원수', rs.totals.daily_capacity === 4);
ok('전체 소진 6 영업일', rs.totals.days === 6, String(rs.totals.days));
ok('전체 소진일 = 6번째 영업일', rs.totals.eta === holidays.nthBusinessDay(AS_OF, 6), String(rs.totals.eta));
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

// 4명 외 테스터 건은 4명의 가용을 쓰지 않으므로 배치에서 빠지되, 명시적으로 집계돼야 한다
ok('기타 테스터 건은 배치 제외로 집계', dp.excluded.slots === 2 && dp.excluded.count === 1,
  `${dp.excluded.count}건 / ${dp.excluded.slots} slot`);
ok('제외된 테스터 이름 노출', dp.excluded.testers.join(',') === '김지윤', dp.excluded.testers.join(','));
ok('배치 레인에 기타 테스터 없음', dp.days.every((d) => d.lane.every((x) => MEMBERS_LIST.includes(x.tester))));

// 배치분 + 구간초과 + 제외분 = 전체 물량 (물량이 조용히 사라지지 않는다)
const placed = dp.days.reduce((a, d) => a + d.used, 0);
ok('배치분 + 구간초과 + 제외분 = 전체 물량',
  placed + dp.overflow + dp.excluded.slots === rs.totals.slots,
  `${placed} + ${dp.overflow} + ${dp.excluded.slots} vs ${rs.totals.slots}`);

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
