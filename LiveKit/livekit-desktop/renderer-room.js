const roomLogic = window.TheCordLogic || {};
const SCREEN_STALL_TIMEOUT_MS = 4000;
const SCREEN_WARMUP_TIMEOUT_MS = 300;
const SCREEN_STALL_MESSAGE = 'Screen share stalled. Click Stop Stream then Start Stream to restart.';
const SYSTEM_AUDIO_WARNING_MESSAGE = 'System audio unavailable; streaming video only.';
let screenHealthTimer = null;
let screenHealthWarningActive = false;
let systemAudioWarningActive = false;
let micSubscriptionSweepTimer = null;

function stopMicSubscriptionSweep() {
  if (!micSubscriptionSweepTimer) return;
  clearInterval(micSubscriptionSweepTimer);
  micSubscriptionSweepTimer = null;
}

function ensureAllRemoteMicsSubscribed(reason = '') {
  try {
    if (!room || room.state !== 'connected') return false;
    let did = false;
    if (room.remoteParticipants) {
      const vals = typeof room.remoteParticipants.values === 'function'
        ? Array.from(room.remoteParticipants.values())
        : (Array.isArray(room.remoteParticipants) ? room.remoteParticipants : []);
      vals.forEach(p => {
        const id = p?.identity || p?.sid;
        if (!id) return;
        if (typeof ensureParticipantMicSubscribed === 'function') {
          if (ensureParticipantMicSubscribed(id)) did = true;
        }
      });
    }
    return did;
  } catch (e) {}
  return false;
}

function startMicSubscriptionSweep(reason = '') {
  if (micSubscriptionSweepTimer) return;
  let attempts = 0;
  micSubscriptionSweepTimer = setInterval(() => {
    attempts += 1;
    const did = ensureAllRemoteMicsSubscribed(reason);
    if (did || attempts >= 6 || !room || room.state !== 'connected') {
      stopMicSubscriptionSweep();
    }
  }, 800);
}

function clearScreenHealthTimer() {
  if (screenHealthTimer) {
    clearTimeout(screenHealthTimer);
    screenHealthTimer = null;
  }
}

function clearScreenHealthWarning() {
  if (!screenHealthWarningActive) return;
  try {
    if (typeof errorBanner !== 'undefined' && errorBanner?.textContent === SCREEN_STALL_MESSAGE) {
      setErrorBanner('');
    }
  } catch (e) {}
  screenHealthWarningActive = false;
  if (systemAudioWarningActive) {
    setSystemAudioWarning(true);
  }
}

function setScreenHealthWarning(active) {
  if (active) {
    try {
      if (typeof errorBanner !== 'undefined'
        && errorBanner?.textContent
        && errorBanner.textContent !== SCREEN_STALL_MESSAGE
        && errorBanner.textContent !== SYSTEM_AUDIO_WARNING_MESSAGE) {
        return;
      }
    } catch (e) {}
    screenHealthWarningActive = true;
    setErrorBanner(SCREEN_STALL_MESSAGE);
    return;
  }
  clearScreenHealthWarning();
}

function clearSystemAudioWarning() {
  if (!systemAudioWarningActive) return;
  try {
    if (typeof errorBanner !== 'undefined' && errorBanner?.textContent === SYSTEM_AUDIO_WARNING_MESSAGE) {
      setErrorBanner('');
    }
  } catch (e) {}
  systemAudioWarningActive = false;
}

function setSystemAudioWarning(active) {
  if (active) {
    try {
      if (typeof errorBanner !== 'undefined' && errorBanner?.textContent && errorBanner.textContent !== SYSTEM_AUDIO_WARNING_MESSAGE) {
        return;
      }
    } catch (e) {}
    systemAudioWarningActive = true;
    setErrorBanner(SYSTEM_AUDIO_WARNING_MESSAGE);
    return;
  }
  clearSystemAudioWarning();
}

function scheduleScreenHealthCheck(track) {
  clearScreenHealthTimer();
  screenHealthTimer = setTimeout(() => {
    screenHealthTimer = null;
    try {
      if (!isStreaming) return;
      if (!screenVideoTrack || screenVideoTrack.mediaStreamTrack !== track) return;
      if (track?.readyState !== 'live' || track?.muted) {
        setScreenHealthWarning(true);
      }
    } catch (e) {}
  }, SCREEN_STALL_TIMEOUT_MS);
}

