const LiveKit = window.LivekitClient;

const LIVEKIT_URL = "";
const DEBUG = false;
const debug = (...args) => { if (DEBUG) console.log(...args); };
const logInfo = (...args) => { if (DEBUG) console.info(...args); };
const settingsKey = "livekit_settings";
const PRESENCE_PORT = 7882;
const CHAT_PORT = 7883;

let room;
let micStream, micAudioTrack;
let screenStream, screenVideoTrack, screenAudioTrack;
let senderStatsTimer = null;
let screenSenderConfigured = false;
let desiredScreenMaxBitrate = 0;
let desiredScreenMaxFramerate = 0;
let currentStreamSendMbps = null;
let lastJoinToken = '';
let manualDisconnect = false;
let autoRejoinTimer = null;
let currentStreamSettings = { res: '', fps: '', maxKbps: '' };
let desiredSourceId = '';
let desiredPlaybackDeviceId = 'default';
let desiredInputDeviceId = 'default';
const minimizedTiles = new Set();
const minimizedParticipants = new Set();
let isStreaming = false;
let muteIncomingAll = false;
let micMuted = false;
// let manualMicGain = 1;
// let micGainNode = null;
// let micPublishMode = 'raw';
const micProcessing = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  noiseGateEnabled: true,
  noiseGateLevel: 35,
  enhancedVoiceEnabled: false,
  enhancedVoiceLevel: 40
};
let micGateState = null;
let pingTimer = null;
let audioLevelTimer = null;
let roomPreviewTimer = null;
let lastPreviewState = { count: null, names: [] };
let lastPingMs = null;
let chatSocket = null;
let chatSocketReady = false;
let chatRoomName = '';
let chatUserName = '';
let chatServerUrl = '';
let chatReconnectTimer = null;
let lastLocalChat = null;
let desiredChatWidth = 320;
let chatCollapsed = false;
let muteHotkey = '';
let capturingHotkey = false;
let autoCollapsedForWidth = false;
let desiredLeftWidth = 320;
let muteBroadcastTimer = null;
const participantAudioEls = new Map();
const participantAudioControls = new Map();
const participantListAudioControls = new Map();
const participantWatchControls = new Map();
const participantQuality = new Map();
const participantAudioSettingsKey = 'livekit_participant_audio';
const participantAudioSettings = new Map();
const participantStreamAudioEls = new Map();
const participantStreamAudioControls = new Map();
const participantStreamAudioSettings = new Map();
const participantAudioTracks = new Map();
const participantsById = new Map();
const watchedVideoParticipants = new Set();
const pendingStreamAudioPlay = new Set();

function kickStreamAudioPlayback(participantId) {
  try {
    const audioEl = participantStreamAudioEls.get(participantId);
    if (!audioEl) return;
    const saved = participantStreamAudioSettings.get(participantId);
    if (!saved) {
      audioEl.volume = 1;
      audioEl.muted = muteIncomingAll ? true : false;
    }
    if (audioEl.paused) {
      audioEl.play().catch(err => logInfo('[watch] stream audio play blocked', err));
    }
  } catch (e) {}
}
const participantMicMuted = new Map();
const participantMuteListeners = new WeakSet();
const participantMeters = new Map();
const participantAnalyzers = new Map();
const participantMeterRaf = new Map();
const meterMediaSources = new WeakMap();
const participantStreamMeters = new Map();
const participantStreamAnalyzers = new Map();
const participantStreamMeterRaf = new Map();
const missingStreamAudioLogged = new Set();
let audioContext = null;
const participantVideoPubs = new Map();

const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startStreamBtn");

const jwtInput = document.getElementById("jwtInput");
const streamsDiv = document.getElementById("streams");
const participantsList = document.getElementById("participantsList");
const sourceSelect = document.getElementById("sourceSelect");
const playbackDeviceSelect = document.getElementById("playbackDeviceSelect");
const inputDeviceSelect = document.getElementById("inputDeviceSelect");
const streamStatus = document.getElementById("streamStatus");
const reconnectBanner = document.getElementById("reconnectBanner");
const errorBanner = document.getElementById("errorBanner");
const themeToggle = document.getElementById("themeToggle");
const theaterToggle = document.getElementById("theaterToggle");
const minimizedPanel = document.getElementById("minimizedPanel");
const minimizedStreams = document.getElementById("minimizedStreams");
const serverUrlInput = document.getElementById("serverUrlInput");
const chatServerInput = document.getElementById("chatServerInput");
const presenceServerInput = document.getElementById("presenceServerInput");
const updateServerInput = document.getElementById("updateServerInput");
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const roomPreviewStatus = document.getElementById("roomPreviewStatus");
const roomPreviewList = document.getElementById("roomPreviewList");
const roomAccessSection = document.getElementById("roomAccessSection");
const audioSettingsBtn = document.getElementById("audioSettingsBtn");
const roomPreviewSection = document.getElementById("roomPreviewSection");
const chatDock = document.getElementById("chatDock");
const chatCollapseBtn = document.getElementById("chatCollapseBtn");
const chatStatus = document.getElementById("chatStatus");
const forceUpdateBtn = document.getElementById("forceUpdateBtn");
const updateStatusText = document.getElementById("updateStatusText");
const updateVersionText = document.getElementById("updateVersionText");
const updateLastCheckedText = document.getElementById("updateLastCheckedText");
const servicesSection = document.getElementById("servicesSection");
const servicesToggle = document.getElementById("servicesToggle");
const streamSetupSection = document.getElementById("streamSetupSection");
const audioSettingsOverlay = document.getElementById("audioSettingsOverlay");
const audioSettingsClose = document.getElementById("audioSettingsClose");
const noiseGateBtn = document.getElementById("noiseGateBtn");
const noiseGateSlider = document.getElementById("noiseGateSlider");
const noiseGateValue = document.getElementById("noiseGateValue");
const enhancedVoiceBtn = document.getElementById("enhancedVoiceBtn");
const enhancedVoiceSlider = document.getElementById("enhancedVoiceSlider");
const enhancedVoiceValue = document.getElementById("enhancedVoiceValue");
const muteHotkeyBtn = document.getElementById("muteHotkeyBtn");
const muteHotkeyDisplay = document.getElementById("muteHotkeyDisplay");
const leaveBtnIcon = document.getElementById("leaveBtnIcon");
const collapsibleSections = document.querySelectorAll("#streamSetupSection.section.collapsible");
const collapseStateKey = "livekit_collapse_state";
const layoutEl = document.querySelector(".layout");
const chatResizeHandle = document.getElementById("chatResizeHandle");
const chatPanel = document.querySelector(".chat-panel");
const leftResizeHandle = document.getElementById("leftResizeHandle");
function setConnectionStatus(text) {
  try {
    const el = document.getElementById('connectionStatus');
    if (!el) { console.warn('connectionStatus element not found'); return; }
    el.textContent = text;
  } catch (e) { console.warn('setConnectionStatus error', e); }
}

function formatConnectionStatus() {
  try {
    if (!room || !room.localParticipant) return 'Disconnected';
    const name = room.localParticipant.identity || 'you';
    const pingText = lastPingMs == null ? '-- ms' : `${lastPingMs} ms`;
    return { name, pingText };
  } catch (e) {}
  return { name: 'Connected', pingText: '-- ms' };
}

function renderConnectionStatus() {
  try {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    if (!room || !room.localParticipant) {
      el.textContent = 'Disconnected';
      el.classList.remove('ping-good', 'ping-warn', 'ping-bad');
      return;
    }
    const data = formatConnectionStatus();
    el.innerHTML = '';
    el.classList.remove('ping-good', 'ping-warn', 'ping-bad');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = data.name;
    const sep = document.createElement('span');
    sep.textContent = ' | ';
    const pingSpan = document.createElement('span');
    pingSpan.id = 'connectionPing';
    pingSpan.textContent = data.pingText;
    if (lastPingMs != null) {
      if (lastPingMs <= 60) el.classList.add('ping-good');
      else if (lastPingMs <= 120) el.classList.add('ping-warn');
      else el.classList.add('ping-bad');
    }
    el.appendChild(nameSpan);
    el.appendChild(sep);
    el.appendChild(pingSpan);
  } catch (e) {}
}

function setStreamStatus(text) {
  if (!streamStatus) return;
  streamStatus.textContent = text || '';
  streamStatus.style.display = text ? 'block' : 'none';
}

function setReconnectBanner(visible) {
  if (!reconnectBanner) return;
  reconnectBanner.style.display = visible ? 'block' : 'none';
}

function setErrorBanner(message) {
  if (!errorBanner) return;
  errorBanner.textContent = message || '';
  errorBanner.style.display = message ? 'block' : 'none';
}

let updateStatusTimer = null;
let updateLastChecked = null;
function setUpdateStatus(message) {
  if (!updateStatusText) return;
  updateStatusText.textContent = message || '';
  if (updateStatusTimer) clearTimeout(updateStatusTimer);
  const shouldPersist = !!message && /no updates available|update ready to install|update error/i.test(message);
  if (message && !shouldPersist) {
    updateStatusTimer = setTimeout(() => {
      if (updateStatusText) updateStatusText.textContent = '';
    }, 6000);
  }
}

function setUpdateVersion(version) {
  if (!updateVersionText) return;
  updateVersionText.textContent = `Version: ${version || '--'}`;
}

function formatUpdateTimestamp(date) {
  if (!date) return '--';
  return date.toLocaleString();
}

function setUpdateLastChecked(date) {
  updateLastChecked = date || null;
  if (!updateLastCheckedText) return;
  updateLastCheckedText.textContent = `Last checked: ${formatUpdateTimestamp(updateLastChecked)}`;
}

function setPingDisplay(ms) {
  if (ms == null) {
    if (lastPingMs == null) {
      lastPingMs = null;
    }
  } else {
    lastPingMs = Math.max(1, Math.round(ms));
  }
  renderConnectionStatus();
}

function getRoomFromToken(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4;
    if (pad) payload += '='.repeat(4 - pad);
    const json = atob(payload);
    const data = JSON.parse(json);
    return data?.video?.room || data?.room || null;
  } catch (e) {
    logInfo('[token] failed to parse room', {
      error: e?.message,
      hasToken: !!token,
      tokenLength: token?.length || 0
    });
  }
  return null;
}

function getNameFromToken(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4;
    if (pad) payload += '='.repeat(4 - pad);
    const json = atob(payload);
    const data = JSON.parse(json);
    return data?.sub || data?.name || null;
  } catch (e) {
    logInfo('[token] failed to parse name', {
      error: e?.message,
      hasToken: !!token,
      tokenLength: token?.length || 0
    });
  }
  return null;
}

function resolveLivekitHostInfo() {
  const raw = serverUrlInput?.value?.trim() || LIVEKIT_URL || '';
  if (!raw) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
  const candidate = hasScheme ? raw : `https://${raw}`;
  try {
    const parsed = new URL(candidate);
    const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
    return { hostname: parsed.hostname, secure };
  } catch (e) {
    logInfo('[services] failed to parse server url', { error: e?.message });
  }
  return null;
}

function normalizeChatUrl(raw) {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `ws://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
    if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') parsed.protocol = 'ws:';
    if (!hasScheme && !parsed.port) parsed.port = String(CHAT_PORT);
    const result = parsed.toString();
    return result.endsWith('/') ? result.slice(0, -1) : result;
  } catch (e) {
    logInfo('[chat] failed to parse chat server url', { error: e?.message });
  }
  return '';
}

function normalizePresenceUrl(raw) {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
    if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') parsed.protocol = 'http:';
    if (!hasScheme && !parsed.port) parsed.port = String(PRESENCE_PORT);
    const result = parsed.toString();
    return result.endsWith('/') ? result.slice(0, -1) : result;
  } catch (e) {
    logInfo('[presence] failed to parse presence server url', { error: e?.message });
  }
  return '';
}

function getChatServerUrl() {
  const explicit = normalizeChatUrl(chatServerInput?.value);
  if (explicit !== null) return explicit;
  const info = resolveLivekitHostInfo();
  if (!info) return '';
  const protocol = info.secure ? 'wss:' : 'ws:';
  return `${protocol}//${info.hostname}:${CHAT_PORT}`;
}

function getPresenceUrl() {
  const explicit = normalizePresenceUrl(presenceServerInput?.value);
  if (explicit !== null) return explicit;
  const info = resolveLivekitHostInfo();
  if (!info) return '';
  const protocol = info.secure ? 'https:' : 'http:';
  return `${protocol}//${info.hostname}:${PRESENCE_PORT}`;
}

async function applyUpdateFeedUrl() {
  try {
    if (!window.electronAPI?.setUpdateFeedUrl) return;
    const raw = updateServerInput?.value?.trim() || '';
    await window.electronAPI.setUpdateFeedUrl(raw);
  } catch (e) {}
}

function areServiceFieldsFilled() {
  const chat = chatServerInput?.value?.trim();
  const presence = presenceServerInput?.value?.trim();
  const update = updateServerInput?.value?.trim();
  return !!(chat && presence && update);
}

function applyServicesCollapsed(collapsed) {
  if (!servicesSection) return;
  servicesSection.classList.toggle('collapsed', collapsed);
  servicesSection.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
}

function getChatIdentity() {
  if (room?.localParticipant?.identity) return room.localParticipant.identity;
  const token = jwtInput?.value?.trim();
  return getNameFromToken(token) || 'You';
}

function updateChatUiState() {
  const enabled = chatSocketReady && chatRoomName;
  if (chatInput) chatInput.disabled = !enabled;
  if (chatSendBtn) chatSendBtn.disabled = !enabled;
  if (chatStatus) {
    const isOnline = chatSocketReady && chatRoomName;
    chatStatus.textContent = isOnline ? 'Chat online' : 'Chat offline';
    chatStatus.classList.toggle('online', isOnline);
    chatStatus.classList.toggle('offline', !isOnline);
  }
}

function scheduleChatConnect() {
  if (chatReconnectTimer) clearTimeout(chatReconnectTimer);
  chatReconnectTimer = setTimeout(connectChatSocket, 250);
}

