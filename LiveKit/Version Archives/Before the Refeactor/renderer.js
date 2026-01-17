const LiveKit = window.LivekitClient;

const LIVEKIT_URL = "";
const DEBUG = false;
const debug = (...args) => { if (DEBUG) console.log(...args); };
const logInfo = (...args) => { if (DEBUG) logInfo(...args); };
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
  } catch (e) {}
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
  } catch (e) {}
  return null;
}

function getChatServerUrl() {
  const raw = serverUrlInput?.value?.trim() || LIVEKIT_URL || '';
  try {
    const parsed = new URL(raw);
    const protocol = (parsed.protocol === 'https:' || parsed.protocol === 'wss:') ? 'wss:' : 'ws:';
    return `${protocol}//${parsed.hostname}:${CHAT_PORT}`;
  } catch (e) {}
  return `ws://127.0.0.1:${CHAT_PORT}`;
}

function getPresenceUrl() {
  const raw = serverUrlInput?.value?.trim() || LIVEKIT_URL || '';
  try {
    const parsed = new URL(raw);
    const protocol = (parsed.protocol === 'https:' || parsed.protocol === 'wss:') ? 'https:' : 'http:';
    return `${protocol}//${parsed.hostname}:${PRESENCE_PORT}`;
  } catch (e) {}
  return `http://127.0.0.1:${PRESENCE_PORT}`;
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
    const url = `${getPresenceUrl()}/room-status?room=${encodeURIComponent(roomName)}`;
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
      const isStream = isScreenShareAudioStrict(pub?.track || {}, pub?.source);
      if (isStream) return true;
      const name = (pub?.trackName || pub?.name || pub?.track?.name || '').toLowerCase();
      if (name.includes('systemaudio')) return true;
      return false;
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
      if (isScreenShareAudioStrict(pub?.track || {}, pub?.source)) return false;
      const name = (pub?.trackName || pub?.name || pub?.track?.name || '').toLowerCase();
      if (name.includes('systemaudio')) return false;
      return true;
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
      const isStream = isScreenShareAudioStrict(pub?.track || {}, pub?.source);
      if (!isStream) return;
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
      label.textContent = parts.join(' · ');
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
      nameLabel.textContent = info ? `${displayName} · ${info}` : displayName;
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
    const isScreenAudio = isScreenShareAudioStrict(info.track, info.source);
    if (isScreenAudio) streamInfo = info;
    else micInfo = info;
  } else if (tracks.length >= 2) {
    streamInfo = tracks.find(t => isScreenShareAudioStrict(t.track, t.source)) || null;
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
      const explicitStream = tracks.find(t => isScreenShareAudioStrict(t.track, t.source)) || null;
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

function logActivity(message) {
  return;
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
  joinBtn.textContent = connected ? "Leave" : "Join";
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

/* ---------- Restore JWT ---------- */
jwtInput.value = localStorage.getItem("livekit_jwt") || "";
setErrorBanner('');
if (!localStorage.getItem(settingsKey)) {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}
  loadSettings();
  updateHotkeyDisplay();
  applyGlobalMuteHotkey();
  loadParticipantAudioSettings();
applyLeftWidth(desiredLeftWidth);
applyChatWidth(desiredChatWidth);
applyChatCollapsed(chatCollapsed);
updateHotkeyDisplay();
updateResponsiveChat();
if (serverUrlInput && !serverUrlInput.value) serverUrlInput.value = LIVEKIT_URL;
if (jwtInput) jwtInput.focus();
applyRecommendedBitrate();
refreshSources();
refreshPlaybackDevices();
refreshInputDevices();
updateMicProcessingButtons();
// if (manualGainSlider) {
//   manualGainSlider.value = String(Math.round(manualMicGain * 100));
// }
if (chatInput) chatInput.disabled = true;
if (chatSendBtn) chatSendBtn.disabled = true;
setMicMuteState(micMuted);
setMuteIncomingState(muteIncomingAll);
startRoomPreviewTimer();
if (muteSystemBtn) muteSystemBtn.style.display = 'none';
loadCollapseState();
if (streamSetupSection) streamSetupSection.classList.add('hidden');
updateParticipantsViewMode(false);
connectChatSocket();
if (chatResizeHandle && layoutEl) {
  let resizing = false;
  let activePointerId = null;
  chatResizeHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    resizing = true;
    activePointerId = event.pointerId;
    chatResizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
  });
  window.addEventListener('pointermove', (event) => {
    if (!resizing) return;
    const rect = layoutEl.getBoundingClientRect();
    const nextWidth = rect.right - event.clientX;
    applyChatWidth(nextWidth);
  });
  window.addEventListener('pointerup', (event) => {
    if (!resizing || activePointerId !== event.pointerId) return;
    resizing = false;
    activePointerId = null;
    chatResizeHandle.releasePointerCapture(event.pointerId);
    document.body.classList.remove('resizing');
    saveSettings();
  });
}
if (leftResizeHandle && layoutEl) {
  let resizing = false;
  let activePointerId = null;
  leftResizeHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    resizing = true;
    activePointerId = event.pointerId;
    leftResizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
  });
  window.addEventListener('pointermove', (event) => {
    if (!resizing) return;
    const rect = layoutEl.getBoundingClientRect();
    const nextWidth = event.clientX - rect.left;
    applyLeftWidth(nextWidth);
  });
  window.addEventListener('pointerup', (event) => {
    if (!resizing || activePointerId !== event.pointerId) return;
    resizing = false;
    activePointerId = null;
    leftResizeHandle.releasePointerCapture(event.pointerId);
    document.body.classList.remove('resizing');
    saveSettings();
  });
}
window.addEventListener('resize', updateResponsiveChat);
resolutionSelect?.addEventListener("change", () => { applyRecommendedBitrate(); saveSettings(); });
fpsSelect?.addEventListener("change", () => {
  applyRecommendedBitrate();
  saveSettings();
});
bitrateInput?.addEventListener("input", saveSettings);
sourceSelect?.addEventListener("change", saveSettings);
sourceSelect?.addEventListener("mousedown", refreshSources);
sourceSelect?.addEventListener("focus", refreshSources);
playbackDeviceSelect?.addEventListener("change", () => {
  desiredPlaybackDeviceId = playbackDeviceSelect.value || 'default';
  saveSettings();
  applyPlaybackDeviceToAll();
});
inputDeviceSelect?.addEventListener("change", async () => {
  desiredInputDeviceId = inputDeviceSelect.value || 'default';
  saveSettings();
  if (room && room.state && room.state !== 'disconnected') {
    await restartMicTrack();
  }
});
playbackDeviceSelect?.addEventListener("mousedown", refreshPlaybackDevices);
playbackDeviceSelect?.addEventListener("focus", refreshPlaybackDevices);
inputDeviceSelect?.addEventListener("mousedown", refreshInputDevices);
inputDeviceSelect?.addEventListener("focus", refreshInputDevices);
themeToggle?.addEventListener("change", () => {
  applyTheme(themeToggle.checked ? 'dark' : 'light');
  saveSettings();
});
theaterToggle?.addEventListener("click", () => {
  const enabled = document.body.classList.toggle('theater-mode');
  if (theaterToggle) theaterToggle.textContent = enabled ? 'Exit theater' : 'Theater mode';
  if (enabled && minimizedPanel) {
    minimizedPanel.style.display = 'none';
  } else {
    updateMinimizedPanelVisibility();
  }
  saveSettings();
});
serverUrlInput?.addEventListener("input", () => { saveSettings(); scheduleChatConnect(); });
jwtInput?.addEventListener("input", scheduleChatConnect);
jwtInput?.addEventListener("blur", () => { refreshRoomPreview(); scheduleChatConnect(); });
chatSendBtn?.addEventListener("click", sendChatMessage);
chatInput?.addEventListener("keydown", (event) => {
  if (event.key === 'Enter') sendChatMessage();
});
chatCollapseBtn?.addEventListener("click", () => {
  if (!chatDock) return;
  chatDock.classList.toggle('collapsed');
  applyChatCollapsed(chatDock.classList.contains('collapsed'));
  if (window.innerWidth < 981) {
    autoCollapsedForWidth = false;
  }
  saveSettings();
});
muteHotkeyBtn?.addEventListener('click', () => {
  capturingHotkey = true;
  if (muteHotkeyBtn) muteHotkeyBtn.textContent = 'Press keys...';
  updateHotkeyDisplay();
});
window.addEventListener('keydown', (event) => {
  if (capturingHotkey) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      muteHotkey = '';
    } else {
      const next = formatHotkey(event);
      if (next) muteHotkey = next;
    }
    capturingHotkey = false;
    if (muteHotkeyBtn) muteHotkeyBtn.textContent = 'Set';
    updateHotkeyDisplay();
    saveSettings();
    applyGlobalMuteHotkey();
    return;
  }
  if (!muteHotkey) return;
  if (isTypingTarget(event.target)) return;
  const current = formatHotkey(event);
  if (current && current === muteHotkey) {
    event.preventDefault();
    setMicMuteState(!micMuted);
    saveSettings();
  }
});

window.electronAPI?.onGlobalMuteToggle?.(() => {
  if (!muteHotkey) return;
  setMicMuteState(!micMuted);
  saveSettings();
});
leaveBtnIcon?.addEventListener("click", () => {
  if (joinBtn) joinBtn.click();
});
function saveCollapseState() {
  try {
    const data = {};
    collapsibleSections.forEach(section => {
      if (!section.id) return;
      data[section.id] = section.classList.contains("collapsed") ? "true" : "false";
    });
    localStorage.setItem(collapseStateKey, JSON.stringify(data));
  } catch (e) {}
}

