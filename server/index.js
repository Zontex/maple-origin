// MapleWeb server entry point

const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');
const { getDb } = require('./db');
const { onConnection } = require('./connection');
const { startCleanupTasks } = require('./cleanup');

// Initialize database
getDb();

// Express app for static files
const app = express();
app.use(express.static(path.join(__dirname, '..', 'TypeScript-Client')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', onConnection);
startCleanupTasks(wss);

// No SIGINT/SIGTERM handlers — nodemon manages the process lifecycle,
// and per-player auto-save already runs on WebSocket close (connection.js).
// Adding signal handlers here closes file descriptors before nodemon's
// pstree cleanup can spawn, causing EBADF errors.

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is listening for connections`);
  console.log(`SQLite database at: maple.db`);
});
