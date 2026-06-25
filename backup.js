// SQLite 데이터를 매일 1회 backups/ 폴더로 자동 백업 (최근 14개 보관)
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'data.db');
const BACKUP_DIR = path.join(__dirname, 'backups');
const KEEP = 14;

function stamp() {
  // YYYYMMDD-HHMMSS
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function backupNow() {
  if (!fs.existsSync(DB_PATH)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `data-${stamp()}.db`);
  try {
    // WAL 안전 백업: better-sqlite3의 backup API 사용
    const src = new Database(DB_PATH, { readonly: true });
    await src.backup(dest);
    src.close();
    prune();
    console.log(`[backup] 완료: ${path.basename(dest)}`);
  } catch (err) {
    console.error('[backup] 실패:', err.message);
  }
}

function prune() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('data-') && f.endsWith('.db'))
    .sort();
  while (files.length > KEEP) {
    const old = files.shift();
    fs.unlinkSync(path.join(BACKUP_DIR, old));
  }
}

function start() {
  backupNow();                                  // 기동 시 1회
  setInterval(backupNow, 24 * 60 * 60 * 1000);  // 이후 24시간마다
}

module.exports = { start, backupNow };
