// MapleWeb server entry point

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const { getDb } = require('./db');
const { onConnection } = require('./connection');
const { startCleanupTasks } = require('./cleanup');
const { saveAllConnected } = require('./handlers/auth');
const { closeDb } = require('./db');

// Initialize database
getDb();
// Feature modules register their message handlers on load
require('./features');

// Express app for static files
const app = express();
app.use(express.static(path.join(__dirname, '..', 'TypeScript-Client')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', onConnection);
startCleanupTasks(wss);

// Graceful shutdown: a kill or restart used to lose everything since each
// client's last save. Saves are synchronous SQLite writes, so they complete
// before the process exits; the sockets are then closed so clients reconnect
// instead of lingering on a dead server. Guarded so a second signal during
// the save does not re-enter.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const n = saveAllConnected();
  console.log(`[Shutdown] ${signal}: saved ${n} character(s)`);
  try {
    for (const client of wss.clients) {
      try { client.close(1012, 'server_restart'); } catch (e) { /* closing anyway */ }
    }
    closeDb();
  } catch (e) {
    console.error('[Shutdown] cleanup error:', e);
  }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is listening for connections`);
  console.log(`SQLite database at: maple.db`);
});
