import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');

let dom = null;

function createLiveKitStub() {
  let sidCounter = 0;
  class LocalTrack {
    constructor(mediaStreamTrack, opts) {
      this.mediaStreamTrack = mediaStreamTrack;
      this.name = opts?.name || '';
      this.sid = `track-${sidCounter += 1}`;
      this.kind = mediaStreamTrack?.kind || 'unknown';
      this.replaced = false;
    }
    stop() {
      this.stopped = true;
      try { this.mediaStreamTrack?.stop?.(); } catch (e) {}
    }
    async replaceTrack(nextTrack) {
      this.mediaStreamTrack = nextTrack;
      this.replaced = true;
    }
  }

  class LocalAudioTrack extends LocalTrack {
    constructor(mediaStreamTrack, opts) {
      super(mediaStreamTrack, opts);
      this.kind = 'audio';
    }
  }

  class LocalVideoTrack extends LocalTrack {
    constructor(mediaStreamTrack, opts) {
      super(mediaStreamTrack, opts);
      this.kind = 'video';
    }
  }

  class Room {
    constructor() {
      this.state = 'disconnected';
      this.localParticipant = null;
    }
    on() {}
    removeAllListeners() {}
  }

  const Track = {
    Source: {
      ScreenShare: 'screenshare',
      ScreenShareAudio: 'screenshareaudio',
      Microphone: 'microphone'
    }
  };

  const RoomEvent = {
    TrackSubscribed: 'TrackSubscribed',
    TrackUnsubscribed: 'TrackUnsubscribed',
    TrackMuted: 'TrackMuted',
    TrackUnmuted: 'TrackUnmuted',
    TrackPublished: 'TrackPublished',
    TrackUnpublished: 'TrackUnpublished',
    ParticipantConnected: 'ParticipantConnected',
    ParticipantDisconnected: 'ParticipantDisconnected',
    ConnectionQualityChanged: 'ConnectionQualityChanged',
    Reconnecting: 'Reconnecting',
    Reconnected: 'Reconnected',
    Disconnected: 'Disconnected',
    DataReceived: 'DataReceived',
    LocalTrackPublished: 'LocalTrackPublished',
    ParticipantAttributesChanged: 'ParticipantAttributesChanged'
  };

  return { LocalAudioTrack, LocalVideoTrack, Room, Track, RoomEvent };
}

class FakeParticipant {
  constructor() {
    this.identity = 'local-user';
    this.sid = 'local-sid';
    this.audioTrackPublications = new Map();
    this.videoTrackPublications = new Map();
    this.attributes = {};
    this.publishCalls = [];
    this.throwOnUnpublish = false;
  }

  async publishTrack(track, opts = {}) {
    this.publishCalls.push({ track, opts });
    const pub = {
      track,
      trackSid: `pub-${track.sid}`,
      source: opts.source,
      kind: track.kind,
      name: track.name,
      trackInfo: { layers: [] },
      sender: {
        getParameters: () => ({ encodings: [{}] }),
        setParameters: () => Promise.resolve(),
        getStats: () => Promise.resolve([])
      }
    };
    if (track.kind === 'audio') this.audioTrackPublications.set(pub.trackSid, pub);
    if (track.kind === 'video') this.videoTrackPublications.set(pub.trackSid, pub);
    return pub;
  }

  async unpublishTrack(track) {
    if (this.throwOnUnpublish) {
      throw new Error('unpublish failed');
    }
    for (const [sid, pub] of this.audioTrackPublications) {
      if (pub.track === track) this.audioTrackPublications.delete(sid);
    }
    for (const [sid, pub] of this.videoTrackPublications) {
      if (pub.track === track) this.videoTrackPublications.delete(sid);
    }
  }

  setAttributes(attrs) {
    this.attributes = { ...attrs };
    return Promise.resolve();
  }

  publishData() {}
}

class FakeMediaStream {
  constructor(tracks = []) {
    this._tracks = tracks;
  }
  getTracks() { return this._tracks; }
  getAudioTracks() { return this._tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return this._tracks.filter(t => t.kind === 'video'); }
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
  }
  resume() { return Promise.resolve(); }
  createMediaStreamSource() {
    return { connect() {}, disconnect() {} };
  }
  createBiquadFilter() {
    return { type: '', frequency: { value: 0 }, connect() {}, disconnect() {} };
  }
  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect() {},
      disconnect() {}
    };
  }
  createAnalyser() {
    return {
      fftSize: 0,
      connect() {},
      disconnect() {},
      getByteTimeDomainData(array) {
        array.fill(128);
      }
    };
  }
  createGain() {
    return {
      gain: { value: 1, setTargetAtTime() {} },
      connect() {},
      disconnect() {},
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    };
  }
  createMediaStreamDestination() {
    const track = makeTrack('audio', { channelCount: 1 }, 'processed');
    return { stream: new FakeMediaStream([track]) };
  }
}