function handleScreenVideoTrackEnded(track) {
  try {
    if (!isStreaming) return;
    if (!screenVideoTrack || screenVideoTrack.mediaStreamTrack !== track) return;
  } catch (e) {}
  clearScreenHealthTimer();
  clearScreenHealthWarning();
  stopStreaming().catch(e => console.warn('[stream] stopStreaming after track end failed', e));
}

async function stopScreenAudioOnly(reason) {
  if (!screenAudioTrack) return;
  const track = screenAudioTrack;
  screenAudioTrack = null;
  try {
    if (room?.localParticipant?.unpublishTrack) {
      await room.localParticipant.unpublishTrack(track);
    }
  } catch (e) {
    console.warn('[stream] unpublish screen audio failed', e);
  }
  try { track.stop(); } catch (e) {}
  try { detachTrack(track); } catch (e) {}
  unregisterLocalTrack('screenAudio', track);
  muteSystemBtn.disabled = true;
  muteSystemBtn.style.display = 'none';
  if (isStreaming) setSystemAudioWarning(true);
  if (reason) {
    logInfo('[stream] screen audio stopped', { reason });
  }
}

function wireScreenTrackEvents(track) {
  try {
    const mediaTrack = track?.mediaStreamTrack;
    if (!mediaTrack) return;
    mediaTrack.onended = () => {
      console.warn('[stream] screen video track ended', {
        readyState: mediaTrack.readyState,
        label: mediaTrack.label
      });
      handleScreenVideoTrackEnded(mediaTrack);
    };
    mediaTrack.onmute = () => {
      logInfo('[stream] screen video track muted', { readyState: mediaTrack.readyState });
      scheduleScreenHealthCheck(mediaTrack);
    };
    mediaTrack.onunmute = () => {
      logInfo('[stream] screen video track unmuted', { readyState: mediaTrack.readyState });
      clearScreenHealthTimer();
      clearScreenHealthWarning();
    };
  } catch (e) {}
}

function wireScreenAudioEvents(track) {
  try {
    const mediaTrack = track?.mediaStreamTrack;
    if (!mediaTrack) return;
    mediaTrack.onended = () => {
      console.warn('[stream] screen audio track ended', {
        readyState: mediaTrack.readyState,
        label: mediaTrack.label
      });
      stopScreenAudioOnly('track ended').catch(e => console.warn('[stream] stop screen audio failed', e));
    };
    mediaTrack.onmute = () => {
      logInfo('[stream] screen audio track muted', { readyState: mediaTrack.readyState });
    };
    mediaTrack.onunmute = () => {
      logInfo('[stream] screen audio track unmuted', { readyState: mediaTrack.readyState });
    };
  } catch (e) {}
}

function getLocalScreenVideoPublication() {
  try {
    const participant = room?.localParticipant;
    if (!participant) return null;
    const pubs = participant.videoTrackPublications
      ? Array.from(participant.videoTrackPublications.values ? participant.videoTrackPublications.values() : participant.videoTrackPublications)
      : [];
    let pub = pubs.find(p => p?.track === screenVideoTrack);
    if (!pub) {
      pub = pubs.find(p => {
        const rawSource = p?.source ?? p?.track?.source;
        if (rawSource === LiveKit?.Track?.Source?.ScreenShare) return true;
        if (typeof rawSource === 'string' && rawSource.toLowerCase().includes('screen')) return true;
        const name = (p?.trackName || p?.name || p?.track?.name || '').toLowerCase();
        return name.includes('screen');
      });
    }
    if (pub) return pub;
    try {
      if (LiveKit?.Track?.Source?.ScreenShare != null && participant.getTrackPublication) {
        return participant.getTrackPublication(LiveKit.Track.Source.ScreenShare) || null;
      }
    } catch (e) {}
  } catch (e) {}
  return null;
}