function connectChatSocket() {
  if (chatReconnectTimer) {
    clearTimeout(chatReconnectTimer);
    chatReconnectTimer = null;
  }
  const token = jwtInput?.value?.trim();
  const roomName = getRoomFromToken(token);
  if (!roomName) {
    chatRoomName = '';
    chatSocketReady = false;
    if (chatSocket && chatSocket.readyState <= 1) {
      try { chatSocket.close(); } catch (e) {}
    }
    updateChatUiState();
    return;
  }
  const nextName = getChatIdentity();
  const nextUrl = getChatServerUrl();
  if (!nextUrl) {
    if (chatSocket && chatSocket.readyState <= 1) {
      try { chatSocket.close(); } catch (e) {}
    }
    chatRoomName = roomName;
    chatUserName = nextName;
    chatServerUrl = '';
    chatSocketReady = false;
    updateChatUiState();
    return;
  }
  if (chatSocket && chatSocket.readyState <= 1) {
    if (chatRoomName === roomName && chatUserName === nextName && chatServerUrl === nextUrl) {
      updateChatUiState();
      return;
    }
    try { chatSocket.close(); } catch (e) {}
  }
  chatRoomName = roomName;
  chatUserName = nextName;
  chatServerUrl = nextUrl;
  chatSocketReady = false;
  updateChatUiState();
  try {
    chatSocket = new WebSocket(nextUrl);
  } catch (e) {
    chatSocket = null;
    return;
  }
  chatSocket.addEventListener('open', () => {
    chatSocketReady = true;
    updateChatUiState();
    try {
      chatSocket.send(JSON.stringify({ type: 'join', room: chatRoomName, name: chatUserName }));
    } catch (e) {}
  });
  chatSocket.addEventListener('message', handleChatServerMessage);
  chatSocket.addEventListener('close', () => {
    chatSocketReady = false;
    updateChatUiState();
    if (jwtInput?.value?.trim() && chatRoomName) scheduleChatConnect();
  });
  chatSocket.addEventListener('error', () => {
    chatSocketReady = false;
    updateChatUiState();
  });
}

function handleChatServerMessage(event) {
  let data;
  try {
    data = JSON.parse(event.data);
  } catch (e) {
    return;
  }
  if (!data) return;
  if (data.type === 'history') {
    if (!chatLog) return;
    chatLog.innerHTML = '';
    const messages = Array.isArray(data.messages) ? data.messages : [];
    messages.forEach(msg => {
      const name = msg.name || 'Unknown';
      const text = msg.message || '';
      if (!text) return;
      appendChatMessage(name, text, name === chatUserName);
    });
    return;
  }
  if (data.type === 'message') {
    const name = data.name || 'Unknown';
    const text = data.message || '';
    if (!text) return;
    if (lastLocalChat && lastLocalChat.name === name && lastLocalChat.message === text && lastLocalChat.ts === data.ts) {
      lastLocalChat = null;
      return;
    }
    appendChatMessage(name, text, name === chatUserName);
  }
}