function loadCollapseState() {
  try {
    const raw = localStorage.getItem(collapseStateKey);
    if (!raw) return;
    const data = JSON.parse(raw);
    collapsibleSections.forEach(section => {
      if (!section.id || data[section.id] == null) return;
      section.classList.toggle("collapsed", data[section.id] === "true");
    });
  } catch (e) {}
}

collapsibleSections.forEach(section => {
  const toggle = section.querySelector(".collapse-toggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    section.classList.toggle("collapsed");
    saveCollapseState();
  });
});
audioSettingsBtn?.addEventListener("click", () => {
  if (!audioSettingsOverlay) return;
  audioSettingsOverlay.classList.add('open');
  audioSettingsOverlay.setAttribute('aria-hidden', 'false');
  if (audioSettingsClose) audioSettingsClose.focus();
});
audioSettingsClose?.addEventListener("click", () => {
  if (!audioSettingsOverlay) return;
  if (audioSettingsClose) audioSettingsClose.blur();
  audioSettingsOverlay.classList.remove('open');
  audioSettingsOverlay.setAttribute('aria-hidden', 'true');
  if (audioSettingsBtn) audioSettingsBtn.focus();
});
audioSettingsOverlay?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.id !== 'audioSettingsOverlay') return;
  if (audioSettingsClose) audioSettingsClose.blur();
  audioSettingsOverlay.classList.remove('open');
  audioSettingsOverlay.setAttribute('aria-hidden', 'true');
  if (audioSettingsBtn) audioSettingsBtn.focus();
});