function getLocalScreenAudioPublication() {
  try {
    const participant = room?.localParticipant;
    if (!participant) return null;
    const pubs = participant.audioTrackPublications
      ? Array.from(participant.audioTrackPublications.values ? participant.audioTrackPublications.values() : participant.audioTrackPublications)
      : [];
    let pub = pubs.find(p => p?.track === screenAudioTrack);
    if (!pub) {
      pub = pubs.find(p => {
        const rawSource = p?.source ?? p?.track?.source;
        if (rawSource === LiveKit?.Track?.Source?.ScreenShareAudio) return true;
        if (typeof rawSource === 'string' && rawSource.toLowerCase().includes('screen')) return true;
        const name = (p?.trackName || p?.name || p?.track?.name || '').toLowerCase();
        return name.includes('system') || name.includes('screen');
      });
    }
    if (pub) return pub;
    try {
      if (LiveKit?.Track?.Source?.ScreenShareAudio != null && participant.getTrackPublication) {
        return participant.getTrackPublication(LiveKit.Track.Source.ScreenShareAudio) || null;
      }
    } catch (e) {}
  } catch (e) {}
  return null;
}

async function handleScreenShareReconnect() {
  try {
    if (!isStreaming || !screenVideoTrack || !room?.localParticipant) return;
    screenSenderConfigured = false;
    screenSenderConfigInFlight = false;
    clearScreenHealthWarning();
    let screenPub = getLocalScreenVideoPublication();
    if (!screenPub) {
      const height = screenVideoTrack.mediaStreamTrack?.getSettings?.()?.height;
      const simulcastLayers = getScreenSimulcastLayers(height);
      const bitrate = desiredScreenMaxBitrate || Number(bitrateInput.value) * 1000;
      const fps = desiredScreenMaxFramerate || getSelectedFps();
      try {
        screenPub = await room.localParticipant.publishTrack(screenVideoTrack, {
          simulcast: simulcastLayers.length > 0,
          source: LiveKit.Track.Source.ScreenShare,
          videoEncoding: { maxBitrate: bitrate, maxFramerate: fps },
          videoSimulcastLayers: simulcastLayers.length > 0 ? simulcastLayers : undefined,
          videoCodec: 'vp8'
        });
        logInfo('[stream] republished screen video after reconnect', {
          pubSid: screenPub?.trackSid,
          trackSid: screenVideoTrack?.sid
        });
      } catch (e) {
        console.warn('[stream] republish screen video failed after reconnect', e);
        setErrorBanner('Screen share lost during reconnect. Click Start Stream to resume.');
        await stopStreaming();
        return;
      }
    }
    if (screenPub) {
      configureScreenSender(screenPub?.sender);
      waitForScreenSender(screenPub, 'Screen share');
    }
    if (screenAudioTrack) {
      const audioPub = getLocalScreenAudioPublication();
      if (!audioPub) {
        const screenAudioOpts = {};
        try {
          if (LiveKit?.Track?.Source?.ScreenShareAudio != null) {
            screenAudioOpts.source = LiveKit.Track.Source.ScreenShareAudio;
          }
        } catch (e) {}
        try {
          await room.localParticipant.publishTrack(screenAudioTrack, screenAudioOpts);
          clearSystemAudioWarning();
          muteSystemBtn.disabled = false;
          muteSystemBtn.style.display = '';
          logInfo('[stream] republished screen audio after reconnect');
        } catch (e) {
          console.warn('[stream] republish screen audio failed after reconnect', e);
          await stopScreenAudioOnly('reconnect publish failed');
        }
      }
    }
  } catch (e) {
    console.warn('[stream] handleScreenShareReconnect failed', e);
  }
}

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
  resetReconnectAttempts();
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
  const activeRoom = room;
  const withActiveRoom = (handler) => (...args) => {
    if (room !== activeRoom) return;
    return handler(...args);
  };

  room.on(LiveKit.RoomEvent.Reconnecting, withActiveRoom(() => {
    setReconnectBanner(true);
  }));
  room.on(LiveKit.RoomEvent.Reconnected, withActiveRoom(() => {
    setReconnectBanner(false);
    resetReconnectAttempts();
    startPingMonitor();
    startAudioLevelMonitor();
    handleScreenShareReconnect().catch(e => console.warn('[stream] reconnect handler failed', e));
    if (typeof ensureMicTrackPublished === 'function') {
      ensureMicTrackPublished('reconnected').catch(e => console.warn('[mic] reconnect recovery failed', e));
    }
    startMicSubscriptionSweep('reconnected');
  }));
  room.on(LiveKit.RoomEvent.Disconnected, withActiveRoom(() => {
    setReconnectBanner(false);
    setJoinButtonState(false);
    stopPingMonitor();
    stopAudioLevelMonitor();
    if (!manualDisconnect) scheduleAutoRejoin();
  }));

  try {
    debug('Connecting to LiveKit...');
    const url = (serverUrlInput && serverUrlInput.value.trim()) ? serverUrlInput.value.trim() : LIVEKIT_URL;
    let connectTimeoutId = null;
    try {
      const connectPromise = room.connect(url, token);
      const timeoutPromise = new Promise((_, reject) => {
        connectTimeoutId = setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });
      await Promise.race([connectPromise, timeoutPromise]);
    } finally {
      if (connectTimeoutId) clearTimeout(connectTimeoutId);
    }
    debug('Connected to LiveKit:', room?.localParticipant?.identity);
  } catch (e) {
    console.warn('LiveKit connect error', e);
    setConnectionStatus('Connection failed');
    setErrorBanner('Connection failed. Check server URL and token.');
    manualDisconnect = true;
    lastJoinToken = '';
    resetReconnectAttempts();
    if (autoRejoinTimer) { clearTimeout(autoRejoinTimer); autoRejoinTimer = null; }
    setJoinButtonState(false);
    if (joinBtn) joinBtn.disabled = false;
    return;
  }
  resetReconnectAttempts();
  try { renderConnectionStatus(); } catch (e) {}
  setJoinButtonState(true);
  if (joinBtn) joinBtn.disabled = false;
  setErrorBanner('');
  playUiTone(520, 140);
  startPingMonitor();
  startAudioLevelMonitor();
  
  refreshRoomPreview();
  if (roomAccessSection) roomAccessSection.classList.add('collapsed');
  connectChatSocket();
  addParticipant(room.localParticipant);

  // Publish microphone (with processing controls)
  const micOk = await restartMicTrack();
  if (!micOk) {
    console.warn('[mic] failed to start microphone');
  }
  setMicMuteState(micMuted);
  if (micMuted) startMuteBroadcast();
  try {
    if (room?.localParticipant?.publishData) {
      const payload = JSON.stringify({ type: 'mic_mute', muted: !!micMuted });
      room.localParticipant.publishData(new TextEncoder().encode(payload), { reliable: true });
    }
  } catch (e) {
    console.warn('[mic] failed to broadcast mute state', e);
  }
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
  room.on(LiveKit.RoomEvent.TrackSubscribed, withActiveRoom((track, publication, participant) => {
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
          if (isStreamAudioPublication(publication)) {
            // Prevent any brief playback before classification for stream audio.
            try { track.mediaStreamTrack.enabled = false; } catch (e) {}
          }
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
  }));
  room.on(LiveKit.RoomEvent.TrackUnsubscribed, withActiveRoom((track, publication, participant) => {
    try {
      if (track?.sid) {
        trackSourceBySid.delete(track.sid);
      }
      if (track?.kind === 'video') {
        logInfo('[video] unsubscribed', { trackSid: track?.sid });
      }
    } catch (e) {}
    const pid = participant?.identity || participant?.sid || null;
    detachTrack(track, pid);
  }));
  room.on(LiveKit.RoomEvent.TrackMuted, withActiveRoom((publication, participant) => {
    try {
      if (!participant || !publication) return;
      if ((publication.kind || publication.track?.kind) !== 'audio') return;
      if (isScreenShareAudioStrict(publication?.track || {}, publication?.source)) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      setParticipantMutedVisual(id, true);
    } catch (e) {}
  }));
  room.on(LiveKit.RoomEvent.TrackUnmuted, withActiveRoom((publication, participant) => {
    try {
      if (!participant || !publication) return;
      if ((publication.kind || publication.track?.kind) !== 'audio') return;
      if (isScreenShareAudioStrict(publication?.track || {}, publication?.source)) return;
      const id = participant.identity || participant.sid;
      if (!id) return;
      setParticipantMutedVisual(id, false);
    } catch (e) {}
  }));
  room.on(LiveKit.RoomEvent.TrackPublished, withActiveRoom((publication, participant) => {
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
        const isStreamAudio = isStreamAudioPublication(publication);
        if (typeof publication.setSubscribed === 'function') {
          publication.setSubscribed(isStreamAudio ? watchedVideoParticipants.has(id) : true);
        }
        if (!isStreamAudio) {
          setParticipantMutedVisual(id, getPublicationMuted(publication));
        }
        if (isStreamAudio && !watchedVideoParticipants.has(id) && publication?.track) {
          detachTrack(publication.track, id);
        }
        if (publication?.track) {
          const shouldAttach = !isStreamAudio || watchedVideoParticipants.has(id);
          if (shouldAttach) {
            try { trackToParticipant.set(publication.track.sid, id); } catch (e) {}
            attachTrack(publication.track);
          }
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
  }));
  room.on(LiveKit.RoomEvent.TrackUnpublished, withActiveRoom((publication, participant) => {
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
  }));
  room.on(LiveKit.RoomEvent.ParticipantAttributesChanged, withActiveRoom((changed, participant) => {
    try {
      updateParticipantStreamInfo(participant);
      updateParticipantMutedFromPublications(participant);
    } catch (e) {}
  }));
  room.on(LiveKit.RoomEvent.DataReceived, withActiveRoom((payload, participant) => {
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
        } catch (e) {
          console.warn('[mic] failed to respond to mute request', e);
        }
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
  }));

  room.on(LiveKit.RoomEvent.LocalTrackPublished, withActiveRoom((publication) => {
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
  }));

  // Participant join/leave
  room.on(LiveKit.RoomEvent.ParticipantConnected, withActiveRoom((p) => {
    try { wireParticipantMuteListeners(p); } catch (e) {}
    addParticipant(p);
    playUiTone(660, 120);
    try { renderConnectionStatus(); } catch(e){}
    refreshRoomPreview();
    startMicSubscriptionSweep('participant-connected');
  }));
  room.on(LiveKit.RoomEvent.ParticipantDisconnected, withActiveRoom((p) => {
    removeParticipant(p);
    playUiTone(440, 160);
    try { renderConnectionStatus(); } catch(e){}
    refreshRoomPreview();
  }));
  room.on(LiveKit.RoomEvent.ConnectionQualityChanged, withActiveRoom((quality, participant) => {
    try {
      const id = participant?.identity || participant?.sid || room?.localParticipant?.identity;
      if (!id) return;
      const mappedQuality = roomLogic.mapConnectionQuality
      ? roomLogic.mapConnectionQuality(quality)
      : ({
          excellent: 'excellent',
          good: 'good',
          poor: 'poor',
          unknown: 'unknown'
        }[quality] || 'unknown');
    participantQuality.set(id, mappedQuality);
    updateConnectionQualityIndicator(id, mappedQuality);
    } catch (e) {}
  }));

  // add existing participants (if any)
  function scanExistingParticipants() {
    try {
      if (room !== activeRoom) return;
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
                    const isStreamAudio = isStreamAudioPublication(pub);
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
                    const isStreamAudio = isStreamAudioPublication(pub);
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
  startMicSubscriptionSweep('post-join');

  updateUIOnConnect();
  try { renderConnectionStatus(); } catch(e){}
};

async function warmUpScreenCapture(track, timeoutMs = SCREEN_WARMUP_TIMEOUT_MS) {
  if (!track || track.readyState === 'ended') return;
  if (typeof window !== 'undefined' && window.__TEST_HOOKS__) return;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
  await new Promise(resolve => {
    let done = false;
    let video = null;
    const finish = () => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch (e) {}
      if (video) {
        try { video.onloadeddata = null; } catch (e) {}
        try { video.oncanplay = null; } catch (e) {}
        try { video.pause(); } catch (e) {}
        try { video.srcObject = null; } catch (e) {}
      }
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      if (typeof document === 'undefined' || typeof MediaStream === 'undefined') return;
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream([track]);
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => finish());
      } else {
        video.onloadeddata = () => finish();
        video.oncanplay = () => finish();
      }
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch (e) {}
  });
}

