const http = require('http');
const fs = require('fs');
const path = require('path');
const { RoomServiceClient } = require('livekit-server-sdk');

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

function loadConfigFile() {
  try {
    const configPath = path.join(__dirname, 'presence.config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function startPresenceServer(options = {}) {
  const fileConfig = loadConfigFile() || {};
  const apiKey = options.apiKey || process.env.LIVEKIT_API_KEY || fileConfig.apiKey;
  const apiSecret = options.apiSecret || process.env.LIVEKIT_API_SECRET || fileConfig.apiSecret;
  const host = options.host || process.env.LIVEKIT_HOST || fileConfig.host || 'http://127.0.0.1:7880';
  const port = Number(options.port || process.env.PRESENCE_PORT || fileConfig.port || 7882);

  if (!apiKey || !apiSecret) {
    throw new Error('Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET');
  }

  const roomService = new RoomServiceClient(host, apiKey, apiSecret);

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
      }
      if (!req.url || !req.url.startsWith('/room-status')) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      const room = url.searchParams.get('room');
      if (!room) {
        sendJson(res, 400, { error: 'missing room' });
        return;
      }
      const participants = await roomService.listParticipants(room);
      const payload = participants.map(p => ({
        identity: p.identity,
        name: p.name || p.identity,
        sid: p.sid
      }));
      sendJson(res, 200, { room, count: payload.length, participants: payload });
    } catch (e) {
      sendJson(res, 500, { error: 'server error' });
    }
  });

  server.listen(port, () => {
    console.log(`Presence server listening on http://127.0.0.1:${port}`);
  });

  return server;
}

if (require.main === module) {
  try {
    startPresenceServer();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { startPresenceServer };
