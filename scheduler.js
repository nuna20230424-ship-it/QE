// 매일 오후 7시에 일일·주간 현황보고를 이메일로 자동 발송하는 스케줄러
const report = require('./report');
const notify = require('./notify');

const SEND_HOUR = 19; // 오후 7시

function msUntilNext(hour) {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next - now;
}

async function sendDailyReports() {
  const d = report.daily();
  const w = report.weekly();
  await notify.sendReportMail(d.subject, d.html);
  await notify.sendReportMail(w.subject, w.html);
}

function start() {
  const schedule = () => {
    const delay = msUntilNext(SEND_HOUR);
    console.log(`[scheduler] 다음 현황보고 발송까지 약 ${Math.round(delay / 60000)}분`);
    setTimeout(async () => {
      try {
        await sendDailyReports();
      } catch (err) {
        console.error('[scheduler] 현황보고 발송 오류:', err.message);
      }
      schedule(); // 다음 날 19시 재예약
    }, delay);
  };
  schedule();
}

module.exports = { start, sendDailyReports };