async function refreshRoomPreview() {
  if (!roomPreviewStatus || !roomPreviewList) return;
  const token = jwtInput?.value?.trim();
  const roomName = getRoomFromToken(token);
  if (!roomName) {
    roomPreviewStatus.textContent = 'Missing token or room';
    roomPreviewList.innerHTML = '';
    lastPreviewState = { count: null, names: [] };
    return;
  }
  if (lastPreviewState.count === null) {
    roomPreviewStatus.textContent = 'Checking...';
  }
  try {
    const presenceUrl = getPresenceUrl();
    if (!presenceUrl) {
      roomPreviewStatus.textContent = 'Presence URL not set';
      roomPreviewStatus.title = '';
      roomPreviewList.innerHTML = '';
      lastPreviewState = { count: null, names: [] };
      return;
    }
    const url = `${presenceUrl}/room-status?room=${encodeURIComponent(roomName)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const count = Number(data.count || 0);
    const names = Array.isArray(data.participants) ? data.participants : [];
    const nameList = names.map(p => p.name || p.identity || 'Participant');
    const changed = count !== lastPreviewState.count
      || nameList.length !== lastPreviewState.names.length
      || nameList.some((n, i) => n !== lastPreviewState.names[i]);
    roomPreviewStatus.textContent = `${count} in room`;
    if (changed) {
      roomPreviewList.innerHTML = '';
      nameList.forEach(name => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        item.textContent = name;
        roomPreviewList.appendChild(item);
      });
      if (count === 0) {
        const item = document.createElement('div');
        item.className = 'preview-item';
        item.textContent = 'No one is in the room';
        roomPreviewList.appendChild(item);
      }
      lastPreviewState = { count, names: nameList };
    }
  } catch (e) {
    roomPreviewStatus.textContent = 'Presence offline';
    roomPreviewStatus.title = 'Presence server not reachable';
  }
}

function getPublisherPc() {
  try {
    return room?.engine?.pcManager?.publisher?.pc
      || room?.engine?.pcManager?.publisher?._pc
      || room?.engine?.pcManager?.publisher?.peerConnection;
  } catch (e) {}
  return null;
}

function getSubscriberPc() {
  try {
    return room?.engine?.pcManager?.subscriber?.pc
      || room?.engine?.pcManager?.subscriber?._pc
      || room?.engine?.pcManager?.subscriber?.peerConnection;
  } catch (e) {}
  return null;
}

function startAudioLevelMonitor() {
  if (audioLevelTimer) return;
  audioLevelTimer = setInterval(async () => {
    try {
      const pc = getSubscriberPc() || getPublisherPc();
      if (!pc || typeof pc.getStats !== 'function') return;
      const stats = await pc.getStats();
      const levels = new Map();
      stats.forEach(report => {
        if (report.type === 'track' && report.kind === 'audio') {
          const level = typeof report.audioLevel === 'number' ? report.audioLevel : null;
          const key = report.trackIdentifier || report.id;
          if (level != null && key) levels.set(key, Math.max(0, Math.min(1, level)));
        }
        if (report.type === 'inbound-rtp' && report.kind === 'audio') {
          let level = null;
          if (typeof report.audioLevel === 'number') {
            level = report.audioLevel;
          } else if (typeof report.totalAudioEnergy === 'number' && typeof report.totalSamplesDuration === 'number' && report.totalSamplesDuration > 0) {
            level = Math.sqrt(report.totalAudioEnergy / report.totalSamplesDuration);
          }
          const key = report.trackIdentifier || report.trackId;
          if (level != null && key) levels.set(key, Math.max(0, Math.min(1, level)));
        }
      });
      participantMeters.forEach(entry => {
        if (!entry?.trackIdentifier) return;
        if (levels.has(entry.trackIdentifier)) {
          entry.statsLevel = levels.get(entry.trackIdentifier);
        }
      });
      participantStreamMeters.forEach(entry => {
        if (!entry?.trackIdentifier) return;
        if (levels.has(entry.trackIdentifier)) {
          entry.statsLevel = levels.get(entry.trackIdentifier);
        }
      });
    } catch (e) {}
  }, 500);
}

function stopAudioLevelMonitor() {
  if (audioLevelTimer) {
    clearInterval(audioLevelTimer);
    audioLevelTimer = null;
  }
}

function startPingMonitor() {
  if (pingTimer) return;
  setPingDisplay(null);
  pingTimer = setInterval(async () => {
    try {
      const pc = getPublisherPc();
      if (!pc || typeof pc.getStats !== 'function') { setPingDisplay(null); return; }
      const stats = await pc.getStats();
      let rttMs = null;
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
          rttMs = report.currentRoundTripTime * 1000;
        }
      });
      setPingDisplay(rttMs);
    } catch (e) {
      setPingDisplay(null);
    }
  }, 1000);
}

function stopPingMonitor() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  setPingDisplay(null);
}

function updateMinimizedPanelVisibility() {
  if (!minimizedPanel || !minimizedStreams) return;
  minimizedPanel.style.display = minimizedStreams.children.length > 0 ? 'block' : 'none';
}

function ensureMinimizedPlaceholder(participantId, trackSid) {
  if (!minimizedStreams) return;
  if (!participantId || !trackSid) return;
  minimizedParticipants.add(participantId);
  const existing = minimizedStreams.querySelector(`[data-sid="${trackSid}"]`);
  if (existing) {
    ensureWatchOverlay(existing, participantId);
    updateWatchOverlays(participantId);
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'stream-tile placeholder minimized';
  wrapper.dataset.sid = trackSid;
  wrapper.dataset.participantId = participantId;
  if (room?.localParticipant
    && (participantId === room.localParticipant.identity || participantId === room.localParticipant.sid)) {
    wrapper.dataset.local = 'true';
  }

  const header = document.createElement('div');
  header.className = 'stream-header';

  const mediaWrap = document.createElement('div');
  mediaWrap.className = 'stream-media';

  const nameWrap = document.createElement('div');
  nameWrap.className = 'stream-title';

  const nameLabel = document.createElement('div');
  nameLabel.dataset.streamNameLabel = 'true';
  nameLabel.className = 'stream-name';
  const displayName = getDisplayNameForId(participantId, participantId);
  nameLabel.textContent = displayName;
  nameLabel.style.display = displayName ? 'block' : 'none';

  nameWrap.appendChild(nameLabel);
  header.appendChild(nameWrap);
  wrapper.appendChild(header);
  wrapper.appendChild(mediaWrap);
  ensureWatchOverlay(wrapper, participantId);
  minimizedStreams.appendChild(wrapper);
  updateMinimizedPanelVisibility();
}

function restoreMinimizedTile(trackSid, participantId) {
  if (!minimizedStreams || !streamsDiv) return;
  let tile = null;
  if (trackSid) {
    tile = minimizedStreams.querySelector(`[data-sid="${trackSid}"]`);
  }
  if (!tile && participantId) {
    tile = minimizedStreams.querySelector(`[data-participant-id="${participantId}"]`);
  }
  if (!tile) return;
  tile.classList.remove('minimized');
  minimizedTiles.delete(tile.dataset.sid);
  if (participantId) minimizedParticipants.delete(participantId);
  streamsDiv.appendChild(tile);
  updateMinimizedPanelVisibility();
}

function requestFullscreenForElement(el) {
  if (!el) return;
  const target = el;
  const req = target.requestFullscreen
    || target.webkitRequestFullscreen
    || target.mozRequestFullScreen
    || target.msRequestFullscreen;
  if (req) {
    try { req.call(target); } catch (e) {}
  }
}

function exitFullscreen() {
  const exit = document.exitFullscreen
    || document.webkitExitFullscreen
    || document.mozCancelFullScreen
    || document.msExitFullscreen;
  if (exit) {
    try { exit.call(document); } catch (e) {}
  }
}

function updateFullscreenIconForTile(tile) {
  if (!tile) return;
  const btn = tile.querySelector('.watch-overlay-actions .fullscreen-toggle');
  if (!btn) return;
  const icon = btn.querySelector('.icon');
  const isFs = document.fullscreenElement === tile
    || document.webkitFullscreenElement === tile
    || document.mozFullScreenElement === tile
    || document.msFullscreenElement === tile;
  if (icon) {
    icon.classList.toggle('expand', !isFs);
    icon.classList.toggle('compress', isFs);
  }
  btn.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Fullscreen');
  btn.setAttribute('title', isFs ? 'Exit fullscreen' : 'Fullscreen');
}

function findPublicationForTrackSid(sid) {
  try {
    if (!room || !sid) return null;
    const parts = [];
    if (room.remoteParticipants && typeof room.remoteParticipants.forEach === 'function') {
      room.remoteParticipants.forEach(p => parts.push(p));
    } else if (room.participants && typeof room.participants.forEach === 'function') {
      room.participants.forEach(p => parts.push(p));
    }
    for (const p of parts) {
      try {
        if (!p || !p.tracks) continue;
        if (typeof p.tracks.forEach === 'function') {
          let found = null;
          p.tracks.forEach(pub => {
            if (!found && pub && (pub.trackSid === sid || (pub.track && pub.track.sid === sid))) found = pub;
          });
          if (found) return found;
        } else if (typeof p.tracks.values === 'function') {
          for (const pub of p.tracks.values()) {
            if (pub && (pub.trackSid === sid || (pub.track && pub.track.sid === sid))) return pub;
          }
        }
        try {
          if (p.trackPublications && typeof p.trackPublications.values === 'function') {
            for (const pub of p.trackPublications.values()) {
              if (pub && (pub.trackSid === sid || (pub.track && pub.track.sid === sid))) return pub;
            }
          }
        } catch (e) {}
        try {
          if (p.videoTrackPublications && typeof p.videoTrackPublications.values === 'function') {
            for (const pub of p.videoTrackPublications.values()) {
              if (pub && (pub.trackSid === sid || (pub.track && pub.track.sid === sid))) return pub;
            }
          }
        } catch (e) {}
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function scheduleAutoRejoin() {
  if (autoRejoinTimer || !lastJoinToken) return;
  autoRejoinTimer = setTimeout(() => {
    autoRejoinTimer = null;
    if (!manualDisconnect && lastJoinToken) {
      jwtInput.value = lastJoinToken;
      joinBtn.click();
    }
  }, 2000);
}

function getParticipantCount() {
  try {
    if (!room) return 0;

    // Prefer the SDK-provided remoteParticipants collection when available
    if (room.remoteParticipants) {
      try {
        let remoteCount = 0;
        if (typeof room.remoteParticipants.size === 'number') remoteCount = room.remoteParticipants.size;
        else if (Array.isArray(room.remoteParticipants)) remoteCount = room.remoteParticipants.length;
        else if (typeof room.remoteParticipants.forEach === 'function') {
          let c = 0; room.remoteParticipants.forEach(() => c++); remoteCount = c;
        } else if (typeof room.remoteParticipants.values === 'function') {
          remoteCount = Array.from(room.remoteParticipants.values()).length;
        }

        // include local participant (if not already counted in remote list)
        let includeLocal = room.localParticipant ? 1 : 0;
        try {
          if (room.localParticipant && room.remoteParticipants) {
            let dup = false;
            const lp = room.localParticipant;
            if (typeof room.remoteParticipants.forEach === 'function') {
              room.remoteParticipants.forEach(p => { if (p && (p.sid === lp.sid || p.identity === lp.identity)) dup = true; });
            } else if (typeof room.remoteParticipants.values === 'function') {
              for (const p of room.remoteParticipants.values()) { if (p && (p.sid === lp.sid || p.identity === lp.identity)) { dup = true; break; } }
            } else if (Array.isArray(room.remoteParticipants)) {
              for (const p of room.remoteParticipants) { if (p && (p.sid === lp.sid || p.identity === lp.identity)) { dup = true; break; } }
            }
            if (dup) includeLocal = 0;
          }
        } catch (e) {}

        return remoteCount + includeLocal;
      } catch (e) {}
    }

    // Fallback: try older room.participants property
    let remoteCount = 0;
    if (room.participants) {
      if (typeof room.participants.size === 'number') remoteCount = room.participants.size;
      else if (Array.isArray(room.participants)) remoteCount = room.participants.length;
      else if (typeof room.participants.forEach === 'function') {
        let c = 0; room.participants.forEach(() => c++); remoteCount = c;
      } else if (typeof room.participants.values === 'function') {
        remoteCount = Array.from(room.participants.values()).length;
      }
    }
    let includeLocal = room.localParticipant ? 1 : 0;
    try {
      if (room.localParticipant && room.participants) {
        let dup = false;
        const lp = room.localParticipant;
        if (typeof room.participants.forEach === 'function') {
          room.participants.forEach(p => { if (p && (p.sid === lp.sid || p.identity === lp.identity)) dup = true; });
        } else if (typeof room.participants.values === 'function') {
          for (const p of room.participants.values()) { if (p && (p.sid === lp.sid || p.identity === lp.identity)) { dup = true; break; } }
        } else if (Array.isArray(room.participants)) {
          for (const p of room.participants) { if (p && (p.sid === lp.sid || p.identity === lp.identity)) { dup = true; break; } }
        }
        if (dup) includeLocal = 0;
      }
    } catch (e) {}

    return remoteCount + includeLocal;
  } catch (e) { }
  return 0;
}

function getDisplayNameForId(id, fallback) { return fallback || id; }

const resolutionSelect = document.getElementById("resolutionSelect");
const fpsSelect = document.getElementById("fpsSelect");
const bitrateInput = document.getElementById("bitrateInput");
const recommendedBitratesKbps60 = {
  "1280x720": 6000,
  "1920x1080": 10000,
  "2560x1440": 16000,
  "3840x2160": 30000
};

function getSelectedFps() {
  if (!fpsSelect) return 0;
  return Number(fpsSelect.value);
}

function formatStreamInfo(p) {
  try {
    const attrs = p && p.attributes ? p.attributes : {};
    const res = attrs.stream_resolution || '';
    const fps = attrs.stream_fps || '';
    const br = attrs.stream_max_bitrate_kbps || '';
    if (!res && !fps && !br) return '';
    const parts = [];
    if (res) parts.push(res);
    if (fps) parts.push(`${fps} fps`);
    if (br) parts.push(`max ${br} kbps`);
    return parts.join(' | ');
  } catch (e) {}
  return '';
}

function updateParticipantStreamInfo(p) {
  try {
    if (!participantsList || !p) return;
    const id = p.identity || p.sid;
    if (!id) return;
    const text = formatStreamInfo(p);
    participantStreamInfo.set(id, text);
  } catch (e) {}
}

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

function getParticipantMeterElement(participantId) {
  if (participantMeters.has(participantId)) return participantMeters.get(participantId);
  const container = document.getElementById(`participant-${participantId}`);
  if (!container) return null;
  const meter = container.querySelector('.volume-meter');
  if (!meter) return null;
  const entry = { el: meter };
  participantMeters.set(participantId, entry);
  return entry;
}

function getParticipantStreamMeterElement(participantId) {
  if (participantStreamMeters.has(participantId)) return participantStreamMeters.get(participantId);
  const container = document.getElementById(`participant-${participantId}`);
  if (!container) return null;
  const meter = container.querySelector('.stream-control-row .volume-meter');
  if (!meter) return null;
  const entry = { el: meter };
  participantStreamMeters.set(participantId, entry);
  return entry;
}

function startParticipantMeterLoop(participantId) {
  if (participantMeterRaf.has(participantId)) return;
  const loop = () => {
    const meterEntry = participantMeters.get(participantId);
    const analyserEntry = participantAnalyzers.get(participantId);
    if (!meterEntry || !analyserEntry) {
      participantMeterRaf.delete(participantId);
      return;
    }
    const data = analyserEntry.data;
    analyserEntry.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    let level = Math.max(0, Math.min(1, rms * 30));
    if (rms < 0.0005 && typeof meterEntry.statsLevel === 'number') {
      level = Math.max(level, meterEntry.statsLevel);
    }
    const prev = Number(meterEntry.level || 0);
    const attack = 0.7
    const decay = 0.12
    const target = level >= prev
      ? prev + (level - prev) * attack
      : prev + (level - prev) * decay;
    meterEntry.level = target;
    if (meterEntry.el.style.width) meterEntry.el.style.width = '';
    meterEntry.el.style.transform = `scaleX(${target})`;
    participantMeterRaf.set(participantId, setTimeout(loop, 60));
  };
  participantMeterRaf.set(participantId, setTimeout(loop, 60));
}

function startParticipantStreamMeterLoop(participantId) {
  if (participantStreamMeterRaf.has(participantId)) return;
  const loop = () => {
    const meterEntry = participantStreamMeters.get(participantId);
    const analyserEntry = participantStreamAnalyzers.get(participantId);
    if (!meterEntry || !analyserEntry) {
      participantStreamMeterRaf.delete(participantId);
      return;
    }
    if (!meterEntry.started) {
      meterEntry.started = true;
      meterEntry.logCount = 0;
      if (DEBUG) {
        try { logInfo('[meter][stream] loop start', { participantId }); } catch (e) {}
      }
    }
    const data = analyserEntry.data;
    analyserEntry.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    let level = Math.max(0, Math.min(1, rms * 30));
    if (rms < 0.0005 && typeof meterEntry.statsLevel === 'number') {
      level = Math.max(level, meterEntry.statsLevel);
    }
    const prev = Number(meterEntry.level || 0);
    const attack = 0.7
    const decay = 0.12
    const target = level >= prev
      ? prev + (level - prev) * attack
      : prev + (level - prev) * decay;
    meterEntry.level = target;
    if (meterEntry.el.style.width) meterEntry.el.style.width = '';
    meterEntry.el.style.transform = `scaleX(${target})`;
    if (DEBUG && watchedVideoParticipants.has(participantId)) {
      const now = Date.now();
      if (!meterEntry.lastLogAt || now - meterEntry.lastLogAt > 2000) {
        meterEntry.lastLogAt = now;
        try {
          logInfo('[meter][stream] level', { participantId, rms: Number(rms.toFixed(4)), level: Number(target.toFixed(3)) });
        } catch (e) {}
      }
    }
    if (DEBUG && meterEntry.logCount != null && meterEntry.logCount < 3) {
      meterEntry.logCount += 1;
      try {
        logInfo('[meter][stream] sample', { participantId, rms: Number(rms.toFixed(4)), level: Number(target.toFixed(3)) });
      } catch (e) {}
    }
    participantStreamMeterRaf.set(participantId, setTimeout(loop, 60));
  };
  participantStreamMeterRaf.set(participantId, setTimeout(loop, 60));
}

function connectParticipantMeter(participantId, trackOrEl) {
  try {
    if (!participantId || !trackOrEl) return;
    const meterEntry = getParticipantMeterElement(participantId);
    if (!meterEntry) {
      try { logInfo('[meter] missing mic meter element', { participantId }); } catch (e) {}
      return;
    }
    const ctx = getAudioContext();
    if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const data = new Uint8Array(analyser.fftSize);
    let source = null;
    let trackIdentifier = null;
    if (trackOrEl instanceof HTMLMediaElement) {
      const capture = typeof trackOrEl.captureStream === 'function' ? trackOrEl.captureStream() : null;
      const captureTrack = capture?.getAudioTracks?.()[0] || null;
      const elTrack = trackOrEl.srcObject?.getAudioTracks?.()[0] || captureTrack || null;
      trackIdentifier = elTrack?.id || null;
      if (captureTrack) {
        source = ctx.createMediaStreamSource(new MediaStream([captureTrack]));
      } else {
        source = meterMediaSources.get(trackOrEl) || null;
        if (!source) {
          source = ctx.createMediaElementSource(trackOrEl);
          meterMediaSources.set(trackOrEl, source);
        }
      }
    } else {
      const mediaTrack = trackOrEl.mediaStreamTrack || trackOrEl;
      if (!mediaTrack) return;
      trackIdentifier = mediaTrack?.id || null;
      source = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
    }
    source.connect(analyser);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
    participantAnalyzers.set(participantId, { analyser, data, source, sink });
    meterEntry.trackIdentifier = trackIdentifier;
    if (typeof meterEntry.statsLevel !== 'number') meterEntry.statsLevel = null;
    try {
      logInfo('[meter] mic meter connected', {
        participantId,
        ctxState: ctx.state,
        trackSid: trackOrEl?.sid,
        label: trackOrEl?.label || trackOrEl?.mediaStreamTrack?.label || ''
      });
    } catch (e) {}
    startParticipantMeterLoop(participantId);
  } catch (e) {}
}

function connectParticipantStreamMeter(participantId, trackOrEl) {
  try {
    if (!participantId || !trackOrEl) return;
    const meterEntry = getParticipantStreamMeterElement(participantId);
    if (!meterEntry) {
      try { logInfo('[meter] missing stream meter element', { participantId }); } catch (e) {}
      return;
    }
    const ctx = getAudioContext();
    if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const data = new Uint8Array(analyser.fftSize);
    let source = null;
    let trackIdentifier = null;
    if (trackOrEl instanceof HTMLMediaElement) {
      const capture = typeof trackOrEl.captureStream === 'function' ? trackOrEl.captureStream() : null;
      const captureTrack = capture?.getAudioTracks?.()[0] || null;
      const elTrack = trackOrEl.srcObject?.getAudioTracks?.()[0] || captureTrack || null;
      trackIdentifier = elTrack?.id || null;
      if (captureTrack) {
        source = ctx.createMediaStreamSource(new MediaStream([captureTrack]));
      } else {
        source = meterMediaSources.get(trackOrEl) || null;
        if (!source) {
          source = ctx.createMediaElementSource(trackOrEl);
          meterMediaSources.set(trackOrEl, source);
        }
      }
    } else {
      const mediaTrack = trackOrEl.mediaStreamTrack || trackOrEl;
      if (!mediaTrack) return;
      trackIdentifier = mediaTrack?.id || null;
      source = ctx.createMediaStreamSource(new MediaStream([mediaTrack]));
    }
    source.connect(analyser);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    analyser.connect(sink);
    sink.connect(ctx.destination);
    participantStreamAnalyzers.set(participantId, { analyser, data, source, sink });
    meterEntry.trackIdentifier = trackIdentifier;
    if (typeof meterEntry.statsLevel !== 'number') meterEntry.statsLevel = null;
    try {
      logInfo('[meter] stream meter connected', {
        participantId,
        ctxState: ctx.state,
        trackSid: trackOrEl?.sid,
        label: trackOrEl?.label || trackOrEl?.mediaStreamTrack?.label || ''
      });
    } catch (e) {}
    startParticipantStreamMeterLoop(participantId);
  } catch (e) {}
}

function disconnectParticipantMeter(participantId) {
  try {
    const entry = participantAnalyzers.get(participantId);
    if (entry?.source) entry.source.disconnect();
    if (entry?.analyser) entry.analyser.disconnect();
    if (entry?.sink) entry.sink.disconnect();
    participantAnalyzers.delete(participantId);
    const meterEntry = participantMeters.get(participantId);
    if (meterEntry?.el) meterEntry.el.style.transform = 'scaleX(0)';
    if (participantMeterRaf.has(participantId)) {
      clearTimeout(participantMeterRaf.get(participantId));
      participantMeterRaf.delete(participantId);
    }
  } catch (e) {}
}

function disconnectParticipantStreamMeter(participantId) {
  try {
    const entry = participantStreamAnalyzers.get(participantId);
    if (entry?.source) entry.source.disconnect();
    if (entry?.analyser) entry.analyser.disconnect();
    if (entry?.sink) entry.sink.disconnect();
    participantStreamAnalyzers.delete(participantId);
    const meterEntry = participantStreamMeters.get(participantId);
    if (meterEntry?.el) meterEntry.el.style.transform = 'scaleX(0)';
    if (participantStreamMeterRaf.has(participantId)) {
      clearTimeout(participantStreamMeterRaf.get(participantId));
      participantStreamMeterRaf.delete(participantId);
    }
  } catch (e) {}
}

function getVideoPublicationsForParticipant(p) {
  try {
    if (!p || !p.tracks) return [];
    const pubs = [];
    try {
      if (typeof p.getTrackPublications === 'function') {
        const g = p.getTrackPublications();
        if (Array.isArray(g)) pubs.push(...g);
        else if (g && typeof g.values === 'function') pubs.push(...Array.from(g.values()));
      }
    } catch (e) {}
    try {
      if (p.trackPublications && typeof p.trackPublications.values === 'function') {
        pubs.push(...Array.from(p.trackPublications.values()));
      }
    } catch (e) {}
    try {
      if (p.videoTrackPublications && typeof p.videoTrackPublications.values === 'function') {
        pubs.push(...Array.from(p.videoTrackPublications.values()));
      }
    } catch (e) {}
    try {
      const fallback = participantVideoPubs.get(p.identity || p.sid) || [];
      if (fallback.length) pubs.push(...fallback);
    } catch (e) {}
    if (typeof p.tracks.forEach === 'function') {
      p.tracks.forEach(pub => pubs.push(pub));
    } else if (typeof p.tracks.values === 'function') {
      for (const pub of p.tracks.values()) pubs.push(pub);
    } else if (Array.isArray(p.tracks)) {
      pubs.push(...p.tracks);
    }
    return pubs.filter(pub => {
      const kind = pub?.kind || pub?.track?.kind;
      return kind === 'video';
    });
  } catch (e) {}
  return [];
}

function getStreamAudioPublicationsForParticipant(p) {
  try {
    if (!p) return [];
    const pubs = [];
    try {
      if (typeof p.getTrackPublications === 'function') {
        const g = p.getTrackPublications();
        if (Array.isArray(g)) pubs.push(...g);
        else if (g && typeof g.values === 'function') pubs.push(...Array.from(g.values()));
      }
    } catch (e) {}
    try {
      if (p.audioTrackPublications && typeof p.audioTrackPublications.values === 'function') {
        pubs.push(...Array.from(p.audioTrackPublications.values()));
      }
    } catch (e) {}
    try {
      if (p.trackPublications && typeof p.trackPublications.values === 'function') {
        pubs.push(...Array.from(p.trackPublications.values()));
      }
    } catch (e) {}
    try {
      if (typeof p.tracks.forEach === 'function') {
        p.tracks.forEach(pub => pubs.push(pub));
      } else if (typeof p.tracks.values === 'function') {
        for (const pub of p.tracks.values()) pubs.push(pub);
      } else if (Array.isArray(p.tracks)) {
        pubs.push(...p.tracks);
      }
    } catch (e) {}
    const filtered = pubs.filter(pub => {
      const kind = pub?.kind || pub?.track?.kind;
      if (kind !== 'audio') return false;
      return isStreamAudioPublication(pub);
    });
    return filtered;
  } catch (e) {}
  return [];
}

function getMicAudioPublicationsForParticipant(p) {
  try {
    if (!p) return [];
    const pubs = [];
    try {
      if (typeof p.getTrackPublications === 'function') {
        const g = p.getTrackPublications();
        if (Array.isArray(g)) pubs.push(...g);
        else if (g && typeof g.values === 'function') pubs.push(...Array.from(g.values()));
      }
    } catch (e) {}
    try {
      if (p.audioTrackPublications && typeof p.audioTrackPublications.values === 'function') {
        pubs.push(...Array.from(p.audioTrackPublications.values()));
      }
    } catch (e) {}
    try {
      if (p.trackPublications && typeof p.trackPublications.values === 'function') {
        pubs.push(...Array.from(p.trackPublications.values()));
      }
    } catch (e) {}
    try {
      if (typeof p.tracks.forEach === 'function') {
        p.tracks.forEach(pub => pubs.push(pub));
      } else if (typeof p.tracks.values === 'function') {
        for (const pub of p.tracks.values()) pubs.push(pub);
      } else if (Array.isArray(p.tracks)) {
        pubs.push(...p.tracks);
      }
    } catch (e) {}
    return pubs.filter(pub => {
      const kind = pub?.kind || pub?.track?.kind;
      if (kind !== 'audio') return false;
      return !isStreamAudioPublication(pub);
    });
  } catch (e) {}
  return [];
}

function ensureParticipantMicSubscribed(participantId) {
  try {
    if (!participantId) return false;
    let p = participantsById.get(participantId);
    if (!p && room?.remoteParticipants) {
      try {
        if (typeof room.remoteParticipants.get === 'function') {
          p = room.remoteParticipants.get(participantId);
        } else if (typeof room.remoteParticipants.values === 'function') {
          p = Array.from(room.remoteParticipants.values()).find(r => r.identity === participantId || r.sid === participantId);
        } else if (Array.isArray(room.remoteParticipants)) {
          p = room.remoteParticipants.find(r => r.identity === participantId || r.sid === participantId);
        }
      } catch (e) {}
    }
    if (!p) return false;
    const pubs = getMicAudioPublicationsForParticipant(p);
    let did = false;
    pubs.forEach(pub => {
      if (pub && typeof pub.setSubscribed === 'function') {
        pub.setSubscribed(true);
        did = true;
      }
      if (pub?.track) {
        attachTrack(pub.track);
        did = true;
      } else {
        const trackSid = pub?.trackSid || pub?.track?.sid;
        if (trackSid) {
          if (room && typeof room.subscribe === 'function') {
            room.subscribe(trackSid).catch(err => console.warn('[mic] room.subscribe err', err));
          } else if (typeof p.subscribe === 'function') {
            p.subscribe(trackSid).catch(err => console.warn('[mic] participant.subscribe err', err));
          }
          did = true;
        }
      }
    });
    return did;
  } catch (e) {}
  return false;
}

function cacheVideoPublication(participantId, pub) {
  if (!participantId || !pub) return;
  if (!participantVideoPubs.has(participantId)) participantVideoPubs.set(participantId, []);
  const list = participantVideoPubs.get(participantId);
  if (list && !list.includes(pub)) list.push(pub);
}

function forceStopVideoBySid(trackSid) {
  if (!trackSid) return;
  try {
    const pub = findPublicationForTrackSid(trackSid);
    if (pub && typeof pub.setSubscribed === 'function') {
      pub.setSubscribed(false);
    }
    if (room && typeof room.unsubscribe === 'function') {
      room.unsubscribe(trackSid).catch(() => {});
    }
    if (pub?.track) detachTrack(pub.track);
  } catch (e) {}
  try {
    const tile = streamsDiv.querySelector(`[data-sid="${trackSid}"]`);
    if (!tile) return;
    const pid = tile.dataset.participantId;
    if (pid && minimizedTiles.has(trackSid)) {
      ensureMinimizedPlaceholder(pid, trackSid);
    }
    const mediaEl = tile.querySelector('video');
    if (mediaEl) mediaEl.srcObject = null;
    tile.classList.add('placeholder');
    const fsBtn = tile.querySelector('.fullscreen-btn');
    if (fsBtn) fsBtn.style.display = 'none';
    ensureWatchOverlay(tile, pid);
    setTileWatchState(tile, false);
    updateMinimizedPanelVisibility();
  } catch (e) {}
}

function setParticipantStreamAudioSubscribed(participantId, subscribe) {
  try {
    logInfo('[watch] setParticipantStreamAudioSubscribed', { participantId, subscribe });
    let p = participantsById.get(participantId);
    if (!p && room?.remoteParticipants) {
      try {
        if (typeof room.remoteParticipants.get === 'function') {
          p = room.remoteParticipants.get(participantId);
        } else if (typeof room.remoteParticipants.values === 'function') {
          p = Array.from(room.remoteParticipants.values()).find(r => r.identity === participantId || r.sid === participantId);
        } else if (Array.isArray(room.remoteParticipants)) {
          p = room.remoteParticipants.find(r => r.identity === participantId || r.sid === participantId);
        }
      } catch (e) {}
    }
    if (!p) return;
    const pubs = getStreamAudioPublicationsForParticipant(p);
    logInfo('[watch] stream audio pubs', { participantId, count: pubs.length, subs: pubs.map(pub => ({
      trackSid: pub?.trackSid || pub?.track?.sid,
      source: pub?.source,
      name: pub?.trackName || pub?.name || pub?.track?.name || '',
      hasTrack: !!pub?.track
    })) });
    pubs.forEach(pub => {
      if (!isStreamAudioPublication(pub)) return;
      if (pub && typeof pub.setSubscribed === 'function') {
        pub.setSubscribed(subscribe);
      }
      if (!subscribe && pub?.track) {
        detachTrack(pub.track);
        const trackSid = pub?.trackSid || pub?.track?.sid;
        if (trackSid && room && typeof room.unsubscribe === 'function') {
          room.unsubscribe(trackSid).catch(() => {});
        }
      } else if (subscribe && pub?.track) {
        attachTrack(pub.track);
        try { pub.track.mediaStreamTrack.enabled = true; } catch (e) {}
        try {
          logInfo('[watch] stream pub state', {
            participantId,
            trackSid: pub?.trackSid || pub?.track?.sid,
            enabled: pub?.track?.mediaStreamTrack?.enabled,
            readyState: pub?.track?.mediaStreamTrack?.readyState,
            muted: pub?.track?.mediaStreamTrack?.muted,
            label: pub?.track?.mediaStreamTrack?.label || ''
          });
        } catch (e) {}
      } else if (subscribe) {
        const trackSid = pub?.trackSid || pub?.track?.sid;
        if (trackSid) {
          if (room && typeof room.subscribe === 'function') {
            room.subscribe(trackSid).catch(err => console.warn('[watch] stream audio room.subscribe err', err));
          } else if (typeof p.subscribe === 'function') {
            p.subscribe(trackSid).catch(err => console.warn('[watch] stream audio participant.subscribe err', err));
          }
        }
      }
    });
    const finalizeStreamAudio = () => {
      const audioEl = participantStreamAudioEls.get(participantId);
      const saved = participantStreamAudioSettings.get(participantId);
      if (!audioEl) return;
      if (!saved) {
        audioEl.volume = 1;
        audioEl.muted = muteIncomingAll ? true : false;
      }
      try {
        logInfo('[watch] stream audio state', {
          participantId,
          muted: audioEl.muted,
          volume: audioEl.volume,
          paused: audioEl.paused,
          readyState: audioEl.readyState,
          sinkId: audioEl.sinkId,
          trackCount: audioEl.srcObject?.getAudioTracks?.().length || 0,
          saved: saved ? { muted: saved.muted, vol: saved.vol } : null
        });
      } catch (e) {}
    };
    if (subscribe) {
      finalizeStreamAudio();
      setTimeout(finalizeStreamAudio, 250);
    }
  } catch (e) {}
}

function setParticipantVideoSubscribed(participantId, subscribe, trackSidOverride) {
  try {
    logInfo('[watch] setParticipantVideoSubscribed', { participantId, subscribe, trackSidOverride });
    if (subscribe) {
      restoreMinimizedTile(trackSidOverride, participantId);
    }
    let p = participantsById.get(participantId);
    if (!p && room?.remoteParticipants) {
      try {
        if (typeof room.remoteParticipants.get === 'function') {
          p = room.remoteParticipants.get(participantId);
        } else if (typeof room.remoteParticipants.values === 'function') {
          p = Array.from(room.remoteParticipants.values()).find(r => r.identity === participantId || r.sid === participantId);
        } else if (Array.isArray(room.remoteParticipants)) {
          p = room.remoteParticipants.find(r => r.identity === participantId || r.sid === participantId);
        }
      } catch (e) {}
    }
    if (!p) return;
    participantsById.set(participantId, p);
    let pubs = getVideoPublicationsForParticipant(p);
    if (!subscribe && trackSidOverride) {
      const pubBySid = findPublicationForTrackSid(trackSidOverride);
      if (pubBySid && !pubs.includes(pubBySid)) pubs = pubs.concat(pubBySid);
    }
    if (!subscribe) {
      const stored = participantVideoPubs.get(participantId) || [];
      stored.forEach(pub => {
        if (pub && !pubs.includes(pub)) pubs.push(pub);
      });
      if (trackSidOverride && room && typeof room.unsubscribe === 'function') {
        room.unsubscribe(trackSidOverride).catch(() => {});
      }
    }
    if (subscribe && pubs.length === 0) {
      const stored = participantVideoPubs.get(participantId) || [];
      if (stored.length) pubs = stored;
    }
    if (!subscribe && pubs.length === 0 && trackSidOverride) {
      forceStopVideoBySid(trackSidOverride);
      return;
    }
    if (subscribe && pubs.length === 0 && trackSidOverride) {
      const pubBySid = findPublicationForTrackSid(trackSidOverride);
      if (pubBySid && typeof pubBySid.setSubscribed === 'function') {
        pubBySid.setSubscribed(true);
        return;
      }
      if (room && typeof room.subscribe === 'function') {
        room.subscribe(trackSidOverride).catch(err => console.warn('[watch] room.subscribe override err', err));
      } else if (typeof p.subscribe === 'function') {
        p.subscribe(trackSidOverride).catch(err => console.warn('[watch] participant.subscribe override err', err));
      }
      return;
    }
    if (subscribe && pubs.length === 0) {
      setTimeout(() => setParticipantVideoSubscribed(participantId, subscribe), 300);
      return;
    }
    pubs.forEach(pub => {
      const trackSid = pub?.trackSid || pub?.track?.sid;
      const ensureAttach = (attempt = 0) => {
        if (!subscribe) return;
        if (pub?.track) {
          attachTrack(pub.track);
          return;
        }
        if (attempt < 5) {
          setTimeout(() => ensureAttach(attempt + 1), 250);
        }
      };
      if (pub && typeof pub.setSubscribed === 'function') {
        pub.setSubscribed(subscribe);
      }
      if (!subscribe && trackSid && room && typeof room.unsubscribe === 'function') {
        room.unsubscribe(trackSid).catch(() => {});
      }
      if (subscribe && trackSid) {
        if (room && typeof room.subscribe === 'function') {
          room.subscribe(trackSid).catch(err => console.warn('[watch] room.subscribe err', err));
        } else if (typeof p.subscribe === 'function') {
          p.subscribe(trackSid).catch(err => console.warn('[watch] participant.subscribe err', err));
        }
      }
      if (!subscribe && pub?.track) {
        detachTrack(pub.track);
      } else if (subscribe && pub?.track) {
        attachTrack(pub.track);
      } else if (subscribe) {
        ensureAttach();
      }
    });
    if (!subscribe) {
      logInboundVideoStats('after stop (immediate)');
      setTimeout(() => logInboundVideoStats('after stop (500ms)'), 500);
    }
  } catch (e) {}
}

function updateParticipantWatchControls(participantId) {
  try {
    const ctrl = participantWatchControls.get(participantId);
    if (!ctrl) return;
    const isLocal = room?.localParticipant
      && (participantId === room.localParticipant.identity || participantId === room.localParticipant.sid);
    if (isLocal) {
      ctrl.watchBtn.style.display = 'none';
      return;
    }
    const p = participantsById.get(participantId);
    const pubs = getVideoPublicationsForParticipant(p);
    if (!pubs.length) {
      ctrl.watchBtn.style.display = 'none';
      return;
    }
    ctrl.watchBtn.style.display = 'none';
    const watching = watchedVideoParticipants.has(participantId);
    ctrl.watchBtn.classList.toggle('is-active', watching);
    if (ctrl.watchIcon) {
      ctrl.watchIcon.classList.toggle('eye-on', watching);
      ctrl.watchIcon.classList.toggle('eye-off', !watching);
    }
    ctrl.watchBtn.setAttribute('aria-label', watching ? 'Stop watching stream' : 'Watch stream');
    ctrl.watchBtn.setAttribute('title', watching ? 'Stop watching stream' : 'Watch stream');
    updateWatchOverlays(participantId);
  } catch (e) {}
}

function logVideoSubscriptions(label = 'subs') {
  try {
    if (!room) return;
    const rows = [];
    const addRow = (p) => {
      if (!p || !p.tracks) return;
      const pubs = [];
      try {
        if (typeof p.getTrackPublications === 'function') {
          const g = p.getTrackPublications();
          if (Array.isArray(g)) pubs.push(...g);
          else if (g && typeof g.values === 'function') pubs.push(...Array.from(g.values()));
        }
      } catch (e) {}
      try {
        if (p.trackPublications && typeof p.trackPublications.values === 'function') {
          pubs.push(...Array.from(p.trackPublications.values()));
        }
      } catch (e) {}
      try {
        if (typeof p.tracks.forEach === 'function') {
          p.tracks.forEach(pub => pubs.push(pub));
        } else if (typeof p.tracks.values === 'function') {
          for (const pub of p.tracks.values()) pubs.push(pub);
        } else if (Array.isArray(p.tracks)) {
          pubs.push(...p.tracks);
        }
      } catch (e) {}
      pubs.forEach(pub => {
        const kind = pub?.kind || pub?.track?.kind;
        if (kind !== 'video') return;
        rows.push({
          participant: p.identity || p.sid,
          trackSid: pub?.trackSid || pub?.track?.sid,
          subscribed: !!pub?.isSubscribed,
          hasTrack: !!pub?.track
        });
      });
    };
    if (room.remoteParticipants) {
      try {
        if (typeof room.remoteParticipants.forEach === 'function') {
          room.remoteParticipants.forEach(addRow);
        } else if (typeof room.remoteParticipants.values === 'function') {
          Array.from(room.remoteParticipants.values()).forEach(addRow);
        }
      } catch (e) {}
    }
    logInfo('[watch] video subs', label, rows);
  } catch (e) {}
}

async function logInboundVideoStats(label = 'inbound') {
  try {
    const pc = room?.engine?.pcManager?.subscriber?.pc || getPublisherPc();
    if (!pc) {
      logInfo('[watch] inbound video', label, { error: 'no pc' });
      return;
    }
    if (typeof pc.getStats !== 'function') {
      logInfo('[watch] inbound video', label, { error: 'no getStats' });
      return;
    }
    const stats = await pc.getStats();
    const rows = [];
    let total = 0;
    stats.forEach(report => {
      total += 1;
      if (report.type !== 'inbound-rtp' || report.kind !== 'video') return;
      rows.push({
        id: report.id,
        trackId: report.trackId,
        bytesReceived: report.bytesReceived,
        framesDecoded: report.framesDecoded
      });
    });
    logInfo('[watch] inbound video', label, { totalReports: total, rows });
  } catch (e) {}
}

function updateStreamNameLabel(id) {
  try {
    if (!id) return;
    const name = getDisplayNameForId(id, id);
    const wrappers = streamsDiv.querySelectorAll(`[data-participant-id="${id}"]`);
    wrappers.forEach(w => {
      const label = w.querySelector('[data-stream-name-label="true"]');
      if (!label) return;
      const info = participantStreamInfo.get(id) || '';
      let metrics = '';
      if (room?.localParticipant && (id === room.localParticipant.identity || id === room.localParticipant.sid)) {
        if (currentStreamSendMbps != null) {
          metrics = `${currentStreamSendMbps.toFixed(1)} Mbps`;
        }
      }
      const parts = [name];
      if (info) parts.push(info);
      if (metrics) parts.push(metrics);
      label.textContent = parts.join(' | ');
      label.style.display = name ? 'block' : 'none';
    });
  } catch (e) {}
}

function updateParticipantsViewMode(isJoined) {
  try {
    if (roomPreviewList) roomPreviewList.style.display = isJoined ? 'none' : '';
    if (participantsList) participantsList.style.display = isJoined ? '' : 'none';
  } catch (e) {}
}

function setTileWatchState(wrapper, watching) {
  if (!wrapper) return;
  wrapper.classList.toggle('watching', watching);
}

function updateWatchOverlays(participantId) {
  if (!participantId || !streamsDiv) return;
  const watching = watchedVideoParticipants.has(participantId);
  const displayName = getDisplayNameForId(participantId, participantId);
  const tiles = document.querySelectorAll(`.stream-tile[data-participant-id="${participantId}"]`);
  tiles.forEach(tile => setTileWatchState(tile, watching));
  tiles.forEach(tile => {
    ensureWatchOverlay(tile, participantId);
    const btn = tile.querySelector('.watch-overlay-btn');
    const isLocal = room?.localParticipant
      && (participantId === room.localParticipant.identity || participantId === room.localParticipant.sid);
    if (btn) {
      if (isLocal) {
        const isMin = tile.classList.contains('minimized');
        btn.textContent = isMin ? 'Restore' : 'Stop';
        btn.dataset.action = isMin ? 'restore' : 'stop';
      } else {
        btn.textContent = watching ? 'Stop' : (displayName ? `Watch ${displayName}` : 'Watch');
        btn.dataset.action = watching ? 'stop' : 'watch';
      }
    }
    const actions = tile.querySelector('.watch-overlay-actions');
    if (actions) actions.style.display = tile.classList.contains('minimized') ? 'none' : '';
    updateFullscreenIconForTile(tile);
  });
}

document.addEventListener('fullscreenchange', () => {
  try {
    const tiles = streamsDiv?.querySelectorAll?.('.stream-tile') || [];
    tiles.forEach(tile => updateFullscreenIconForTile(tile));
  } catch (e) {}
});

function ensureWatchOverlay(wrapper, participantId) {
  if (!wrapper) return;
  if (wrapper.querySelector('.stream-watch-overlay')) return;
  let mediaWrap = wrapper.querySelector('.stream-media');
  if (!mediaWrap) {
    const videoEl = wrapper.querySelector('video');
    if (videoEl) {
      mediaWrap = document.createElement('div');
      mediaWrap.className = 'stream-media';
      videoEl.parentElement?.replaceChild(mediaWrap, videoEl);
      mediaWrap.appendChild(videoEl);
    }
  }
  const overlay = document.createElement('div');
  overlay.className = 'stream-watch-overlay';
  const isLocal = wrapper.dataset.local === 'true';
  const watchBtn = document.createElement('button');
  watchBtn.className = 'btn primary watch-overlay-btn';
  watchBtn.type = 'button';
  const displayName = participantId ? getDisplayNameForId(participantId, participantId) : '';
  if (isLocal) {
    const isMin = wrapper.classList.contains('minimized');
    watchBtn.textContent = isMin ? 'Restore' : 'Stop';
    watchBtn.dataset.action = isMin ? 'restore' : 'stop';
  } else {
    watchBtn.textContent = watchedVideoParticipants.has(participantId)
      ? 'Stop'
      : (displayName ? `Watch ${displayName}` : 'Watch');
    watchBtn.dataset.action = watchedVideoParticipants.has(participantId) ? 'stop' : 'watch';
  }
  const overlayActions = document.createElement('div');
  overlayActions.className = 'watch-overlay-actions';
  const minimizeOverlayBtn = document.createElement('button');
  minimizeOverlayBtn.className = 'btn ghost small';
  minimizeOverlayBtn.type = 'button';
  minimizeOverlayBtn.textContent = 'Minimize';
  const fsOverlayBtn = document.createElement('button');
  fsOverlayBtn.className = 'btn ghost small fullscreen-toggle';
  fsOverlayBtn.type = 'button';
  fsOverlayBtn.setAttribute('aria-label', 'Fullscreen');
  fsOverlayBtn.setAttribute('title', 'Fullscreen');
  const fsIcon = document.createElement('span');
  fsIcon.className = 'icon expand';
  fsIcon.setAttribute('aria-hidden', 'true');
  fsOverlayBtn.appendChild(fsIcon);
  watchBtn.onclick = () => {
    logInfo('[watch] overlay clicked', { participantId, trackSid: wrapper.dataset.sid });
    if (!participantId) return;
    const trackSid = wrapper.dataset.sid;
    if (isLocal) {
      if (wrapper.classList.contains('minimized')) {
        restoreMinimizedTile(trackSid, participantId);
        updateWatchOverlays(participantId);
      } else {
        stopStreaming();
      }
      return;
    }
    if (watchedVideoParticipants.has(participantId)) {
      watchedVideoParticipants.delete(participantId);
      setParticipantVideoSubscribed(participantId, false, trackSid);
      setParticipantStreamAudioSubscribed(participantId, false);
      pendingStreamAudioPlay.delete(participantId);
      setTileWatchState(wrapper, false);
    } else {
      if (wrapper.classList.contains('minimized')) {
        restoreMinimizedTile(trackSid, participantId);
      }
      watchedVideoParticipants.add(participantId);
      setParticipantVideoSubscribed(participantId, true, trackSid);
      setParticipantStreamAudioSubscribed(participantId, true);
      pendingStreamAudioPlay.add(participantId);
      kickStreamAudioPlayback(participantId);
      setTileWatchState(wrapper, true);
    }
    logVideoSubscriptions('overlay click');
    updateWatchOverlays(participantId);
    updateParticipantWatchControls(participantId);
    reconcileParticipantAudioAssignments(participantId);
  };
  minimizeOverlayBtn.onclick = () => {
    if (!participantId) return;
    const trackSid = wrapper.dataset.sid;
    const isLocal = room?.localParticipant
      && (participantId === room.localParticipant.identity || participantId === room.localParticipant.sid);
    if (!wrapper.classList.contains('minimized')) {
      wrapper.classList.add('minimized');
      minimizedTiles.add(trackSid);
      if (minimizedStreams) minimizedStreams.appendChild(wrapper);
    }
    ensureMinimizedPlaceholder(participantId, trackSid);
    if (!isLocal) {
      watchedVideoParticipants.delete(participantId);
      setParticipantVideoSubscribed(participantId, false, trackSid);
      setParticipantStreamAudioSubscribed(participantId, false);
      setTileWatchState(wrapper, false);
      updateWatchOverlays(participantId);
      updateParticipantWatchControls(participantId);
      reconcileParticipantAudioAssignments(participantId);
    }
    const minTile = minimizedStreams?.querySelector(`[data-sid="${trackSid}"]`) || wrapper;
    ensureWatchOverlay(minTile, participantId);
    updateWatchOverlays(participantId);
    if (overlayActions) overlayActions.style.display = 'none';
    updateMinimizedPanelVisibility();
  };
  fsOverlayBtn.onclick = () => {
    const isFs = document.fullscreenElement === wrapper
      || document.webkitFullscreenElement === wrapper
      || document.mozFullScreenElement === wrapper
      || document.msFullscreenElement === wrapper;
    if (isFs) exitFullscreen();
    else requestFullscreenForElement(wrapper);
    updateFullscreenIconForTile(wrapper);
  };
  overlayActions.appendChild(minimizeOverlayBtn);
  overlayActions.appendChild(fsOverlayBtn);
  overlay.appendChild(watchBtn);
  overlay.appendChild(overlayActions);
  (mediaWrap || wrapper).appendChild(overlay);
  updateFullscreenIconForTile(wrapper);
}

function getOrCreateVideoTile(participantId, trackSid) {
  if (!streamsDiv || !trackSid) return null;
  let tile = streamsDiv.querySelector(`[data-sid="${trackSid}"]`);
  if (!tile && participantId) {
    tile = streamsDiv.querySelector(`.stream-tile.placeholder[data-participant-id="${participantId}"]`);
    if (tile) {
      tile.dataset.sid = trackSid;
    }
  }
  if (tile) return tile;
  ensureVideoPlaceholder(participantId, trackSid);
  return streamsDiv.querySelector(`[data-sid="${trackSid}"]`);
}

function ensureVideoPlaceholder(participantId, trackSid) {
  try {
    if (!streamsDiv || !trackSid) return;
    if (participantId) {
      const existingByParticipant = streamsDiv.querySelector(`.stream-tile.placeholder[data-participant-id="${participantId}"]`);
      if (existingByParticipant) {
        existingByParticipant.dataset.sid = trackSid;
        return;
      }
    }
    if (streamsDiv.querySelector(`[data-sid="${trackSid}"]`)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'stream-tile placeholder';
    wrapper.dataset.sid = trackSid;
    if (participantId) wrapper.dataset.participantId = participantId;

    const header = document.createElement('div');
    header.className = 'stream-header';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'stream-title';

    const nameLabel = document.createElement('div');
    nameLabel.dataset.streamNameLabel = 'true';
    nameLabel.className = 'stream-name';
    if (participantId) {
      const displayName = getDisplayNameForId(participantId, participantId);
      const info = participantStreamInfo.get(participantId) || '';
      nameLabel.textContent = info ? `${displayName} | ${info}` : displayName;
      nameLabel.style.display = nameLabel.textContent ? 'block' : 'none';
    } else {
      nameLabel.style.display = 'none';
    }


    const label = document.createElement('div');
    label.dataset.streamInfoLabel = 'true';
    label.className = 'stream-info';
    label.style.display = 'none';

    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'stream-media';

    const el = document.createElement('video');
    el.autoplay = true;
    el.playsInline = true;
    el.muted = true;

    nameWrap.appendChild(nameLabel);
    nameWrap.appendChild(label);
    header.appendChild(nameWrap);
    mediaWrap.appendChild(el);
    wrapper.appendChild(header);
    wrapper.appendChild(mediaWrap);
    streamsDiv.appendChild(wrapper);
    ensureWatchOverlay(wrapper, participantId);
    setTileWatchState(wrapper, watchedVideoParticipants.has(participantId));
    if (minimizedTiles.has(trackSid)) {
      wrapper.classList.add('minimized');
      if (minimizedStreams) minimizedStreams.appendChild(wrapper);
    }
    updateMinimizedPanelVisibility();
  } catch (e) {}
}

function attachParticipantToTile(trackSid, participantId) {
  try {
    if (!trackSid || !participantId) return;
    const tile = streamsDiv.querySelector(`[data-sid="${trackSid}"]`);
    if (!tile) return;
    tile.dataset.participantId = participantId;
    updateStreamNameLabel(participantId);
  } catch (e) {}
}

function updateAudioControlsForParticipant(participantId) {
  try {
    const controls = participantAudioControls.get(participantId);
    const listControls = participantListAudioControls.get(participantId);
    const audioEl = participantAudioEls.get(participantId);
  const apply = (ctrl) => {
      if (!ctrl) return;
      ctrl.muteBtn.disabled = !audioEl;
      ctrl.slider.disabled = !audioEl;
      if (!audioEl) {
        ctrl.slider.value = '100';
        return;
      }
      ctrl.muteBtn.classList.toggle('is-muted', audioEl.muted);
      const icon = ctrl.muteBtn.querySelector('.icon');
      if (icon) {
        icon.classList.toggle('mic-on', !audioEl.muted);
        icon.classList.toggle('mic-off', audioEl.muted);
      }
      ctrl.muteBtn.setAttribute('aria-label', audioEl.muted ? 'Unmute participant' : 'Mute participant');
      ctrl.muteBtn.setAttribute('title', audioEl.muted ? 'Unmute participant' : 'Mute participant');
      if (document.activeElement !== ctrl.slider) {
        const volValue = audioEl.muted ? 0 : Math.round(audioEl.volume * 100);
        ctrl.slider.value = String(volValue);
      }
    };
    apply(controls);
    apply(listControls);
  } catch (e) {}
}

function updateStreamAudioControlsForParticipant(participantId) {
  try {
    const controls = participantStreamAudioControls.get(participantId);
    if (!controls) return;
    const audioEl = participantStreamAudioEls.get(participantId);
    const isWatched = watchedVideoParticipants.has(participantId);
    controls.row.classList.toggle('active', !!audioEl && isWatched);
    if (!audioEl) return;
    controls.muteBtn.classList.toggle('is-muted', audioEl.muted);
    const icon = controls.muteBtn.querySelector('.icon');
    if (icon) {
      icon.classList.toggle('tv-on', !audioEl.muted);
      icon.classList.toggle('tv-off', audioEl.muted);
    }
    controls.muteBtn.setAttribute('aria-label', audioEl.muted ? 'Unmute stream audio' : 'Mute stream audio');
    controls.muteBtn.setAttribute('title', audioEl.muted ? 'Unmute stream audio' : 'Mute stream audio');
    if (document.activeElement !== controls.slider) {
      const volValue = audioEl.muted ? 0 : Math.round(audioEl.volume * 100);
      controls.slider.value = String(volValue);
    }
  } catch (e) {}
}

function loadParticipantAudioSettings() {
  try {
    const raw = localStorage.getItem(participantAudioSettingsKey);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return;
    Object.keys(data).forEach(id => {
      const entry = data[id];
      if (!entry) return;
      const vol = Math.max(0, Math.min(1, Number(entry.vol)));
      const muted = entry.muted === true;
      participantAudioSettings.set(id, { vol: isNaN(vol) ? 1 : vol, muted });
    });
  } catch (e) {}
}

function saveParticipantAudioSettings() {
  try {
    const data = {};
    participantAudioSettings.forEach((entry, id) => {
      data[id] = { vol: entry.vol, muted: entry.muted };
    });
    localStorage.setItem(participantAudioSettingsKey, JSON.stringify(data));
  } catch (e) {}
}

function applySavedAudioSettings(participantId, audioEl) {
  if (!participantId || !audioEl) return;
  const entry = participantAudioSettings.get(participantId);
  if (!entry) return;
  audioEl.volume = Math.max(0, Math.min(1, Number(entry.vol)));
  audioEl.muted = entry.muted || muteIncomingAll;
}

function setParticipantAudioSetting(participantId, setting) {
  if (!participantId) return;
  const current = participantAudioSettings.get(participantId) || { vol: 1, muted: false };
  const next = { ...current, ...setting };
  participantAudioSettings.set(participantId, next);
  saveParticipantAudioSettings();
}

function isScreenShareAudio(track, sourceOverride) {
  try {
    const rawSource = sourceOverride ?? track?.source;
    const sourceText = (() => {
      if (typeof rawSource === 'string') return rawSource;
      if (typeof rawSource === 'number') {
        const map = {
          0: 'unknown',
          1: 'camera',
          2: 'microphone',
          3: 'screen_share',
          4: 'screen_share_audio'
        };
        return map[rawSource] || String(rawSource);
      }
      if (rawSource && typeof rawSource === 'object') {
        if (typeof rawSource.name === 'string') return rawSource.name;
        if (typeof rawSource.toString === 'function') return rawSource.toString();
      }
      return String(rawSource || '');
    })();
    const source = sourceText.toLowerCase();
    const name = (track?.name || '').toLowerCase();
    const label = (track?.mediaStreamTrack?.label || '').toLowerCase();
    return source.includes('screen_share')
      || source.includes('screen-share')
      || source.includes('screenshare')
      || source.includes('screen_share_audio')
      || name.includes('screen')
      || name.includes('systemaudio')
      || label.includes('screen')
      || label.includes('system');
  } catch (e) {}
  return false;
}

function isScreenShareAudioStrict(track, sourceOverride) {
  try {
    const rawSource = sourceOverride ?? track?.source;
    if (typeof rawSource === 'string') {
      const source = rawSource.toLowerCase();
      return source.includes('screen_share_audio') || source.includes('screen-share-audio');
    }
    if (typeof rawSource === 'number') {
      return rawSource === 4;
    }
    if (rawSource && typeof rawSource === 'object') {
      const name = typeof rawSource.name === 'string' ? rawSource.name.toLowerCase() : '';
      return name.includes('screen_share_audio') || name.includes('screen-share-audio');
    }
  } catch (e) {}
  return false;
}

function isLikelyStreamAudioTrack(track, sourceOverride) {
  if (isScreenShareAudioStrict(track, sourceOverride)) return true;
  return isScreenShareAudio(track, sourceOverride);
}

function isStreamAudioPublication(pub) {
  if (!pub) return false;
  if (isScreenShareAudioStrict(pub?.track || {}, pub?.source)) return true;
  const name = (pub?.trackName || pub?.name || pub?.track?.name || '').toLowerCase();
  if (name.includes('systemaudio') || name.includes('screen_share_audio') || name.includes('screen')) return true;
  return isScreenShareAudio(pub?.track || {}, pub?.source);
}

function isMicrophoneAudio(track, sourceOverride) {
  try {
    const rawSource = sourceOverride ?? track?.source;
    const sourceText = (() => {
      if (typeof rawSource === 'string') return rawSource;
      if (typeof rawSource === 'number') {
        const map = {
          0: 'unknown',
          1: 'camera',
          2: 'microphone',
          3: 'screen_share',
          4: 'screen_share_audio'
        };
        return map[rawSource] || String(rawSource);
      }
      if (rawSource && typeof rawSource === 'object') {
        if (typeof rawSource.name === 'string') return rawSource.name;
        if (typeof rawSource.toString === 'function') return rawSource.toString();
      }
      return String(rawSource || '');
    })();
    const source = sourceText.toLowerCase();
    const name = (track?.name || '').toLowerCase();
    const label = (track?.mediaStreamTrack?.label || '').toLowerCase();
    return source.includes('microphone')
      || name.includes('mic')
      || label.includes('microphone');
  } catch (e) {}
  return false;
}

function getPublicationMuted(pub) {
  try {
    if (!pub) return false;
    if (typeof pub.isMuted === 'boolean') return pub.isMuted;
    if (typeof pub.muted === 'boolean') return pub.muted;
    if (typeof pub.isMuted === 'function') return pub.isMuted();
  } catch (e) {}
  return false;
}

function getParticipantMutedAttribute(participant) {
  try {
    const raw = participant?.attributes?.mic_muted;
    if (raw == null) return null;
    return String(raw) === 'true';
  } catch (e) {}
  return null;
}

function setParticipantMutedVisual(participantId, muted) {
  if (!participantId) return;
  participantMicMuted.set(participantId, !!muted);
  const container = document.getElementById(`participant-${participantId}`);
  if (container) container.classList.toggle('is-muted', !!muted);
  const row = container ? container.querySelector('.participant-row') : null;
  if (row) row.classList.toggle('is-muted', !!muted);
}

function updateParticipantMutedFromPublications(participant) {
  if (!participant) return;
  const id = participant.identity || participant.sid;
  if (!id) return;
  const attrMuted = getParticipantMutedAttribute(participant);
  if (attrMuted !== null) {
    setParticipantMutedVisual(id, attrMuted);
    return;
  }
  if (participantMicMuted.has(id)) {
    setParticipantMutedVisual(id, participantMicMuted.get(id));
    return;
  }
  let muted = false;
  let found = false;
  try {
    const pubs = participant.audioTrackPublications
      ? Array.from(participant.audioTrackPublications.values ? participant.audioTrackPublications.values() : participant.audioTrackPublications)
      : [];
    pubs.forEach(pub => {
      if (pub?.kind && pub.kind !== 'audio') return;
      if (isScreenShareAudio(pub?.track || {}, pub?.source)) return;
      found = true;
      muted = getPublicationMuted(pub);
    });
  } catch (e) {}
  if (!found) {
    muted = participantMicMuted.has(id) ? participantMicMuted.get(id) : false;
  }
  setParticipantMutedVisual(id, muted);
}

function wireParticipantMuteListeners(participant) {
  if (!participant || participantMuteListeners.has(participant)) return;
  participantMuteListeners.add(participant);
  const mutedEvent = LiveKit?.ParticipantEvent?.TrackMuted || 'trackMuted';
  const unmutedEvent = LiveKit?.ParticipantEvent?.TrackUnmuted || 'trackUnmuted';
  try {
    participant.on(mutedEvent, (publication) => {
      if (!publication) return;
      if ((publication.kind || publication.track?.kind) !== 'audio') return;
      if (isScreenShareAudio(publication?.track || {}, publication?.source)) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      setParticipantMutedVisual(id, true);
    });
    participant.on(unmutedEvent, (publication) => {
      if (!publication) return;
      if ((publication.kind || publication.track?.kind) !== 'audio') return;
      if (isScreenShareAudio(publication?.track || {}, publication?.source)) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      setParticipantMutedVisual(id, false);
    });
  } catch (e) {}
}

function startMuteBroadcast() {
  if (muteBroadcastTimer) return;
  const send = () => {
    try {
      if (room?.state !== 'connected') return;
      if (room?.localParticipant?.publishData) {
        const payload = JSON.stringify({ type: 'mic_mute', muted: !!micMuted });
        room.localParticipant.publishData(new TextEncoder().encode(payload), { reliable: true });
      }
    } catch (e) {}
  };
  send();
  muteBroadcastTimer = setInterval(send, 2000);
}

function stopMuteBroadcast() {
  if (!muteBroadcastTimer) return;
  clearInterval(muteBroadcastTimer);
  muteBroadcastTimer = null;
}

function applySavedStreamAudioSettings(participantId, audioEl) {
  if (!participantId || !audioEl) return;
  const entry = participantStreamAudioSettings.get(participantId);
  if (!entry) return;
  audioEl.volume = Math.max(0, Math.min(1, Number(entry.vol)));
  audioEl.muted = entry.muted || muteIncomingAll;
}

function setParticipantStreamAudioSetting(participantId, setting) {
  if (!participantId) return;
  const current = participantStreamAudioSettings.get(participantId) || { vol: 1, muted: false };
  const next = { ...current, ...setting };
  participantStreamAudioSettings.set(participantId, next);
}

function getTrackChannelCount(track) {
  try {
    const settings = track?.mediaStreamTrack?.getSettings?.();
    if (settings && typeof settings.channelCount === 'number') return settings.channelCount;
  } catch (e) {}
  return 0;
}

function registerRemoteAudioTrack(participantId, track, audioEl) {
  if (!participantId || !track || !audioEl) return;
  let list = participantAudioTracks.get(participantId);
  if (!list) {
    list = new Map();
    participantAudioTracks.set(participantId, list);
  }
  list.set(track.sid, {
    track,
    el: audioEl,
    channelCount: getTrackChannelCount(track),
    source: trackSourceBySid.get(track.sid) || track?.source,
    addedAt: Date.now()
  });
  reconcileParticipantAudioAssignments(participantId);
}

function unregisterRemoteAudioTrack(participantId, track) {
  if (!participantId || !track) return;
  const list = participantAudioTracks.get(participantId);
  if (list) {
    list.delete(track.sid);
    if (list.size === 0) participantAudioTracks.delete(participantId);
  }
  reconcileParticipantAudioAssignments(participantId);
}

function reconcileParticipantAudioAssignments(participantId) {
  const list = participantAudioTracks.get(participantId);
  const tracks = list ? Array.from(list.values()) : [];
  const isStreaming = Boolean(participantStreamInfo.get(participantId));
  const isWatched = watchedVideoParticipants.has(participantId);
  let micInfo = null;
  let streamInfo = null;

  if (tracks.length === 0) {
    ensureParticipantMicSubscribed(participantId);
  }

  tracks.forEach(info => {
    try {
      const liveCount = getTrackChannelCount(info.track);
      if (liveCount && liveCount !== info.channelCount) {
        info.channelCount = liveCount;
      }
    } catch (e) {}
  });

  if (tracks.length === 1) {
    const info = tracks[0];
    const isScreenAudio = isLikelyStreamAudioTrack(info.track, info.source);
    if (isScreenAudio) streamInfo = info;
    else micInfo = info;
  } else if (tracks.length >= 2) {
    streamInfo = tracks.find(t => isLikelyStreamAudioTrack(t.track, t.source)) || null;
    if (streamInfo) {
      micInfo = tracks.find(t => isMicrophoneAudio(t.track, t.source)) || tracks.find(t => t !== streamInfo) || null;
    } else {
      micInfo = tracks.find(t => isMicrophoneAudio(t.track, t.source)) || null;
      if (micInfo) {
        streamInfo = tracks.find(t => t !== micInfo) || null;
      } else if (isStreaming) {
        const ordered = tracks.slice().sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        micInfo = ordered[0] || null;
        streamInfo = ordered[ordered.length - 1] || null;
      } else {
        micInfo = tracks[0];
        streamInfo = tracks.find(t => t !== micInfo) || tracks[1];
      }
    }
    if (isStreaming) {
      const explicitMic = tracks.find(t => isMicrophoneAudio(t.track, t.source)) || null;
      const explicitStream = tracks.find(t => isLikelyStreamAudioTrack(t.track, t.source)) || null;
      if (explicitMic) {
        micInfo = explicitMic;
        if (explicitStream) {
          streamInfo = explicitStream;
        } else if (streamInfo === micInfo) {
          streamInfo = tracks.find(t => t !== micInfo) || null;
        }
      } else if (explicitStream && streamInfo !== explicitStream) {
        streamInfo = explicitStream;
        if (micInfo === streamInfo) {
          micInfo = tracks.find(t => t !== streamInfo) || null;
        }
      }
    }
    if (isStreaming && micInfo && streamInfo && micInfo !== streamInfo) {
      const micCh = micInfo.channelCount || 0;
      const streamCh = streamInfo.channelCount || 0;
      if (micCh && streamCh && micCh > streamCh) {
        const swap = micInfo;
        micInfo = streamInfo;
        streamInfo = swap;
      }
    } else if (isStreaming && !streamInfo && tracks.length >= 2) {
      const orderedByChannels = tracks.slice().sort((a, b) => (b.channelCount || 0) - (a.channelCount || 0));
      const first = orderedByChannels[0];
      const second = orderedByChannels[1];
      if ((first?.channelCount || 0) > (second?.channelCount || 0)) {
        streamInfo = first;
        if (!micInfo || micInfo === streamInfo) micInfo = second || micInfo;
      }
    }
  }

  if (micInfo) {
    participantAudioEls.set(participantId, micInfo.el);
    const entry = participantAudioSettings.get(participantId);
    if (entry) {
      applySavedAudioSettings(participantId, micInfo.el);
    } else {
      micInfo.el.volume = 1;
      micInfo.el.muted = muteIncomingAll ? true : false;
    }
    updateAudioControlsForParticipant(participantId);
    disconnectParticipantMeter(participantId);
    connectParticipantMeter(participantId, micInfo.el || micInfo.track);
  } else {
    participantAudioEls.delete(participantId);
    updateAudioControlsForParticipant(participantId);
    disconnectParticipantMeter(participantId);
  }

  if (streamInfo) {
    participantStreamAudioEls.set(participantId, streamInfo.el);
    if (isWatched) {
      const entry = participantStreamAudioSettings.get(participantId);
      if (entry) {
        applySavedStreamAudioSettings(participantId, streamInfo.el);
      } else {
        streamInfo.el.volume = 1;
        streamInfo.el.muted = muteIncomingAll ? true : false;
      }
      try {
        const currentTrack = streamInfo.el.srcObject?.getAudioTracks?.()[0];
        if (!currentTrack || currentTrack.id !== streamInfo.track.mediaStreamTrack.id) {
          streamInfo.el.srcObject = new MediaStream([streamInfo.track.mediaStreamTrack]);
        }
      } catch (e) {}
      disconnectParticipantStreamMeter(participantId);
      connectParticipantStreamMeter(participantId, streamInfo.el || streamInfo.track);
      if (pendingStreamAudioPlay.has(participantId)) {
        pendingStreamAudioPlay.delete(participantId);
        setTimeout(() => {
          kickStreamAudioPlayback(participantId);
        }, 100);
      }
    } else {
      streamInfo.el.muted = true;
      try { streamInfo.track.mediaStreamTrack.enabled = false; } catch (e) {}
      disconnectParticipantStreamMeter(participantId);
    }
    updateStreamAudioControlsForParticipant(participantId);
  } else {
    participantStreamAudioEls.delete(participantId);
    updateStreamAudioControlsForParticipant(participantId);
    disconnectParticipantStreamMeter(participantId);
  }

  const micIsMicSource = micInfo && isMicrophoneAudio(micInfo.track, micInfo.source);
  const micLooksLikeScreen = micInfo && isScreenShareAudio(micInfo.track, micInfo.source);
  const micLooksLikeScreenStrict = micInfo && isScreenShareAudioStrict(micInfo.track, micInfo.source);
  const hasDistinctStream = Boolean(streamInfo && micInfo && streamInfo !== micInfo);
  if (micInfo) {
    const allowMicAudio = !micLooksLikeScreenStrict || micIsMicSource || hasDistinctStream;
    if (isStreaming && !isWatched) {
      try {
        logInfo('[audio][assign] mic candidate', {
          participantId,
          allowMicAudio,
          micIsMicSource,
          micLooksLikeScreen,
          channelCount: micInfo.channelCount,
          source: micInfo.source,
          name: micInfo.track?.name || '',
          label: micInfo.track?.mediaStreamTrack?.label || ''
        });
      } catch (e) {}
    }
    if (allowMicAudio) {
      try { micInfo.track.mediaStreamTrack.enabled = true; } catch (e) {}
    } else {
      micInfo.el.muted = true;
      try { micInfo.track.mediaStreamTrack.enabled = false; } catch (e) {}
    }
  }

  if (streamInfo && isWatched) {
    try { streamInfo.track.mediaStreamTrack.enabled = true; } catch (e) {}
    streamInfo.el.muted = muteIncomingAll ? true : false;
    try {
      logInfo('[audio][stream] watched state', {
        participantId,
        enabled: streamInfo.track?.mediaStreamTrack?.enabled,
        muted: streamInfo.el.muted,
        volume: streamInfo.el.volume,
        channelCount: streamInfo.channelCount,
        source: streamInfo.source,
        label: streamInfo.track?.mediaStreamTrack?.label || ''
      });
    } catch (e) {}
  }
  if (isStreaming && !isWatched && streamInfo) {
    try {
      logInfo('[audio][assign] stream candidate (muted until watch)', {
        participantId,
        channelCount: streamInfo.channelCount,
        source: streamInfo.source,
        name: streamInfo.track?.name || '',
        label: streamInfo.track?.mediaStreamTrack?.label || ''
      });
    } catch (e) {}
  }
  if (isWatched && isStreaming && !streamInfo && tracks.length && !missingStreamAudioLogged.has(participantId)) {
    missingStreamAudioLogged.add(participantId);
    try {
      logInfo('[stream-audio] no stream track detected', {
        participantId,
        trackCount: tracks.length,
        tracks: tracks.map(t => ({
          sid: t.track?.sid,
          channelCount: t.channelCount,
          source: t.source,
          name: t.track?.name || '',
          label: t.track?.mediaStreamTrack?.label || ''
        }))
      });
    } catch (e) {}
  }
}

function startRoomPreviewTimer() {
  if (roomPreviewTimer) return;
  roomPreviewTimer = setInterval(() => {
    refreshRoomPreview();
  }, 5000);
}

function stopRoomPreviewTimer() {
  if (!roomPreviewTimer) return;
  clearInterval(roomPreviewTimer);
  roomPreviewTimer = null;
}

function setMicMuteState(muted) {
  micMuted = muted;
  if (micAudioTrack) {
    micAudioTrack.mediaStreamTrack.enabled = !muted;
  }
  if (!muteMicBtn) return;
  muteMicBtn.classList.toggle('is-muted', muted);
  muteMicBtn.setAttribute('aria-label', muted ? 'Unmute Mic' : 'Mute Mic');
  muteMicBtn.setAttribute('title', muted ? 'Unmute Mic' : 'Mute Mic');
  const icon = muteMicBtn.querySelector('.icon');
  if (icon) {
    icon.classList.toggle('mic-on', !muted);
    icon.classList.toggle('mic-off', muted);
  }
  const localId = room?.localParticipant?.identity || room?.localParticipant?.sid;
  if (localId) {
    const container = document.getElementById(`participant-${localId}`);
    if (container) container.classList.toggle('is-muted', muted);
  }
  try {
    if (room?.localParticipant?.setAttributes) {
      const current = room.localParticipant.attributes || {};
      room.localParticipant.setAttributes({ ...current, mic_muted: muted ? 'true' : 'false' });
    }
  } catch (e) {}
  if (muted) startMuteBroadcast();
  else stopMuteBroadcast();
}

function setMuteIncomingState(muted) {
  muteIncomingAll = muted;
  if (!muteIncomingBtn) return;
  muteIncomingBtn.classList.toggle('is-muted', muted);
  muteIncomingBtn.setAttribute('aria-label', muted ? 'Unmute Incoming Audio' : 'Mute Incoming Audio');
  muteIncomingBtn.setAttribute('title', muted ? 'Unmute Incoming Audio' : 'Mute Incoming Audio');
  const icon = muteIncomingBtn.querySelector('.icon');
  if (icon) {
    icon.classList.toggle('headphones-on', !muted);
    icon.classList.toggle('headphones-off', muted);
  }
}

function applyMuteIncomingToAll() {
  participantAudioEls.forEach((audioEl, pid) => {
    if (!audioEl) return;
    if (muteIncomingAll) {
      audioEl.muted = true;
    } else {
      const saved = participantAudioSettings.get(pid);
      audioEl.muted = saved ? saved.muted : false;
      if (saved && typeof saved.vol === 'number') {
        audioEl.volume = Math.max(0, Math.min(1, saved.vol));
      }
    }
    updateAudioControlsForParticipant(pid);
  });
  participantStreamAudioEls.forEach((audioEl, pid) => {
    if (!audioEl) return;
    if (muteIncomingAll) {
      audioEl.muted = true;
    } else {
      if (!watchedVideoParticipants.has(pid)) {
        audioEl.muted = true;
        updateStreamAudioControlsForParticipant(pid);
        return;
      }
      const saved = participantStreamAudioSettings.get(pid);
      audioEl.muted = saved ? saved.muted : false;
      if (saved && typeof saved.vol === 'number') {
        audioEl.volume = Math.max(0, Math.min(1, saved.vol));
      }
    }
    updateStreamAudioControlsForParticipant(pid);
  });
}

function updateParticipantListName(id, name) {
  try {
    if (!participantsList) return;
    const nameEl = participantsList.querySelector(`#participant-${id} .participant-name`);
    if (nameEl) nameEl.textContent = getDisplayNameForId(id, name || nameEl.textContent);
  } catch (e) {}
}

