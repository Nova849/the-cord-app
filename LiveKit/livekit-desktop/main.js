const { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, dialog, session } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// Track all event listeners to prevent memory leaks
const eventListeners = new Set();

let mainWindow = null;
let registeredMuteHotkey = '';
let updatePromptOpen = false;
const isE2eSmoke = process.argv.includes('--e2e-smoke');
const isE2eFull = process.argv.includes('--e2e-full');
const isE2eLive = process.argv.includes('--e2e-live');
const isE2eMode = isE2eSmoke || isE2eFull;
const isE2eAutomation = isE2eMode || isE2eLive;

// Configuration - moved from hardcoded to configurable
const LIVEKIT_SERVER_URL = String(process.env.LIVEKIT_SERVER_URL || '').trim();

if (isE2eAutomation) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
}

function resolveLocalPath(fileName) {
  const localPath = path.join(__dirname, fileName);
  if (fs.existsSync(localPath)) return localPath;
  return path.join(__dirname, '..', fileName);
}

function loadUpdateFeedUrl() {
  if (process.env.THECORD_UPDATE_URL) return process.env.THECORD_UPDATE_URL;
  const candidates = [];
  try {
    if (app?.getPath) {
      candidates.push(path.join(app.getPath('userData'), 'update.config.json'));
    }
  } catch (e) {}
  candidates.push(resolveLocalPath('update.config.json'));
  try {
    for (const configPath of candidates) {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      const url = typeof parsed.updateUrl === 'string' ? parsed.updateUrl.trim() : '';
      if (url) return url;
    }
    return '';
  } catch (e) {
    console.warn('Failed to load update.config.json', e);
    return '';
  }
}

function normalizeUpdateUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function persistUpdateFeedUrl(url) {
  if (!app?.getPath) return '';
  const configPath = path.join(app.getPath('userData'), 'update.config.json');
  const payload = { updateUrl: normalizeUpdateUrl(url) };
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  const feedUrl = normalizeUpdateUrl(loadUpdateFeedUrl());
  if (!feedUrl) {
    console.log('Auto-update disabled (no update URL configured).');
    return;
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    console.log('[auto-update] feed URL', feedUrl);
  } catch (e) {
    console.warn('Failed to set update feed URL', e);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', 'Update available. Downloading...');
    }
  });
  autoUpdater.on('update-not-available', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', 'No updates available.');
    }
  });
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-status', 'Update ready to install.');
    }
    if (updatePromptOpen) return;
    updatePromptOpen = true;
    dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: 'A new version is ready. Restart to install?'
    }).then(result => {
      updatePromptOpen = false;
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    }).catch(() => {
      updatePromptOpen = false;
    });
  });
  autoUpdater.on('error', (err) => {
    const details = err?.stack || err?.message || String(err);
    console.error('Auto-update error', details);
    if (mainWindow && !mainWindow.isDestroyed()) {
      const message = err?.message ? `Update error: ${err.message}` : 'Update error. Check the update URL.';
      mainWindow.webContents.send('update-status', message);
    }
  });
  autoUpdater.checkForUpdates();
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 6 * 60 * 60 * 1000);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = win;

  // Track the window close event for cleanup
  const windowCloseHandler = () => {
    try {
      globalShortcut.unregisterAll();
      } catch (e) {}
  };

  win.on('closed', windowCloseHandler);
  eventListeners.add({ element: win, event: 'closed', handler: windowCloseHandler });

  win.loadFile('index.html');
  if (!app.isPackaged && !isE2eAutomation) {
    win.webContents.openDevTools();
  }
  return win;
}

