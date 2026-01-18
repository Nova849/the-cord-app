/* ---------- Restore JWT ---------- */
jwtInput.value = localStorage.getItem("livekit_jwt") || "";
setErrorBanner('');
if (!localStorage.getItem(settingsKey)) {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}
  loadSettings();
  applyServicesCollapsed(areServiceFieldsFilled());
  applyUpdateFeedUrl();
  window.electronAPI?.getAppVersion?.()
    .then((res) => setUpdateVersion(res?.ok ? res.version : ''))
    .catch(() => setUpdateVersion(''));
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
serverUrlInput?.addEventListener("input", () => {
  saveSettings();
  scheduleChatConnect();
  refreshRoomPreview();
});
chatServerInput?.addEventListener("input", () => {
  saveSettings();
  scheduleChatConnect();
});
presenceServerInput?.addEventListener("input", () => {
  saveSettings();
  refreshRoomPreview();
});
updateServerInput?.addEventListener("input", () => {
  saveSettings();
  applyUpdateFeedUrl();
});
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
servicesToggle?.addEventListener("click", () => {
  if (!servicesSection) return;
  const collapsed = servicesSection.classList.toggle('collapsed');
  servicesSection.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
});
forceUpdateBtn?.addEventListener("click", async () => {
  setUpdateStatus('Checking for updates...');
  setUpdateLastChecked(new Date());
  try {
    const res = await window.electronAPI?.checkForUpdates?.();
    if (!res) {
      setUpdateStatus('Update check unavailable.');
      return;
    }
    if (res.ok) {
      if (res.message) setUpdateStatus(res.message);
      return;
    }
    setUpdateStatus(res.message || 'Update check failed.');
  } catch (e) {
    setUpdateStatus('Update check failed.');
  }
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
window.electronAPI?.onUpdateStatus?.((message) => {
  setUpdateStatus(message || '');
  setUpdateLastChecked(new Date());
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