/* ---------- JOIN ROOM ---------- */
joinBtn.onclick = async () => {
  if (joinBtn) joinBtn.disabled = true;
  if (room && room.state && room.state !== 'disconnected') {
    await leaveRoom();
    return;
  }
  const token = jwtInput.value.trim();
  if (!token) return alert("Enter JWT");

  manualDisconnect = false;
  lastJoinToken = token;
  saveSettings();
  localStorage.setItem("livekit_jwt", token);
  if (autoRejoinTimer) { clearTimeout(autoRejoinTimer); autoRejoinTimer = null; }
  if (room) {
    try { await room.disconnect(); } catch (e) {}
  }
  if (room) {
    try { room.removeAllListeners(); } catch (e) {}
  }

  room = new LiveKit.Room({
    adaptiveStream: true,
    dynacast: true,
    autoSubscribe: false,
  });

  room.on(LiveKit.RoomEvent.Reconnecting, () => {
    setReconnectBanner(true);
  });
  room.on(LiveKit.RoomEvent.Reconnected, () => {
    setReconnectBanner(false);
    startPingMonitor();
    startAudioLevelMonitor();
  });
  room.on(LiveKit.RoomEvent.Disconnected, () => {
    setReconnectBanner(false);
    setJoinButtonState(false);
    stopPingMonitor();
    stopAudioLevelMonitor();
    if (!manualDisconnect) scheduleAutoRejoin();
  });

  try {
    debug('Connecting to LiveKit...');
    const url = (serverUrlInput && serverUrlInput.value.trim()) ? serverUrlInput.value.trim() : LIVEKIT_URL;
    await room.connect(url, token);
    debug('Connected to LiveKit:', room?.localParticipant?.identity);
  } catch (e) {
    console.warn('LiveKit connect error', e);
    setConnectionStatus('Connection failed');
    setErrorBanner('Connection failed. Check server URL and token.');
    manualDisconnect = true;
    lastJoinToken = '';
    if (autoRejoinTimer) { clearTimeout(autoRejoinTimer); autoRejoinTimer = null; }
    setJoinButtonState(false);
    if (joinBtn) joinBtn.disabled = false;
    return;
  }
  try { renderConnectionStatus(); } catch (e) {}
  setJoinButtonState(true);
  if (joinBtn) joinBtn.disabled = false;
  setErrorBanner('');
  logActivity('You joined the room');
  playUiTone(520, 140);
  startPingMonitor();
  startAudioLevelMonitor();
  
  refreshRoomPreview();
  if (roomAccessSection) roomAccessSection.classList.add('collapsed');
  connectChatSocket();
  addParticipant(room.localParticipant);

  // Publish microphone (with processing controls)
  await restartMicTrack();
  setMicMuteState(micMuted);
  if (micMuted) startMuteBroadcast();
  try {
    if (room?.localParticipant?.publishData) {
      const payload = JSON.stringify({ type: 'mic_mute', muted: !!micMuted });
      room.localParticipant.publishData(new TextEncoder().encode(payload), { reliable: true });
    }
  } catch (e) {}
  await refreshPlaybackDevices();
  applyPlaybackDeviceToAll();
  await refreshInputDevices();

  // Enable mic mute after track is ready
  muteMicBtn.disabled = false;
  if (echoCancelBtn) echoCancelBtn.disabled = false;
  if (noiseSuppressBtn) noiseSuppressBtn.disabled = false;
  if (noiseGateBtn) noiseGateBtn.disabled = false;
  if (enhancedVoiceBtn) enhancedVoiceBtn.disabled = false;
  if (autoGainBtn) autoGainBtn.disabled = false;

  // Listen for remote tracks
  room.on(LiveKit.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    try {
      // With autoSubscribe disabled, only subscribed tracks arrive here.
    if (track && participant) {
      const id = participant.identity || participant.sid;
      if (id) {
        trackToParticipant.set(track.sid, id);
        attachParticipantToTile(track.sid, id);
      }
        if (publication?.source) {
          if (track?.sid) trackSourceBySid.set(track.sid, publication.source);
          if (publication?.trackSid) trackSourceBySid.set(publication.trackSid, publication.source);
        }
      if (track?.kind === 'audio') {
          // Prevent any brief playback before classification.
          try { track.mediaStreamTrack.enabled = false; } catch (e) {}
          try {
            const label = track?.mediaStreamTrack?.label || '';
            const rawSource = publication?.source;
            logInfo('[audio] subscribed', {
              participant: id,
              trackSid: track?.sid,
              source: rawSource,
              name: track?.name || '',
              label
            });
          } catch (e) {}
          if (id && !isScreenShareAudio(track, publication?.source)) {
            setParticipantMutedVisual(id, getPublicationMuted(publication));
          }
        }
        if (track?.kind === 'video') {
          try {
            logInfo('[video] subscribed', {
              participant: id,
              trackSid: track?.sid || publication?.trackSid,
              source: publication?.source
            });
          } catch (e) {}
        }
        if (track?.sid && publication?.source) {
          const list = participantAudioTracks.get(id);
          const entry = list ? list.get(track.sid) : null;
          if (entry) {
            entry.source = publication.source;
          }
        }
      }
    } catch (e) {}
    attachTrack(track);
    try { wireParticipantMuteListeners(participant); } catch (e) {}
  });
  room.on(LiveKit.RoomEvent.TrackUnsubscribed, track => {
    try {
      if (track?.sid) trackSourceBySid.delete(track.sid);
      if (track?.kind === 'video') {
        logInfo('[video] unsubscribed', { trackSid: track?.sid });
      }
    } catch (e) {}
    detachTrack(track);
  });
  room.on(LiveKit.RoomEvent.TrackMuted, (publication, participant) => {
    try {
      if (!participant || !publication) return;
      if ((publication.kind || publication.track?.kind) !== 'audio') return;
      if (isScreenShareAudioStrict(publication?.track || {}, publication?.source)) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      setParticipantMutedVisual(id, true);
    } catch (e) {}
  });
  room.on(LiveKit.RoomEvent.TrackUnmuted, (publication, participant) => {
    try {
      if (!participant || !publication) return;
      if ((publication.kind || publication.track?.kind) !== 'audio') return;
      if (isScreenShareAudioStrict(publication?.track || {}, publication?.source)) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      setParticipantMutedVisual(id, false);
    } catch (e) {}
  });
  room.on(LiveKit.RoomEvent.TrackPublished, (publication, participant) => {
    try {
      if (!participant) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      wireParticipantMuteListeners(participant);
      if (publication?.source && publication?.trackSid) {
        trackSourceBySid.set(publication.trackSid, publication.source);
      }
      if (publication?.source && publication?.track?.sid) {
        trackSourceBySid.set(publication.track.sid, publication.source);
      }
      participantsById.set(id, participant);
      updateParticipantWatchControls(id);
      const kind = publication?.kind || publication?.track?.kind;
      if (kind === 'audio') {
        const isStreamAudio = isScreenShareAudioStrict(publication?.track || {}, publication?.source);
        if (typeof publication.setSubscribed === 'function') {
          publication.setSubscribed(isStreamAudio ? watchedVideoParticipants.has(id) : true);
        }
        if (!isStreamAudio) {
          setParticipantMutedVisual(id, getPublicationMuted(publication));
        }
        if (isStreamAudio && !watchedVideoParticipants.has(id) && publication?.track) {
          detachTrack(publication.track);
        }
        if (publication?.track?.sid && publication?.source) {
          const list = participantAudioTracks.get(id);
          const entry = list ? list.get(publication.track.sid) : null;
          if (entry) {
            entry.source = publication.source;
          }
        }
      }
      if (kind === 'video') {
        if (!participantVideoPubs.has(id)) participantVideoPubs.set(id, []);
        const list = participantVideoPubs.get(id);
        if (list && !list.includes(publication)) list.push(publication);
        ensureVideoPlaceholder(id, publication.trackSid || publication?.track?.sid);
        if (typeof publication.setSubscribed === 'function') {
          publication.setSubscribed(watchedVideoParticipants.has(id));
        }
        if (watchedVideoParticipants.has(id) && publication?.track) {
          attachTrack(publication.track);
        }
        if (publication?.trackInfo?.layers?.length) {
          logInfo('[simulcast] remote video layers', {
            participant: id,
            layers: publication.trackInfo.layers
          });
        }
        logInfo('[video] published', {
          participant: id,
          trackSid: publication?.trackSid,
          source: publication?.source
        });
      }
    } catch (e) {}
  });
  room.on(LiveKit.RoomEvent.TrackUnpublished, (publication, participant) => {
    try {
      if (!participant) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      if (publication?.trackSid) trackSourceBySid.delete(publication.trackSid);
      if (publication?.track?.sid) trackSourceBySid.delete(publication.track.sid);
      if (publication?.kind === 'video' || publication?.track?.kind === 'video') {
        const list = participantVideoPubs.get(id);
        if (list) {
          const idx = list.indexOf(publication);
          if (idx >= 0) list.splice(idx, 1);
        }
        const remaining = (participantVideoPubs.get(id) || []).length;
        const trackSid = publication?.trackSid || publication?.track?.sid || null;
        cleanupStreamTiles(id, trackSid, remaining === 0);
        logInfo('[video] unpublished', {
          participant: id,
          trackSid: publication?.trackSid || publication?.track?.sid
        });
      }
      updateParticipantWatchControls(id);
    } catch (e) {}
  });
  room.on(LiveKit.RoomEvent.ParticipantAttributesChanged, (changed, participant) => {
    try {
      updateParticipantStreamInfo(participant);
      updateParticipantMutedFromPublications(participant);
    } catch (e) {}
  });
  room.on(LiveKit.RoomEvent.DataReceived, (payload, participant) => {
    try {
      const text = new TextDecoder().decode(payload);
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}
      if (data && data.type === 'mic_mute_request') {
        try {
          if (room?.state === 'connected' && room?.localParticipant?.publishData) {
            const payload = JSON.stringify({ type: 'mic_mute', muted: !!micMuted });
            room.localParticipant.publishData(new TextEncoder().encode(payload), { reliable: true });
          }
        } catch (e) {}
        return;
      }
      if (data && data.type === 'mic_mute') {
        const id = participant?.identity || participant?.sid;
        if (id) setParticipantMutedVisual(id, !!data.muted);
        return;
      }
      if (chatSocketReady) return;
      if (data) {
        const name = data.name || participant?.identity || 'Unknown';
        const message = data.message || text;
        if (message) appendChatMessage(name, message, false);
        return;
      }
      if (text) appendChatMessage(participant?.identity || 'Unknown', text, false);
    } catch (e) {}
  });

  room.on(LiveKit.RoomEvent.LocalTrackPublished, publication => {
    try {
      if (!publication) return;
      if (publication.track && screenVideoTrack && publication.track === screenVideoTrack) {
        configureScreenSender(publication.sender);
        const info = publication.trackInfo;
        if (info?.layers?.length) {
          logInfo('[simulcast] local screen layers', info.layers);
        } else {
          logInfo('[simulcast] local screen layers not available');
        }
      }
    } catch (e) {}
  });

  // Participant join/leave
  room.on(LiveKit.RoomEvent.ParticipantConnected, p => {
    try { wireParticipantMuteListeners(p); } catch (e) {}
    addParticipant(p);
    logActivity(`${p.identity || p.sid || 'Participant'} joined`);
    playUiTone(660, 120);
    try { renderConnectionStatus(); } catch(e){}
    refreshRoomPreview();
  });
  room.on(LiveKit.RoomEvent.ParticipantDisconnected, p => {
    removeParticipant(p);
    logActivity(`${p.identity || p.sid || 'Participant'} left`);
    playUiTone(440, 160);
    try { renderConnectionStatus(); } catch(e){}
    refreshRoomPreview();
  });
  room.on(LiveKit.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    try {
      const id = participant?.identity || participant?.sid || room?.localParticipant?.identity;
      if (!id) return;
      const map = {
        excellent: 'excellent',
        good: 'good',
        poor: 'poor',
        unknown: 'unknown'
      };
      participantQuality.set(id, map[quality] || 'unknown');
      updateConnectionQualityIndicator(id, map[quality] || 'unknown');
    } catch (e) {}
  });

  // add existing participants (if any)
  function scanExistingParticipants() {
    try {
      debug('Scanning existing participants. room object keys:', Object.keys(room || {}));

      // Prefer the SDK-provided remoteParticipants collection when available
      const processedParticipants = new Set();
      const processedTrackSids = new Set();

      if (room && room.remoteParticipants) {
        try {
          const vals = typeof room.remoteParticipants.values === 'function' ? Array.from(room.remoteParticipants.values()) : (Array.isArray(room.remoteParticipants) ? room.remoteParticipants : []);
          debug('Found remoteParticipants count:', vals.length);
          vals.forEach(p => {
            try {
            debug(' Existing remote participant:', p && (p.sid || p.identity), p);
              const pid = p && (p.identity || p.sid);
              addParticipant(p);
              processedParticipants.add(pid);

              // gather publications in a robust way (SDKs expose different shapes)
              const pubs = [];
              try {
                if (typeof p.getTrackPublications === 'function') {
                  const g = p.getTrackPublications();
                  if (g) {
                    if (Array.isArray(g)) pubs.push(...g);
                    else if (typeof g.values === 'function') pubs.push(...Array.from(g.values()));
                  }
                }
              } catch (e) {}
              try {
                if (p.tracks && typeof p.tracks.forEach === 'function') p.tracks.forEach(pub => pubs.push(pub));
                else if (p.tracks && typeof p.tracks.values === 'function') for (const pub of p.tracks.values()) pubs.push(pub);
              } catch (e) {}

              // Inspect and attempt to attach / subscribe to publications
              pubs.forEach(pub => {
                try {
                  const info = {
                    trackSid: pub && (pub.trackSid || (pub.track && pub.track.sid)),
                    hasTrack: !!(pub && pub.track),
                    keys: pub ? Object.keys(pub) : []
                  };
                  debug('  publication:', info);
                  if (info.trackSid && pub?.source) trackSourceBySid.set(info.trackSid, pub.source);
                  const kind = pub?.kind || pub?.track?.kind;
                  if (kind === 'video' && pid) {
                    cacheVideoPublication(pid, pub);
                  }
                  if (kind === 'audio') {
                    const isStreamAudio = isScreenShareAudioStrict(pub?.track || {}, pub?.source);
                    if (typeof pub.setSubscribed === 'function') {
                      try { pub.setSubscribed(isStreamAudio ? watchedVideoParticipants.has(p.identity || p.sid) : true); } catch (e) {}
                    }
                    if (isStreamAudio && !watchedVideoParticipants.has(p.identity || p.sid)) {
                      return;
                    }
                  }
                  if (kind === 'video') {
                    ensureVideoPlaceholder(p.identity || p.sid, info.trackSid);
                    if (!watchedVideoParticipants.has(p.identity || p.sid)) {
                      debug('  skipping video publication (not watched)');
                      if (pub && typeof pub.setSubscribed === 'function') {
                        try { pub.setSubscribed(false); } catch (e) {}
                      }
                      return;
                    }
                  }
                  const sid = info.trackSid;
                  if (sid && processedTrackSids.has(sid)) { debug('  skipping already-processed trackSid', sid); return; }
                  if (kind === 'audio') {
                    const isStreamAudio = isScreenShareAudioStrict(pub?.track || {}, pub?.source);
                    if (isStreamAudio && !watchedVideoParticipants.has(p.identity || p.sid)) {
                      debug('  skipping stream audio publication (not watched)');
                      return;
                    }
                  }
                  if (pub && pub.track) {
                    try {
                      const pid = p && (p.identity || p.sid);
                      if (pid) trackToParticipant.set(pub.track.sid, pid);
                    } catch (e) {}
                    attachTrack(pub.track);
                    if (sid) processedTrackSids.add(sid);
                  } else if (sid) {
                    // attempt SDK subscribe if available
                    if (room && typeof room.subscribe === 'function') {
                      debug('  attempting room.subscribe for', sid);
                      try {
                        room.subscribe(sid).then(track => {
                          debug('  room.subscribe resolved for', sid, track);
                          if (track) {
                            try {
                              const pid = p && (p.identity || p.sid);
                              if (pid) trackToParticipant.set(track.sid, pid);
                            } catch (e) {}
                            attachTrack(track);
                            if (sid) processedTrackSids.add(sid);
                          }
                        }).catch(err => console.warn('  room.subscribe error', err));
                      } catch (e) { console.warn('  room.subscribe call failed', e); }
                    } else if (typeof p.subscribe === 'function') {
                      debug('  attempting participant.subscribe for', sid);
                      try {
                        p.subscribe(sid).then(track => {
                          debug('  participant.subscribe resolved for', sid, track);
                          if (track) {
                            try {
                              const pid = p && (p.identity || p.sid);
                              if (pid) trackToParticipant.set(track.sid, pid);
                            } catch (e) {}
                            attachTrack(track);
                            if (sid) processedTrackSids.add(sid);
                          }
                        }).catch(err => console.warn('  participant.subscribe error', err));
                      } catch (e) { console.warn('  participant.subscribe call failed', e); }
                    } else {
                      debug('  publication has no track and no subscribe API available');
                    }
                  } else {
                    debug('  publication lacking identifiable sid/track, skipping');
                  }
                } catch (e) { console.warn('pub inspect/attach error', e); }
              });
            } catch (e) { console.warn('remote participant inspect error', e); }
          });
        } catch (e) { console.warn('error reading remoteParticipants', e); }
      }

      // helper: try to detect participant-like collections on the room object
      function findParticipantCollections(obj) {
        const found = [];
        if (!obj) return found;
        for (const k of Object.keys(obj)) {
          try {
            const val = obj[k];
            if (!val) continue;
            // arrays
            if (Array.isArray(val)) {
              if (val.length > 0 && val[0] && (val[0].identity || val[0].tracks || val[0].sid)) found.push(k);
              continue;
            }
            // Map-like with values()
            if (typeof val.values === 'function') {
              const first = val.values().next();
              if (first && first.value && (first.value.identity || first.value.tracks || first.value.sid)) found.push(k);
              continue;
            }
            // forEach-able
            if (typeof val.forEach === 'function') {
              // attempt to get a sample
              try {
                let sample = null;
                val.forEach(v => { if (!sample) sample = v; });
                if (sample && (sample.identity || sample.tracks || sample.sid)) found.push(k);
              } catch (e) {}
            }
          } catch (e) {}
        }
        return found;
      }

      const candidateKeys = findParticipantCollections(room);
      debug('Potential participant containers on room:', candidateKeys);

      const participants = [];
      for (const k of candidateKeys) {
        try {
          const col = room[k];
          if (!col) continue;
          if (Array.isArray(col)) participants.push(...col);
          else if (typeof col.values === 'function') participants.push(...Array.from(col.values()));
          else if (typeof col.forEach === 'function') { col.forEach(p => participants.push(p)); }
        } catch (e) { console.warn('error iterating', k, e); }
      }

      // dedupe by participant sid/identity
      const seen = new Set();
      participants.forEach(p => {
        try {
          const key = p && (p.identity || p.sid || JSON.stringify(p));
          if (!key || seen.has(key)) return; seen.add(key);
          // skip if already handled by remoteParticipants branch
          if (processedParticipants && processedParticipants.has(p && (p.sid || p.identity))) {
            debug('Skipping participant (already processed):', p && (p.sid || p.identity));
            return;
          }
          debug('Existing participant detected:', p && (p.sid || p.identity), p);
          addParticipant(p);
          // gather publications
          const pubs = [];
          if (p.tracks && typeof p.tracks.forEach === 'function') p.tracks.forEach(pub => pubs.push(pub));
          else if (p.tracks && typeof p.tracks.values === 'function') for (const pub of p.tracks.values()) pubs.push(pub);
          debug('  publications count:', pubs.length);
          pubs.forEach(pub => {
            try {
              const trackSid = pub && (pub.trackSid || (pub.track && pub.track.sid));
              debug('   pub inspect:', { trackSid, hasTrack: !!(pub && pub.track), keys: pub ? Object.keys(pub) : [] });
              if (trackSid && processedTrackSids.has(trackSid)) { debug('   skipping already-processed pub', trackSid); return; }
              if (pub && pub.track) { attachTrack(pub.track); if (trackSid) processedTrackSids.add(trackSid); }
              else if (trackSid) {
                if (room && typeof room.subscribe === 'function') {
                  room.subscribe(trackSid).then(track => { if (track) { attachTrack(track); processedTrackSids.add(trackSid); } }).catch(e=>console.warn('subscribe error', e));
                } else if (typeof p.subscribe === 'function') {
                  p.subscribe(trackSid).then(track => { if (track) { attachTrack(track); processedTrackSids.add(trackSid); } }).catch(e=>console.warn('participant.subscribe error', e));
                } else {
                  debug('    cannot obtain track for pub', trackSid);
                }
              }
            } catch (e) { console.warn('pub inspect error', e); }
          });
        } catch (e) { console.warn('participant inspect error', e); }
      });
    } catch (e) { console.warn('scanExistingParticipants error', e); }
  }

  // some SDKs populate participants asynchronously; scan shortly after connecting
  setTimeout(scanExistingParticipants, 300);
  // also run another scan a bit later to be robust
  setTimeout(scanExistingParticipants, 1200);

  updateUIOnConnect();
  try { renderConnectionStatus(); } catch(e){}
};