async function runE2eSmoke(win) {
  const timeoutMs = 20000;
  const timeoutId = setTimeout(() => {
    console.error('[e2e] timeout waiting for renderer');
    app.exit(1);
  }, timeoutMs);

  try {
    if (win.webContents.isLoading()) {
      await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    }
    const result = await win.webContents.executeJavaScript(`(() => {
      const requiredIds = [
        'joinBtn',
        'startStreamBtn',
        'muteSystemBtn',
        'muteMicBtn',
        'connectionStatus',
        'chatDock',
        'chatLog',
        'streams',
        'participantsList'
      ];
      const missing = requiredIds.filter(id => !document.getElementById(id));
      const startDisabled = document.getElementById('startStreamBtn')?.disabled === true;
      const connectionText = document.getElementById('connectionStatus')?.textContent || '';
      return { missing, startDisabled, connectionText };
    })()`, true);

    if (result.missing.length) {
      throw new Error(`Missing elements: ${result.missing.join(', ')}`);
    }
    if (!result.startDisabled) {
      throw new Error('Start Stream should be disabled before joining');
    }
    if (!result.connectionText.trim()) {
      throw new Error('Connection status is empty');
    }

    clearTimeout(timeoutId);
    app.exit(0);
  } catch (e) {
    clearTimeout(timeoutId);
    console.error('[e2e] smoke failed', e);
    app.exit(1);
  }
}