async function captureScreenStreamWithFallback(sourceId, w, h, fps) {
  const resolvedFps = Number.isFinite(fps) && fps > 0 ? fps : 1;
  const minFrameRate = Math.min(resolvedFps, 30);
  const constraintBundle = roomLogic.buildCaptureConstraints
    ? roomLogic.buildCaptureConstraints({
        sourceId,
        width: w,
        height: h,
        fps
      })
    : (() => {
        const baseVideo = {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
          minWidth: w,
          maxWidth: w,
          minHeight: h,
          maxHeight: h,
          minFrameRate,
          maxFrameRate: resolvedFps
        };
        const baseAudio = {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId
          }
        };
        return {
          videoMandatory: baseVideo,
          captureConstraints: {
            audio: { ...baseAudio },
            video: { mandatory: { ...baseVideo } }
          }
        };
      })();
  const baseVideo = constraintBundle.videoMandatory || {
    chromeMediaSource: "desktop",
    chromeMediaSourceId: sourceId,
    minWidth: w,
    maxWidth: w,
    minHeight: h,
    maxHeight: h,
    minFrameRate,
    maxFrameRate: resolvedFps
  };
  const baseAudio = constraintBundle.captureConstraints?.audio || {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId
    }
  };
  const noFrameCaps = roomLogic.stripFrameRateConstraints
    ? roomLogic.stripFrameRateConstraints(baseVideo)
    : (() => {
        const next = { ...baseVideo };
        delete next.minFrameRate;
        delete next.maxFrameRate;
        return next;
      })();
  const attempts = [
    {
      label: 'full constraints',
      constraints: { audio: { ...baseAudio }, video: { mandatory: { ...baseVideo } } }
    },
    {
      label: 'no frame caps',
      constraints: { audio: { ...baseAudio }, video: { mandatory: { ...noFrameCaps } } }
    },
    {
      label: 'relaxed size',
      constraints: {
        audio: { ...baseAudio },
        video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId } }
      }
    },
    {
      label: 'video only',
      constraints: {
        audio: false,
        video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId } }
      }
    }
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(attempt.constraints);
    } catch (e) {
      lastError = e;
      const name = e?.name || 'UnknownError';
      console.warn(`[stream] capture failed (${attempt.label})`, e);
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
        const hasAudio = attempt?.constraints?.audio !== false;
        const hasVideoOnlyFallback = attempts.some(a => a?.constraints?.audio === false);
        if (!hasAudio || !hasVideoOnlyFallback) {
          throw e;
        }
      }
    }
  }
  throw lastError || new Error('Screen capture failed');
}