/* ---------- START STREAM ---------- */
startBtn.onclick = async () => {
  if (isStreaming) {
    await stopStreaming();
    return;
  }
  const [w, h] = resolutionSelect.value.split("x").map(Number);
  const fps = getSelectedFps();
  const bitrate = Number(bitrateInput.value) * 1000;
  desiredScreenMaxBitrate = bitrate;
  desiredScreenMaxFramerate = fps;
  debug('Start stream settings:', { resolution: `${w}x${h}`, fps, bitrateKbps: bitrateInput.value, bitrateBps: bitrate });

  // Get desktop sources from Electron preload
  const sources = filterScreenSources(await window.electronAPI.getSources());
  const selectedId = sourceSelect?.value;
  const source = sources.find(s => s.id === selectedId) || sources[0];
  if (!source) {
    alert("No capture sources available");
    return;
  }

  // Capture screen video + system audio
  const videoMandatory = {
    chromeMediaSource: "desktop",
    chromeMediaSourceId: source.id,
    minWidth: w,
    maxWidth: w,
    minHeight: h,
    maxHeight: h,
    minFrameRate: 1,
    maxFrameRate: fps,
  };
  const captureConstraints = {
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id
      }
    },
    video: { mandatory: videoMandatory },
  };
  try {
    screenStream = await navigator.mediaDevices.getUserMedia(captureConstraints);
  } catch (e) {
    if (e && e.name === 'OverconstrainedError') {
      console.warn('Capture constraints too strict, retrying without frame rate caps', e);
      delete videoMandatory.minFrameRate;
      delete videoMandatory.maxFrameRate;
      screenStream = await navigator.mediaDevices.getUserMedia(captureConstraints);
    } else {
      throw e;
    }
  }

  // Log actual capture settings (desktop capture may ignore constraints)
  try {
    const captureSettings = screenStream.getVideoTracks()[0]?.getSettings?.();
    debug('Screen capture settings:', captureSettings);
    const actualW = captureSettings?.width || w;
    const actualH = captureSettings?.height || h;
    const actualFps = captureSettings?.frameRate || fps;
    currentStreamSettings = {
      res: `${actualW}x${actualH}`,
      fps: String(Math.round(actualFps)),
      maxKbps: String(Math.round(bitrate / 1000))
    };
    setLocalStreamAttributes({
      stream_resolution: currentStreamSettings.res,
      stream_fps: currentStreamSettings.fps,
      stream_max_bitrate_kbps: currentStreamSettings.maxKbps
    });
  } catch (e) {
    currentStreamSettings = {
      res: `${w}x${h}`,
      fps: String(Math.round(fps)),
      maxKbps: String(Math.round(bitrate / 1000))
    };
    setLocalStreamAttributes({
      stream_resolution: currentStreamSettings.res,
      stream_fps: currentStreamSettings.fps,
      stream_max_bitrate_kbps: currentStreamSettings.maxKbps
    });
  }

  // Screen video track
  screenVideoTrack = new LiveKit.LocalVideoTrack(screenStream.getVideoTracks()[0], { name: "screen" });
  try { screenVideoTrack.mediaStreamTrack.contentHint = 'motion'; } catch (e) {}
  try {
    const track = screenVideoTrack.mediaStreamTrack;
    if (track) {
      track.onended = () => {
        console.warn('[stream] screen video track ended', {
          readyState: track.readyState,
          label: track.label
        });
      };
      track.onmute = () => {
        logInfo('[stream] screen video track muted', { readyState: track.readyState });
      };
      track.onunmute = () => {
        logInfo('[stream] screen video track unmuted', { readyState: track.readyState });
      };
    }
  } catch (e) {}
  const simulcastLayers = getScreenSimulcastLayers(
    screenStream.getVideoTracks()[0]?.getSettings?.()?.height
  );
  logInfo('[stream] publishing screen video track', { trackSid: screenVideoTrack?.sid });
  const screenPub = await room.localParticipant.publishTrack(screenVideoTrack, {
    simulcast: simulcastLayers.length > 0,
    source: LiveKit.Track.Source.ScreenShare,
    videoEncoding: { maxBitrate: bitrate, maxFramerate: fps },
    videoSimulcastLayers: simulcastLayers.length > 0 ? simulcastLayers : undefined,
    videoCodec: 'vp8'
  });
  logInfo('[stream] published screen video track', {
    pubSid: screenPub?.trackSid,
    trackSid: screenVideoTrack?.sid,
    codec: screenPub?.mimeType || screenPub?.track?.codec || null,
    simulcast: simulcastLayers.length > 0
  });
  configureScreenSender(screenPub?.sender);
  waitForScreenSender(screenPub, 'Screen share');

  // System audio track
  if (screenStream.getAudioTracks().length > 0) {
    screenAudioTrack = new LiveKit.LocalAudioTrack(screenStream.getAudioTracks()[0], { name: "systemAudio" });
    const screenAudioOpts = {};
    try {
      if (LiveKit?.Track?.Source?.ScreenShareAudio != null) {
        screenAudioOpts.source = LiveKit.Track.Source.ScreenShareAudio;
      }
    } catch (e) {}
    await room.localParticipant.publishTrack(screenAudioTrack, screenAudioOpts);
    // Enable system audio mute button after track is ready
    muteSystemBtn.disabled = false;
    muteSystemBtn.style.display = '';
  }

  attachTrack(screenVideoTrack, true);

  setStreamButtonState(true);
};

