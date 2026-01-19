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
              const sourceHint = trackSourceBySid.get(track.sid) || track?.source;
              const isStreamCandidate = isLikelyStreamAudioTrack(track, sourceHint);
              // Ensure reused audio elements start muted to avoid a burst for stream audio.
              if (isStreamCandidate) {
                mediaEl.muted = true;
                try { track.mediaStreamTrack.enabled = false; } catch (e) {}
              }
              registerRemoteAudioTrack(pid, track, mediaEl);
              if (!isStreamCandidate) {
                const entry = participantAudioSettings.get(pid);
                if (entry) applySavedAudioSettings(pid, mediaEl);
                else {
                  mediaEl.volume = 1;
                  mediaEl.muted = muteIncomingAll ? true : false;
                }
                try { track.mediaStreamTrack.enabled = true; } catch (e) {}
              }
            } else {
              mediaEl.muted = true;
              mediaEl.volume = 0;
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
    if (isLocal) {
      el.muted = true;
      el.volume = 0;
    }
    const sourceHint = trackSourceBySid.get(track.sid) || track?.source;
    const isStreamCandidate = !isLocal && isLikelyStreamAudioTrack(track, sourceHint);
    // Start muted only for stream audio to avoid a brief burst.
    if (isStreamCandidate) {
      el.muted = true;
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
          const sourceHint = trackSourceBySid.get(track.sid) || track?.source;
          const isStreamCandidate = isLikelyStreamAudioTrack(track, sourceHint);
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
          if (!isStreamCandidate) {
            const entry = participantAudioSettings.get(pid);
            if (entry) applySavedAudioSettings(pid, el);
            else {
              el.volume = 1;
              el.muted = muteIncomingAll ? true : false;
            }
            try { track.mediaStreamTrack.enabled = true; } catch (e) {}
          } else {
            try { track.mediaStreamTrack.enabled = false; } catch (e) {}
          }
        } else {
          el.muted = true;
          el.volume = 0;
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
      nameLabel.textContent = info ? `${displayName} | ${info}` : displayName;
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

