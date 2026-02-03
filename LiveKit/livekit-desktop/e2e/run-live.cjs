const path = require('path');
const { spawn } = require('child_process');
const electronPath = require('electron');
const appDir = path.resolve(__dirname, '..');

const serverUrl = String(process.env.LIVEKIT_SERVER_URL || 'ws://192.168.1.240:7880').trim();
const room = String(process.env.LIVEKIT_ROOM || 'test').trim();

const token1 = process.env.LIVEKIT_TOKEN_1;
const token2 = process.env.LIVEKIT_TOKEN_2;

const apiKey = String(process.env.LIVEKIT_API_KEY || 'mykey123').trim();
const apiSecret = String(process.env.LIVEKIT_API_SECRET || 'f9A3kL8pQ2xM7vD1rS6bH0tW4nZ5yUeK').trim();
let AccessToken = null;

function buildToken(identity) {
  if (!AccessToken) {
    throw new Error('AccessToken not available. Provide LIVEKIT_TOKEN_1/2 or install livekit-server-sdk.');
  }
  const token = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 * 60 });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishData: true,
    canUpdateOwnMetadata: true
  });
  return token.toJwt();
}

async function resolveTokens() {
  if (token1 && token2) return { token1, token2 };
  if (!apiKey || !apiSecret) {
    throw new Error('Missing LiveKit credentials. Set LIVEKIT_TOKEN_1/2 or LIVEKIT_API_KEY/SECRET.');
  }
  let AccessToken;
  try {
    ({ AccessToken } = require('livekit-server-sdk'));
  } catch (err) {
    throw new Error('livekit-server-sdk is required to generate tokens. Install it or provide LIVEKIT_TOKEN_1/2.');
  }
  return {
    token1: await buildToken('e2e-user-1'),
    token2: await buildToken('e2e-user-2')
  };
}

(async () => {
  try {
    const { token1: t1, token2: t2 } = await resolveTokens();
    const args = [appDir, '--e2e-live'];
    const env = {
      ...process.env,
      E2E_LIVE: '1',
      LIVEKIT_SERVER_URL: serverUrl,
      LIVEKIT_ROOM: room,
      LIVEKIT_TOKEN_1: t1,
      LIVEKIT_TOKEN_2: t2
    };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronPath, args, { stdio: 'inherit', env });
    child.on('exit', (code) => {
      process.exit(code == null ? 1 : code);
    });
  } catch (err) {
    console.error('[e2e-live] failed to start', err?.message || err);
    process.exit(1);
  }
})();