/* ---------- STOP STREAM ---------- */
async function stopStreaming() {
  if (!isStreaming) return;
  if (screenVideoTrack) {
    logInfo('[stream] unpublishing screen video track', { trackSid: screenVideoTrack?.sid });
    await room.localParticipant.unpublishTrack(screenVideoTrack);
    screenVideoTrack.stop();
    detachTrack(screenVideoTrack);
    screenVideoTrack = null;
  }

  if (screenAudioTrack) {
    await room.localParticipant.unpublishTrack(screenAudioTrack);
    screenAudioTrack.stop();
    detachTrack(screenAudioTrack);
    screenAudioTrack = null;
  }

  screenStream?.getTracks().forEach(t => t.stop());
  screenStream = null;

  setStreamStatus('');
  currentStreamSettings = { res: '', fps: '', maxKbps: '' };
  setLocalStreamAttributes({
    stream_resolution: '',
    stream_fps: '',
    stream_max_bitrate_kbps: ''
  });
  screenSenderConfigured = false;
  stopSenderStatsLogging();
  setStreamButtonState(false);
  muteSystemBtn.disabled = true;
  muteSystemBtn.style.display = 'none';
  if (echoCancelBtn) echoCancelBtn.disabled = false;
  if (noiseSuppressBtn) noiseSuppressBtn.disabled = false;
  if (noiseGateBtn) noiseGateBtn.disabled = false;
  if (enhancedVoiceBtn) enhancedVoiceBtn.disabled = false;
  if (autoGainBtn) autoGainBtn.disabled = false;
}
 

/* ---------- LEAVE ROOM ---------- */
async function leaveRoom() {
  if (joinBtn) joinBtn.disabled = true;
  manualDisconnect = true;
  if (autoRejoinTimer) { clearTimeout(autoRejoinTimer); autoRejoinTimer = null; }
  setReconnectBanner(false);
  setStreamButtonState(false);
  setJoinButtonState(false);
  stopPingMonitor();
  stopAudioLevelMonitor();
  stopMuteBroadcast();
  if (!room) {
    updateUIOnDisconnect();
    if (joinBtn) joinBtn.disabled = false;
    return;
  }
  try { room && room.removeAllListeners && room.removeAllListeners(); } catch (e) {}
  if (screenVideoTrack) {
    logInfo('[stream] unpublishing screen video track (leave)', { trackSid: screenVideoTrack?.sid });
    await room.localParticipant.unpublishTrack(screenVideoTrack);
    screenVideoTrack.stop();
  }
  if (screenAudioTrack) {
    await room.localParticipant.unpublishTrack(screenAudioTrack);
    screenAudioTrack.stop();
  }
  if (micAudioTrack) {
    await room.localParticipant.unpublishTrack(micAudioTrack);
    micAudioTrack.stop();
  }

  stopMicGate();
  micStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());

  setLocalStreamAttributes({
    stream_resolution: '',
    stream_fps: '',
    stream_max_bitrate_kbps: ''
  });
  await room.disconnect();
  room = null;
  setStreamStatus('');
  currentStreamSettings = { res: '', fps: '', maxKbps: '' };

  screenSenderConfigured = false;
  stopSenderStatsLogging();
  // cleanup streams and participant UI + audio resources
  streamsDiv.innerHTML = "";
  if (minimizedStreams) minimizedStreams.innerHTML = "";
  minimizedTiles.clear();
  minimizedParticipants.clear();
  participantAudioEls.clear();
  participantAudioControls.clear();
  participantListAudioControls.clear();
  participantQuality.clear();
  trackToParticipant.clear();
  participantStreamInfo.clear();
  participantWatchControls.clear();
  participantsById.clear();
  watchedVideoParticipants.clear();
  participantVideoPubs.clear();
  participantStreamAudioEls.clear();
  participantStreamAudioControls.clear();
  participantStreamAudioSettings.clear();
  participantMeters.clear();
  participantAnalyzers.clear();
  participantMeterRaf.clear();
  updateMinimizedPanelVisibility();
  try { if (participantsList) participantsList.innerHTML = ""; } catch (e) {}
  try { setConnectionStatus('Not connected'); } catch (e) {}
  startBtn.disabled = true;
  muteMicBtn.disabled = true;
  muteSystemBtn.disabled = true;
  if (muteMicBtn) {
    setMicMuteState(micMuted);
  }
  if (muteSystemBtn) {
    muteSystemBtn.classList.remove('is-muted');
    muteSystemBtn.setAttribute('aria-label', 'Mute System Audio');
    muteSystemBtn.setAttribute('title', 'Mute System Audio');
    const icon = muteSystemBtn.querySelector('.icon');
    if (icon) {
      icon.classList.add('speaker-on');
      icon.classList.remove('speaker-off');
    }
  }
  setMuteIncomingState(muteIncomingAll);
  if (muteIncomingBtn) muteIncomingBtn.disabled = false;
  if (echoCancelBtn) echoCancelBtn.disabled = false;
  if (noiseSuppressBtn) noiseSuppressBtn.disabled = false;
  if (noiseGateBtn) noiseGateBtn.disabled = false;
  if (enhancedVoiceBtn) enhancedVoiceBtn.disabled = false;
  if (autoGainBtn) autoGainBtn.disabled = false;
  updateUIOnDisconnect();
  if (joinBtn) joinBtn.disabled = false;
  logActivity('You left the room');
  playUiTone(360, 180);
  refreshRoomPreview();
  connectChatSocket();
  setMuteIncomingState(muteIncomingAll);
  if (muteIncomingBtn) muteIncomingBtn.disabled = false;
  if (roomAccessSection) roomAccessSection.classList.remove('collapsed');
}

/* ---------- MUTE MIC ---------- */
muteMicBtn.onclick = () => {
  const muted = !micMuted;
  setMicMuteState(muted);
  saveSettings();
};

/* ---------- MIC PROCESSING ---------- */
if (echoCancelBtn) echoCancelBtn.onclick = async () => {
  micProcessing.echoCancellation = !micProcessing.echoCancellation;
  updateMicProcessingButtons();
  await restartMicTrack();
};
if (noiseSuppressBtn) noiseSuppressBtn.onclick = async () => {
  micProcessing.noiseSuppression = !micProcessing.noiseSuppression;
  updateMicProcessingButtons();
  await restartMicTrack();
};
if (noiseGateBtn) noiseGateBtn.onclick = async () => {
  micProcessing.noiseGateEnabled = !micProcessing.noiseGateEnabled;
  updateMicProcessingButtons();
  saveSettings();
  await restartMicTrack();
};
if (noiseGateSlider) noiseGateSlider.oninput = () => {
  micProcessing.noiseGateLevel = Math.max(0, Math.min(100, Number(noiseGateSlider.value) || 0));
  updateMicProcessingButtons();
  saveSettings();
};
if (enhancedVoiceSlider) enhancedVoiceSlider.oninput = () => {
  micProcessing.enhancedVoiceLevel = Math.max(0, Math.min(100, Number(enhancedVoiceSlider.value) || 0));
  updateMicProcessingButtons();
  saveSettings();
};
if (enhancedVoiceBtn) enhancedVoiceBtn.onclick = async () => {
  micProcessing.enhancedVoiceEnabled = !micProcessing.enhancedVoiceEnabled;
  updateMicProcessingButtons();
  saveSettings();
  await restartMicTrack();
};
if (autoGainBtn) autoGainBtn.onclick = async () => {
  micProcessing.autoGainControl = !micProcessing.autoGainControl;
  updateMicProcessingButtons();
  await restartMicTrack();
};

// if (manualGainSlider) manualGainSlider.oninput = async () => {
//   manualMicGain = Number(manualGainSlider.value) / 100;
//   saveSettings();
//   if (!micProcessing.autoGainControl) {
//     await applyManualGainIfNeeded();
//   }
// };

/* ---------- MUTE SYSTEM AUDIO ---------- */
muteSystemBtn.onclick = () => {
  if (!screenAudioTrack) return;
  const newState = !screenAudioTrack.mediaStreamTrack.enabled;
  screenAudioTrack.mediaStreamTrack.enabled = newState;
  const muted = !newState;
  muteSystemBtn.classList.toggle('is-muted', muted);
  muteSystemBtn.setAttribute('aria-label', muted ? 'Unmute System Audio' : 'Mute System Audio');
  muteSystemBtn.setAttribute('title', muted ? 'Unmute System Audio' : 'Mute System Audio');
  const icon = muteSystemBtn.querySelector('.icon');
  if (icon) {
    icon.classList.toggle('speaker-on', !muted);
    icon.classList.toggle('speaker-off', muted);
  }
};

/* ---------- MUTE INCOMING AUDIO ---------- */
if (muteIncomingBtn) muteIncomingBtn.onclick = () => {
  const muted = !muteIncomingAll;
  setMuteIncomingState(muted);
  applyMuteIncomingToAll();
  saveSettings();
};

