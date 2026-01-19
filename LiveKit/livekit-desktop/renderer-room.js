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
  });
  room.on(LiveKit.RoomEvent.TrackUnsubscribed, track => {
    try {
      if (track?.sid) {
        trackSourceBySid.delete(track.sid);
        trackToParticipant.delete(track.sid);
      }
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
        const isStreamAudio = isStreamAudioPublication(publication);
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
    playUiTone(660, 120);
    try { renderConnectionStatus(); } catch(e){}
    refreshRoomPreview();
  });
  room.on(LiveKit.RoomEvent.ParticipantDisconnected, p => {
    removeParticipant(p);
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
    try { await room.localParticipant.unpublishTrack(screenVideoTrack); } catch (e) {
      console.warn('[stream] unpublish screen video failed (continuing)', e);
    }
    try { screenVideoTrack.stop(); } catch (e) {}
  }
  if (screenAudioTrack) {
    try { await room.localParticipant.unpublishTrack(screenAudioTrack); } catch (e) {
      console.warn('[stream] unpublish screen audio failed (continuing)', e);
    }
    try { screenAudioTrack.stop(); } catch (e) {}
  }
  if (micAudioTrack) {
    try { await room.localParticipant.unpublishTrack(micAudioTrack); } catch (e) {
      console.warn('[mic] unpublish failed (continuing)', e);
    }
    try { micAudioTrack.stop(); } catch (e) {}
  }

  stopMicGate();
  micStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  micStream = null;
  screenStream = null;
  micAudioTrack = null;
  screenVideoTrack = null;
  screenAudioTrack = null;

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