function makeTrack(kind, settings = {}, label = '') {
  const track = {
    kind,
    label,
    enabled: true,
    muted: false,
    readyState: 'live',
    id: `${kind}-${Math.random().toString(16).slice(2)}`,
    getSettings: () => settings,
    stop: () => { track.stopped = true; track.readyState = 'ended'; }
  };
  return track;
}

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function loadScriptsCombined(window, files) {
  const combined = files.map((fileName) => {
    const filePath = path.resolve(appDir, fileName);
    return fs.readFileSync(filePath, 'utf8');
  }).join('\n');
  window.eval(combined);
}

function setupRenderer() {
  const html = fs.readFileSync(path.resolve(appDir, 'index.html'), 'utf8');
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost' });
  const { window } = dom;
  window.console = console;
  window.__TEST_HOOKS__ = {};
  window.LivekitClient = createLiveKitStub();
  window.electronAPI = {
    getSources: async () => [{ id: 'screen:1', name: 'Screen 1' }]
  };
  window.MediaStream = FakeMediaStream;
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
  window.navigator.mediaDevices = { getUserMedia: async () => new FakeMediaStream() };

  loadScriptsCombined(window, [
    'renderer-logic.js',
    'renderer-core.js',
    'renderer-participants.js',
    'renderer-tracks.js',
    'renderer-room.js'
  ]);

  return window;
}

beforeEach(() => {
  dom = null;
});

afterEach(() => {
  if (dom) {
    dom.window?.close();
    dom = null;
  }
});

describe('voice pipeline', () => {
  it('publishes mic track and respects mute state', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant });

    let capturedConstraints = null;
    window.navigator.mediaDevices.getUserMedia = async (constraints) => {
      capturedConstraints = constraints;
      const audioTrack = makeTrack('audio', { channelCount: 1 }, 'microphone');
      return new FakeMediaStream([audioTrack]);
    };

    const success = await window.__TEST_HOOKS__.core.restartMicTrack();

    expect(success).toBe(true);
    expect(capturedConstraints.audio.echoCancellation).toBe(true);
    expect(capturedConstraints.audio.noiseSuppression).toBe(true);
    expect(capturedConstraints.audio.autoGainControl).toBe(true);
    const micTrack = window.__TEST_HOOKS__.core.getMicTrack();
    expect(micTrack).toBeTruthy();
    expect(micTrack.mediaStreamTrack.enabled).toBe(true);
    expect(fakeParticipant.audioTrackPublications.size).toBe(1);

    micTrack.mediaStreamTrack.enabled = false;
    await window.__TEST_HOOKS__.core.restartMicTrack();
    const updatedMicTrack = window.__TEST_HOOKS__.core.getMicTrack();
    expect(updatedMicTrack.replaced).toBe(true);
    expect(updatedMicTrack.mediaStreamTrack.enabled).toBe(false);
    expect(fakeParticipant.audioTrackPublications.size).toBe(1);

    window.__TEST_HOOKS__.core.stopMicGate();
  });

  it('uses processed mic track when noise gate is enabled', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant });

    window.__TEST_HOOKS__.core.micProcessing.noiseGateEnabled = true;
    window.__TEST_HOOKS__.core.micProcessing.enhancedVoiceEnabled = true;

    window.navigator.mediaDevices.getUserMedia = async () => {
      const audioTrack = makeTrack('audio', { channelCount: 1 }, 'microphone');
      return new FakeMediaStream([audioTrack]);
    };

    const success = await window.__TEST_HOOKS__.core.restartMicTrack();
    expect(success).toBe(true);
    const processedTrack = window.__TEST_HOOKS__.core.getMicTrack();
    expect(processedTrack.mediaStreamTrack.label).toBe('processed');

    window.__TEST_HOOKS__.core.stopMicGate();
  });

  it('recovers mic track after media track ends', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

    let callCount = 0;
    window.navigator.mediaDevices.getUserMedia = async () => {
      callCount += 1;
      const audioTrack = makeTrack('audio', { channelCount: 1 }, 'microphone');
      return new FakeMediaStream([audioTrack]);
    };

    vi.useFakeTimers();
    try {
      const success = await window.__TEST_HOOKS__.core.restartMicTrack();
      expect(success).toBe(true);
      const micTrack = window.__TEST_HOOKS__.core.getMicTrack();
      micTrack.mediaStreamTrack.onended?.();
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
      expect(callCount).toBe(2);
    } finally {
      vi.useRealTimers();
      window.__TEST_HOOKS__.core.stopMicGate();
    }
  });

  it('keeps the newest mic restart from being overwritten by a stale one', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant });

    window.__TEST_HOOKS__.core.micProcessing.noiseGateEnabled = false;
    window.__TEST_HOOKS__.core.micProcessing.enhancedVoiceEnabled = false;

    const pending = [];
    window.navigator.mediaDevices.getUserMedia = async () => {
      const deferred = createDeferred();
      pending.push(deferred);
      return deferred.promise;
    };

    const first = window.__TEST_HOOKS__.core.restartMicTrack();
    const second = window.__TEST_HOOKS__.core.restartMicTrack();

    pending[1].resolve(new FakeMediaStream([makeTrack('audio', { channelCount: 1 }, 'second')]));
    await second;
    pending[0].resolve(new FakeMediaStream([makeTrack('audio', { channelCount: 1 }, 'first')]));
    await first;

    const micTrack = window.__TEST_HOOKS__.core.getMicTrack();
    expect(micTrack.mediaStreamTrack.label).toBe('second');
    expect(fakeParticipant.audioTrackPublications.size).toBe(1);
    expect(fakeParticipant.publishCalls.length).toBe(1);

    window.__TEST_HOOKS__.core.stopMicGate();
  });

  it('restarts mic when ensure detects an ended track', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

    window.__TEST_HOOKS__.core.micProcessing.noiseGateEnabled = false;
    window.__TEST_HOOKS__.core.micProcessing.enhancedVoiceEnabled = false;

    let callCount = 0;
    window.navigator.mediaDevices.getUserMedia = async () => {
      callCount += 1;
      const label = callCount === 1 ? 'first' : 'second';
      return new FakeMediaStream([makeTrack('audio', { channelCount: 1 }, label)]);
    };

    const started = await window.__TEST_HOOKS__.core.restartMicTrack();
    expect(started).toBe(true);
    const micTrack = window.__TEST_HOOKS__.core.getMicTrack();
    micTrack.mediaStreamTrack.readyState = 'ended';

    const ok = await window.__TEST_HOOKS__.core.ensureMicTrackPublished('test');
    expect(ok).toBe(true);
    const updated = window.__TEST_HOOKS__.core.getMicTrack();
    expect(updated.mediaStreamTrack.label).toBe('second');

    window.__TEST_HOOKS__.core.stopMicGate();
  });
});

