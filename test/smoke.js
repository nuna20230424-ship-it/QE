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

// ---------- 0. 빈 DB: 0 나눗셈 방어 ----------
head('0. 빈 DB (Divide by Zero 방어)');
const empty = repo.certStats(null);
ok('rows 비어 있음', empty.rows.length === 0);
ok('total 0', empty.totals.total === 0);
ok('pass_rate 0 (NaN/Infinity 아님)', empty.totals.pass_rate === 0, String(empty.totals.pass_rate));
ok('fail_rate 0 (NaN/Infinity 아님)', empty.totals.fail_rate === 0, String(empty.totals.fail_rate));
ok('modelNames 빈 배열', repo.modelNames().length === 0);

// ---------- 픽스처 ----------
// KM-100 / Google xTS : 3건 (Pass 1, Fail 1, 미판정 1) — 이번 주
// KM-100 / Netflix NTS: 1건 (Pass)                    — 이번 주
// KM-200 / Google xTS : 2건 (Fail 2)                  — 지난 주 (주차 필터에서 빠져야 함)
// KM-300 / Amazon AVTS: 1건 (미판정, Round 미입력)      — 이번 주
const mk = (d) => {
  const r = repo.create({ cert_type: d.cert_type, model_name: d.model_name, round: d.round, requester: 'PL', desired_date: d.start }, '테스트');
  return repo.update(r.id, {
    started_date: d.start, completed_date: d.end || '', status: d.status,
    verdict: d.verdict || '', progress: d.progress || '', result: d.result || '', tester: '이해찬',
  }, '테스트');
};
mk({ cert_type: 'Google xTS', model_name: 'KM-100', round: '1', start: thisWeek(0), end: thisWeek(1), status: '완료', verdict: 'Pass' });
mk({ cert_type: 'Google xTS', model_name: 'KM-100', round: '3', start: thisWeek(1), end: thisWeek(2), status: '완료', verdict: 'Fail', progress: '2일차 중단', result: 'DRM 재생 실패' });
mk({ cert_type: 'Google xTS', model_name: 'KM-100', round: '4', start: thisWeek(3), status: '진행중' });
mk({ cert_type: 'Netflix NTS', model_name: 'KM-100', round: '2', start: thisWeek(0), end: thisWeek(0), status: '완료', verdict: 'Pass' });
mk({ cert_type: 'Google xTS', model_name: 'KM-200', round: '1', start: lastWeek(0), end: lastWeek(1), status: '완료', verdict: 'Fail' });
mk({ cert_type: 'Google xTS', model_name: 'KM-200', round: '2', start: lastWeek(2), end: lastWeek(3), status: '완료', verdict: 'Fail' });
mk({ cert_type: 'Amazon AVTS', model_name: 'KM-300', round: '', start: thisWeek(2), status: '예약확정' });

// ---------- Task 2. 모델명 자동 목록화 ----------
head('Task 2. 모델명 DISTINCT 목록');
const models = repo.modelNames();
ok('중복 제거 (KM-100 4건 → 1개)', models.filter((m) => m === 'KM-100').length === 1, JSON.stringify(models));
ok('모델 3개 전부 노출', models.length === 3, JSON.stringify(models));
ok('이름순 정렬', JSON.stringify(models) === JSON.stringify([...models].sort()), JSON.stringify(models));

// ---------- Task 4-1. 누적 인증 통계 ----------
head('Task 4-1. 모델별 누적 통계');
const all = repo.certStats(null);
const row = (m, c) => all.rows.find((r) => r.model_name === m && r.cert_type === c);
const x = row('KM-100', 'Google xTS');
ok('진행차수(누적 의뢰) = 3', x.total === 3, String(x.total));
ok('Fail 횟수 = 1', x.fail === 1, String(x.fail));
ok('Pass율 = 33.3% (1/3)', x.pass_rate === 33.3, String(x.pass_rate));
ok('Fail율 = 33.3% (1/3)', x.fail_rate === 33.3, String(x.fail_rate));
ok('미판정 = 1', x.pending === 1, String(x.pending));
ok('최대 Round = 4', x.max_round === 4, String(x.max_round));
ok('모델×인증 조합으로 행 분리', row('KM-100', 'Netflix NTS').total === 1);
ok('Round 미입력 → max_round 0', row('KM-300', 'Amazon AVTS').max_round === 0);
ok('판정 0건 → Pass율 0%', row('KM-300', 'Amazon AVTS').pass_rate === 0);
ok('총계 누적 의뢰 = 7', all.totals.total === 7, String(all.totals.total));
ok('총계 모델 수 = 3', all.totals.models === 3, String(all.totals.models));

// ---------- Task 4-2. 주차(월~금) 필터 ----------
head('Task 4-2. 주차 월~금 필터');
const wk = report.workWeekRange(now);
ok('월요일 시작', new Date(`${wk.from}T00:00:00`).getDay() === 1, wk.from);
ok('금요일 종료', new Date(`${wk.to}T00:00:00`).getDay() === 5, wk.to);
const wkStats = repo.certStats(wk);
ok('지난주 건(KM-200) 제외', !wkStats.rows.some((r) => r.model_name === 'KM-200'));
ok('이번주 KM-100/xTS 3건 포함', wkStats.rows.find((r) => r.model_name === 'KM-100' && r.cert_type === 'Google xTS').total === 3);
ok('이번주 누적 의뢰 = 5', wkStats.totals.total === 5, String(wkStats.totals.total));

// ---------- Task 3 / 4-2. 리포트 렌더 ----------
head('Task 3 / 4-2. 리포트 HTML');
const w = report.weekly(now);
ok('"진행차수 1차, Pass" 표기', w.html.includes('진행차수 1차, Pass'));
ok('"진행차수 3차, Fail" 표기', w.html.includes('진행차수 3차, Fail'));
ok('인증 통계 섹션 포함', w.html.includes('모델별 인증 현황'));
ok('주차 범위(월~금) 표기', w.html.includes(`${wk.from} ~ ${wk.to}`));
ok('Fail 상세에 결과 코멘트 유지', w.html.includes('DRM 재생 실패'));
ok('본문 집계 구간은 월~일 유지', report.weekRange(now).to !== wk.to);
ok('일일보고에는 통계 섹션 없음', !report.daily(now).html.includes('모델별 인증 현황'));

// 정리 실패가 테스트 결과를 뒤집지 않도록 분리한다. 임시 폴더가 남아도 OS가 회수한다.
repo.close();
try { fs.rmSync(TMP, { recursive: true, force: true }); }
catch (e) { console.log(`\n  (임시 폴더 정리 실패, 무시함: ${e.code} ${TMP})`); }

console.log(`\n===== PASS ${pass} / FAIL ${fail} =====`);
process.exit(fail ? 1 : 0);
