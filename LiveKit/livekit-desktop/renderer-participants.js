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








