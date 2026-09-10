// .env 파일을 의존성 없이 읽어 process.env에 채우는 최소 로더 (Confluence PAT 보관용)
const fs = require('fs');
const path = require('path');

// KEY=VALUE 한 줄씩. 주석(#)과 빈 줄은 건너뛰고, 값 앞뒤 따옴표는 벗긴다.
// 이미 process.env에 있는 키는 덮지 않는다 — 실행 환경이 파일보다 우선이다.
// dotenv를 쓰지 않은 이유: 의존성 3개로 유지 중이고, 이 정도는 15줄이면 된다.
function load(file = path.join(__dirname, '.env')) {
  const loaded = [];
  if (!fs.existsSync(file)) return loaded;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq <= 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k in process.env) continue;
    process.env[k] = v;
    loaded.push(k);   // 값은 담지 않는다 — 로그에 비밀이 새지 않게 키 이름만 돌려준다
  }
  return loaded;
}

module.exports = { load };
