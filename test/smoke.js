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

// ---------- 픽스처 ----------
// KM-100 / Google xTS  / 3PL   : 3건 (1차 Pass, 3차 Fail, 4차 미판정) — 이번 주
// KM-100 / Netflix NTS / 3PL   : 1건 (2차 Pass)                       — 이번 주
// KM-100 / Google xTS  / MR    : 1건 (1차 Pass)                       — 이번 주 (Test 목적으로 행이 갈리는지)
// KM-200 / Google xTS  / 3PL   : 2건 (1차 Fail, 2차 Fail)             — 지난 주 (주차 필터에서 빠져야 함)
// KM-300 / Amazon AVTS / 양산  : 1건 (미판정, Round 미입력)            — 이번 주 (집계에서 통째로 빠져야 함)
const mk = (d) => {
  const r = repo.create({
    cert_type: d.cert_type, model_name: d.model_name, test_purpose: d.purpose,
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
const n1 = repo.nextRound('KM-100', '3PL');
ok('직전 3차 Fail → 4차', n1.round === 4, String(n1.round));
ok('근거 basis = fail', n1.basis === 'fail', n1.basis);
ok('근거 문구에 차수 포함', n1.reason.includes('3차 Fail'), n1.reason);
const n2 = repo.nextRound('KM-100', 'MR');
ok('직전 Pass → 1차 리셋', n2.round === 1 && n2.basis === 'pass', `${n2.round}/${n2.basis}`);
const n3 = repo.nextRound('KM-999', '3PL');
ok('이력 없음 → 1차', n3.round === 1 && n3.basis === 'new', `${n3.round}/${n3.basis}`);
ok('이력 없음 → history 빈 배열', n3.history.length === 0);
ok('미판정만 있는 조합 → 1차', repo.nextRound('KM-300', '양산').round === 1);
ok('직전 2차 Fail → 3차', repo.nextRound('KM-200', '3PL').round === 3);
ok('모델명 공백 → 1차 (조회 안 함)', repo.nextRound('  ', '3PL').round === 1);
ok('history는 최신순', n1.history[0].round === '3' && n1.history[0].verdict === 'Fail', JSON.stringify(n1.history[0]));
ok('history에 미판정 건 미포함', !n1.history.some((h) => !h.verdict));
ok('history는 (모델 × 목적) 기준 — 인증종류 무관', n1.history.length === 3, String(n1.history.length));

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

// 정리 실패가 테스트 결과를 뒤집지 않도록 분리한다. 임시 폴더가 남아도 OS가 회수한다.
repo.close();
try { fs.rmSync(TMP, { recursive: true, force: true }); }
catch (e) { console.log(`\n  (임시 폴더 정리 실패, 무시함: ${e.code} ${TMP})`); }

console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
process.exit(fail ? 1 : 0);