function getAudioElForTile(tile) {
  try {
    const pid = tile?.dataset?.participantId;
    if (!pid) return null;
    return participantAudioEls.get(pid) || null;
  } catch (e) {}
  return null;
}

function setLocalStreamAttributes(attrs) {
  try {
    if (room?.localParticipant?.setAttributes) {
      const current = room.localParticipant.attributes || {};
      const next = { ...current, ...attrs };
      const p = room.localParticipant.setAttributes(next);
      if (p && typeof p.catch === 'function') {
        p.catch(err => console.warn('setAttributes failed:', err));
      }
      updateParticipantStreamInfo(room.localParticipant);
    }
  } catch (e) {}
}

function applyRecommendedBitrate() {
  if (!resolutionSelect || !bitrateInput) return;
  const base = recommendedBitratesKbps60[resolutionSelect.value];
  const fps = getSelectedFps();
  if (!base || !fps) return;
  const rec = Math.round(base * (fps / 60));
  bitrateInput.value = String(rec);
  bitrateInput.placeholder = "";
}

function clampChatWidth(value) {
  const min = 277;
  const max = 520;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return desiredChatWidth;
  return Math.max(min, Math.min(max, parsed));
}

function clampLeftWidth(value) {
  const min = 277;
  const max = 420;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return desiredLeftWidth;
  return Math.max(min, Math.min(max, parsed));
}