/* ---------- ATTACH TRACK ---------- */
function attachTrack(track, isLocal = false) {
  // avoid creating duplicate elements for the same track.sid
  try {
    const existing = streamsDiv.querySelector(`[data-sid="${track.sid}"]`);
    if (existing) {
      // update srcObject in case the track instance changed
      try {
        const mediaEl = (existing.tagName === 'VIDEO' || existing.tagName === 'AUDIO')
          ? existing
          : existing.querySelector('video, audio');
        if (mediaEl) mediaEl.srcObject = new MediaStream([track.mediaStreamTrack]);
        if (track.kind === 'video') {
          existing.classList.remove('placeholder');
          ensureWatchOverlay(existing, existing.dataset.participantId);
          setTileWatchState(existing, true);
          if (existing.dataset.participantId) {
            updateWatchOverlays(existing.dataset.participantId);
          }
        } else if (track.kind === 'audio') {
          const pid = isLocal
            ? (room?.localParticipant?.identity || room?.localParticipant?.sid)
            : (trackToParticipant.get(track.sid) || resolveParticipantIdForTrack(track));
          if (pid) {
            if (!isLocal) {
              // Ensure reused audio elements start muted to avoid a burst.
              mediaEl.muted = true;
              registerRemoteAudioTrack(pid, track, mediaEl);
              try { track.mediaStreamTrack.enabled = false; } catch (e) {}
            } else {
              applySavedAudioSettings(pid, mediaEl);
            }
          }
        }
      } catch (e) {}
      return;
    }
    if (track.kind === 'video') {
      const pid = trackToParticipant.get(track.sid) || resolveParticipantIdForTrack(track);
    const placeholderTile = pid ? streamsDiv.querySelector(`.stream-tile.placeholder[data-participant-id="${pid}"]`) : null;
    if (placeholderTile) {
      placeholderTile.dataset.sid = track.sid;
      const mediaEl = placeholderTile.querySelector('video');
      if (mediaEl) mediaEl.srcObject = new MediaStream([track.mediaStreamTrack]);
      placeholderTile.classList.remove('placeholder');
      const infoLabel = placeholderTile.querySelector('[data-stream-info-label="true"]');
        if (infoLabel) {
          const info = pid ? (participantStreamInfo.get(pid) || '') : '';
          infoLabel.textContent = info;
          infoLabel.style.display = info ? 'block' : 'none';
        }
        ensureWatchOverlay(placeholderTile, pid);
        setTileWatchState(placeholderTile, true);
        if (pid) updateWatchOverlays(pid);
        return;
      }
    }
  } catch (e) {}

  const el = document.createElement(track.kind === "video" ? "video" : "audio");
  el.autoplay = true;
  el.playsInline = true;

  if (track.kind === "audio") {
    // Start muted to avoid a brief audio burst before classification.
    el.muted = true;
    if (!isLocal) {
      try { track.mediaStreamTrack.enabled = false; } catch (e) {}
    }
  }

  el.srcObject = new MediaStream([track.mediaStreamTrack]);

  if (track.kind === "audio") {
    applyPlaybackDeviceToElement(el);
  }

  if (track.kind === "video") {
    el.style.cursor = "pointer";
    el.ondblclick = () => {
      const target = el.parentElement || el;
      requestFullscreenForElement(target);
    };
  }

  if (track.kind === "audio" && !isLocal) {
    el.onclick = () => {
      track.mediaStreamTrack.enabled = !track.mediaStreamTrack.enabled;
      el.style.opacity = track.mediaStreamTrack.enabled ? "1" : "0.4";
    };
  }

  if (track.kind === "audio") {
    try {
      const pid = isLocal
        ? (room?.localParticipant?.identity || room?.localParticipant?.sid)
        : (trackToParticipant.get(track.sid) || resolveParticipantIdForTrack(track));
      if (pid) {
        if (!isLocal) {
          if (muteIncomingAll) {
            el.muted = true;
          }
          registerRemoteAudioTrack(pid, track, el);
          try {
            const info = participantAudioTracks.get(pid)?.get(track.sid);
            logInfo('[audio][attach] remote audio attached', {
              participantId: pid,
              trackSid: track.sid,
              source: info?.source,
              channelCount: info?.channelCount,
              isStreaming: Boolean(participantStreamInfo.get(pid)),
              isWatched: watchedVideoParticipants.has(pid)
            });
          } catch (e) {}
          try { track.mediaStreamTrack.enabled = false; } catch (e) {}
        } else {
          applySavedAudioSettings(pid, el);
        }
      }
    } catch (e) {}
  }

  if (track.kind === "video") {
    const pid = trackToParticipant.get(track.sid) || resolveParticipantIdForTrack(track);
    if (pid && !watchedVideoParticipants.has(pid) && !isLocal) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'stream-tile';
    wrapper.dataset.sid = track.sid;

    const header = document.createElement('div');
    header.className = 'stream-header';

    const nameWrap = document.createElement('div');
    nameWrap.className = 'stream-title';

    const nameLabel = document.createElement('div');
    nameLabel.dataset.streamNameLabel = 'true';
    nameLabel.className = 'stream-name';

    const label = document.createElement('div');
    label.dataset.streamInfoLabel = 'true';
    label.className = 'stream-info';


    let participantId = null;
    if (isLocal) {
      participantId = room?.localParticipant?.identity || room?.localParticipant?.sid || null;
    } else {
      participantId = trackToParticipant.get(track.sid) || resolveParticipantIdForTrack(track);
    }
    if (participantId) {
      wrapper.dataset.participantId = participantId;
      if (isLocal) {
        wrapper.dataset.local = 'true';
        label.style.display = 'none';
      } else {
        const info = participantStreamInfo.get(participantId) || '';
        label.textContent = info;
        label.style.display = info ? 'block' : 'none';
      }
      const displayName = getDisplayNameForId(participantId, participantId);
      const info = participantStreamInfo.get(participantId) || '';
      nameLabel.textContent = info ? `${displayName} · ${info}` : displayName;
      nameLabel.style.display = nameLabel.textContent ? 'block' : 'none';
    } else {
      label.style.display = 'none';
      nameLabel.style.display = 'none';
    }

    nameWrap.appendChild(nameLabel);
    nameWrap.appendChild(label);
    header.appendChild(nameWrap);
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'stream-media';
    mediaWrap.appendChild(el);
    wrapper.appendChild(header);
    wrapper.appendChild(mediaWrap);
    streamsDiv.appendChild(wrapper);
    if (minimizedTiles.has(track.sid)) {
      wrapper.classList.add('minimized');
      if (minimizedStreams) minimizedStreams.appendChild(wrapper);
    }
    ensureWatchOverlay(wrapper, participantId);
    if (participantId) updateWatchOverlays(participantId);
    updateMinimizedPanelVisibility();
  } else {
    el.dataset.sid = track.sid;
    streamsDiv.appendChild(el);
  }
}

function startSenderStatsLogging(sender, label) {
  if (!sender || senderStatsTimer) return;
  let lastBytes = 0;
  let lastTs = 0;
  let lastCodec = '';
  let loggedSummary = false;
  let lastAvailable = 0;
  senderStatsTimer = setInterval(async () => {
    try {
      const stats = await sender.getStats();
      if (!loggedSummary) {
        const typeCounts = {};
        stats.forEach(r => { typeCounts[r.type] = (typeCounts[r.type] || 0) + 1; });
        debug(`${label} stats types:`, typeCounts);
        stats.forEach(r => {
          if (r.type === 'codec') {
            debug(`${label} codec report:`, r);
          }
        });
        loggedSummary = true;
      }
      stats.forEach(report => {
        if (report.type === 'transport' && report.availableOutgoingBitrate) {
          const available = report.availableOutgoingBitrate;
          if (available && available !== lastAvailable) {
            lastAvailable = available;
            debug(`${label} available outgoing bitrate: ${(available / 1e6).toFixed(2)} Mbps`);
          }
        }
        if (report.type !== 'outbound-rtp' || report.isRemote) return;
        if (!report.bytesSent || !report.timestamp) return;
        try {
          if (report.codecId && typeof stats.get === 'function') {
            const codec = stats.get(report.codecId);
            const mimeType = codec && codec.mimeType ? codec.mimeType : '';
            if (mimeType && mimeType !== lastCodec) {
              lastCodec = mimeType;
              debug(`${label} codec: ${mimeType}`);
            }
          }
        } catch (e) {}
        if (lastTs) {
          const bytesDelta = report.bytesSent - lastBytes;
          const timeDelta = (report.timestamp - lastTs) / 1000;
          if (timeDelta > 0) {
            const bps = (bytesDelta * 8) / timeDelta;
            debug(`${label} send bitrate: ${(bps / 1e6).toFixed(2)} Mbps`);
            try {
              currentStreamSendMbps = bps / 1e6;
              const res = currentStreamSettings.res || 'unknown';
              const fps = currentStreamSettings.fps || 'unknown';
              const maxKbps = currentStreamSettings.maxKbps || 'unknown';
              const codec = lastCodec || 'unknown';
              setStreamStatus(`Stream: ${res} | ${fps} fps | max ${maxKbps} kbps | codec ${codec} | send ${(bps / 1e6).toFixed(2)} Mbps`);
              const localId = room?.localParticipant?.identity || room?.localParticipant?.sid;
              if (localId) updateStreamNameLabel(localId);
            } catch (e) {}
          }
        }
        lastBytes = report.bytesSent;
        lastTs = report.timestamp;
      });
    } catch (e) {}
  }, 1000);
}

function configureScreenSender(sender) {
  if (!sender || screenSenderConfigured) return;
  screenSenderConfigured = true;
  try {
    const params = sender.getParameters();
    debug('Screen sender params before:', params);
    if (params.encodings && params.encodings[0]) {
      if (desiredScreenMaxBitrate > 0) params.encodings[0].maxBitrate = desiredScreenMaxBitrate;
      if (desiredScreenMaxFramerate > 0) params.encodings[0].maxFramerate = desiredScreenMaxFramerate;
      params.encodings[0].scaleResolutionDownBy = 1;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
    }
    params.degradationPreference = 'maintain-framerate';
    sender.setParameters(params).then(() => {
      try {
        const applied = sender.getParameters();
        debug('Screen sender params applied:', applied);
        try {
          const enc = applied.encodings && applied.encodings[0] ? applied.encodings[0] : null;
          debug('Screen sender encoding[0]:', enc);
          if (enc) {
            debug('Screen sender maxBitrate/scale/priority:', {
              maxBitrate: enc.maxBitrate,
              scaleResolutionDownBy: enc.scaleResolutionDownBy,
              priority: enc.priority
            });
          }
        } catch (e) {}
      } catch (e) {}
    }).catch(e => {
      console.warn('Screen sender setParameters failed:', e);
    });
  } catch (e) {}
  startSenderStatsLogging(sender, 'Screen share');
}

function findScreenSenderViaPC() {
  try {
    const pc = getPublisherPc();
    if (!pc || !screenVideoTrack) return null;
    const track = screenVideoTrack.mediaStreamTrack;
    const senders = typeof pc.getSenders === 'function' ? pc.getSenders() : [];
    return senders.find(s => s && s.track === track) || null;
  } catch (e) {}
  return null;
}