async function runE2eFull(win) {
  const timeoutMs = 30000;
  const timeoutId = setTimeout(() => {
    console.error('[e2e] timeout waiting for renderer');
    app.exit(1);
  }, timeoutMs);

  const exec = (code) => win.webContents.executeJavaScript(code, true);
  const waitFor = async (predicateCode, label, timeout = 15000) => {
    const start = Date.now();
    while ((Date.now() - start) < timeout) {
      const ok = await exec(`(() => ${predicateCode})()`);
      if (ok) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Timeout waiting for ${label}`);
  };

  try {
    if (win.webContents.isLoading()) {
      await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    }

    await exec(`(() => {
      window.__e2eErrors = [];
      window.__e2eAlerts = [];
      window.__e2eMediaErrors = [];
      window.__e2eMediaCalls = [];
      const originalConsoleError = console.error.bind(console);
      console.error = (...args) => {
        window.__e2eErrors.push(args.map(a => String(a)).join(' '));
        originalConsoleError(...args);
      };
      window.addEventListener('error', (event) => {
        window.__e2eErrors.push(event?.message || 'error');
      });
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason;
        window.__e2eErrors.push(reason?.message || String(reason || 'rejection'));
      });
      window.alert = (message) => {
        window.__e2eAlerts.push(String(message || ''));
      };
      const toBase64Url = (obj) => {
        const json = JSON.stringify(obj);
        const base64 = btoa(json).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '');
        return base64;
      };
      const header = toBase64Url({ alg: 'none', typ: 'JWT' });
      const payload = toBase64Url({ video: { room: 'e2e-room' }, sub: 'e2e-user' });
      const token = \`\${header}.\${payload}.\`;
      const jwtInput = document.getElementById('jwtInput');
      const serverUrlInput = document.getElementById('serverUrlInput');
      if (jwtInput) jwtInput.value = token;
      if (serverUrlInput) serverUrlInput.value = 'wss://e2e.local';

      let videoCallCount = 0;
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const createAudioTrack = async () => {
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioCtx();
          const dest = ctx.createMediaStreamDestination();
          const track = dest.stream.getAudioTracks()[0];
          if (track) return track;
        } catch (e) {
          window.__e2eMediaErrors.push(e?.message || 'audio-context-failed');
        }
        const fallback = await originalGetUserMedia({ audio: true });
        return fallback.getAudioTracks()[0];
      };
      const createVideoTrack = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        if (typeof canvas.captureStream === 'function') {
          const stream = canvas.captureStream(30);
          const track = stream.getVideoTracks()[0];
          if (track) return track;
        }
        try {
          const fallback = await originalGetUserMedia({ video: true });
          return fallback.getVideoTracks()[0];
        } catch (e) {
          window.__e2eMediaErrors.push(e?.message || 'video-fallback-failed');
          throw e;
        }
      };
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const needsVideo = !!(constraints && constraints.video);
        const needsAudio = !!(constraints && constraints.audio);
        if (needsVideo) {
          videoCallCount += 1;
          if (videoCallCount === 1) {
            const err = new Error('Overconstrained');
            err.name = 'OverconstrainedError';
            throw err;
          }
        }
        const tracks = [];
        if (needsAudio) {
          try { tracks.push(await createAudioTrack()); } catch (e) { window.__e2eMediaErrors.push(e?.message || 'audio-track-failed'); }
        }
        if (needsVideo) {
          try { tracks.push(await createVideoTrack()); } catch (e) { window.__e2eMediaErrors.push(e?.message || 'video-track-failed'); throw e; }
        }
        window.__e2eMediaCalls.push({
          needsAudio,
          needsVideo,
          audioCount: tracks.filter(t => t?.kind === 'audio').length,
          videoCount: tracks.filter(t => t?.kind === 'video').length
        });
        return new MediaStream(tracks);
      };

      if (window.electronAPI) {
        window.electronAPI.getSources = async () => [{ id: 'screen:1', name: 'E2E Screen' }];
      }

      window.WebSocket = class {
        constructor() {
          this.readyState = 1;
          setTimeout(() => this._onopen?.(), 0);
        }
        addEventListener(type, handler) {
          if (type === 'open') this._onopen = handler;
          if (type === 'close') this._onclose = handler;
          if (type === 'message') this._onmessage = handler;
          if (type === 'error') this._onerror = handler;
        }
        send() {}
        close() {
          this.readyState = 3;
          this._onclose?.();
        }
      };

      window.fetch = async () => ({
        ok: true,
        json: async () => ({ count: 1, participants: ['e2e-user'] })
      });

      const joinBtn = document.getElementById('joinBtn');
      const startBtn = document.getElementById('startStreamBtn');
      window.__e2eClicks = [];
      if (joinBtn && typeof joinBtn.onclick === 'function') {
        const originalJoin = joinBtn.onclick;
        joinBtn.onclick = async (...args) => {
          window.__e2eClicks.push('join');
          return originalJoin.apply(joinBtn, args);
        };
      }
      if (startBtn && typeof startBtn.onclick === 'function') {
        const originalStart = startBtn.onclick;
        startBtn.onclick = async (...args) => {
          window.__e2eClicks.push('start');
          return originalStart.apply(startBtn, args);
        };
      }
    })()`);

    const e2eModeFlag = await exec(`(() => window.__E2E_MODE__ === true)()`);
    if (!e2eModeFlag) {
      const livekitInfo = await exec(`(() => ({
        type: typeof window.LivekitClient,
        hasRoom: !!(window.LivekitClient && window.LivekitClient.Room),
        hasRoomEvent: !!(window.LivekitClient && window.LivekitClient.RoomEvent),
        hasTrack: !!(window.LivekitClient && window.LivekitClient.Track)
      }))()`);
      if (!livekitInfo.hasRoom) {
        throw new Error(`LivekitClient missing Room (${JSON.stringify(livekitInfo)})`);
      }
    }

    await exec(`(() => document.getElementById('joinBtn')?.click())()`);
    await waitFor(`document.getElementById('joinBtn')?.style.display === 'none'`, 'join button hidden');
    await waitFor(`document.getElementById('startStreamBtn')?.disabled === false`, 'start enabled');

    await exec(`(() => document.getElementById('startStreamBtn')?.click())()`);
    await waitFor(`document.getElementById('startStreamBtn')?.textContent === 'Stop Stream'`, 'stream started');
    await waitFor(`document.getElementById('muteSystemBtn')?.disabled === false`, 'system mute enabled');

    await exec(`(() => document.getElementById('startStreamBtn')?.click())()`);
    await waitFor(`document.getElementById('startStreamBtn')?.textContent === 'Start Stream'`, 'stream stopped');

    await exec(`(() => document.getElementById('leaveBtnIcon')?.click())()`);
    await waitFor(`document.getElementById('joinBtn')?.style.display !== 'none'`, 'join button visible');
    await waitFor(`document.getElementById('startStreamBtn')?.disabled === true`, 'start disabled');

    clearTimeout(timeoutId);
    app.exit(0);
  } catch (e) {
    try {
      const diagnostics = await exec(`(() => ({
        joinDisplay: document.getElementById('joinBtn')?.style.display || '',
        joinDisabled: document.getElementById('joinBtn')?.disabled || false,
        connectionText: document.getElementById('connectionStatus')?.textContent || '',
        errorBanner: document.getElementById('errorBanner')?.textContent || '',
        jwtValue: document.getElementById('jwtInput')?.value || '',
        startText: document.getElementById('startStreamBtn')?.textContent || '',
        startDisabled: document.getElementById('startStreamBtn')?.disabled || false,
        streamStatus: document.getElementById('streamStatus')?.textContent || '',
        muteSystemDisabled: document.getElementById('muteSystemBtn')?.disabled || false,
        sourceCount: document.getElementById('sourceSelect')?.options?.length || 0,
        alerts: Array.isArray(window.__e2eAlerts) ? window.__e2eAlerts : [],
        errors: Array.isArray(window.__e2eErrors) ? window.__e2eErrors : [],
        mediaErrors: Array.isArray(window.__e2eMediaErrors) ? window.__e2eMediaErrors : [],
        mediaCalls: Array.isArray(window.__e2eMediaCalls) ? window.__e2eMediaCalls : [],
        clicks: Array.isArray(window.__e2eClicks) ? window.__e2eClicks : []
      }))()`);
      console.error('[e2e] diagnostics', diagnostics);
    } catch (err) {}
    clearTimeout(timeoutId);
    console.error('[e2e] full flow failed', e);
    app.exit(1);
  }
}

