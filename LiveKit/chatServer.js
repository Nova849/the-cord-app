const { WebSocketServer } = require('ws');

const PORT = Number(process.env.CHAT_PORT || 7883);
const MAX_HISTORY = 200;

const rooms = new Map();

function getRoom(room) {
  if (!rooms.has(room)) {
    rooms.set(room, { messages: [], clients: new Set() });
  }
  return rooms.get(room);
}

function pushMessage(room, message) {
  const data = getRoom(room);
  data.messages.push(message);
  if (data.messages.length > MAX_HISTORY) {
    data.messages.shift();
  }
}

function broadcast(room, payload) {
  const data = getRoom(room);
  const msg = JSON.stringify(payload);
  data.clients.forEach(ws => {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  });
}

function startChatServer(options = {}) {
  const port = Number(options.port || PORT);
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws) => {
    ws.room = null;
    ws.name = null;

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }
      if (data.type === 'join') {
        const room = data.room || 'default';
        const name = data.name || 'Unknown';
        ws.room = room;
        ws.name = name;
        const roomData = getRoom(room);
        roomData.clients.add(ws);
        ws.send(JSON.stringify({ type: 'history', room, messages: roomData.messages }));
        return;
      }
      if (data.type === 'message') {
        const room = data.room || ws.room || 'default';
        const payload = {
          type: 'message',
          room,
          name: data.name || ws.name || 'Unknown',
          message: data.message || '',
          ts: data.ts || Date.now()
        };
        if (!payload.message) return;
        pushMessage(room, payload);
        broadcast(room, payload);
      }
    });

    ws.on('close', () => {
      if (ws.room && rooms.has(ws.room)) {
        rooms.get(ws.room).clients.delete(ws);
      }
    });
  });

  console.log(`Chat server listening on ws://127.0.0.1:${port}`);
  return wss;
}

if (require.main === module) {
  startChatServer();
}

module.exports = { startChatServer };