function waitForScreenSender(publication, label) {
  if (!publication) return;
  let tries = 0;
  const maxTries = 10;
  const timer = setInterval(() => {
    tries += 1;
    if (screenSenderConfigured) {
      clearInterval(timer);
      return;
    }
    const directSender = publication.sender;
    if (directSender) {
      configureScreenSender(directSender);
      clearInterval(timer);
      return;
    }
    const pcSender = findScreenSenderViaPC();
    if (pcSender) {
      debug('Screen sender found via peer connection');
      configureScreenSender(pcSender);
      clearInterval(timer);
      return;
    }
    if (tries >= maxTries) {
      console.warn(`${label} sender still unavailable after ${maxTries} checks`);
      clearInterval(timer);
    }
  }, 250);
}

function stopSenderStatsLogging() {
  if (!senderStatsTimer) return;
  clearInterval(senderStatsTimer);
  senderStatsTimer = null;
  currentStreamSendMbps = null;
  try {
    const localId = room?.localParticipant?.identity || room?.localParticipant?.sid;
    if (localId) updateStreamNameLabel(localId);
  } catch (e) {}
}

function cleanupStreamTiles(participantId, trackSid, removeAllForParticipant) {
  try {
    if (trackSid) {
      const bySid = document.querySelectorAll(`.stream-tile[data-sid="${trackSid}"]`);
      bySid.forEach(tile => {
        minimizedTiles.delete(trackSid);
        tile.remove();
      });
    }
    if (removeAllForParticipant && participantId) {
      const byParticipant = document.querySelectorAll(`.stream-tile[data-participant-id="${participantId}"]`);
      byParticipant.forEach(tile => tile.remove());
      minimizedParticipants.delete(participantId);
      watchedVideoParticipants.delete(participantId);
      updateWatchOverlays(participantId);
      updateParticipantWatchControls(participantId);
    }
  } catch (e) {}
  updateMinimizedPanelVisibility();
}

/* ---------- DETACH TRACK ---------- */
function detachTrack(track) {
  const el = streamsDiv.querySelector(`[data-sid="${track.sid}"]`);
  if (el) {
    if (track.kind === 'video') {
      const pid = el.dataset.participantId;
      const isLocalTile = el.dataset.local === 'true';
      if (isLocalTile) {
        el.remove();
      } else if (pid && !watchedVideoParticipants.has(pid)) {
        const mediaEl = el.querySelector('video');
        if (mediaEl) mediaEl.srcObject = null;
        if (!el.classList.contains('placeholder')) {
          el.classList.add('placeholder');
          ensureWatchOverlay(el, pid);
          const fsBtn = el.querySelector('.fullscreen-btn');
          if (fsBtn) fsBtn.style.display = 'none';
        }
        updateMinimizedPanelVisibility();
      } else {
        el.remove();
      }
    } else {
      el.remove();
    }
  }
  if (track && track.kind === 'video' && minimizedTiles.has(track.sid)) {
    try {
      const pid = trackToParticipant.get(track.sid) || resolveParticipantIdForTrack(track);
      if (pid) ensureMinimizedPlaceholder(pid, track.sid);
    } catch (e) {}
  }
  if (minimizedStreams) {
    const minEl = minimizedStreams.querySelector(`[data-sid="${track.sid}"]`);
    if (minEl && !minimizedTiles.has(track.sid)) {
      const pid = minEl.dataset.participantId;
      if (!pid || !minimizedParticipants.has(pid)) {
        minEl.remove();
      }
    }
  }
  if (track && track.kind === 'audio') {
    try {
      const pid = trackToParticipant.get(track.sid) || resolveParticipantIdForTrack(track);
      if (pid) {
        unregisterRemoteAudioTrack(pid, track);
      }
    } catch (e) {}
  }
  minimizedTiles.delete(track.sid);
  updateMinimizedPanelVisibility();
}

/* ---------- Participants UI ---------- */
const trackToParticipant = new Map();
const participantStreamInfo = new Map();
const trackSourceBySid = new Map();

/* ---------- UI helpers ---------- */
function updateUIOnConnect() {
  try {
    startBtn.disabled = false;
    muteMicBtn.disabled = false;
    if (muteIncomingBtn) muteIncomingBtn.disabled = false;
    if (streamSetupSection) streamSetupSection.classList.remove('hidden');
    updateParticipantsViewMode(true);
    // leave/start/stop buttons reflect room state
    try { setConnectionStatus(formatConnectionStatus()); } catch (e) {}
    setJoinButtonState(true);
  } catch (e) { console.warn('updateUIOnConnect error', e); }
}

function updateUIOnDisconnect() {
  try {
    startBtn.disabled = true;
    muteMicBtn.disabled = false;
    muteSystemBtn.disabled = true;
    if (muteIncomingBtn) muteIncomingBtn.disabled = false;
    setConnectionStatus('Disconnected');
    setJoinButtonState(false);
    stopPingMonitor();
    stopAudioLevelMonitor();
    if (streamSetupSection) streamSetupSection.classList.add('hidden');
    updateParticipantsViewMode(false);
    try { if (participantsList) participantsList.innerHTML = ""; } catch (e) {}
  } catch (e) { console.warn('updateUIOnDisconnect error', e); }
}

function createParticipantEntry(id, displayName) {
  if (!participantsList) return;
  if (document.getElementById(`participant-${id}`)) return;
  const container = document.createElement('div');
  container.id = `participant-${id}`;
  // mark temporary entries that were created from track SIDs (LiveKit track sids often start with 'TR_')
  if (typeof id === 'string' && id.startsWith('TR_')) container.dataset.temp = 'true';
  if (participantMicMuted.get(id)) container.classList.add('is-muted');
  const row = document.createElement('div');
  row.className = 'participant-row';
  row.dataset.participantId = id;
  if (participantMicMuted.get(id)) row.classList.add('is-muted');

  const meta = document.createElement('div');
  meta.className = 'participant-meta';

  const qualityDot = document.createElement('span');
  qualityDot.className = 'quality-dot';

  const nameStack = document.createElement('div');
  nameStack.className = 'participant-name-stack';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'participant-name';
  nameSpan.textContent = getDisplayNameForId(id, displayName || 'Unknown');

  const nameRow = document.createElement('div');
  nameRow.className = 'participant-name-row';
  const mutedIcon = document.createElement('span');
  mutedIcon.className = 'participant-muted-icon';
  mutedIcon.setAttribute('aria-hidden', 'true');

  nameRow.appendChild(nameSpan);
  nameRow.appendChild(mutedIcon);
  nameStack.appendChild(nameRow);

  meta.appendChild(qualityDot);
  meta.appendChild(nameStack);

  const controls = document.createElement('div');
  controls.className = 'participant-controls';

  const micControls = document.createElement('div');
  micControls.className = 'participant-control-row';

  const muteBtn = document.createElement('button');
  muteBtn.className = 'btn icon-btn small mute-btn';
  muteBtn.type = 'button';
  const muteIcon = document.createElement('span');
  muteIcon.className = 'icon mic-on';
  muteIcon.setAttribute('aria-hidden', 'true');
  muteBtn.appendChild(muteIcon);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '100';
  slider.className = 'volume-slider';

  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'volume-wrap';
  const meter = document.createElement('div');
  meter.className = 'volume-meter';

  const streamControls = document.createElement('div');
  streamControls.className = 'participant-control-row stream-control-row';

  const streamMuteBtn = document.createElement('button');
  streamMuteBtn.className = 'btn icon-btn small stream-mute-btn';
  streamMuteBtn.type = 'button';
  const streamIcon = document.createElement('span');
  streamIcon.className = 'icon tv-on';
  streamIcon.setAttribute('aria-hidden', 'true');
  streamMuteBtn.appendChild(streamIcon);

  const streamVolumeWrap = document.createElement('div');
  streamVolumeWrap.className = 'volume-wrap';
  const streamMeter = document.createElement('div');
  streamMeter.className = 'volume-meter';
  const streamSlider = document.createElement('input');
  streamSlider.type = 'range';
  streamSlider.min = '0';
  streamSlider.max = '100';
  streamSlider.value = '100';
  streamSlider.className = 'volume-slider';

  const watchBtn = document.createElement('button');
  watchBtn.className = 'btn icon-btn small watch-btn';
  watchBtn.type = 'button';
  watchBtn.style.display = 'none';
  const watchIcon = document.createElement('span');
  watchIcon.className = 'icon eye-off';
  watchIcon.setAttribute('aria-hidden', 'true');
  watchBtn.appendChild(watchIcon);

  const isLocal = room?.localParticipant
    && (id === room.localParticipant.identity || id === room.localParticipant.sid);
  if (isLocal) {
    muteBtn.style.display = 'none';
    slider.style.display = 'none';
    streamMuteBtn.style.display = 'none';
    streamSlider.style.display = 'none';
  }

  muteBtn.onclick = () => {
    const audioEl = participantAudioEls.get(id);
    if (!audioEl) return;
    const wasMuted = audioEl.muted;
    audioEl.muted = !audioEl.muted;
    if (wasMuted && audioEl.volume === 0) {
      audioEl.volume = 0.1;
    }
    setParticipantAudioSetting(id, { muted: audioEl.muted, vol: audioEl.volume });
    updateAudioControlsForParticipant(id);
  };
  slider.oninput = () => {
    const audioEl = participantAudioEls.get(id);
    if (!audioEl) return;
    const vol = Number(slider.value) / 100;
    audioEl.volume = Math.max(0, Math.min(1, vol));
    audioEl.muted = audioEl.volume === 0 ? true : false;
    setParticipantAudioSetting(id, { muted: audioEl.muted, vol: audioEl.volume });
    updateAudioControlsForParticipant(id);
  };

  streamMuteBtn.onclick = () => {
    const audioEl = participantStreamAudioEls.get(id);
    if (!audioEl) return;
    const wasMuted = audioEl.muted;
    audioEl.muted = !audioEl.muted;
    if (wasMuted && audioEl.volume === 0) {
      audioEl.volume = 0.1;
    }
    setParticipantStreamAudioSetting(id, { muted: audioEl.muted, vol: audioEl.volume });
    updateStreamAudioControlsForParticipant(id);
  };

  streamSlider.oninput = () => {
    const audioEl = participantStreamAudioEls.get(id);
    if (!audioEl) return;
    const vol = Number(streamSlider.value) / 100;
    audioEl.volume = Math.max(0, Math.min(1, vol));
    audioEl.muted = audioEl.volume === 0 ? true : false;
    setParticipantStreamAudioSetting(id, { muted: audioEl.muted, vol: audioEl.volume });
    updateStreamAudioControlsForParticipant(id);
  };

  watchBtn.onclick = () => {
    logInfo('[watch] list button clicked', { participantId: id });
    const watching = watchedVideoParticipants.has(id);
    if (watching) {
      watchedVideoParticipants.delete(id);
      setParticipantVideoSubscribed(id, false);
      setParticipantStreamAudioSubscribed(id, false);
      pendingStreamAudioPlay.delete(id);
    } else {
      watchedVideoParticipants.add(id);
      setParticipantVideoSubscribed(id, true);
      setParticipantStreamAudioSubscribed(id, true);
      pendingStreamAudioPlay.add(id);
      kickStreamAudioPlayback(id);
    }
    updateParticipantWatchControls(id);
    reconcileParticipantAudioAssignments(id);
    try {
      const list = participantAudioTracks.get(id);
      const tracks = list ? Array.from(list.values()) : [];
      logInfo('[watch] audio tracks', {
        participantId: id,
        watched: watchedVideoParticipants.has(id),
        count: tracks.length,
        tracks: tracks.map(t => ({
          sid: t.track?.sid,
          channelCount: t.channelCount,
          source: t.source,
          name: t.track?.name || '',
          label: t.track?.mediaStreamTrack?.label || ''
        }))
      });
    } catch (e) {}
    logVideoSubscriptions('list click');
  };

  volumeWrap.appendChild(meter);
  volumeWrap.appendChild(slider);

  streamVolumeWrap.appendChild(streamMeter);
  streamVolumeWrap.appendChild(streamSlider);

  micControls.appendChild(muteBtn);
  micControls.appendChild(volumeWrap);
  streamControls.appendChild(streamMuteBtn);
  streamControls.appendChild(streamVolumeWrap);

  controls.appendChild(watchBtn);
  controls.appendChild(micControls);
  controls.appendChild(streamControls);

  row.appendChild(meta);
  row.appendChild(controls);
  container.appendChild(row);
  participantsList.appendChild(container);
  participantListAudioControls.set(id, { muteBtn, slider });
  participantWatchControls.set(id, { watchBtn, watchIcon });
  participantMeters.set(id, { el: meter });
  participantStreamAudioControls.set(id, { row: streamControls, muteBtn: streamMuteBtn, slider: streamSlider });
  participantStreamMeters.set(id, { el: streamMeter });
  updateAudioControlsForParticipant(id);
  updateStreamAudioControlsForParticipant(id);
  updateConnectionQualityIndicator(id, participantQuality.get(id));
  updateParticipantWatchControls(id);
}