/* ---------- START STREAM ---------- */
startBtn.onclick = async () => {
  if (isStreaming) {
    await stopStreaming();
    return;
  }
  clearScreenHealthTimer();
  clearScreenHealthWarning();
  clearSystemAudioWarning();
  const resolution = roomLogic.parseResolution
    ? roomLogic.parseResolution(resolutionSelect.value)
    : (() => {
        const parts = String(resolutionSelect.value || '').split('x');
        return { width: Number(parts[0]), height: Number(parts[1]) };
      })();
  const w = resolution.width;
  const h = resolution.height;
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
  if (sourceSelect && source.id && source.id !== selectedId) {
    sourceSelect.value = source.id;
    saveSettings();
  }

  // Capture screen video + system audio
  try {
    screenStream = await captureScreenStreamWithFallback(source.id, w, h, fps);
  } catch (e) {
    console.error('[stream] screen capture failed', e);
    return;
  }
  // Log actual capture settings (desktop capture may ignore constraints)
  try {
    const captureSettings = screenStream.getVideoTracks()[0]?.getSettings?.();
    debug('Screen capture settings:', captureSettings);
    currentStreamSettings = roomLogic.buildStreamSettings
      ? roomLogic.buildStreamSettings({
          captureSettings,
          fallbackWidth: w,
          fallbackHeight: h,
          fallbackFps: fps,
          bitrateBps: bitrate
        })
      : {
          res: `${captureSettings?.width || w}x${captureSettings?.height || h}`,
          fps: String(Math.round(captureSettings?.frameRate || fps)),
          maxKbps: String(Math.round(bitrate / 1000))
        };
    setLocalStreamAttributes({
      stream_resolution: currentStreamSettings.res,
      stream_fps: currentStreamSettings.fps,
      stream_max_bitrate_kbps: currentStreamSettings.maxKbps
    });
  } catch (e) {
    currentStreamSettings = roomLogic.buildStreamSettings
      ? roomLogic.buildStreamSettings({
          captureSettings: null,
          fallbackWidth: w,
          fallbackHeight: h,
          fallbackFps: fps,
          bitrateBps: bitrate
        })
      : {
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
  const screenVideoMediaTrack = screenStream.getVideoTracks()[0];
  if (!screenVideoMediaTrack) {
    console.warn('[stream] no video tracks available from capture stream');
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    setStreamStatus('');
    currentStreamSettings = { res: '', fps: '', maxKbps: '' };
    setLocalStreamAttributes({
      stream_resolution: '',
      stream_fps: '',
      stream_max_bitrate_kbps: ''
    });
    return;
  }
  await warmUpScreenCapture(screenVideoMediaTrack);
  screenVideoTrack = new LiveKit.LocalVideoTrack(screenVideoMediaTrack, { name: "screen" });
  registerLocalTrack('screenVideo', screenVideoTrack);
  try { screenVideoTrack.mediaStreamTrack.contentHint = 'motion'; } catch (e) {}
  wireScreenTrackEvents(screenVideoTrack);
  const simulcastLayers = getScreenSimulcastLayers(
    screenStream.getVideoTracks()[0]?.getSettings?.()?.height
  );
  logInfo('[stream] publishing screen video track', { trackSid: screenVideoTrack?.sid });
  let screenPub = null;
  try {
    screenPub = await room.localParticipant.publishTrack(screenVideoTrack, {
      simulcast: simulcastLayers.length > 0,
      source: LiveKit.Track.Source.ScreenShare,
      videoEncoding: { maxBitrate: bitrate, maxFramerate: fps },
      videoSimulcastLayers: simulcastLayers.length > 0 ? simulcastLayers : undefined,
      videoCodec: 'vp8'
    });
  } catch (e) {
    console.error('[stream] publish screen video failed', e);
    try { screenVideoTrack.stop(); } catch (err) {}
    try { detachTrack(screenVideoTrack); } catch (err) {}
    unregisterLocalTrack('screenVideo', screenVideoTrack);
    screenVideoTrack = null;
    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;
    setStreamStatus('');
    currentStreamSettings = { res: '', fps: '', maxKbps: '' };
    setLocalStreamAttributes({
      stream_resolution: '',
      stream_fps: '',
      stream_max_bitrate_kbps: ''
    });
    return;
  }
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
    registerLocalTrack('screenAudio', screenAudioTrack);
    wireScreenAudioEvents(screenAudioTrack);
    const screenAudioOpts = {};
    try {
      if (LiveKit?.Track?.Source?.ScreenShareAudio != null) {
        screenAudioOpts.source = LiveKit.Track.Source.ScreenShareAudio;
      }
    } catch (e) {}
    try {
      await room.localParticipant.publishTrack(screenAudioTrack, screenAudioOpts);
      clearSystemAudioWarning();
      // Enable system audio mute button after track is ready
      muteSystemBtn.disabled = false;
      muteSystemBtn.style.display = '';
    } catch (e) {
      console.warn('[stream] publish screen audio failed', e);
      try { screenAudioTrack.stop(); } catch (err) {}
      unregisterLocalTrack('screenAudio', screenAudioTrack);
      screenAudioTrack = null;
      setSystemAudioWarning(true);
    }
  } else {
    setSystemAudioWarning(true);
  }

  attachTrack(screenVideoTrack, true);

  setStreamButtonState(true);
};

/* ---------- STOP STREAM ---------- */
async function stopStreaming() {
  if (!isStreaming && !screenVideoTrack && !screenAudioTrack) return;
  const videoTrack = screenVideoTrack;
  const audioTrack = screenAudioTrack;
  screenVideoTrack = null;
  screenAudioTrack = null;
  if (videoTrack) {
    logInfo('[stream] unpublishing screen video track', { trackSid: videoTrack?.sid });
    try {
      if (room?.localParticipant?.unpublishTrack) {
        await room.localParticipant.unpublishTrack(videoTrack);
      }
    } catch (e) {
      console.warn('[stream] unpublish screen video failed (continuing)', e);
    }
    try {
      if (videoTrack.mediaStreamTrack) {
        videoTrack.mediaStreamTrack.onended = null;
        videoTrack.mediaStreamTrack.onmute = null;
        videoTrack.mediaStreamTrack.onunmute = null;
      }
    } catch (e) {}
    try { videoTrack.stop(); } catch (e) {}
    try { detachTrack(videoTrack); } catch (e) {}
    unregisterLocalTrack('screenVideo', videoTrack);
  }

  if (audioTrack) {
    try {
      if (room?.localParticipant?.unpublishTrack) {
        await room.localParticipant.unpublishTrack(audioTrack);
      }
    } catch (e) {
      console.warn('[stream] unpublish screen audio failed (continuing)', e);
    }
    try {
      if (audioTrack.mediaStreamTrack) {
        audioTrack.mediaStreamTrack.onended = null;
        audioTrack.mediaStreamTrack.onmute = null;
        audioTrack.mediaStreamTrack.onunmute = null;
      }
    } catch (e) {}
    try { audioTrack.stop(); } catch (e) {}
    try { detachTrack(audioTrack); } catch (e) {}
    unregisterLocalTrack('screenAudio', audioTrack);
  }

  screenStream?.getTracks().forEach(t => t.stop());
  screenStream = null;
  clearScreenHealthTimer();
  clearScreenHealthWarning();
  clearSystemAudioWarning();

  setStreamStatus('');
  currentStreamSettings = { res: '', fps: '', maxKbps: '' };
  setLocalStreamAttributes({
    stream_resolution: '',
    stream_fps: '',
    stream_max_bitrate_kbps: ''
  });
  screenSenderConfigured = false;
  screenSenderConfigInFlight = false;
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
  resetReconnectAttempts();
  setReconnectBanner(false);
  stopMicSubscriptionSweep();
  setStreamButtonState(false);
  clearScreenHealthTimer();
  clearScreenHealthWarning();
  clearSystemAudioWarning();
  if (typeof clearMicRecoveryState === 'function') clearMicRecoveryState();
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
    try { await room.localParticipant.unpublishTrack(screenVideoTrack); } catch (e) {
      console.warn('[stream] unpublish screen video failed (continuing)', e);
    }
    try { screenVideoTrack.stop(); } catch (e) {}
    unregisterLocalTrack('screenVideo', screenVideoTrack);
  }
  if (screenAudioTrack) {
    try { await room.localParticipant.unpublishTrack(screenAudioTrack); } catch (e) {
      console.warn('[stream] unpublish screen audio failed (continuing)', e);
    }
    try { screenAudioTrack.stop(); } catch (e) {}
    unregisterLocalTrack('screenAudio', screenAudioTrack);
  }
  if (micAudioTrack) {
    try { await room.localParticipant.unpublishTrack(micAudioTrack); } catch (e) {
      console.warn('[mic] unpublish failed (continuing)', e);
    }
    try { micAudioTrack.stop(); } catch (e) {}
    unregisterLocalTrack('mic', micAudioTrack);
  }

  stopMicGate();
  closeAudioContext();
  micStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  micStream = null;
  screenStream = null;
  micAudioTrack = null;
  screenVideoTrack = null;
  screenAudioTrack = null;
  clearLocalTrackRegistry();

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
  screenSenderConfigInFlight = false;
  stopSenderStatsLogging();
  // cleanup streams and participant UI + audio resources
  streamsDiv.innerHTML = "";
  if (minimizedStreams) minimizedStreams.innerHTML = "";
  minimizedTiles.clear();
  minimizedParticipants.clear();
  participantAudioEls.clear();
  participantAudioControls.clear();
  participantListAudioControls.clear();
  participantAudioTracks.clear();
  participantQuality.clear();
  trackToParticipant.clear();
  trackSourceBySid.clear();
  participantStreamInfo.clear();
  participantWatchControls.clear();
  participantsById.clear();
  watchedVideoParticipants.clear();
  participantVideoPubs.clear();
  participantStreamAudioEls.clear();
  participantStreamAudioControls.clear();
  participantStreamAudioSettings.clear();
  participantMeters.clear();
  participantStreamMeters.clear();
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
  playUiTone(360, 180);
  refreshRoomPreview();
  connectChatSocket();
  setMuteIncomingState(muteIncomingAll);
  if (muteIncomingBtn) muteIncomingBtn.disabled = false;
  if (roomAccessSection) roomAccessSection.classList.remove('collapsed');
}

if (window.__TEST_HOOKS__) {
  window.__TEST_HOOKS__.room = {
    startStreaming: () => startBtn.onclick(),
    stopStreaming,
    captureScreenStreamWithFallback,
    handleScreenShareReconnect,
    getScreenVideoTrack: () => screenVideoTrack,
    getScreenAudioTrack: () => screenAudioTrack,
    getScreenStream: () => screenStream,
    getCurrentStreamSettings: () => currentStreamSettings,
    isStreaming: () => isStreaming
  };
}


