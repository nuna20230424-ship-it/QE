// 의뢰 예약·현황 대시보드 REST API 및 정적 파일 서버
const path = require('path');
const express = require('express');
const repo = require('./db');
const notify = require('./notify');
const backup = require('./backup');
const report = require('./report');
const scheduler = require('./scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const STATUSES = ['예약대기', '예약확정', '진행중', '완료', '보류', '중단'];
const CERT_TYPES = ['Netflix NTS', 'Google xTS', 'Amazon AVTS'];
const NOTIFY_ON = ['예약확정', '완료'];   // 이 상태로 바뀔 때 메일 발송

const actorOf = (req) => req.body && req.body.actor;

app.get('/api/requests', (req, res) => {
  res.json(repo.list({
    cert_type: req.query.cert_type,
    status: req.query.status,
    q: req.query.q,
  }));
});

app.get('/api/stats', (req, res) => {
  res.json(repo.stats());
});

// 입력 필드 자동목록용 선택지 (모델명: 한 번이라도 입력된 값 전체)
app.get('/api/options', (req, res) => {
  res.json({ models: repo.modelNames() });
});

// 모델(프로젝트)별 인증 통계. from·to를 함께 주면 해당 기간에 진행된 건만 집계
app.get('/api/cert-stats', (req, res) => {
  const { from, to } = req.query;
  if ((from && !to) || (!from && to)) {
    return res.status(400).json({ error: 'from과 to는 함께 지정해야 합니다.' });
  }
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if ((from && !ymd.test(from)) || (to && !ymd.test(to))) {
    return res.status(400).json({ error: '날짜는 YYYY-MM-DD 형식이어야 합니다.' });
  }
  res.json(repo.certStats(from && to ? { from, to } : null));
});

// Task 5. 모델명 + Test 목적으로 신규 의뢰의 진행차수를 산출. 근거 이력도 함께 돌려준다.
app.get('/api/next-round', (req, res) => {
  const model = String(req.query.model_name || '').trim();
  if (!model) return res.status(400).json({ error: 'model_name은 필수입니다.' });
  res.json(repo.nextRound(model, req.query.test_purpose));
});

// Task 6-2. 반복 Fail·장기 미판정 병목 경고
app.get('/api/bottlenecks', (req, res) => {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  res.json(repo.bottlenecks({
    roundThreshold: num(req.query.round, 5),
    staleDays: num(req.query.days, 14),
  }));
});

// 일일/주간 현황보고 (미리보기용 HTML + 집계)
app.get('/api/report/:period', (req, res) => {
  const p = req.params.period;
  if (p !== 'daily' && p !== 'weekly') return res.status(400).json({ error: 'period는 daily 또는 weekly여야 합니다.' });
  const r = report[p]();
  res.json({ period: p, from: r.data.from, to: r.data.to, counts: r.data.counts, html: r.html });
});

// 현황보고 즉시 메일 발송 (수동 트리거)
app.post('/api/report/:period/send', async (req, res) => {
  const p = req.params.period;
  if (p !== 'daily' && p !== 'weekly') return res.status(400).json({ error: 'period는 daily 또는 weekly여야 합니다.' });
  const r = report[p]();
  const sent = await notify.sendReportMail(r.subject, r.html);
  res.json({ sent });
});

app.get('/api/requests/:id', (req, res) => {
  const r = repo.get(Number(req.params.id));
  if (!r) return res.status(404).json({ error: '해당 의뢰를 찾을 수 없습니다.' });
  res.json(r);
});

app.get('/api/requests/:id/history', (req, res) => {
  res.json(repo.history(Number(req.params.id)));
});

app.post('/api/requests', (req, res) => {
  const { cert_type, model_name } = req.body;
  if (!CERT_TYPES.includes(cert_type)) {
    return res.status(400).json({ error: '인증종류는 Netflix NTS, Google xTS, Amazon AVTS 중 하나여야 합니다.' });
  }
  if (!model_name || !String(model_name).trim()) {
    return res.status(400).json({ error: '모델명은 필수입니다.' });
  }
  const created = repo.create(req.body, actorOf(req));
  res.status(201).json(created);
});

app.patch('/api/requests/:id', (req, res) => {
  if (req.body.status && !STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: '잘못된 상태값입니다.' });
  }
  if (req.body.cert_type && !CERT_TYPES.includes(req.body.cert_type)) {
    return res.status(400).json({ error: '잘못된 인증종류입니다.' });
  }
  const before = repo.get(Number(req.params.id));
  if (!before) return res.status(404).json({ error: '해당 의뢰를 찾을 수 없습니다.' });

  const after = repo.update(Number(req.params.id), req.body, actorOf(req));

  // 상태가 알림 대상으로 새로 바뀐 경우에만 메일 발송
  if (after.status !== before.status && NOTIFY_ON.includes(after.status)) {
    notify.sendStatusNotification(after, after.status);
  }
  res.json(after);
});

app.delete('/api/requests/:id', (req, res) => {
  const ok = repo.remove(Number(req.params.id), req.query.actor);
  if (!ok) return res.status(404).json({ error: '해당 의뢰를 찾을 수 없습니다.' });
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`인증 일정 대시보드 실행 중: http://${HOST}:${PORT}`);
  backup.start();
  scheduler.start();
});
