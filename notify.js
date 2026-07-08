// 예약확정·완료 시 이메일 알림 전송 (config.json 미설정 시 자동 생략)
const fs = require('fs');
const path = require('path');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* 미설치 시 생략 */ }

function loadConfig() {
  const p = path.join(__dirname, 'config.json');
  if (!fs.existsSync(p)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!cfg.smtp || !cfg.smtp.user || !cfg.smtp.pass) return null;
    return cfg;
  } catch {
    return null;
  }
}

let transporter = null;
let config = null;
function init() {
  config = loadConfig();
  if (!config || !nodemailer) {
    console.log('[notify] config.json 미설정 → 이메일 알림 생략 (앱은 정상 동작)');
    return;
  }
  transporter = nodemailer.createTransport({
    host: config.smtp.host || 'smtp.gmail.com',
    port: config.smtp.port || 465,
    secure: config.smtp.port ? config.smtp.port === 465 : true,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  console.log(`[notify] 이메일 알림 활성화 (수신: ${(config.notifyTo || []).join(', ') || '없음'})`);
}

const EVENT_LABEL = { 예약확정: '예약이 확정', 완료: '인증이 완료' };

async function sendStatusNotification(req, event) {
  if (!transporter || !config) return;
  const to = config.notifyTo || [];
  if (!to.length) return;

  const subject = `[인증일정] ${req.cert_type} · ${req.model_name} — ${event}`;
  const url = config.baseUrl || '';
  const lines = [
    `${EVENT_LABEL[event] || event}되었습니다.`,
    '',
    `· 인증종류: ${req.cert_type}`,
    `· Test: ${[req.test_type, req.test_purpose].filter(Boolean).join(' / ') || '-'}`,
    `· 모델 / FW: ${req.model_name} ${req.fw_version || ''}`,
    `· 의뢰자: ${req.requester || '-'}`,
    `· 담당 테스터: ${req.tester || '-'}`,
    `· 예약 일정: ${req.scheduled_date || req.desired_date || '-'}`,
    `· 상태: ${req.status}`,
    event === '완료' ? `· 결과: ${req.result || '-'}` : '',
    '',
    url ? `대시보드: ${url}` : '',
  ].filter((l) => l !== '');

  try {
    await transporter.sendMail({
      from: config.smtp.from || config.smtp.user,
      to: to.join(','),
      subject,
      text: lines.join('\n'),
    });
    console.log(`[notify] 발송: ${subject}`);
  } catch (err) {
    console.error('[notify] 발송 실패:', err.message);
  }
}

// 일일/주간 현황보고 수신자 기본값 (config.reportTo 로 재정의 가능)
const DEFAULT_REPORT_TO = ['nuna20230424@gmail.com', 'keonhee.cho@kaongroup.com'];

async function sendReportMail(subject, html) {
  if (!transporter || !config) {
    console.log('[notify] config.json 미설정 → 현황보고 메일 생략');
    return false;
  }
  const to = (config.reportTo && config.reportTo.length) ? config.reportTo : DEFAULT_REPORT_TO;
  try {
    await transporter.sendMail({
      from: config.smtp.from || config.smtp.user,
      to: to.join(','),
      subject,
      html,
    });
    console.log(`[notify] 현황보고 발송: ${subject} → ${to.join(', ')}`);
    return true;
  } catch (err) {
    console.error('[notify] 현황보고 발송 실패:', err.message);
    return false;
  }
}

init();
module.exports = { sendStatusNotification, sendReportMail };
