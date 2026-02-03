import { describe, it, expect } from 'vitest';
import logic from '../renderer-logic.js';

function makeJwt(payload) {
  const header = { alg: 'none', typ: 'JWT' };
  const encode = (obj) => {
    const json = JSON.stringify(obj);
    const base64 = Buffer.from(json).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  return `${encode(header)}.${encode(payload)}.`;
}

describe('renderer-logic', () => {
  it('maps connection quality values', () => {
    expect(logic.mapConnectionQuality('excellent')).toBe('excellent');
    expect(logic.mapConnectionQuality('good')).toBe('good');
    expect(logic.mapConnectionQuality('poor')).toBe('poor');
    expect(logic.mapConnectionQuality('unknown')).toBe('unknown');
    expect(logic.mapConnectionQuality('weird')).toBe('unknown');
  });

  it('parses resolution strings', () => {
    expect(logic.parseResolution('1920x1080')).toEqual({ width: 1920, height: 1080 });
    expect(logic.parseResolution('bad')).toEqual({ width: 0, height: 0 });
  });

  it('builds capture constraints', () => {
    const { videoMandatory, captureConstraints } = logic.buildCaptureConstraints({
      sourceId: 'screen:1',
      width: 1920,
      height: 1080,
      fps: 60
    });
    expect(videoMandatory.chromeMediaSource).toBe('desktop');
    expect(videoMandatory.chromeMediaSourceId).toBe('screen:1');
    expect(videoMandatory.minWidth).toBe(1920);
    expect(videoMandatory.maxHeight).toBe(1080);
    expect(videoMandatory.maxFrameRate).toBe(60);
    expect(captureConstraints.audio.mandatory.chromeMediaSourceId).toBe('screen:1');
    expect(captureConstraints.video.mandatory).toMatchObject(videoMandatory);
  });

  it('strips frame rate constraints', () => {
    const base = {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: 'screen:1',
      minWidth: 1280,
      maxWidth: 1280,
      minHeight: 720,
      maxHeight: 720,
      minFrameRate: 1,
      maxFrameRate: 30
    };
    const relaxed = logic.stripFrameRateConstraints(base);
    expect(relaxed.minFrameRate).toBeUndefined();
    expect(relaxed.maxFrameRate).toBeUndefined();
    expect(relaxed.minWidth).toBe(1280);
  });

  it('builds stream settings with capture settings', () => {
    const settings = logic.buildStreamSettings({
      captureSettings: { width: 1280, height: 720, frameRate: 59.94 },
      fallbackWidth: 1920,
      fallbackHeight: 1080,
      fallbackFps: 30,
      bitrateBps: 10000
    });
    expect(settings).toEqual({ res: '1280x720', fps: '60', maxKbps: '10' });
  });

  it('builds stream settings with fallbacks', () => {
    const settings = logic.buildStreamSettings({
      captureSettings: null,
      fallbackWidth: 1920,
      fallbackHeight: 1080,
      fallbackFps: 30,
      bitrateBps: 5000000
    });
    expect(settings).toEqual({ res: '1920x1080', fps: '30', maxKbps: '5000' });
  });

  it('decodes jwt room and name', () => {
    const token = makeJwt({ video: { room: 'studio-a' }, sub: 'Nova' });
    expect(logic.getRoomFromToken(token)).toBe('studio-a');
    expect(logic.getNameFromToken(token)).toBe('Nova');
  });

  it('normalizes chat url', () => {
    expect(logic.normalizeChatUrl('example.com', 7883)).toBe('ws://example.com:7883');
    expect(logic.normalizeChatUrl('https://example.com', 7883)).toBe('wss://example.com');
  });

  it('normalizes presence url', () => {
    expect(logic.normalizePresenceUrl('example.com', 7882)).toBe('http://example.com:7882');
    expect(logic.normalizePresenceUrl('wss://example.com', 7882)).toBe('https://example.com');
  });

  it('resolves host info', () => {
    expect(logic.resolveHostInfo('wss://example.com')).toEqual({ hostname: 'example.com', secure: true });
    expect(logic.resolveHostInfo('example.com:7880')).toEqual({ hostname: 'example.com', secure: true });
  });
});
