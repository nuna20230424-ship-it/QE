// 재발급한 Confluence PAT가 이 인스턴스에서 실제로 먹는지만 한 번에 판정한다 (토큰 값은 출력하지 않는다)
// 사용법: node scripts/pat-check.js
// 읽기 전용 — 대시보드 DB도, Confluence도 바꾸지 않는다.
const client = require('../confluence-client');

// 한글 라벨은 글자폭이 달라 padEnd로 맞추면 오히려 어긋난다. 그냥 붙인다.
const line = (k, v) => console.log(`${k} : ${v}`);

(async () => {
  const c = client.config();

  // 값이 아니라 형태만 본다. 길이가 0이면 .env 형식이 틀렸거나 환경변수가 안 잡힌 것이다.
  line('baseUrl', c.baseUrl || '(비어 있음 — config.json confluence.baseUrl)');
  line('토큰 길이', c.token.length || '0  ← 토큰이 안 잡혔다');
  console.log('');

  if (!c.baseUrl || !c.token) {
    console.log('판정: 확인 불가 — 위에서 비어 있는 값을 먼저 채운다.');
    console.log('      node scripts/env-check.js 로 .env 형태를 진단할 수 있다.');
    process.exitCode = 1;
    return;
  }

  let r;
  try {
    r = await client.checkAuth(c);
  } catch (e) {
    console.log(`판정: 확인 불가 — 요청 자체가 실패했다 (${e.message})`);
    console.log('      사내망·VPN 연결을 확인한다.');
    process.exitCode = 1;
    return;
  }

  line('요청', r.url);
  line('상태코드', r.status);
  line('인식된 계정', r.who || '(없음)');
  console.log('');

  // 200이 곧 성공은 아니다. 익명 열람이 켜진 인스턴스는 토큰을 무시하고도 200을 돌려준다.
  if (r.authenticated) {
    console.log(`판정: ✅ 토큰이 먹는다 (계정 ${r.who})`);
    console.log('      다음 → node scripts/confluence-probe.js');
    return;
  }
  if (r.anonymous) {
    console.log('판정: ❌ 토큰이 무시됐다 — 서버가 익명으로 처리했다.');
    console.log('      상태코드가 200이어도 인증은 안 붙은 것이다.');
    console.log('      확인 순서: (1) 토큰을 복사할 때 앞뒤가 잘리지 않았는지');
    console.log('                 (2) 개인 액세스 토큰 페이지에 그 토큰이 살아 있는지');
    console.log('                 (3) 그래도 같으면 리버스프록시가 Authorization 헤더를 떼는지 관리자 확인');
    process.exitCode = 1;
    return;
  }
  console.log(`판정: ❌ 인증 거부 (${r.status})`);
  console.log('      토큰이 만료됐거나 이 인스턴스에서 PAT가 꺼져 있다.');
  process.exitCode = 1;
})();
