// Runtime frontend configuration. Override by editing this file on the server.
(function () {
  // Default API mapping rules:
  // - If running on localhost, assume local services on ports 5000/5001/5002.
  // - Otherwise, use current origin for same-origin APIs.

  const host = (window.location && window.location.hostname) || '127.0.0.1';
  const isLocal = host === 'localhost' || host === '127.0.0.1';

  // Primary API base used by pages that previously targeted 127.0.0.1:5002
  window.__API_BASE__ = window.__API_BASE__ || (isLocal ? 'http://127.0.0.1:5002' : window.location.origin);

  // Secondary auth/haptic API (legacy pages used 5000/5001) — keep for compatibility
  window.__AUTH_API_BASE__ = window.__AUTH_API_BASE__ || (isLocal ? 'http://127.0.0.1:5000' : window.location.origin);

  // Signaling server base (WebSocket/http) — default to API base
  window.__SIGNALING_BASE__ = window.__SIGNALING_BASE__ || window.__API_BASE__;

  // Expose a helper for building endpoints
  window.__buildApiUrl = function (path, base) {
    base = base || window.__API_BASE__ || '';
    if (!path) return base;
    if (path[0] === '/') return base.replace(/\/$/, '') + path;
    return base.replace(/\/$/, '') + '/' + path;
  };
})();