async function runE2eLive(win1, win2) {
  const timeoutMs = 180000;
  const timeoutId = setTimeout(() => {
    console.error('[e2e-live] timeout waiting for renderer');
    app.exit(1);
  }, timeoutMs);

  const exec = (win, code) => win.webContents.executeJavaScript(code, true);
  const waitFor = async (win, predicateCode, label, timeout = 20000) => {
    const start = Date.now();
    while ((Date.now() - start) < timeout) {
      const ok = await exec(win, `(() => ${predicateCode})()`);
      if (ok) return;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Timeout waiting for ${label}`);
  };
  const getInboundAudioBytes = async (win) => exec(win, `(() => {
    const room = window.__TEST_HOOKS__?.core?.getRoom?.();
    const pc = room?.engine?.pcManager?.subscriber?.pc
      || room?.engine?.pcManager?.subscriber?._pc
      || room?.engine?.pcManager?.subscriber?.peerConnection;
    if (!pc || typeof pc.getStats !== 'function') return null;
    return pc.getStats().then(stats => {
      let total = 0;
      stats.forEach(r => {
        const kind = r.kind || r.mediaType;
        if (r.type === 'inbound-rtp' && kind === 'audio' && typeof r.bytesReceived === 'number') {
          total += r.bytesReceived;
        }
      });
      return total;
    });
  })()`);
  const getAudioPlaybackSnapshot = async (win) => exec(win, `(() => {
    const els = Array.from(document.querySelectorAll('#streams audio'));
    const live = els.find(el => el.muted === false);
    return {
      anyUnmuted: els.some(el => el.muted === false),
      currentTime: live ? live.currentTime : null
    };
  })()`);
  const waitForInboundAudio = async (win, label, timeout = 20000) => {
    const start = Date.now();
    let last = null;
    while ((Date.now() - start) < timeout) {
      const bytes = await getInboundAudioBytes(win);
      const playback = await getAudioPlaybackSnapshot(win);
      const hasUnmutedAudio = playback?.anyUnmuted;
      if (typeof bytes === 'number') {
        if (last != null && bytes > last) return;
        last = bytes;
      }
      if (hasUnmutedAudio) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timeout waiting for inbound audio: ${label}`);
  };
  const waitForSustainedInboundAudio = async (win, label, durationMs = 15000, timeout = 30000) => {
    const start = Date.now();
    let firstBytes = null;
    let lastBytes = null;
    let firstTime = null;
    let lastTime = null;
    while ((Date.now() - start) < timeout) {
      const bytes = await getInboundAudioBytes(win);
      const playback = await getAudioPlaybackSnapshot(win);
      if (typeof bytes === 'number') {
        if (firstBytes == null) firstBytes = bytes;
        lastBytes = bytes;
      }
      if (playback && playback.anyUnmuted && typeof playback.currentTime === 'number') {
        if (firstTime == null) firstTime = playback.currentTime;
        lastTime = playback.currentTime;
      }
      const elapsed = Date.now() - start;
      if (elapsed >= durationMs) {
        if (typeof firstBytes === 'number' && typeof lastBytes === 'number') {
          if (lastBytes > firstBytes + 5000) return;
        }
        if (typeof firstTime === 'number' && typeof lastTime === 'number') {
          if (lastTime > firstTime + 5) return;
        }
        throw new Error(`Sustained audio check failed: ${label}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Timeout waiting for sustained audio: ${label}`);
  };

  const serverUrl = LIVEKIT_SERVER_URL || 'ws://192.168.1.240:7880';
  const token1 = process.env.LIVEKIT_TOKEN_1;
  const token2 = process.env.LIVEKIT_TOKEN_2;
  if (!token1 || !token2) {
    clearTimeout(timeoutId);
    console.error('[e2e-live] missing LIVEKIT_TOKEN_1 or LIVEKIT_TOKEN_2');
    app.exit(1);
    return;
  }

  try {
    if (win1.webContents.isLoading()) {
      await new Promise(resolve => win1.webContents.once('did-finish-load', resolve));
    }
    if (win2.webContents.isLoading()) {
      await new Promise(resolve => win2.webContents.once('did-finish-load', resolve));
    }

    const injectTone = `(() => {
      if (window.__e2eToneInjected) return;
      window.__e2eToneInjected = true;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const needsAudio = !!(constraints && constraints.audio);
        const needsVideo = !!(constraints && constraints.video);
        const tracks = [];
        if (needsAudio) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioCtx();
          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0.2;
          osc.frequency.value = 440;
          osc.connect(gain);
          const dest = ctx.createMediaStreamDestination();
          gain.connect(dest);
          osc.start();
          const track = dest.stream.getAudioTracks()[0];
          if (track) tracks.push(track);
          window.__e2eToneCtx = ctx;
          window.__e2eToneOsc = osc;
        }
        if (needsVideo) {
          try {
            const video = await original({ video: true });
            video.getVideoTracks().forEach(t => tracks.push(t));
          } catch (e) {}
        }
        return new MediaStream(tracks);
      };
    })()`;
    await exec(win1, injectTone);
    await exec(win2, injectTone);

    await exec(win1, `(() => {
      const jwtInput = document.getElementById('jwtInput');
      const serverUrlInput = document.getElementById('serverUrlInput');
      if (jwtInput) jwtInput.value = ${JSON.stringify(token1)};
      if (serverUrlInput) serverUrlInput.value = ${JSON.stringify(serverUrl)};
    })()`);
    await exec(win2, `(() => {
      const jwtInput = document.getElementById('jwtInput');
      const serverUrlInput = document.getElementById('serverUrlInput');
      if (jwtInput) jwtInput.value = ${JSON.stringify(token2)};
      if (serverUrlInput) serverUrlInput.value = ${JSON.stringify(serverUrl)};
    })()`);

    await exec(win1, `(() => document.getElementById('joinBtn')?.click())()`);
    await waitFor(
      win1,
      `(() => {
        const text = document.getElementById('connectionStatus')?.textContent || '';
        return text && !text.toLowerCase().includes('disconnected');
      })()`,
      'user1 connect'
    );
    await waitFor(
      win1,
      `(() => document.querySelectorAll('#streams audio').length > 0)()`,
      'user1 mic publish'
    );

    await exec(win2, `(() => document.getElementById('joinBtn')?.click())()`);
    await waitFor(
      win2,
      `(() => {
        const text = document.getElementById('connectionStatus')?.textContent || '';
        return text && !text.toLowerCase().includes('disconnected');
      })()`,
      'user2 connect'
    );

    await waitForInboundAudio(win2, 'user2 hears user1');
    await waitForInboundAudio(win1, 'user1 hears user2');
    await Promise.all([
      waitForSustainedInboundAudio(win2, 'user2 sustained audio before rejoin', 15000),
      waitForSustainedInboundAudio(win1, 'user1 sustained audio before rejoin', 15000)
    ]);

    // user2 leaves and rejoins
    await exec(win2, `(() => document.getElementById('joinBtn')?.click())()`);
    await waitFor(
      win2,
      `(() => {
        const text = document.getElementById('connectionStatus')?.textContent || '';
        return text.toLowerCase().includes('disconnected');
      })()`,
      'user2 disconnect'
    );
    await exec(win2, `(() => document.getElementById('joinBtn')?.click())()`);
    await waitFor(
      win2,
      `(() => {
        const text = document.getElementById('connectionStatus')?.textContent || '';
        return text && !text.toLowerCase().includes('disconnected');
      })()`,
      'user2 reconnect'
    );
    await waitForInboundAudio(win2, 'user2 hears user1 after rejoin');
    await waitForInboundAudio(win1, 'user1 hears user2 after rejoin');
    await Promise.all([
      waitForSustainedInboundAudio(win2, 'user2 sustained audio after rejoin', 15000),
      waitForSustainedInboundAudio(win1, 'user1 sustained audio after rejoin', 15000)
    ]);

    // user1 leaves and rejoins
    await exec(win1, `(() => document.getElementById('joinBtn')?.click())()`);
    await waitFor(
      win1,
      `(() => {
        const text = document.getElementById('connectionStatus')?.textContent || '';
        return text.toLowerCase().includes('disconnected');
      })()`,
      'user1 disconnect'
    );
    await exec(win1, `(() => document.getElementById('joinBtn')?.click())()`);
    await waitFor(
      win1,
      `(() => {
        const text = document.getElementById('connectionStatus')?.textContent || '';
        return text && !text.toLowerCase().includes('disconnected');
      })()`,
      'user1 reconnect'
    );
    await waitForInboundAudio(win1, 'user1 hears user2 after rejoin');
    await waitForInboundAudio(win2, 'user2 hears user1 after rejoin');
    await Promise.all([
      waitForSustainedInboundAudio(win1, 'user1 sustained audio after rejoin 2', 15000),
      waitForSustainedInboundAudio(win2, 'user2 sustained audio after rejoin 2', 15000)
    ]);

    clearTimeout(timeoutId);
    app.exit(0);
  } catch (e) {
    clearTimeout(timeoutId);
    try {
      const diag1 = await exec(win1, `(() => ({
        connectionStatus: document.getElementById('connectionStatus')?.textContent || '',
        audioCount: document.querySelectorAll('#streams audio').length,
        unmutedAudioCount: Array.from(document.querySelectorAll('#streams audio')).filter(el => el.muted === false).length,
        inboundBytes: window.__TEST_HOOKS__?.core?.getRoom?.()?.engine?.pcManager?.subscriber?.pc ? 'available' : 'unavailable',
        hooks: Boolean(window.__TEST_HOOKS__?.core)
      }))()`);
      const diag2 = await exec(win2, `(() => ({
        connectionStatus: document.getElementById('connectionStatus')?.textContent || '',
        audioCount: document.querySelectorAll('#streams audio').length,
        unmutedAudioCount: Array.from(document.querySelectorAll('#streams audio')).filter(el => el.muted === false).length,
        inboundBytes: window.__TEST_HOOKS__?.core?.getRoom?.()?.engine?.pcManager?.subscriber?.pc ? 'available' : 'unavailable',
        hooks: Boolean(window.__TEST_HOOKS__?.core)
      }))()`);
      console.error('[e2e-live] diagnostics', { user1: diag1, user2: diag2 });
    } catch (err) {}
    console.error('[e2e-live] failed', e);
    app.exit(1);
  }
}

app.whenReady().then(() => {
  if (isE2eMode) {
    try {
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['https://cdn.jsdelivr.net/npm/livekit-client*', 'https://cdn.jsdelivr.net/npm/livekit-client@*'] },
        (details, callback) => callback({ cancel: true })
      );
    } catch (e) {}
  }
  if (!isE2eAutomation) {
    const win = createWindow();
    setupAutoUpdater();
    return;
  }
  if (isE2eLive) {
    const win1 = createWindow();
    const win2 = createWindow();
    runE2eLive(win1, win2);
    return;
  }
  const win = createWindow();
  if (isE2eFull) {
    runE2eFull(win);
  } else {
    runE2eSmoke(win);
  }
});