function applyChatWidth(width) {
  if (!layoutEl) return;
  const next = clampChatWidth(width);
  desiredChatWidth = next;
  layoutEl.style.setProperty('--chatWidth', `${next}px`);
}

function applyLeftWidth(width) {
  if (!layoutEl) return;
  const next = clampLeftWidth(width);
  desiredLeftWidth = next;
  layoutEl.style.setProperty('--leftWidth', `${next}px`);
}

function applyChatCollapsed(collapsed) {
  chatCollapsed = !!collapsed;
  if (chatDock) chatDock.classList.toggle('collapsed', chatCollapsed);
  if (layoutEl) layoutEl.classList.toggle('chat-collapsed', chatCollapsed);
  if (chatPanel) chatPanel.classList.toggle('collapsed', chatCollapsed);
  if (!chatCollapsed && chatLog) {
    requestAnimationFrame(() => {
      chatLog.scrollTop = chatLog.scrollHeight;
    });
  }
}

function updateResponsiveChat() {
  const isNarrow = window.innerWidth < 420;
  document.body.classList.toggle('narrow', isNarrow);
  if (isNarrow && !chatCollapsed) {
    autoCollapsedForWidth = true;
    applyChatCollapsed(true);
  } else if (!isNarrow && autoCollapsedForWidth) {
    autoCollapsedForWidth = false;
    applyChatCollapsed(false);
  }
}

