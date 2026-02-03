/* ---------- MUTE MIC ---------- */
muteMicBtn.onclick = () => {
  const muted = !micMuted;
  setMicMuteState(muted);
  saveSettings();
};

/* ---------- MIC PROCESSING ---------- */
if (echoCancelBtn) echoCancelBtn.onclick = async () => {
  const prev = micProcessing.echoCancellation;
  micProcessing.echoCancellation = !prev;
  updateMicProcessingButtons();
  const ok = await restartMicTrack();
  if (!ok) {
    micProcessing.echoCancellation = prev;
    updateMicProcessingButtons();
    console.warn('[mic] echo cancellation update failed; reverted');
  }
};
if (noiseSuppressBtn) noiseSuppressBtn.onclick = async () => {
  const prev = micProcessing.noiseSuppression;
  micProcessing.noiseSuppression = !prev;
  updateMicProcessingButtons();
  const ok = await restartMicTrack();
  if (!ok) {
    micProcessing.noiseSuppression = prev;
    updateMicProcessingButtons();
    console.warn('[mic] noise suppression update failed; reverted');
  }
};
if (noiseGateBtn) noiseGateBtn.onclick = async () => {
  const prev = micProcessing.noiseGateEnabled;
  micProcessing.noiseGateEnabled = !prev;
  updateMicProcessingButtons();
  saveSettings();
  const ok = await restartMicTrack();
  if (!ok) {
    micProcessing.noiseGateEnabled = prev;
    updateMicProcessingButtons();
    saveSettings();
    console.warn('[mic] noise gate update failed; reverted');
  }
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
  const prev = micProcessing.enhancedVoiceEnabled;
  micProcessing.enhancedVoiceEnabled = !prev;
  updateMicProcessingButtons();
  saveSettings();
  const ok = await restartMicTrack();
  if (!ok) {
    micProcessing.enhancedVoiceEnabled = prev;
    updateMicProcessingButtons();
    saveSettings();
    console.warn('[mic] enhanced voice update failed; reverted');
  }
};
if (autoGainBtn) autoGainBtn.onclick = async () => {
  const prev = micProcessing.autoGainControl;
  micProcessing.autoGainControl = !prev;
  updateMicProcessingButtons();
  const ok = await restartMicTrack();
  if (!ok) {
    micProcessing.autoGainControl = prev;
    updateMicProcessingButtons();
    console.warn('[mic] auto gain update failed; reverted');
  }
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

