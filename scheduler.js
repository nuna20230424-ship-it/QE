// 일일·주간 현황보고와 주간 인증 통계를 정해진 요일·시각에 자동 메일 발송하는 스케줄러
const report = require('./report');
const notify = require('./notify');

// days: null이면 매일, 아니면 발송 요일 (Date.getDay() 기준 0=일 … 6=토)
const JOBS = [
  { key: 'daily', label: '일일보고', build: () => report.daily(), hour: 18, minute: 0, days: null },
  { key: 'weekly', label: '주간보고', build: () => report.weekly(), hour: 18, minute: 0, days: [5] },
  { key: 'certstats', label: '인증 통계', build: () => report.certStats(), hour: 9, minute: 0, days: [1] },
];

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const jobDesc = (j) => `${j.label} — ${j.days ? j.days.map((d) => DAY_KO[d] + '요일').join('·') : '매일'} ${j.hour}:${String(j.minute).padStart(2, '0')}`;

// 다음 발송 시각까지 남은 ms. 오늘 시각이 이미 지났거나 요일이 맞지 않으면 다음 해당 요일로 넘긴다.
function msUntilNext(job, now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), job.hour, job.minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  if (job.days) {
    // 최대 7일 안에 반드시 해당 요일이 나온다.
    for (let i = 0; i < 7 && !job.days.includes(next.getDay()); i += 1) {
      next.setDate(next.getDate() + 1);
    }
  }
  return next - now;
}

async function runJob(job) {
  const r = job.build();
  // 반드시 mailHtml(집계 + 링크만). r.html은 모델명·실명·결함 코멘트가 든 사내 화면용이다.
  await notify.sendReportMail(r.subject, r.mailHtml);
}

function schedule(job) {
  const delay = msUntilNext(job);
  const at = new Date(Date.now() + delay);
  console.log(`[scheduler] ${jobDesc(job)} → 다음 발송 ${at.toLocaleString('ko-KR')}`);
  setTimeout(async () => {
    try {
      await runJob(job);
    } catch (err) {
      console.error(`[scheduler] ${job.label} 발송 오류:`, err.message);
    }
    schedule(job); // 발송 후 다음 회차 재예약
  }, delay);
}

function start() {
  JOBS.forEach(schedule);
}

// 수동 트리거용 (period: daily | weekly | certstats)
async function sendNow(period) {
  const job = JOBS.find((j) => j.key === period);
  if (!job) throw new Error(`알 수 없는 보고 종류: ${period}`);
  await runJob(job);
}

module.exports = { start, sendNow, JOBS, msUntilNext };