// Add cleanup function to properly remove all event listeners
function cleanupEventListeners() {
  try {
    eventListeners.forEach(({ element, event, handler }) => {
      if (element && element.removeEventListener) {
        element.removeEventListener(event, handler);
  }
    });
    eventListeners.clear();
  } catch (e) {
    console.warn('Error during event listener cleanup:', e);
  }
}

// Add cleanup for autoUpdater events
function cleanupAutoUpdater() {
  try {
    autoUpdater.removeAllListeners();
  } catch (e) {
    console.warn('Error during autoUpdater cleanup:', e);
  }
}

app.on('before-quit', () => {
  cleanupEventListeners();
  cleanupAutoUpdater();
  try {
    globalShortcut.unregisterAll();
  } catch (e) {}
});

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

ipcMain.handle('set-mute-hotkey', async (event, accelerator) => {
  try {
    const next = String(accelerator || '').trim();
    if (registeredMuteHotkey) {
      try { globalShortcut.unregister(registeredMuteHotkey); } catch (e) {}
      registeredMuteHotkey = '';
    }
    if (!next) return { ok: true, registered: '' };
    const success = globalShortcut.register(next, () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-mute-toggle');
        }
      } catch (e) {}
    });
    if (success) registeredMuteHotkey = next;
    return { ok: success, registered: success ? next : '' };
  } catch (e) {
    return { ok: false, registered: '' };
  }
});