function addParticipant(p) {
  try {
    const id = p.identity || p.sid || Math.random().toString(36).slice(2,7);
    const name = getDisplayNameForId(id, p.identity || p.name || `participant-${id}`);
    participantsById.set(id, p);

    // consolidate any existing entries created for track SIDs that belong to this participant
    try {
      const children = Array.from(participantsList ? participantsList.children : []);
      children.forEach(child => {
        const elId = child.id && child.id.startsWith('participant-') ? child.id.slice('participant-'.length) : null;
        if (!elId || elId === id) return;
        // check if this elId corresponds to a track SID owned by participant p
        try {
          if (p.tracks) {
            // p.tracks might be a Map or an array-like; handle both
            const iter = typeof p.tracks.forEach === 'function' ? p.tracks : Object.values(p.tracks || {});
            iter.forEach && iter.forEach(pub => {
              try {
                if (pub && pub.track && pub.track.sid === elId) {
                  // update track->participant mapping so any analysers will map to this participant
                  try { trackToParticipant.set(pub.track.sid, id); } catch (e) {}
                  // if child is a temporary track-based entry, remove it; we'll create canonical entry below
                  if (child.dataset && child.dataset.temp === 'true') {
                    child.remove();
                  } else {
                    // otherwise rename the element to canonical id
                    renameParticipantEntry(elId, id, name);
                  }
                }
              } catch (e) {}
            });
          }
        } catch (e) {}
      });
    } catch (e) {}

    createParticipantEntry(id, name);
    updateParticipantListName(id, name);
    updateParticipantStreamInfo(p);
    updateParticipantMutedFromPublications(p);
    updateStreamNameLabel(id);
    updateParticipantWatchControls(id);
    wireParticipantMuteListeners(p);
  } catch (e) {}
}

function renameParticipantEntry(oldId, newId, newDisplayName) {
  if (!participantsList) return;
  const oldEl = document.getElementById(`participant-${oldId}`);
  if (!oldEl) return;
  // if a newId entry already exists, remove the old one
  const newEl = document.getElementById(`participant-${newId}`);
  if (newEl) {
    oldEl.remove();
    return;
  }
  // rename element id
  oldEl.id = `participant-${newId}`;
  // update name span text
  const nameSpan = oldEl.querySelector('.participant-name');
  if (nameSpan) nameSpan.textContent = getDisplayNameForId(newId, newDisplayName || nameSpan.textContent);
  const row = oldEl.querySelector('.participant-row');
  if (row) row.dataset.participantId = newId;
  if (participantListAudioControls.has(oldId)) {
    participantListAudioControls.set(newId, participantListAudioControls.get(oldId));
    participantListAudioControls.delete(oldId);
  }
  if (participantWatchControls.has(oldId)) {
    participantWatchControls.set(newId, participantWatchControls.get(oldId));
    participantWatchControls.delete(oldId);
  }
  if (participantStreamAudioControls.has(oldId)) {
    participantStreamAudioControls.set(newId, participantStreamAudioControls.get(oldId));
    participantStreamAudioControls.delete(oldId);
  }
  if (participantStreamAudioSettings.has(oldId)) {
    participantStreamAudioSettings.set(newId, participantStreamAudioSettings.get(oldId));
    participantStreamAudioSettings.delete(oldId);
  }
  if (participantMicMuted.has(oldId)) {
    participantMicMuted.set(newId, participantMicMuted.get(oldId));
    participantMicMuted.delete(oldId);
  }
  if (participantAudioSettings.has(oldId)) {
    participantAudioSettings.set(newId, participantAudioSettings.get(oldId));
    participantAudioSettings.delete(oldId);
    saveParticipantAudioSettings();
  }
  if (participantMeters.has(oldId)) {
    participantMeters.set(newId, participantMeters.get(oldId));
    participantMeters.delete(oldId);
  }
  if (participantAnalyzers.has(oldId)) {
    participantAnalyzers.set(newId, participantAnalyzers.get(oldId));
    participantAnalyzers.delete(oldId);
  }
  if (participantMeterRaf.has(oldId)) {
    participantMeterRaf.set(newId, participantMeterRaf.get(oldId));
    participantMeterRaf.delete(oldId);
  }
}

function removeParticipant(p) {
  try {
    const candidates = [];
    if (p && p.identity) candidates.push(p.identity);
    if (p && p.sid) candidates.push(p.sid);
    if (p && p.name) candidates.push(p.name);
    // also try to match any element whose id includes the identity or sid
    const children = Array.from(participantsList ? participantsList.children : []);
    children.forEach(child => {
      const elId = child.id && child.id.startsWith('participant-') ? child.id.slice('participant-'.length) : null;
      if (elId && candidates.includes(elId)) {
        try {
          participantAudioEls.delete(elId);
          participantAudioControls.delete(elId);
          participantListAudioControls.delete(elId);
          participantWatchControls.delete(elId);
          participantStreamAudioControls.delete(elId);
          participantStreamInfo.delete(elId);
          participantQuality.delete(elId);
          participantMicMuted.delete(elId);
          participantsById.delete(elId);
          watchedVideoParticipants.delete(elId);
          participantStreamAudioEls.delete(elId);
          if (participantAudioSettings.has(elId)) {
            participantAudioSettings.delete(elId);
            saveParticipantAudioSettings();
          }
          participantStreamAudioSettings.delete(elId);
          participantVideoPubs.delete(elId);
          disconnectParticipantMeter(elId);
        } catch (e) {}
        child.remove();
      }
    });
    candidates.forEach(id => {
      const tiles = streamsDiv.querySelectorAll(`[data-participant-id="${id}"]`);
      tiles.forEach(tile => tile.remove());
    });
  } catch (e) {}
}

function resolveParticipantIdForTrack(track) {
  try {
    if (!room || !room.participants) return null;
    if (typeof room.participants.forEach === 'function') {
      let found = null;
      room.participants.forEach(p => {
        try {
          p.tracks && p.tracks.forEach(pub => {
            if (pub.track && pub.track.sid === track.sid) found = p.identity || p.sid;
          });
        } catch(e){}
      });
      return found;
    }
  } catch (e) { }
  return null;
}