function updateHotkeyDisplay() {
  if (!muteHotkeyDisplay) return;
  muteHotkeyDisplay.textContent = muteHotkey || 'None';
  muteHotkeyDisplay.classList.toggle('listening', capturingHotkey);
}

async function applyGlobalMuteHotkey() {
  try {
    if (!window.electronAPI?.setMuteHotkey) return;
    await window.electronAPI.setMuteHotkey(muteHotkey || '');
  } catch (e) {}
}

function formatHotkey(event) {
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');
  let key = event.key;
  if (!key) return '';
  if (key === ' ') key = 'Space';
  if (key === 'Escape') key = 'Esc';
  if (key.length === 1) key = key.toUpperCase();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return '';
  parts.push(key);
  return parts.join('+');
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}


function saveSettings() {
  try {
    desiredSourceId = sourceSelect?.value || desiredSourceId;
    const data = {
      resolution: resolutionSelect?.value || '',
      fps: fpsSelect?.value || '',
      bitrate: bitrateInput?.value || '',
      sourceId: desiredSourceId || '',
      playbackDeviceId: playbackDeviceSelect?.value || desiredPlaybackDeviceId || 'default',
      inputDeviceId: inputDeviceSelect?.value || desiredInputDeviceId || 'default',
      micMuted: micMuted ? 'true' : 'false',
      incomingMuted: muteIncomingAll ? 'true' : 'false',
      leftWidth: String(desiredLeftWidth),
      chatWidth: String(desiredChatWidth),
      chatCollapsed: chatCollapsed ? 'true' : 'false',
      muteHotkey: muteHotkey || '',
      noiseGateEnabled: micProcessing.noiseGateEnabled ? 'true' : 'false',
      noiseGateLevel: String(micProcessing.noiseGateLevel),
      enhancedVoiceEnabled: micProcessing.enhancedVoiceEnabled ? 'true' : 'false',
      enhancedVoiceLevel: String(micProcessing.enhancedVoiceLevel),
      // manualGain: String(manualMicGain),
      serverUrl: serverUrlInput?.value || '',
      chatServerUrl: chatServerInput?.value || '',
      presenceServerUrl: presenceServerInput?.value || '',
      updateServerUrl: updateServerInput?.value || '',
      theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
      theater: document.body.classList.contains('theater-mode') ? 'true' : 'false'
    };
    localStorage.setItem(settingsKey, JSON.stringify(data));
  } catch (e) {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.resolution && resolutionSelect) resolutionSelect.value = data.resolution;
    if (data.fps && fpsSelect) fpsSelect.value = data.fps;
    if (data.bitrate && bitrateInput) bitrateInput.value = data.bitrate;
    if (data.sourceId) {
      desiredSourceId = data.sourceId;
      if (sourceSelect) sourceSelect.value = data.sourceId;
    }
    if (data.playbackDeviceId) desiredPlaybackDeviceId = data.playbackDeviceId;
    if (data.inputDeviceId) desiredInputDeviceId = data.inputDeviceId;
    if (data.micMuted) micMuted = data.micMuted === 'true';
    if (data.incomingMuted) muteIncomingAll = data.incomingMuted === 'true';
    if (data.leftWidth !== undefined) desiredLeftWidth = clampLeftWidth(data.leftWidth);
    if (data.chatWidth !== undefined) desiredChatWidth = clampChatWidth(data.chatWidth);
    if (data.chatCollapsed !== undefined) chatCollapsed = data.chatCollapsed === 'true';
    if (data.muteHotkey !== undefined) muteHotkey = String(data.muteHotkey || '');
    if (data.noiseGateEnabled !== undefined) micProcessing.noiseGateEnabled = data.noiseGateEnabled === 'true';
    if (data.noiseGateLevel !== undefined) micProcessing.noiseGateLevel = Math.max(0, Math.min(100, Number(data.noiseGateLevel) || 0));
    if (data.enhancedVoiceEnabled !== undefined) micProcessing.enhancedVoiceEnabled = data.enhancedVoiceEnabled === 'true';
    if (data.enhancedVoiceLevel !== undefined) micProcessing.enhancedVoiceLevel = Math.max(0, Math.min(100, Number(data.enhancedVoiceLevel) || 0));
    // if (data.manualGain) manualMicGain = Math.max(0, Number(data.manualGain) || 1);
    if (data.serverUrl && serverUrlInput) serverUrlInput.value = data.serverUrl;
    if (data.chatServerUrl !== undefined && chatServerInput) chatServerInput.value = data.chatServerUrl;
    if (data.presenceServerUrl !== undefined && presenceServerInput) presenceServerInput.value = data.presenceServerUrl;
    if (data.updateServerUrl !== undefined && updateServerInput) updateServerInput.value = data.updateServerUrl;
    if (data.theme) applyTheme(data.theme);
    // Theater mode should not persist between sessions.
  } catch (e) {}
}