describe('screen share pipeline', () => {
  it('starts and stops screen share with system audio', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

    const originalWarn = window.console.warn;
    window.console.warn = () => {};

    let callCount = 0;
    window.navigator.mediaDevices.getUserMedia = async () => {
      callCount += 1;
      if (callCount === 1) {
        const err = new Error('Overconstrained');
        err.name = 'OverconstrainedError';
        throw err;
      }
      const videoTrack = makeTrack('video', { width: 1920, height: 1080, frameRate: 60 }, 'screen');
      const audioTrack = makeTrack('audio', { channelCount: 2 }, 'system');
      return new FakeMediaStream([videoTrack, audioTrack]);
    };

    await window.__TEST_HOOKS__.room.startStreaming();

    expect(window.__TEST_HOOKS__.room.isStreaming()).toBe(true);
    expect(window.__TEST_HOOKS__.room.getScreenVideoTrack()).toBeTruthy();
    expect(window.__TEST_HOOKS__.room.getScreenAudioTrack()).toBeTruthy();
    const streamSettings = window.__TEST_HOOKS__.room.getCurrentStreamSettings();
    expect(streamSettings.res).toBe('1920x1080');
    expect(streamSettings.fps).toBe('60');
    expect(window.__TEST_HOOKS__.core.muteSystemBtn.disabled).toBe(false);
    expect(window.__TEST_HOOKS__.core.muteSystemBtn.style.display).toBe('');

    await window.__TEST_HOOKS__.room.stopStreaming();

    expect(window.__TEST_HOOKS__.room.isStreaming()).toBe(false);
    expect(window.__TEST_HOOKS__.room.getScreenVideoTrack()).toBe(null);
    expect(window.__TEST_HOOKS__.room.getScreenAudioTrack()).toBe(null);
    expect(window.__TEST_HOOKS__.core.muteSystemBtn.disabled).toBe(true);

    window.console.warn = originalWarn;
  });

  it('stops screen share when screen video track ends', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

    window.navigator.mediaDevices.getUserMedia = async () => {
      const videoTrack = makeTrack('video', { width: 1280, height: 720, frameRate: 30 }, 'screen');
      const audioTrack = makeTrack('audio', { channelCount: 2 }, 'system');
      return new FakeMediaStream([videoTrack, audioTrack]);
    };

    await window.__TEST_HOOKS__.room.startStreaming();

    const mediaTrack = window.__TEST_HOOKS__.room.getScreenVideoTrack().mediaStreamTrack;
    mediaTrack.onended?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(window.__TEST_HOOKS__.room.isStreaming()).toBe(false);
    expect(window.__TEST_HOOKS__.room.getScreenVideoTrack()).toBe(null);
  });

  it('cleans up even if screen unpublish fails', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

    window.navigator.mediaDevices.getUserMedia = async () => {
      const videoTrack = makeTrack('video', { width: 1280, height: 720, frameRate: 30 }, 'screen');
      const audioTrack = makeTrack('audio', { channelCount: 2 }, 'system');
      return new FakeMediaStream([videoTrack, audioTrack]);
    };

    await window.__TEST_HOOKS__.room.startStreaming();
    fakeParticipant.throwOnUnpublish = true;

    await window.__TEST_HOOKS__.room.stopStreaming();

    expect(window.__TEST_HOOKS__.room.isStreaming()).toBe(false);
    expect(window.__TEST_HOOKS__.room.getScreenVideoTrack()).toBe(null);
    expect(window.__TEST_HOOKS__.room.getScreenAudioTrack()).toBe(null);
  });

  it('re-publishes screen share after reconnect when publication is missing', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

    window.navigator.mediaDevices.getUserMedia = async () => {
      const videoTrack = makeTrack('video', { width: 1280, height: 720, frameRate: 30 }, 'screen');
      const audioTrack = makeTrack('audio', { channelCount: 2 }, 'system');
      return new FakeMediaStream([videoTrack, audioTrack]);
    };

    await window.__TEST_HOOKS__.room.startStreaming();
    expect(fakeParticipant.videoTrackPublications.size).toBe(1);

    fakeParticipant.videoTrackPublications.clear();
    fakeParticipant.audioTrackPublications.clear();

    await window.__TEST_HOOKS__.room.handleScreenShareReconnect();

    expect(fakeParticipant.videoTrackPublications.size).toBe(1);
    expect(fakeParticipant.audioTrackPublications.size).toBe(1);
  });

  it('falls back to video-only when system audio permission fails', async () => {
    const window = setupRenderer();
    const fakeParticipant = new FakeParticipant();
    window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

    window.navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.audio !== false) {
        const err = new Error('NotAllowed');
        err.name = 'NotAllowedError';
        throw err;
      }
      const videoTrack = makeTrack('video', { width: 1280, height: 720, frameRate: 30 }, 'screen');
      return new FakeMediaStream([videoTrack]);
    };

    await window.__TEST_HOOKS__.room.startStreaming();

    expect(window.__TEST_HOOKS__.room.isStreaming()).toBe(true);
    expect(window.__TEST_HOOKS__.room.getScreenAudioTrack()).toBeFalsy();
    expect(window.__TEST_HOOKS__.core.muteSystemBtn.disabled).toBe(true);
    expect(window.document.getElementById('errorBanner')?.textContent).toBe('System audio unavailable; streaming video only.');
  });

  it('shows a stall warning when screen track stays muted', async () => {
    vi.useFakeTimers();
    try {
      const window = setupRenderer();
      const fakeParticipant = new FakeParticipant();
      window.__TEST_HOOKS__.core.setRoom({ localParticipant: fakeParticipant, state: 'connected' });

      window.navigator.mediaDevices.getUserMedia = async () => {
        const videoTrack = makeTrack('video', { width: 1280, height: 720, frameRate: 30 }, 'screen');
        const audioTrack = makeTrack('audio', { channelCount: 2 }, 'system');
        return new FakeMediaStream([videoTrack, audioTrack]);
      };

      await window.__TEST_HOOKS__.room.startStreaming();

      const mediaTrack = window.__TEST_HOOKS__.room.getScreenVideoTrack().mediaStreamTrack;
      mediaTrack.muted = true;
      mediaTrack.onmute?.();

      vi.advanceTimersByTime(4100);
      await Promise.resolve();
      const errorText = window.document.getElementById('errorBanner')?.textContent;
      expect(errorText).toBe('Screen share stalled. Click Stop Stream then Start Stream to restart.');

      mediaTrack.muted = false;
      mediaTrack.onunmute?.();
      expect(window.document.getElementById('errorBanner')?.textContent).toBe('');

      await window.__TEST_HOOKS__.room.stopStreaming();
    } finally {
      vi.useRealTimers();
    }
  });
});