ipcMain.handle('set-update-feed-url', async (event, url) => {
  try {
    const next = normalizeUpdateUrl(url);
    persistUpdateFeedUrl(next);
    if (app.isPackaged && next) {
      try {
        autoUpdater.setFeedURL({ provider: 'generic', url: next });
        autoUpdater.checkForUpdates();
      } catch (e) {
        return { ok: false, error: e?.message || 'Failed to set feed URL' };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Failed to save update URL' };
  }
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    return { ok: false, message: 'Updates require a packaged build.' };
  }
  const feedUrl = normalizeUpdateUrl(loadUpdateFeedUrl());
  if (!feedUrl) {
    return { ok: false, message: 'Update feed URL not set.' };
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  } catch (e) {
    console.warn('Failed to set update URL', e);
    return { ok: false, message: 'Failed to set update URL.' };
  }
  try {
    console.log('[auto-update] checkForUpdates', feedUrl);
    autoUpdater.checkForUpdates();
    return { ok: true, message: 'Checking for updates...' };
  } catch (e) {
    console.warn('Update check failed', e);
    return { ok: false, message: 'Update check failed.' };
  }
});

ipcMain.handle('get-app-version', async () => {
  try {
    return { ok: true, version: app.getVersion() };
  } catch (e) {
    return { ok: false, version: '' };
  }
});

ipcMain.handle('get-config', async () => {
  try {
    return {
      ok: true,
      livekitServerUrl: LIVEKIT_SERVER_URL
    };
  } catch (e) {
    return {
      ok: false,
      livekitServerUrl: ''
    };
  }
});