function filterScreenSources(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.filter(s => {
    const id = (s?.id || '').toLowerCase();
    const name = (s?.name || '').toLowerCase();
    return id.startsWith('screen:') || name.startsWith('screen');
  });
}

function getScreenSimulcastLayers(height) {
  const presets = LiveKit?.VideoPresets;
  if (!presets || !height) return [];
  if (height >= 1080) return [presets.h540, presets.h216].filter(Boolean);
  if (height >= 720) return [presets.h360, presets.h180].filter(Boolean);
  if (height >= 540) return [presets.h180].filter(Boolean);
  return [];
}

async function refreshSources() {
  if (!sourceSelect || !window.electronAPI?.getSources) return;
  try {
    const sources = filterScreenSources(await window.electronAPI.getSources());
    const prev = sourceSelect.value || desiredSourceId;
    sourceSelect.innerHTML = "";
    sources.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      sourceSelect.appendChild(opt);
    });
    if (prev) {
      const match = Array.from(sourceSelect.options).find(o => o.value === prev);
      if (match) sourceSelect.value = prev;
    }
    saveSettings();
  } catch (e) {
    console.warn("refreshSources error", e);
  }
}

async function refreshPlaybackDevices() {
  if (!playbackDeviceSelect || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    if (!('setSinkId' in HTMLMediaElement.prototype)) {
      playbackDeviceSelect.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = 'default';
      opt.textContent = 'Output selection unavailable';
      playbackDeviceSelect.appendChild(opt);
      playbackDeviceSelect.disabled = true;
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    const prev = desiredPlaybackDeviceId || playbackDeviceSelect.value || 'default';
    playbackDeviceSelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'default';
    defaultOpt.textContent = 'Default';
    playbackDeviceSelect.appendChild(defaultOpt);

    outputs.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId || '';
      opt.textContent = d.label || `Audio output ${idx + 1}`;
      playbackDeviceSelect.appendChild(opt);
    });

    let selected = prev || 'default';
    if (selected !== 'default' && !outputs.some(d => d.deviceId === selected)) {
      selected = 'default';
    }
    playbackDeviceSelect.value = selected;
    desiredPlaybackDeviceId = selected;
    playbackDeviceSelect.disabled = outputs.length === 0;
    saveSettings();
  } catch (e) {
    console.warn('refreshPlaybackDevices error', e);
  }
}

