// Mob-host election harness — drives fake WebSocket clients against the
// live server on :3001 and verifies every host-assignment scenario,
// including the "mobs frozen" failure modes. Run: node tools/host-harness.js
// Uses map 999999901 so it never touches a real session.const WebSocket = require('ws');

const URL = 'ws://localhost:3001';
const MAP = 999999901;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Fake {
  constructor(name) {
    this.name = name;
    this.playerId = null;
    this.hostEvents = []; // {isHost, at}
    this.open = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      const to = setTimeout(() => reject(new Error('connect timeout')), 5000);
      this.ws.on('open', () => { this.open = true; });
      this.ws.on('message', (m) => {
        let d; try { d = JSON.parse(m.toString()); } catch { return; }
        if (d.type === 'player_id') { this.playerId = d.id; clearTimeout(to); resolve(); }
        if (d.type === 'mob_host_assign') {
          this.hostEvents.push({ isHost: d.isHost, at: Date.now() });
          log(`${this.name} <- mob_host_assign isHost=${d.isHost}`);
        }
        if (d.type === 'reregister') {
          this.gotReregister = true;
          log(`${this.name} <- reregister`);
        }
      });
      this.ws.on('error', reject);
      this.ws.on('close', () => { this.open = false; });
    });
  }
  send(type, data) { if (this.open) this.ws.send(JSON.stringify({ type, data })); }
  register() {
    this.send('player_info', {
      id: this.playerId, name: this.name, mapId: MAP, x: 0, y: 0,
      stance: 'stand1', frame: 0, flipped: false, hair: 30030, face: 20000,
      skin: 0, level: 1, job: 0, hp: 50, maxHp: 50, equipped: [],
    });
  }
  heartbeat() { this.send('heartbeat', {}); }
  mobBatch() {
    this.send('mob_state_batch', { mapId: MAP, mobs: [{ oId: 0, x: 1, y: 1, stance: 'stand', frame: 0, flipped: false, hp: 10 }] });
  }
  requestHostCheck() { this.send('request_host_check', {}); }
  lastHost() { return this.hostEvents.length ? this.hostEvents[this.hostEvents.length - 1].isHost : null; }
  closeClean() { this.ws.close(); }
  killHard() { this.ws.terminate(); }
}

const t0 = Date.now();
const log = (s) => console.log(`[${String(Date.now() - t0).padStart(6)}ms] ${s}`);
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  // ── S1: first joiner becomes host ───────────────────────────────
  const A = new Fake('A');
  await A.connect(); A.register();
  await sleep(1500);
  check('S1 first joiner becomes host', A.lastHost() === true, `A=${A.lastHost()}`);

  // ── S2: second joiner told NOT host, first stays host ───────────
  const B = new Fake('B');
  await B.connect(); B.register();
  await sleep(1500);
  check('S2 second joiner told not-host', B.lastHost() === false, `B=${B.lastHost()}`);

  // Keep both "alive" with heartbeats
  const hbA = setInterval(() => A.heartbeat(), 1000);
  const hbB = setInterval(() => B.heartbeat(), 1000);

  // ── S3: refresh — host closes cleanly, survivor must be promoted ─
  clearInterval(hbA); A.closeClean();
  await sleep(2000);
  check('S3 clean close promotes survivor', B.lastHost() === true, `B=${B.lastHost()}`);

  // ── S4: rejoin after refresh — new tab of the same user ─────────
  const A2 = new Fake('A2');
  await A2.connect(); A2.register();
  const hbA2 = setInterval(() => A2.heartbeat(), 1000);
  await sleep(1500);
  check('S4 rejoiner told its role', A2.lastHost() !== null, `A2=${A2.lastHost()}`);

  // ── S5: backgrounded host — stops heartbeats, keeps mob batches ──
  // B is host. Stop B's heartbeats but keep its setInterval-style batches.
  clearInterval(hbB);
  const bBatch = setInterval(() => B.mobBatch(), 500);
  log('B heartbeats stopped (simulating backgrounded tab), batches continue');
  await sleep(17000); // stale after 10s + 5s sweep + margin
  check('S5 stale host replaced despite batches', A2.lastHost() === true, `A2=${A2.lastHost()}`);
  clearInterval(bBatch);

  // ── S6: victim-initiated recovery — request_host_check answered ──
  const before = A2.hostEvents.length;
  A2.requestHostCheck();
  await sleep(1500);
  check('S6 request_host_check answered', A2.hostEvents.length > before,
    `events ${before} -> ${A2.hostEvents.length}`);

  // ── S7: hard-kill host (crashed tab, no close frame) ────────────
  clearInterval(hbA2);
  A2.killHard();
  const C = new Fake('C');
  await C.connect(); C.register();
  const hbC = setInterval(() => C.heartbeat(), 1000);
  await sleep(17000);
  check('S7 hard-killed host replaced', C.lastHost() === true, `C=${C.lastHost()}`);

  // ── S8: THE BUG — unregistered client asks for a host check ─────
  // Simulates a client that reconnected mid-map-load: player_info was
  // deferred, so the server has info=null. Its watchdog fires
  // request_host_check. Before the fix this was silently dropped forever.
  const D = new Fake('D');
  await D.connect(); // deliberately NOT registered
  D.requestHostCheck();
  await sleep(1500);
  check('S8a unregistered check answered with reregister', D.gotReregister === true);
  // The real client re-sends player_info on 'reregister' — emulate that
  D.register();
  await sleep(1500);
  check('S8b registration after reregister yields a role', D.lastHost() !== null, `D=${D.lastHost()}`);
  D.closeClean();

  clearInterval(hbC); B.closeClean(); C.closeClean();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n══ ${results.length - failed.length}/${results.length} passed ══`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('harness error:', e.message); process.exit(2); });
