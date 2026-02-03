(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TheCordLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mapConnectionQuality(quality) {
    const map = {
      excellent: 'excellent',
      good: 'good',
      poor: 'poor',
      unknown: 'unknown'
    };
    return map[quality] || 'unknown';
  }

  function parseResolution(value) {
    const parts = String(value || '').split('x');
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0
    };
  }

  function buildCaptureConstraints(options) {
    const sourceId = options && options.sourceId ? String(options.sourceId) : '';
    const width = Number(options && options.width);
    const height = Number(options && options.height);
    const fps = Number(options && options.fps);
    const resolvedFps = Number.isFinite(fps) && fps > 0 ? fps : 1;
    const minFrameRate = Math.min(resolvedFps, 30);
    const videoMandatory = {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      minWidth: width,
      maxWidth: width,
      minHeight: height,
      maxHeight: height,
      minFrameRate,
      maxFrameRate: resolvedFps
    };
    const captureConstraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId
        }
      },
      video: { mandatory: videoMandatory }
    };
    return { videoMandatory, captureConstraints };
  }

  function stripFrameRateConstraints(videoMandatory) {
    if (!videoMandatory) return {};
    const next = { ...videoMandatory };
    delete next.minFrameRate;
    delete next.maxFrameRate;
    return next;
  }

  function buildStreamSettings(options) {
    const captureSettings = options && options.captureSettings ? options.captureSettings : null;
    const fallbackWidth = Number(options && options.fallbackWidth) || 0;
    const fallbackHeight = Number(options && options.fallbackHeight) || 0;
    const fallbackFps = Number(options && options.fallbackFps) || 0;
    const bitrateBps = Number(options && options.bitrateBps) || 0;

    const width = Number(captureSettings && captureSettings.width);
    const height = Number(captureSettings && captureSettings.height);
    const frameRate = Number(captureSettings && captureSettings.frameRate);

    const resolvedWidth = Number.isFinite(width) && width > 0 ? width : fallbackWidth;
    const resolvedHeight = Number.isFinite(height) && height > 0 ? height : fallbackHeight;
    const resolvedFps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : fallbackFps;

    return {
      res: `${resolvedWidth}x${resolvedHeight}`,
      fps: String(Math.round(resolvedFps || 0)),
      maxKbps: String(Math.round(bitrateBps / 1000))
    };
  }

  function base64UrlDecode(payload) {
    if (!payload) return null;
    let normalized = String(payload).replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    if (pad) normalized += '='.repeat(4 - pad);
    if (typeof atob === 'function') {
      return atob(normalized);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(normalized, 'base64').toString('utf8');
    }
    return null;
  }

  function decodeJwtPayload(token) {
    try {
      if (!token) return null;
      const parts = String(token).split('.');
      if (parts.length < 2) return null;
      const json = base64UrlDecode(parts[1]);
      if (!json) return null;
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  }

  function getRoomFromToken(token) {
    const data = decodeJwtPayload(token);
    return data?.video?.room || data?.room || null;
  }

  function getNameFromToken(token) {
    const data = decodeJwtPayload(token);
    return data?.sub || data?.name || null;
  }

  function normalizeChatUrl(raw, defaultPort) {
    const trimmed = raw == null ? '' : String(raw).trim();
    if (!trimmed) return null;
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const candidate = hasScheme ? trimmed : `ws://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
      if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') parsed.protocol = 'ws:';
      if (!hasScheme && !parsed.port && defaultPort) parsed.port = String(defaultPort);
      const result = parsed.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (e) {
      return '';
    }
  }

  function normalizePresenceUrl(raw, defaultPort) {
    const trimmed = raw == null ? '' : String(raw).trim();
    if (!trimmed) return null;
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const candidate = hasScheme ? trimmed : `http://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
      if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') parsed.protocol = 'http:';
      if (!hasScheme && !parsed.port && defaultPort) parsed.port = String(defaultPort);
      const result = parsed.toString();
      return result.endsWith('/') ? result.slice(0, -1) : result;
    } catch (e) {
      return '';
    }
  }

  function resolveHostInfo(raw) {
    const trimmed = raw == null ? '' : String(raw).trim();
    if (!trimmed) return null;
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    const candidate = hasScheme ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
      return { hostname: parsed.hostname, secure };
    } catch (e) {
      return null;
    }
  }

  return {
    mapConnectionQuality,
    parseResolution,
    buildCaptureConstraints,
    stripFrameRateConstraints,
    buildStreamSettings,
    decodeJwtPayload,
    getRoomFromToken,
    getNameFromToken,
    normalizeChatUrl,
    normalizePresenceUrl,
    resolveHostInfo
  };
});