async function refreshInputDevices() {
  if (!inputDeviceSelect || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === 'audioinput');
    const prev = desiredInputDeviceId || inputDeviceSelect.value || 'default';
    inputDeviceSelect.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = 'default';
    defaultOpt.textContent = 'Default';
    inputDeviceSelect.appendChild(defaultOpt);

    inputs.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId || '';
      opt.textContent = d.label || `Microphone ${idx + 1}`;
      inputDeviceSelect.appendChild(opt);
    });

    let selected = prev || 'default';
    if (selected !== 'default' && !inputs.some(d => d.deviceId === selected)) {
      selected = 'default';
    }
    inputDeviceSelect.value = selected;
    desiredInputDeviceId = selected;
    inputDeviceSelect.disabled = inputs.length === 0;
    saveSettings();
  } catch (e) {
    console.warn('refreshInputDevices error', e);
  }
}

function applyPlaybackDeviceToElement(el) {
  if (!el || typeof el.setSinkId !== 'function') return;
  const id = playbackDeviceSelect?.value || desiredPlaybackDeviceId || 'default';
  if (el.sinkId === id) return;
  el.setSinkId(id).catch(err => {
    const name = err?.name || '';
    if (name === 'AbortError') {
      setTimeout(() => {
        if (el.sinkId !== id) {
          el.setSinkId(id).catch(e => console.warn('setSinkId failed', e));
        }
      }, 150);
      return;
    }
    console.warn('setSinkId failed', err);
  });
}

function applyPlaybackDeviceToAll() {
  if (!streamsDiv) return;
  const mediaEls = streamsDiv.querySelectorAll('audio, video');
  mediaEls.forEach(el => applyPlaybackDeviceToElement(el));
}

function appendChatMessage(name, message, isLocal = false) {
  if (!chatLog) return;
  const row = document.createElement('div');
  row.className = 'chat-item';
  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'chat-name';
  nameSpan.textContent = `${name}${isLocal ? ' (you)' : ''}`;
  nameSpan.style.color = getNameColor(name);
  const timeSpan = document.createElement('span');
  timeSpan.className = 'chat-time';
  const now = new Date();
  timeSpan.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.appendChild(nameSpan);
  meta.appendChild(timeSpan);
  const text = document.createElement('div');
  text.className = 'chat-text';
  text.textContent = message;
  row.appendChild(meta);
  row.appendChild(text);
  chatLog.appendChild(row);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function sendChatMessage() {
  const message = chatInput?.value?.trim();
  if (!message) return;
  const name = getChatIdentity();
  try {
    const ts = Date.now();
    if (chatSocketReady && chatSocket && chatRoomName) {
      lastLocalChat = { name, message, ts };
      chatSocket.send(JSON.stringify({ type: 'message', room: chatRoomName, name, message, ts }));
      appendChatMessage(name, message, true);
      chatInput.value = '';
      return;
    }
    if (room && room.localParticipant) {
      const payload = JSON.stringify({ message, name, ts });
      const bytes = new TextEncoder().encode(payload);
      room.localParticipant.publishData(bytes, { reliable: true });
      appendChatMessage(name, message, true);
      chatInput.value = '';
    }
  } catch (e) {
    console.warn('sendChatMessage error', e);
  }
}

function getNameColor(name) {
  const str = name || '';
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

function playUiTone(freq, durationMs = 140) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    osc.frequency.value = freq;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, durationMs);
  } catch (e) {}
}

function updateConnectionQualityIndicator(participantId, quality) {
  try {
    if (!participantId || !participantsList) return;
    const entry = participantsList.querySelector(`#participant-${participantId} .quality-dot`);
    if (!entry) return;
    entry.classList.remove('quality-excellent', 'quality-good', 'quality-poor');
    if (quality === 'excellent') entry.classList.add('quality-excellent');
    else if (quality === 'good') entry.classList.add('quality-good');
    else if (quality === 'poor') entry.classList.add('quality-poor');
  } catch (e) {}
}

function applyTheme(mode) {
  const isDark = mode === 'dark';
  document.body.classList.toggle('theme-dark', isDark);
  if (themeToggle) themeToggle.checked = isDark;
}

function setStreamButtonState(active) {
  isStreaming = active;
  if (startBtn) startBtn.textContent = active ? "Stop Stream" : "Start Stream";
}

function setJoinButtonState(connected) {
  if (!joinBtn) return;
  joinBtn.textContent = "Join";
  joinBtn.style.display = connected ? "none" : "";
  const connectionTitle = document.getElementById("connectionTitle");
  if (connectionTitle) connectionTitle.textContent = connected ? "" : "Connection";
  if (roomAccessSection) roomAccessSection.classList.toggle('connected', connected);
  if (leaveBtnIcon) {
    leaveBtnIcon.style.display = connected ? 'inline-flex' : 'none';
  }
  if (roomAccessSection) {
    const actionRow = roomAccessSection.querySelector('.button-row');
    if (actionRow) actionRow.style.display = connected ? 'none' : '';
  }
}

function updateMicProcessingButtons() {
  if (echoCancelBtn) echoCancelBtn.textContent = `Echo Cancellation: ${micProcessing.echoCancellation ? "On" : "Off"}`;
  if (noiseSuppressBtn) noiseSuppressBtn.textContent = `Noise Suppression: ${micProcessing.noiseSuppression ? "On" : "Off"}`;
  if (noiseGateBtn) noiseGateBtn.textContent = `Noise Gate: ${micProcessing.noiseGateEnabled ? "On" : "Off"}`;
  if (enhancedVoiceBtn) enhancedVoiceBtn.textContent = `Enhanced Voice: ${micProcessing.enhancedVoiceEnabled ? "On" : "Off"}`;
  if (autoGainBtn) autoGainBtn.textContent = `Auto Gain: ${micProcessing.autoGainControl ? "On" : "Off"}`;
  if (noiseGateSlider) noiseGateSlider.disabled = !micProcessing.noiseGateEnabled;
  if (noiseGateSlider) noiseGateSlider.value = String(micProcessing.noiseGateLevel);
  if (noiseGateValue) noiseGateValue.textContent = String(micProcessing.noiseGateLevel);
  if (enhancedVoiceSlider) enhancedVoiceSlider.disabled = !micProcessing.enhancedVoiceEnabled;
  if (enhancedVoiceSlider) enhancedVoiceSlider.value = String(micProcessing.enhancedVoiceLevel);
  if (enhancedVoiceValue) enhancedVoiceValue.textContent = String(micProcessing.enhancedVoiceLevel);
  // if (manualGainRow) {
  //   manualGainRow.style.display = micProcessing.autoGainControl ? 'none' : 'flex';
  // }
  // if (manualGainSlider) {
  //   manualGainSlider.disabled = micProcessing.autoGainControl;
  // }
}

function getNoiseGateThreshold() {
  const level = Math.max(0, Math.min(100, Number(micProcessing.noiseGateLevel) || 0));
  const base = 0.002 + (level / 100) * 0.02;
  if (!micProcessing.enhancedVoiceEnabled) return base;
  const strength = Math.max(0, Math.min(100, Number(micProcessing.enhancedVoiceLevel) || 0));
  const multiplier = 1 + (strength / 200);
  return base * multiplier;
}

function getEnhancedVoiceFloor() {
  const strength = Math.max(0, Math.min(100, Number(micProcessing.enhancedVoiceLevel) || 0));
  return 0.6 - (strength / 100) * 0.4;
}

function stopMicGate() {
  if (!micGateState) return;
  if (micGateState.timer) {
    clearInterval(micGateState.timer);
  }
  try { micGateState.source?.disconnect(); } catch (e) {}
  try { micGateState.analyser?.disconnect(); } catch (e) {}
  try { micGateState.gain?.disconnect(); } catch (e) {}
  try { micGateState.highpass?.disconnect(); } catch (e) {}
  try { micGateState.compressor?.disconnect(); } catch (e) {}
  micGateState = null;
}

function createProcessedMicTrack(stream) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const source = ctx.createMediaStreamSource(stream);
    let chainInput = source;
    let highpass = null;
    let compressor = null;
    if (micProcessing.enhancedVoiceEnabled) {
      highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 100;
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      chainInput.connect(highpass);
      highpass.connect(compressor);
      chainInput = compressor;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const gain = ctx.createGain();
    gain.channelCount = 1;
    gain.channelCountMode = 'explicit';
    gain.channelInterpretation = 'speakers';
    gain.gain.value = 1;
    const dest = ctx.createMediaStreamDestination();

    chainInput.connect(analyser);
    analyser.connect(gain);
    gain.connect(dest);

    const data = new Uint8Array(analyser.fftSize);
    let gateOpen = true;
    let lastAbove = performance.now();
    const releaseMs = 600;
    const expanderFloor = getEnhancedVoiceFloor();
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const threshold = getNoiseGateThreshold();
      const now = performance.now();
      if (rms >= threshold) {
        lastAbove = now;
        if (!gateOpen) {
          gateOpen = true;
          gain.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
        } else if (micProcessing.enhancedVoiceEnabled && !micProcessing.noiseGateEnabled) {
          gain.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
        }
      } else if (gateOpen && (now - lastAbove) > releaseMs) {
        if (micProcessing.noiseGateEnabled) {
          gateOpen = false;
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        } else if (micProcessing.enhancedVoiceEnabled) {
          gain.gain.setTargetAtTime(expanderFloor, ctx.currentTime, 0.03);
        }
      }
    }, 50);

    micGateState = { source, analyser, gain, timer, highpass, compressor };
    const track = dest.stream.getAudioTracks()[0];
    return track || null;
  } catch (e) {
    console.warn('createProcessedMicTrack error', e);
  }
  return null;
}

function createMonoMicTrack(stream) {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const source = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.channelCount = 1;
    gain.channelCountMode = 'explicit';
    gain.channelInterpretation = 'speakers';
    gain.gain.value = 1;
    const dest = ctx.createMediaStreamDestination();
    source.connect(gain);
    gain.connect(dest);
    micGateState = { source, analyser: null, gain, timer: null, highpass: null, compressor: null };
    const track = dest.stream.getAudioTracks()[0];
    return track || null;
  } catch (e) {
    console.warn('createMonoMicTrack error', e);
  }
  return null;
}

function buildMicConstraints() {
  const deviceId = inputDeviceSelect?.value || desiredInputDeviceId;
  const deviceConstraint = deviceId && deviceId !== 'default' ? { exact: deviceId } : undefined;
  return {
    audio: {
      ...(deviceConstraint ? { deviceId: deviceConstraint } : {}),
      channelCount: { ideal: 1 },
      echoCancellation: micProcessing.echoCancellation,
      noiseSuppression: micProcessing.noiseSuppression,
      autoGainControl: micProcessing.autoGainControl
    }
  };
}

// async function applyManualGainIfNeeded() {
//   try {
//     if (!micStream || micProcessing.autoGainControl) return;
//     const ctx = getAudioContext();
//     if (!micGainNode) {
//       micGainNode = ctx.createGain();
//     }
//     micGainNode.gain.value = manualMicGain;
//     if (!micGainNode._source || !micGainNode._dest) {
//       const source = ctx.createMediaStreamSource(micStream);
//       source.connect(micGainNode);
//       const dest = ctx.createMediaStreamDestination();
//       micGainNode.connect(dest);
//       micGainNode._source = source;
//       micGainNode._dest = dest;
//     }
//     const track = micGainNode._dest.stream.getAudioTracks()[0];
//     if (!track) return;
//     if (micPublishMode !== 'gain') {
//       if (micAudioTrack) {
//         await room.localParticipant.unpublishTrack(micAudioTrack);
//         detachTrack(micAudioTrack);
//         micAudioTrack.stop();
//       }
//       micAudioTrack = new LiveKit.LocalAudioTrack(track);
//       await room.localParticipant.publishTrack(micAudioTrack);
//       micPublishMode = 'gain';
//     }
//   } catch (e) {
//     console.warn('applyManualGainIfNeeded error', e);
//   }
// }

async function restartMicTrack() {
  if (!room) return;
  try {
    const wasMuted = micAudioTrack ? !micAudioTrack.mediaStreamTrack.enabled : false;
    if (micAudioTrack) {
      await room.localParticipant.unpublishTrack(micAudioTrack);
      detachTrack(micAudioTrack);
      micAudioTrack.stop();
      micAudioTrack = null;
    }
    stopMicGate();
    micStream?.getTracks().forEach(t => t.stop());
    micStream = null;
    micStream = await navigator.mediaDevices.getUserMedia(buildMicConstraints());
    const baseTrack = micStream.getAudioTracks()[0];
    const processedTrack = (micProcessing.noiseGateEnabled || micProcessing.enhancedVoiceEnabled)
      ? createProcessedMicTrack(micStream)
      : null;
    let monoFallbackTrack = null;
    if (!processedTrack && baseTrack) {
      const channelCount = baseTrack.getSettings?.().channelCount || 0;
      if (channelCount > 1) {
        monoFallbackTrack = createMonoMicTrack(micStream);
      }
    }
    micAudioTrack = new LiveKit.LocalAudioTrack(processedTrack || monoFallbackTrack || baseTrack, { name: 'microphone' });
    const micPublishOpts = {};
    try {
      if (LiveKit?.Track?.Source?.Microphone != null) {
        micPublishOpts.source = LiveKit.Track.Source.Microphone;
      }
    } catch (e) {}
    await room.localParticipant.publishTrack(micAudioTrack, micPublishOpts);
    if (micAudioTrack) {
      if (wasMuted) micAudioTrack.mediaStreamTrack.enabled = false;
      attachTrack(micAudioTrack, true);
      const localId = room?.localParticipant?.identity || room?.localParticipant?.sid;
      if (localId) connectParticipantMeter(localId, micAudioTrack);
    }
  } catch (e) {
    console.warn("restartMicTrack error", e);
  }
}

const muteMicBtn = document.getElementById("muteMicBtn");
const muteSystemBtn = document.getElementById("muteSystemBtn");
const muteIncomingBtn = document.getElementById("muteIncomingBtn");
const echoCancelBtn = document.getElementById("echoCancelBtn");
const noiseSuppressBtn = document.getElementById("noiseSuppressBtn");
const autoGainBtn = document.getElementById("autoGainBtn");
// const manualGainRow = document.getElementById("manualGainRow");
// const manualGainSlider = document.getElementById("manualGainSlider");

startBtn.disabled = true;
muteMicBtn.disabled = false;
muteSystemBtn.disabled = true;
muteSystemBtn.style.display = 'none';
if (muteIncomingBtn) muteIncomingBtn.disabled = false;
if (echoCancelBtn) echoCancelBtn.disabled = false;
if (noiseSuppressBtn) noiseSuppressBtn.disabled = false;
if (noiseGateBtn) noiseGateBtn.disabled = false;
if (enhancedVoiceBtn) enhancedVoiceBtn.disabled = false;
if (autoGainBtn) autoGainBtn.disabled = false;
muteMicBtn.classList.remove('is-muted');
muteSystemBtn.classList.remove('is-muted');
if (muteIncomingBtn) muteIncomingBtn.classList.remove('is-muted');
if (leaveBtnIcon) leaveBtnIcon.style.display = 'none';

