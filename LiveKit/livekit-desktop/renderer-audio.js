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

