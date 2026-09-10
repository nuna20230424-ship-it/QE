// .env 파일이 왜 안 읽히는지 진단하는 스크립트 (토큰 값은 절대 출력하지 않는다)
// 사용법: node scripts/env-check.js [파일경로]
const fs = require('fs');
const path = require('path');

const KEY = 'CONFLUENCE_PAT';
const file = process.argv[2] || path.join(__dirname, '..', '.env');
const line = (k, v) => console.log(`${k.padEnd(12)}: ${v}`);

line('파일', file);

// 환경변수가 이미 있으면 파일보다 우선한다 — 로더가 파일 값을 건너뛰므로 먼저 알려 준다.
if (KEY in process.env) {
  const len = String(process.env[KEY]).length;
  line('환경변수', `${KEY} 이미 설정됨 (길이 ${len})${len === 0 ? ' ← 빈 값이라 파일 값을 덮는다. Remove-Item Env:' + KEY : ''}`);
} else {
  line('환경변수', `${KEY} 없음 (파일을 읽는다)`);
}

if (!fs.existsSync(file)) {
  line('존재', '아니오');
  console.log('\n→ 파일이 없다. 아래 중 하나로 만든다.');
  console.log(`   PowerShell : Set-Content -Path .env -Value '${KEY}=실제토큰' -Encoding utf8`);
  console.log(`   또는 파일 없이 : $env:${KEY} = '실제토큰'`);
  process.exit(1);
}

const buf = fs.readFileSync(file);
line('존재', '예');
line('크기', `${buf.length} 바이트`);
const head = [...buf.slice(0, 4)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
line('앞 4바이트', head || '(빈 파일)');

// UTF-16으로 저장되면 utf8로 읽을 때 키 이름이 깨져 조용히 실패한다.
let enc = 'UTF-8 / ANSI';
if (buf[0] === 0xFF && buf[1] === 0xFE) enc = 'UTF-16 LE  ← 로더가 읽지 못한다';
else if (buf[0] === 0xFE && buf[1] === 0xFF) enc = 'UTF-16 BE  ← 로더가 읽지 못한다';
else if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) enc = 'UTF-8 (BOM) — 문제없다';
line('인코딩', enc);

if (buf.length === 0) {
  console.log('\n→ 파일이 비어 있다. 위 명령으로 한 줄을 넣는다.');
  process.exit(1);
}

console.log('');
let found = null;
let n = 0;
for (const raw of buf.toString('utf8').split(/\r?\n/)) {
  n += 1;
  const s = raw.trim();
  if (!s) continue;
  if (s.startsWith('#')) { console.log(`줄 ${n}: (주석)`); continue; }
  const eq = s.indexOf('=');
  if (eq <= 0) {
    console.log(`줄 ${n}: 형식 이상 — '=' 가 없거나 맨 앞이다 (길이 ${s.length})`);
    continue;
  }
  const k = s.slice(0, eq).trim();
  const v = s.slice(eq + 1).trim();
  console.log(`줄 ${n}: 키='${k}'  값길이=${v.length}`);
  if (k === KEY) found = v.length;
}

console.log('');
if (found === null) {
  console.log(`→ ${KEY} 키를 찾지 못했다. 키 이름 오타이거나 인코딩이 UTF-16일 수 있다.`);
  process.exit(1);
} else if (found === 0) {
  console.log(`→ ${KEY} 는 있지만 값이 비어 있다. '=' 뒤에 실제 토큰을 넣는다.`);
  process.exit(1);
} else {
  console.log(`→ ${KEY} 정상 (값 길이 ${found}). 이제 node scripts/confluence-probe.js 를 실행한다.`);
}
