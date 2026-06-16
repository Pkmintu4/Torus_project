(() => {
  const CALL_STATE = {
    WAITING: "waiting",
    CONNECTED: "connected"
  };

  // Prefer the local signaling server on port 3000 (matches server.js default)
  const DEFAULT_SIGNAL_SERVER = (window && window.__SIGNALING_BASE__) || (window && window.__API_BASE__) || "http://127.0.0.1:3000";
  const RTC_CONFIG = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  let isStarted = false;

  const state = {
    role: "doctor",
    roomId: "",
    doctorUrl: "",
    socket: null,
    signalServerUrl: "",
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    pendingIceCandidates: [],
    callState: CALL_STATE.WAITING,
    isPatientConnected: false,
    isJoined: false,
    hasPeer: false,
    hasCreatedOffer: false,
    hasManualSessionStart: false,
    hasShownDoctorJoinedPopup: false,
    hasClickedProceed: false,
    doctorBeginReceived: false,
    doctorClickedBegin: false,
    cameraEnabled: true,
    micEnabled: true,
    userId: ""
  };

  const dom = {
    subtitle: null,
    connectionPill: null,
    doctorPanel: null,
    patientPanel: null,
    doctorPlaceholder: null,
    patientPlaceholder: null,
    patientTile: null,
    patientTileMarkup: "",
    callStatePanel: null,
    controlsSection: null,
    testingBtn: null,
    endBtn: null,
    backBtn: null,
    doctorVideo: null,
    patientVideo: null,
    doctorJoinedModal: null,
    doctorJoinedModalAction: null,
    doctorJoinedModalMessage: null
  };

  function normalizeRoomId(value) {
    return String(value || "").trim().toUpperCase();
  }

  function setElementDisplay(element, display) {
    if (!element) return;
    element.style.display = display;
  }

  function setConnectionLabel(text) {
    if (!dom.connectionPill) return;

    const label = dom.connectionPill.querySelector("span:last-child") || dom.connectionPill;
    label.textContent = text;
  }

  function readConfig() {
    const params = new URLSearchParams(window.location.search);
    const roleParam = String(params.get("role") || "").toLowerCase();
    state.role = roleParam === "patient" ? "patient" : "doctor";

    const roomFromUrl = normalizeRoomId(params.get("room"));
    const roomFromStorage = normalizeRoomId(localStorage.getItem("roomId"));
    state.roomId = roomFromUrl || roomFromStorage || "";
  }

  function cacheDom() {
    dom.subtitle = document.getElementById("consultationSubtitle");
    dom.connectionPill = document.querySelector(".connected-pill");
    dom.doctorPanel = document.getElementById("doctorVideoPanel");
    dom.patientPanel = document.getElementById("patientVideoPanel");
    dom.doctorPlaceholder = document.getElementById("doctorPlaceholder");
    dom.patientPlaceholder = document.getElementById("patientPlaceholder");
    dom.patientTile = document.getElementById("patientVideoTile");
    dom.patientTileMarkup = dom.patientTile ? dom.patientTile.innerHTML : "";
    dom.callStatePanel = document.getElementById("callStatePanel");
    dom.controlsSection = dom.callStatePanel;
    dom.testingBtn = document.getElementById("testingBtn");
    dom.endBtn = document.getElementById("endConsultationBtn");
    dom.backBtn = document.getElementById("backToDashboardBtn");
    dom.doctorPanelTitle = document.getElementById("doctorPanelTitle");
    dom.patientPanelTitle = document.getElementById("patientPanelTitle");
    dom.patientPanelLabel = dom.patientPanel ? dom.patientPanel.querySelector(".feed-label.bottom-text") : null;
    dom.flipBtn = document.getElementById("flipBtn");
    dom.remoteVideo = document.getElementById("remoteVideo");
    dom.localVideo = document.getElementById("localVideo");
    dom.panelFullscreenButtons = Array.from(document.querySelectorAll(".panel-fullscreen-btn"));
    dom.panelMenuButtons = Array.from(document.querySelectorAll(".panel-menu-btn"));
    dom.doctorJoinedModal = document.getElementById("doctorJoinedModal");
    dom.doctorJoinedModalAction = document.getElementById("doctorJoinedModalAction");
    dom.doctorJoinedModalMessage = document.getElementById("doctorJoinedModalMessage");
  }

  function buildSignalServerCandidates() {
    const params = new URLSearchParams(window.location.search);
    const signalFromQuery = params.get("signal") || params.get("signalServer") || params.get("signalServerUrl") || "";
    const stored = localStorage.getItem("signalServerUrl") || "";
    const host = window.location.hostname || "127.0.0.1";
    const pageProtocol = window.location.protocol === "https:" ? "https:" : "http:";
    const wsProtocol = pageProtocol === "https:" ? "wss:" : "ws:";

    const socketIoCandidates = [];
    const webSocketCandidates = [];

    const pushUnique = (list, value) => {
      if (!value || typeof value !== "string") {
        return;
      }
      if (!list.includes(value)) {
        list.push(value);
      }
    };

    const normalizeSocketIoUrl = (rawValue) => {
      if (!rawValue) return "";
      try {
        const parsed = new URL(rawValue, window.location.origin);
        if (parsed.protocol === "ws:") parsed.protocol = "http:";
        if (parsed.protocol === "wss:") parsed.protocol = "https:";
        return parsed.origin;
      } catch (_error) {
        return "";
      }
    };

    const deriveWebSocketUrls = (rawValue) => {
      if (!rawValue) return [];

      try {
        const parsed = new URL(rawValue, window.location.origin);
        if (parsed.protocol === "http:") parsed.protocol = "ws:";
        if (parsed.protocol === "https:") parsed.protocol = "wss:";

        const trimmedPath = parsed.pathname && parsed.pathname !== "/"
          ? parsed.pathname.replace(/\/+$/, "")
          : "";
        const baseHost = `${parsed.protocol}//${parsed.host}`;
        const results = [];

        if (trimmedPath && trimmedPath !== "/socket.io") {
          results.push(`${baseHost}${trimmedPath}`);
        } else {
          results.push(baseHost);
          results.push(`${baseHost}/ws`);
        }

        return [...new Set(results)];
      } catch (_error) {
        return [];
      }
    };

    const addFromRaw = (rawValue) => {
      const ioUrl = normalizeSocketIoUrl(rawValue);
      if (ioUrl) {
        pushUnique(socketIoCandidates, ioUrl);
      }

      const wsUrls = deriveWebSocketUrls(rawValue);
      wsUrls.forEach((wsUrl) => pushUnique(webSocketCandidates, wsUrl));
    };

    addFromRaw(signalFromQuery);
    addFromRaw(stored);
    addFromRaw(DEFAULT_SIGNAL_SERVER);

    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (!isLocal) {
      pushUnique(socketIoCandidates, `${pageProtocol}//${host}`);
      pushUnique(webSocketCandidates, `${wsProtocol}//${host}`);
      pushUnique(webSocketCandidates, `${wsProtocol}//${host}/ws`);
    }

    [5002, 3000].forEach((port) => {
      pushUnique(socketIoCandidates, `${pageProtocol}//127.0.0.1:${port}`);
      pushUnique(socketIoCandidates, `${pageProtocol}//${host}:${port}`);

      pushUnique(webSocketCandidates, `${wsProtocol}//127.0.0.1:${port}`);
      pushUnique(webSocketCandidates, `${wsProtocol}//${host}:${port}`);
      pushUnique(webSocketCandidates, `${wsProtocol}//127.0.0.1:${port}/ws`);
      pushUnique(webSocketCandidates, `${wsProtocol}//${host}:${port}/ws`);
    });

    return {
      socketIoCandidates,
      webSocketCandidates
    };
  }

  // Probe a URL (HTTP/HTTPS) to check whether a signaling server is alive.
  // Converts ws/wss to http/https for probing when necessary.
  async function probeUrl(rawUrl, timeoutMs = 1600) {
    if (!rawUrl) return false;

    try {
      let probe = rawUrl;
      // normalize ws:// -> http://, wss:// -> https://
      probe = probe.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');

      // if path contains /ws or /socket.io, probe the origin root first
      try {
        const urlObj = new URL(probe, window.location.origin);
        urlObj.pathname = urlObj.pathname && urlObj.pathname !== '/' ? urlObj.pathname.replace(/\/+$/, '') : urlObj.pathname;
        // if path ends with /ws or /socket.io, probe root origin
        if (/\/ws$|\/socket.io$/i.test(urlObj.pathname || '')) {
          urlObj.pathname = '/';
        }
        probe = urlObj.toString();
      } catch (e) {
        // ignore
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(probe, { method: 'GET', signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      return resp && resp.ok;
    } catch (err) {
      return false;
    }
  }

  async function handleSignalMessage(event, socket) {
    if (state.socket !== socket) {
      return;
    }

    try {
      const data = JSON.parse(String(event.data || "{}"));
      const incomingRoomId = normalizeRoomId(data.roomId || data.room);
      if (incomingRoomId && state.roomId && incomingRoomId !== state.roomId) {
        return;
      }

      if (data.type === "joined-room") {
        state.isJoined = true;
        console.log("User joined:", state.role);
        const participants = Number(data.participants || 0);
        const hasPeer = participants > 1;
        state.hasPeer = hasPeer;

        if (!hasPeer) {
          clearRemoteVideo();
        }

        setConnectionLabel(hasPeer ? "Connected" : "Waiting");
        setConnectionPillState(hasPeer);
        setCallState(CALL_STATE.WAITING, state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient");

        if (state.role === "patient") {
          if (hasPeer) {
            if (dom.testingBtn && !state.hasClickedProceed) {
              dom.testingBtn.textContent = "Doctor Joined, Please click to begin consultation";
              dom.testingBtn.disabled = false;
              dom.testingBtn.classList.remove("is-waiting");
              dom.testingBtn.classList.add("ultrasound-ready");
            }
          } else {
            if (dom.testingBtn) {
              dom.testingBtn.textContent = "Waiting for Doctor";
              dom.testingBtn.disabled = true;
            }
          }
        } else {
          if (dom.testingBtn) {
            dom.testingBtn.textContent = state.doctorClickedBegin ? "Ultrasound Scanning" : "Waiting for Patient";
            dom.testingBtn.disabled = true;
          }
        }
        return;
      }

      if (data.type === "waiting-state") {
        state.hasPeer = false;
        clearRemoteVideo();
        setCallState(CALL_STATE.WAITING, state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient");
        return;
      }

      if (data.type === "doctor-joined" || data.type === "user-joined") {
        state.hasPeer = true;
        setConnectionLabel("Connected");
        setConnectionPillState(true);
        if (dom.callStatePanel) {
          dom.callStatePanel.style.display = "none";
        }
        if (state.role === "patient" && data.type === "doctor-joined") {
          showDoctorJoinedPopup();
        }
        return;
      }

      if (data.type === "patient-proceed") {
        if (state.role === "doctor") {
          if (dom.testingBtn && !state.doctorClickedBegin) {
            dom.testingBtn.textContent = "Patient Joined, Please click here to begin consultation";
            dom.testingBtn.disabled = false;
            dom.testingBtn.classList.remove("is-waiting");
            dom.testingBtn.classList.add("ultrasound-ready");
          }
        }
        return;
      }

      if (data.type === "doctor-begin") {
        if (state.role === "patient") {
          state.doctorBeginReceived = true;
          if (dom.testingBtn) {
            dom.testingBtn.textContent = "Ultra Sound in Progress";
            dom.testingBtn.disabled = false;
            dom.testingBtn.classList.remove("is-waiting");
            dom.testingBtn.classList.add("ultrasound-ready");
          }
          setCallState(CALL_STATE.CONNECTED);
          if (state.socket && state.socket.readyState === WebSocket.OPEN && state.roomId && state.isJoined) {
            sendSignal("ready", { roomId: state.roomId });
          }
        }
        return;
      }

      if (data.type === "patient-report-redirect") {
        if (state.role === "patient") {
          console.log("Redirecting patient to report generation page");
          window.location.href = `patient-generate.html?room=${state.roomId}&role=patient`;
        }
        return;
      }

      if (data.type === "connect-success" || data.type === "both-users-connected") {
        state.isJoined = true;
        const participants = Number(data.participants || 0);
        const hasPeer = participants > 1;
        state.hasPeer = hasPeer;
        setConnectionLabel(hasPeer ? "Connected" : "Waiting");
        setConnectionPillState(hasPeer);
        setCallState(CALL_STATE.WAITING, state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient");

        if (state.role === "patient") {
          if (hasPeer) {
            if (dom.testingBtn && !state.hasClickedProceed) {
              dom.testingBtn.textContent = "Doctor Joined, Please click to begin consultation";
              dom.testingBtn.disabled = false;
              dom.testingBtn.classList.remove("is-waiting");
              dom.testingBtn.classList.add("ultrasound-ready");
            }
          } else {
            if (dom.testingBtn) {
              dom.testingBtn.textContent = "Waiting for Doctor";
              dom.testingBtn.disabled = true;
            }
          }
        }
        return;
      }

      if (data.type === "user-left") {
        state.hasPeer = false;
        state.isPatientConnected = false;
        setConnectionLabel("Waiting");
        setConnectionPillState(false);
        clearRemoteVideo();
        setCallState(CALL_STATE.WAITING, "Waiting for patient...");
        return;
      }

      if (data.type === "ready") {
        if (!state.hasCreatedOffer && state.role === "doctor" && state.doctorClickedBegin) {
          await createOffer();
        }
        return;
      }

      if (data.type === "offer" && data.offer) {
        await handleOffer({ offer: data.offer });
        return;
      }

      if (data.type === "answer" && data.answer) {
        await handleAnswer({ answer: data.answer });
        return;
      }

      if (data.type === "candidate" && data.candidate) {
        await handleIceCandidate({ candidate: data.candidate });
        return;
      }

      if (data.type === "ice-candidate" && data.candidate) {
        await handleIceCandidate({ candidate: data.candidate });
        return;
      }

      if (data.type === "error-message") {
        const errorMessage = data.message || "Signaling error";
        console.warn(errorMessage);
        setCallState(CALL_STATE.WAITING, errorMessage);
      }
    } catch (error) {
      console.error("Signal parse error", error);
    }
  }

  function connectToSignalServer(signalServerUrl) {
    return new Promise((resolve, reject) => {
      console.log(`[socket.io] Initializing with URL: ${signalServerUrl}`);

      if (!window.io) {
        const error = new Error("window.io not found - socket.io library not loaded");
        console.error(error.message);
        return reject(error);
      }

      const ioSocket = window.io(signalServerUrl, {
        path: "/socket.io",
        transports: ["websocket", "polling"]
      });

      console.log(`[socket.io] Socket instance created, waiting for connection...`);

      const socket = createSignalSocketAdapter(ioSocket, signalServerUrl);
      state.signalServerUrl = signalServerUrl;
      state.socket = socket;

      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          console.warn(`[socket.io] Connection timeout after 10s: ${signalServerUrl}`);
          finishReject(new Error("socket.io connection timeout"));
        }
      }, 10000);

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        localStorage.setItem("signalServerUrl", signalServerUrl);
        console.log(`[socket.io] ✓ Connected and resolved: ${signalServerUrl}`);
        resolve(socket);
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (state.socket === socket) {
          state.socket = null;
        }
        if (socket && socket.close) socket.close();
        console.error(`[socket.io] ✗ Connection rejected:`, error?.message);
        reject(error);
      };

      const sendJoinMessage = () => {
        if (!state.roomId || socket.readyState !== WebSocket.OPEN) {
          return;
        }

        socket.send(JSON.stringify({
          type: "join",
          room: state.roomId,
          role: state.role
        }));

        console.log("join sent:", state.roomId, state.role);
      };

      const sendReadyIfPossible = () => {
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.roomId || !state.isJoined) {
          return;
        }
        sendSignal("ready", { roomId: state.roomId });
      };

      socket.onopen = () => {
        if (state.socket !== socket) {
          console.warn("[socket.io] onopen: socket was replaced, ignoring");
          return;
        }

        console.log("[socket.io] ✓ onopen event fired");
        console.log("[socket.io] Connected ID:", ioSocket.id || "unknown");
        sendJoinMessage();
        finishResolve();
      };

      socket.onerror = (err) => {
        if (state.socket !== socket) {
          console.warn("[socket.io] onerror: socket was replaced, ignoring");
          return;
        }

        console.error("[socket.io] ✗ onerror event:", err);
        finishReject(err instanceof Error ? err : new Error("websocket error / server is down"));
      };

      socket.onclose = () => {
        if (state.socket !== socket) {
          console.warn("[socket.io] onclose: socket was replaced, ignoring");
          return;
        }

        console.warn("[socket.io] onclose event fired");
        state.isJoined = false;
        state.hasCreatedOffer = false;

        if (!settled) {
          finishReject(new Error("websocket error / server is down"));
          return;
        }

        setCallState(CALL_STATE.WAITING, "Unable to connect signaling server");
      };

      socket.onmessage = (event) => {
        void handleSignalMessage(event, socket);
      };

      // Hook into socket.io events for debugging
      ioSocket.on("connect", () => {
        console.log("[socket.io] 'connect' event fired, ID:", ioSocket.id);
      });

      ioSocket.on("connect_error", (error) => {
        console.error("[socket.io] 'connect_error' event:", error?.message || error);
      });

      ioSocket.on("disconnect", (reason) => {
        console.warn("[socket.io] 'disconnect' event:", reason);
      });
    });
  }

  function connectToNativeWebSocket(signalServerUrl) {
    return new Promise((resolve, reject) => {
      console.log(`[native-ws] Initializing connection to: ${signalServerUrl}`);

      const socket = new WebSocket(signalServerUrl);
      state.signalServerUrl = signalServerUrl;
      state.socket = socket;

      let settled = false;
      const timeoutHandle = setTimeout(() => {
        if (!settled) {
          console.warn(`[native-ws] Connection timeout after 10s: ${signalServerUrl}`);
          finishReject(new Error("native WebSocket connection timeout"));
        }
      }, 10000);

      const finishResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        localStorage.setItem("signalServerUrl", signalServerUrl);
        console.log(`[native-ws] ✓ Connected and resolved: ${signalServerUrl}`);
        resolve(socket);
      };

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (state.socket === socket) {
          state.socket = null;
        }
        if (socket && socket.close) socket.close();
        console.error(`[native-ws] ✗ Connection rejected:`, error?.message);
        reject(error);
      };

      socket.onopen = () => {
        if (state.socket !== socket) {
          console.warn("[native-ws] onopen: socket was replaced, ignoring");
          return;
        }

        console.log("[native-ws] ✓ onopen event fired");

        if (state.roomId && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: "join",
            room: state.roomId,
            role: state.role
          }));
          console.log("[native-ws] join sent:", state.roomId, state.role);
        }

        finishResolve();
      };

      socket.onerror = (err) => {
        if (state.socket !== socket) {
          console.warn("[native-ws] onerror: socket was replaced, ignoring");
          return;
        }

        console.error("[native-ws] ✗ onerror event:", err);
        finishReject(err instanceof Error ? err : new Error("websocket error / server is down"));
      };

      socket.onclose = () => {
        if (state.socket !== socket) {
          console.warn("[native-ws] onclose: socket was replaced, ignoring");
          return;
        }

        console.warn("[native-ws] onclose event fired");
        state.isJoined = false;
        state.hasCreatedOffer = false;

        if (!settled) {
          finishReject(new Error("websocket error / server is down"));
          return;
        }

        setCallState(CALL_STATE.WAITING, "Unable to connect signaling server");
      };

      socket.onmessage = (event) => {
        void handleSignalMessage(event, socket);
      };

      console.log("[native-ws] WebSocket instance created, waiting for open event...");
    });
  }

  async function connectSignaling() {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      console.log("✓ Socket already connected, skipping reconnect");
      return;
    }

    const { socketIoCandidates, webSocketCandidates } = buildSignalServerCandidates();
    console.log("📡 Signal Server Candidates:");
    console.log("  Socket.IO URLs:", socketIoCandidates);
    console.log("  WebSocket URLs:", webSocketCandidates);

    // Probe candidates first and prefer any server that responds to an HTTP health check.
    try {
      for (let i = 0; i < socketIoCandidates.length; i++) {
        const candidate = socketIoCandidates[i];
        // probe origin (http/https)
        // eslint-disable-next-line no-await-in-loop
        const ok = await probeUrl(candidate);
        if (ok) {
          console.log('[probe] Socket.IO candidate responsive, prioritizing:', candidate);
          socketIoCandidates.splice(i, 1);
          socketIoCandidates.unshift(candidate);
          break;
        }
      }

      for (let i = 0; i < webSocketCandidates.length; i++) {
        const candidate = webSocketCandidates[i];
        // eslint-disable-next-line no-await-in-loop
        const ok = await probeUrl(candidate);
        if (ok) {
          console.log('[probe] WebSocket candidate responsive, prioritizing:', candidate);
          webSocketCandidates.splice(i, 1);
          webSocketCandidates.unshift(candidate);
          break;
        }
      }
    } catch (probeErr) {
      console.warn('[probe] Error while probing signal servers:', probeErr && probeErr.message);
    }

    let lastError = null;

    console.log("🔗 Attempting Socket.IO connections...");
    for (const signalServerUrl of socketIoCandidates) {
      try {
        console.log(`  → Trying: ${signalServerUrl}`);
        const socket = await connectToSignalServer(signalServerUrl);
        console.log(`  ✓ Connected via Socket.IO: ${signalServerUrl}`);
        state.socket = socket;
        return;
      } catch (error) {
        console.warn(`  ✗ Socket.IO failed (${signalServerUrl}):`, error?.message);
        lastError = error;
      }
    }

    console.log("🔗 Attempting native WebSocket connections...");
    for (const signalServerUrl of webSocketCandidates) {
      try {
        console.log(`  → Trying: ${signalServerUrl}`);
        const socket = await connectToNativeWebSocket(signalServerUrl);
        console.log(`  ✓ Connected via WebSocket: ${signalServerUrl}`);
        state.socket = socket;
        return;
      } catch (error) {
        console.warn(`  ✗ WebSocket failed (${signalServerUrl}):`, error?.message);
        lastError = error;
      }
    }

    const finalError = lastError || new Error("websocket error / server is down");
    console.error("❌ All connection attempts failed:", finalError.message);
    throw finalError;
  }

  function setConnectionPillState(isConnected) {
    if (!dom.connectionPill) return;

    dom.connectionPill.classList.toggle("is-connected", isConnected);
    dom.connectionPill.classList.toggle("is-waiting", !isConnected);
  }

  function setSubtitle(text) {
    if (dom.subtitle) {
      dom.subtitle.textContent = text;
    }
  }

  function generateRoomId() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  function buildPatientLink(roomId) {
    const current = new URL(window.location.href);
    return `${current.origin}${current.pathname}?room=${encodeURIComponent(roomId)}&role=patient`;
  }

  function buildDoctorLink(roomId) {
    return `connected-device.html?room=${encodeURIComponent(roomId)}&role=doctor`;
  }

  function buildAbsoluteDoctorUrl(roomId) {
    const current = new URL(window.location.href);
    current.searchParams.set("room", normalizeRoomId(roomId));
    current.searchParams.set("role", "doctor");
    return current.toString();
  }

  function buildReportLink() {
    const current = new URL(window.location.href);
    current.pathname = current.pathname.replace(/connected-device\.html$/i, "report-generation.html");
    return current.toString();
  }

  function buildNavigationUrl(pageName) {
    const current = new URL(window.location.href);
    current.pathname = current.pathname.replace(/[^/]+$/i, pageName);
    return current.toString();
  }

  function createVideoElement(muted, elementId = "") {
    const video = document.createElement("video");
    video.className = "video-stream";
    video.autoplay = true;
    video.playsInline = true;
    video.muted = muted;
    if (elementId) {
      video.id = elementId;
    }
    return video;
  }

  let isFlipped = false;

  function getRoleSpecificTitles() {
    return state.role === "doctor"
      ? {
          rightTitle: "Patient Camera",
          selfLabel: "Doctor",
          peerLabel: "Patient"
        }
      : {
          rightTitle: "Doctor Camera",
          selfLabel: "Patient",
          peerLabel: "Doctor"
        };
  }

  function updatePanelTitles() {
    const titles = getRoleSpecificTitles();

    if (dom.doctorPanelTitle) {
      dom.doctorPanelTitle.textContent = "Ultrasound Video Feed";
    }

    if (dom.patientPanelTitle) {
      dom.patientPanelTitle.textContent = titles.rightTitle;
    }

    if (dom.patientPanelLabel) {
      dom.patientPanelLabel.textContent = titles.rightTitle;
    }
  }

  function attachLocalVideo() {
    renderRoleVideoLayout();
  }

  function hasRemoteStream() {
    return Boolean(state.remoteStream && state.remoteStream.getTracks().length > 0);
  }

  function getMainStreamForRole() {
    // Keep the main panel reserved for the peer video.
    // The doctor's own camera should live in the preview tile.
    return state.remoteStream;
  }

  function getOverlayStreamForRole() {
    // Always show the local stream in the preview tile once the doctor camera is started.
    return state.localStream;
  }

  async function tryPlayVideo(videoElement) {
    if (!videoElement) {
      return;
    }

    try {
      await videoElement.play();
    } catch (error) {
      // Autoplay can be blocked if audio is unmuted; render still remains attached.
      console.warn("Video autoplay blocked:", error?.message || error);
    }
  }

  function renderRoleVideoLayout() {
    updatePanelTitles();
    const mainStream = getMainStreamForRole();
    const overlayStream = getOverlayStreamForRole();
    const mainVideo = dom.remoteVideo;
    const overlayVideo = dom.localVideo;
    const patientTile = dom.patientTile;

    if (mainVideo) {
      if (mainStream) {
        mainVideo.srcObject = mainStream;
        mainVideo.muted = false;
        void tryPlayVideo(mainVideo);
        if (dom.patientPlaceholder) {
          dom.patientPlaceholder.classList.add("hidden");
        }
      } else {
        mainVideo.srcObject = null;
        if (dom.patientPlaceholder) {
          dom.patientPlaceholder.classList.remove("hidden");
        }
      }
    }

    if (overlayVideo) {
      if (overlayStream) {
        overlayVideo.srcObject = overlayStream;
        overlayVideo.style.transform = isFlipped ? "scaleX(-1)" : "scaleX(1)";
        overlayVideo.muted = true;
        void tryPlayVideo(overlayVideo);
        overlayVideo.style.display = "block";
        if (patientTile) {
          patientTile.style.display = "none";
        }
      } else {
        overlayVideo.srcObject = null;
        overlayVideo.style.display = "none";
        if (patientTile) {
          patientTile.style.display = "flex";
        }
      }
    }
  }

  function clearRemoteVideo() {
    state.remoteStream = null;
    renderRoleVideoLayout();
  }

  function setTestingButtonState(isPatientConnected) {
    if (!dom.testingBtn) return;

    const hasPeer = dom.connectionPill && dom.connectionPill.classList.contains("is-connected");

    if (state.role === "patient") {
      if (state.doctorBeginReceived) {
        dom.testingBtn.textContent = "Ultra Sound in Progress";
        dom.testingBtn.disabled = false;
        dom.testingBtn.classList.add("ultrasound-ready");
        dom.testingBtn.classList.remove("is-waiting");
      } else if (state.hasClickedProceed) {
        dom.testingBtn.textContent = "Waiting for Doctor to start...";
        dom.testingBtn.disabled = true;
        dom.testingBtn.classList.add("is-waiting");
        dom.testingBtn.classList.remove("ultrasound-ready");
      } else if (state.hasPeer || hasPeer) {
        dom.testingBtn.textContent = "Doctor Joined, Please click to begin consultation";
        dom.testingBtn.disabled = false;
        dom.testingBtn.classList.add("ultrasound-ready");
        dom.testingBtn.classList.remove("is-waiting");
      } else {
        dom.testingBtn.textContent = "Waiting for Doctor";
        dom.testingBtn.disabled = true;
        dom.testingBtn.classList.add("is-waiting");
        dom.testingBtn.classList.remove("ultrasound-ready");
      }
    } else {
      // Doctor role
      if (isPatientConnected || hasPeer) {
        if (state.hasClickedProceed || state.doctorClickedBegin) {
          if (state.doctorClickedBegin) {
            dom.testingBtn.textContent = "Ultrasound Scanning";
            dom.testingBtn.disabled = false;
            dom.testingBtn.classList.remove("is-waiting");
            dom.testingBtn.classList.add("ultrasound-ready");
          } else {
            dom.testingBtn.textContent = "Patient Joined, Please click here to begin consultation";
            dom.testingBtn.disabled = false;
            dom.testingBtn.classList.remove("is-waiting");
            dom.testingBtn.classList.add("ultrasound-ready");
          }
        } else {
          dom.testingBtn.textContent = "Waiting for Patient";
          dom.testingBtn.disabled = true;
          dom.testingBtn.classList.add("is-waiting");
          dom.testingBtn.classList.remove("ultrasound-ready");
        }
      } else {
        dom.testingBtn.textContent = "Waiting for Patient";
        dom.testingBtn.disabled = true;
        dom.testingBtn.classList.add("is-waiting");
        dom.testingBtn.classList.remove("ultrasound-ready");
      }
    }

    if (isPatientConnected) {
      dom.testingBtn.classList.add("active-ultrasound", "is-connected");
    } else {
      dom.testingBtn.classList.remove("active-ultrasound", "is-connected");
    }
  }

  function resetTestingButtonState() {
    if (!dom.testingBtn) return;

    dom.testingBtn.disabled = true;
    dom.testingBtn.textContent = state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient";
    dom.testingBtn.classList.remove("active-ultrasound", "is-connected", "ultrasound-ready");
    dom.testingBtn.classList.add("is-waiting");
  }

  function resetVideoPlaceholders() {
    if (dom.doctorPlaceholder) {
      dom.doctorPlaceholder.classList.remove("hidden");
    }

    if (dom.patientPlaceholder) {
      dom.patientPlaceholder.classList.remove("hidden");
    }

    const remoteVideo = document.getElementById("remoteVideo");
    if (remoteVideo) {
      remoteVideo.srcObject = null;
    }

    const localVideo = document.getElementById("localVideo");
    if (localVideo) {
      localVideo.srcObject = null;
      localVideo.style.transform = isFlipped ? "scaleX(-1)" : "scaleX(1)";
    }
  }

  function setElementHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle("hidden", hidden);
  }

  function hideDoctorJoinedPopup() {
    setElementHidden(dom.doctorJoinedModal, true);
  }

  function showDoctorJoinedPopup() {
    if (state.role !== "patient" || state.hasShownDoctorJoinedPopup) {
      return;
    }

    state.hasShownDoctorJoinedPopup = true;

    // Show browser notification popup as alert
    window.alert("Doctor Joined");

    if (dom.testingBtn) {
      dom.testingBtn.textContent = "Doctor Joined, Please click to begin consultation";
      dom.testingBtn.disabled = false;
      dom.testingBtn.classList.remove("is-waiting");
      dom.testingBtn.classList.add("ultrasound-ready");
    }
  }

  function setInitialConsultationVisibility(hidden) {
    // Only hide connected pill, not patient details
    setElementHidden(document.querySelector(".connected-pill"), hidden);
  }

  function showInitialState() {
    state.callState = CALL_STATE.WAITING;
    state.isPatientConnected = false;
    state.hasManualSessionStart = false;
    hideDoctorJoinedPopup();
    updatePanelTitles();

    // Initial state requirements: show doctor panel, testing/end buttons and waiting.
    setElementDisplay(dom.doctorPanel, "flex");
    setElementDisplay(dom.patientPanel, "flex");
    setElementDisplay(dom.testingBtn, "block");
    setElementDisplay(dom.endBtn, "block");
    setElementDisplay(dom.patientTile, "flex");

    setConnectionLabel("Waiting");
    setConnectionPillState(false);
    resetTestingButtonState();
    resetVideoPlaceholders();
    if (dom.localVideo) {
      dom.localVideo.style.display = "none";
    }
    if (dom.patientTile) {
      dom.patientTile.style.display = "flex";
    }
    setInitialConsultationVisibility(false);

    setSessionDetailsVisibility(false);
    renderWaitingState(state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient");
  }

  function showFullUI() {
    setInitialConsultationVisibility(false);

    if (dom.callStatePanel) {
      dom.callStatePanel.style.display = "flex";
    }

    const leftPanel = document.getElementById("doctorVideoPanel");
    const rightPanel = document.getElementById("patientVideoPanel");
    if (leftPanel) leftPanel.classList.add("active");
    if (rightPanel) rightPanel.classList.add("active");
  }

  function showWaitingState(waitingMessage = "Waiting...") {
    setConnectionLabel("Waiting");
    setConnectionPillState(false);

    if (dom.testingBtn) {
      dom.testingBtn.disabled = true;
      dom.testingBtn.classList.remove("is-connected", "active-ultrasound", "ultrasound-ready");
      dom.testingBtn.classList.add("is-waiting");
      if (state.role === "patient") {
        dom.testingBtn.textContent = "Waiting for Doctor";
      } else {
        dom.testingBtn.textContent = state.doctorClickedBegin ? "Connecting..." : "Waiting for Patient";
      }
    }

    renderWaitingState(
      waitingMessage && waitingMessage !== "Waiting..."
        ? waitingMessage
        : (state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient")
    );

    const hasPeer = dom.connectionPill && dom.connectionPill.classList.contains("is-connected");
    if (state.role === "patient" && hasPeer) {
      setElementDisplay(dom.controlsSection, "none");
    } else {
      setElementDisplay(dom.controlsSection, "flex");
    }
  }

  function showConnectedState() {
    state.callState = CALL_STATE.CONNECTED;
    state.isPatientConnected = true;

    // Connected state requirements: reveal details, controls and patient tile.
    setElementDisplay(dom.doctorPanel, "flex");
    setElementDisplay(dom.patientPanel, "flex");
    setElementDisplay(dom.patientTile, "flex");
    setElementDisplay(dom.controlsSection, "flex");
    setElementDisplay(dom.testingBtn, "block");
    setElementDisplay(dom.endBtn, "block");

    showFullUI();
    setConnectionLabel("Connected");
    setConnectionPillState(true);
    setTestingButtonState(true);
    setSessionDetailsVisibility(true);

    if (dom.callStatePanel) {
      dom.callStatePanel.innerHTML = "";
    }

    if (dom.patientPlaceholder) {
      dom.patientPlaceholder.classList.add("hidden");
    }

    renderRoleVideoLayout();
    renderControlsState();
    showLiveCallUI();
  }

  function showInitialUI() {
    showInitialState();
  }

  function setInitialState() {
    showInitialState();
  }

  function showWaiting() {
    showWaitingState();
  }

  function showConnectedUI() {
    showConnectedState();
  }

  function setSessionDetailsVisibility(isPatientConnected) {
    const patientDetailsSection = document.getElementById("patientDetailsSection");
    if (!patientDetailsSection) {
      return;
    }

    patientDetailsSection.style.display = isPatientConnected ? "block" : "none";
  }

  function hasActivePatientConnection() {
    return hasRemoteStream();
  }

  function syncConsultationUi(waitingMessage = "Waiting...") {
    const isConnected = state.callState === CALL_STATE.CONNECTED || (state.role === "patient" && state.doctorBeginReceived);
    state.isPatientConnected = isConnected;

    if (isConnected) {
      showConnectedState();
      return;
    }

    setConnectionLabel("Waiting");
    setConnectionPillState(false);
    setTestingButtonState(false);
    setSessionDetailsVisibility(false);
    renderWaitingState(
      waitingMessage && waitingMessage !== "Waiting..."
        ? waitingMessage
        : (state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient")
    );
  }

  function setCallState(nextState, waitingMessage = "Waiting...") {
    state.callState = nextState === CALL_STATE.CONNECTED ? CALL_STATE.CONNECTED : CALL_STATE.WAITING;
    syncConsultationUi(waitingMessage);
  }

  function setPatientConnectionState(isPatientConnected, waitingMessage = "Waiting...") {
    setCallState(isPatientConnected ? CALL_STATE.CONNECTED : CALL_STATE.WAITING, waitingMessage);
  }

  function showLiveCallUI() {
    const leftPanel = document.getElementById("doctorVideoPanel");
    const rightPanel = document.getElementById("patientVideoPanel");
    if (leftPanel) leftPanel.classList.add("active");
    if (rightPanel) rightPanel.classList.add("active");
  }

  function renderWaitingState(message) {
    if (!dom.callStatePanel) return;

    if (state.role === "patient" && (state.hasPeer || state.doctorBeginReceived)) {
      renderControlsState();
      return;
    }

    dom.callStatePanel.style.display = "flex";
    dom.callStatePanel.style.alignItems = "center";
    dom.callStatePanel.style.justifyContent = "center";

    const showDoctorActions = state.role === "doctor";

    dom.callStatePanel.innerHTML = `
      <div class="call-status-panel" style="display:flex;flex-direction:column;align-items:center;gap:6px;">
        <div class="spinner" aria-hidden="true"></div>
        ${showDoctorActions ? `
        <div style="display:flex;gap:8px;justify-content:center;align-items:center;">
          <button id="notifyBtn" style="padding:6px 10px;font-size:0.9rem;border-radius:6px;border:1px solid #ddd;background:#fff;color:#333;">Notify</button>
          <button id="resendBtn" style="padding:6px 10px;font-size:0.9rem;border-radius:6px;border:1px solid #ddd;background:#fff;color:#333;">Resend</button>
        </div>` : ""}
        <div style="margin-top:4px;font-weight:600;color:inherit;">${message}</div>
      </div>
    `;

    // Bind lightweight handlers for the small buttons (placeholders).
    if (!showDoctorActions) {
      return;
    }

    try {
      const notify = document.getElementById('notifyBtn');
      const resend = document.getElementById('resendBtn');
      if (notify) {
        notify.addEventListener('click', () => {
          console.log('Notify clicked (placeholder)');
          // non-invasive placeholder action
        });
      }
      if (resend) {
        resend.addEventListener('click', () => {
          console.log('Resend clicked (placeholder)');
        });
      }
    } catch (e) {
      // ignore binding errors
    }
  }

  function renderControlsState() {
    if (!dom.callStatePanel) return;

    dom.callStatePanel.style.display = "flex";
    dom.callStatePanel.style.alignItems = "center";
    dom.callStatePanel.style.justifyContent = "center";

    dom.callStatePanel.innerHTML = `
      <div class="call-controls">
        <button class="control-btn active" id="camToggleBtn" type="button" aria-label="Toggle camera">
          <i data-lucide="video"></i>
        </button>
        <button class="control-btn active" id="micToggleBtn" type="button" aria-label="Toggle microphone">
          <i data-lucide="mic"></i>
        </button>
        <button class="control-btn" id="settingsBtn" type="button" aria-label="Call settings">
          <i data-lucide="settings"></i>
        </button>
      </div>
    `;

    if (window.lucide) {
      window.lucide.createIcons();
    }

    bindControlButtons();
  }

  function bindControlButtons() {
    const camToggleBtn = document.getElementById("camToggleBtn");
    const micToggleBtn = document.getElementById("micToggleBtn");
    const settingsBtn = document.getElementById("settingsBtn");

    if (camToggleBtn) {
      camToggleBtn.addEventListener("click", () => {
        state.cameraEnabled = !state.cameraEnabled;
        if (state.localStream) {
          state.localStream.getVideoTracks().forEach((track) => {
            track.enabled = state.cameraEnabled;
          });
        }
        camToggleBtn.classList.toggle("active", state.cameraEnabled);
        camToggleBtn.classList.toggle("off", !state.cameraEnabled);
      });
    }

    if (micToggleBtn) {
      micToggleBtn.addEventListener("click", () => {
        state.micEnabled = !state.micEnabled;
        if (state.localStream) {
          state.localStream.getAudioTracks().forEach((track) => {
            track.enabled = state.micEnabled;
          });
        }
        micToggleBtn.classList.toggle("active", state.micEnabled);
        micToggleBtn.classList.toggle("off", !state.micEnabled);
      });
    }

    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => {
        const settingsModal = document.getElementById("settingsModal");
        if (settingsModal) {
          settingsModal.classList.remove("hidden");
        }
      });
    }
  }

  async function ensureLocalStream() {
    if (state.localStream) return;

    // Allow test mode to skip camera (append ?test=1 to URL)
    const isTestMode = /test=1|skipCamera=true/i.test(window.location.search);
    if (isTestMode) {
      console.log("🧪 TEST MODE: Skipping camera - will connect signaling only");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.alert("Use HTTPS. Camera not supported.");
      throw new Error("getUserMedia unsupported. Use HTTPS or localhost.");
    }

    try {
      // Mobile-optimized constraints
      const constraints = {
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      attachLocalVideo();
    } catch (error) {
      console.error("Camera permission error:", error);

      // Distinguish between different error types
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        throw new Error("Camera permission denied. Please allow camera access in browser settings.");
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        throw new Error("No camera found on this device.");
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        throw new Error("Camera is already in use by another app. Close other apps and retry.");
      } else {
        throw new Error(`Camera error: ${error.message}. Try refreshing the page.`);
      }
    }
  }

  async function startMedia() {
    await ensureLocalStream();
  }

  async function startInitialCameraPreview() {
    await ensureLocalStream();
  }

  function ensurePeerConnection() {
    if (state.peerConnection) {
      return state.peerConnection;
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);

    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, state.localStream);
      });
    }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      state.remoteStream = remoteStream;

      const remoteVideo = document.getElementById("remoteVideo");
      if (remoteVideo) {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.muted = false;
        void tryPlayVideo(remoteVideo);
      }

      renderRoleVideoLayout();
      setCallState(CALL_STATE.CONNECTED);
      showLiveCallUI();
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
      console.log("ICE candidate sent");
      sendSignal("candidate", {
        roomId: state.roomId,
        candidate: event.candidate
      });
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === "connected" || pc.connectionState === "completed") {
        console.log("✅ CONNECTED");
        setCallState(CALL_STATE.CONNECTED);
        return;
      }

      if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
        setCallState(CALL_STATE.WAITING);
        clearRemoteVideo();
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        setCallState(CALL_STATE.CONNECTED);
        return;
      }

      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        setCallState(CALL_STATE.WAITING);
        clearRemoteVideo();
      }
    };

    state.peerConnection = pc;
    return pc;
  }

  function sendSignal(eventName, payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;

    state.socket.send(JSON.stringify({
      type: eventName,
      ...payload
    }));
  }

  function createSignalSocketAdapter(socket, signalServerUrl) {
    const adapter = {
      readyState: WebSocket.CONNECTING,
      onopen: null,
      onerror: null,
      onclose: null,
      onmessage: null,
      send(message) {
        if (adapter.readyState !== WebSocket.OPEN) {
          return;
        }

        let data = message;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch (_error) {
            return;
          }
        }

        const type = String(data.type || "").trim();
        const roomId = String(data.roomId || data.room || "").trim();

        if (type === "join" || type === "join-room") {
          socket.emit("join-room", { roomId, room: roomId, role: data.role });
          console.log("join-room sent:", roomId, data.role);
          return;
        }

        if (type === "patient-proceed") {
          socket.emit("patient-proceed", { roomId, room: roomId });
          return;
        }

        if (type === "doctor-begin") {
          socket.emit("doctor-begin", { roomId, room: roomId });
          return;
        }

        if (type === "patient-report-redirect") {
          socket.emit("patient-report-redirect", { roomId, room: roomId });
          return;
        }

        if (type === "ready") {
          socket.emit("ready", {
            roomId,
            room: roomId
          });
          return;
        }

        if (type === "offer") {
          socket.emit("offer", {
            roomId,
            room: roomId,
            offer: data.offer
          });
          return;
        }

        if (type === "answer") {
          socket.emit("answer", {
            roomId,
            room: roomId,
            answer: data.answer
          });
          return;
        }

        if (type === "candidate" || type === "ice-candidate") {
          socket.emit("ice-candidate", {
            roomId,
            room: roomId,
            candidate: data.candidate
          });
        }
      },
      close() {
        socket.disconnect();
        adapter.readyState = WebSocket.CLOSED;
      },
      url: signalServerUrl
    };

    socket.on("connect", () => {
      adapter.readyState = WebSocket.OPEN;
      if (typeof adapter.onopen === "function") {
        adapter.onopen();
      }
    });

    socket.on("disconnect", () => {
      adapter.readyState = WebSocket.CLOSED;
      if (typeof adapter.onclose === "function") {
        adapter.onclose();
      }
    });

    socket.on("connect_error", (err) => {
      if (typeof adapter.onerror === "function") {
        adapter.onerror(err);
      }
    });

    const forward = (type, payload = {}) => {
      if (typeof adapter.onmessage === "function") {
        adapter.onmessage({
          data: JSON.stringify({ type, ...payload })
        });
      }
    };

    socket.on("joined-room", (payload) => forward("joined-room", payload));
    socket.on("doctor-joined", (payload) => forward("doctor-joined", payload));
    socket.on("patient-proceed", (payload) => forward("patient-proceed", payload));
    socket.on("doctor-begin", (payload) => forward("doctor-begin", payload));
    socket.on("patient-report-redirect", (payload) => forward("patient-report-redirect", payload));
    socket.on("user-joined", (payload) => forward("user-joined", payload));
    socket.on("ready", (payload) => forward("ready", payload));
    socket.on("both-users-connected", (payload) => forward("both-users-connected", payload));
    socket.on("connect-success", (payload) => forward("connect-success", payload));
    socket.on("waiting-state", (payload) => forward("waiting-state", payload));
    socket.on("user-left", (payload) => forward("user-left", payload));
    socket.on("offer", (payload) => forward("offer", { offer: payload }));
    socket.on("answer", (payload) => forward("answer", { answer: payload }));
    socket.on("ice-candidate", (payload) => forward("ice-candidate", { candidate: payload?.candidate || payload }));
    socket.on("error-message", (payload) => forward("error-message", payload || {}));

    return adapter;
  }

  async function createOffer() {
    const pc = ensurePeerConnection();

    if (state.hasCreatedOffer) {
      return;
    }

    if (pc.signalingState !== "stable") {
      return;
    }

    state.hasCreatedOffer = true;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    sendSignal("offer", {
      roomId: state.roomId,
      offer
    });
    console.log("Offer sent");
  }

  async function flushPendingIceCandidates() {
    if (!state.peerConnection || !state.pendingIceCandidates.length) {
      return;
    }

    const pending = [...state.pendingIceCandidates];
    state.pendingIceCandidates = [];

    for (const candidate of pending) {
      try {
        await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("ICE error", error);
      }
    }
  }

  async function handleOffer(message) {
    const pc = ensurePeerConnection();
    console.log("Offer received");

    state.hasCreatedOffer = false;

    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await flushPendingIceCandidates();

    sendSignal("answer", {
      roomId: state.roomId,
      answer
    });
    console.log("Answer sent");
  }

  async function handleAnswer(message) {
    if (!state.peerConnection) return;
    console.log("Answer received");
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
    await flushPendingIceCandidates();
    state.hasCreatedOffer = false;
  }

  async function handleIceCandidate(message) {
    if (!message.candidate) return;

    console.log("ICE candidate received");

    if (!state.peerConnection) {
      state.pendingIceCandidates.push(message.candidate);
      return;
    }

    const hasRemoteDescription = Boolean(state.peerConnection.remoteDescription);
    if (!hasRemoteDescription) {
      state.pendingIceCandidates.push(message.candidate);
      return;
    }

    try {
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
    } catch (error) {
      console.error("ICE error", error);
    }
  }

  async function connectSocket() {
    await connectSignaling();
  }

  async function initSocket() {
    await connectSocket();
  }

  async function startWebRTC() {
    ensurePeerConnection();
  }

  function syncRoomInUrl(roomId) {
    const room = normalizeRoomId(roomId);
    if (!room) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("room", room);
    url.searchParams.set("role", state.role);
    window.history.replaceState(null, "", url.toString());
  }

  function storeDoctorUrl(roomId) {
    const normalizedRoom = normalizeRoomId(roomId);
    if (!normalizedRoom) {
      return;
    }

    state.doctorUrl = buildAbsoluteDoctorUrl(normalizedRoom);
    localStorage.setItem("doctorRoomId", normalizedRoom);
    localStorage.setItem("doctorUrl", state.doctorUrl);
  }

  function ensureDoctorRoomGenerated() {
    if (state.role !== "doctor") {
      return;
    }

    if (!state.roomId) {
      state.roomId = normalizeRoomId(generateRoomId());
    }

    if (!state.roomId) {
      return;
    }

    syncRoomInUrl(state.roomId);
    storeDoctorUrl(state.roomId);
  }

  async function startConsultationSession() {
    if (isStarted || window.callStarted || window.started) {
      return;
    }

    isStarted = true;
    window.callStarted = true;
    window.started = true;
    state.hasManualSessionStart = false;

    try {
      showWaitingState(state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient");

      if (!state.roomId) {
        throw new Error("Missing room ID. Open connected-device.html with ?room=ABC123&role=doctor or ?room=ABC123&role=patient");
      }

      localStorage.setItem("roomId", state.roomId);
      if (state.role === "doctor") {
        storeDoctorUrl(state.roomId);
      }

      try {
        await startMedia();
      } catch (cameraError) {
        const cameraMessage = String(cameraError?.message || cameraError || "");
        if (/camera|permission|notallowed|notfound|notreadable/i.test(cameraMessage)) {
          console.warn("Camera unavailable, continuing with signaling only:", cameraMessage);
          state.localStream = null;
        } else {
          throw cameraError;
        }
      }
      await initSocket();
      await startWebRTC();

      if (state.role === "patient") {
        // removed auto-send patient-proceed to require manual click
      }

      showWaitingState(state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient");
    } catch (error) {
      const errorMessage = error?.message || "Failed to start call";
      isStarted = false;
      window.callStarted = false;
      window.started = false;
      state.hasManualSessionStart = false;

      const readableMessage = /socket|signaling|connect/i.test(errorMessage)
        ? `Unable to connect signaling server${state.signalServerUrl ? ` (${state.signalServerUrl})` : ""}. ${errorMessage}`
        : errorMessage;
      showInitialState();
      setCallState(CALL_STATE.WAITING, readableMessage);
      console.error(error);

      const isCameraPermissionError = /camera|permission/i.test(errorMessage);
      if (!/socket\.io|signaling|connect|websocket|socket/i.test(errorMessage) && !isCameraPermissionError) {
        window.alert(errorMessage);
      }

      console.warn("Failed to start consultation:", readableMessage);
    } finally {
      if (dom.testingBtn && state.callState !== CALL_STATE.CONNECTED) {
        dom.testingBtn.disabled = true;
        dom.testingBtn.textContent = state.role === "patient" ? "Waiting for Doctor" : "Waiting for Patient";
        dom.testingBtn.classList.remove("ultrasound-ready");
        dom.testingBtn.classList.add("is-waiting");
      }
    }
  }

  async function handleTestingClick(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (state.role === "patient") {
      if (state.doctorBeginReceived) {
        console.log("Patient clicked Ultra Sound in Progress -> Redirecting to ultrasound-scanning.html");
        window.location.href = `ultrasound-scanning.html?room=${state.roomId}&role=patient`;
      } else {
        console.log("Patient clicked Doctor Joined -> Sending patient-proceed");
        state.hasClickedProceed = true;
        sendSignal("patient-proceed");
        if (dom.testingBtn) {
          dom.testingBtn.textContent = "Waiting for Doctor to start...";
          dom.testingBtn.disabled = true;
          dom.testingBtn.classList.remove("ultrasound-ready");
          dom.testingBtn.classList.add("is-waiting");
        }
      }
    } else if (state.role === "doctor") {
      if (!state.doctorClickedBegin) {
        state.doctorClickedBegin = true;
        if (dom.testingBtn) {
          dom.testingBtn.textContent = "Ultrasound Scanning";
          dom.testingBtn.disabled = false;
          dom.testingBtn.classList.remove("is-waiting");
          dom.testingBtn.classList.add("ultrasound-ready");
        }
        sendSignal("doctor-begin");
        console.log("Doctor clicked to begin consultation");

        if (state.socket && state.socket.readyState === WebSocket.OPEN && state.roomId && state.isJoined) {
          sendSignal("ready", { roomId: state.roomId });
        }
      } else {
        console.log("Doctor clicked Ultrasound Scanning button -> Redirecting to ultrasound scanning page");
        window.location.href = `ultrasound-scanning.html?room=${state.roomId}&role=doctor`;
      }
    }
  }

  function stopMediaStreams() {
    if (state.localStream) {
      state.localStream.getTracks().forEach((track) => track.stop());
      state.localStream = null;
    }

    if (state.remoteStream) {
      state.remoteStream.getTracks().forEach((track) => track.stop());
      state.remoteStream = null;
    }
  }

  function cleanupConnection() {
    if (state.peerConnection) {
      state.peerConnection.ontrack = null;
      state.peerConnection.onicecandidate = null;
      state.peerConnection.close();
      state.peerConnection = null;
    }

    if (state.socket) {
      state.socket.onopen = null;
      state.socket.onmessage = null;
      state.socket.onerror = null;
      state.socket.onclose = null;
      if (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING) {
        state.socket.close();
      }
      state.socket = null;
    }

    state.pendingIceCandidates = [];
    state.callState = CALL_STATE.WAITING;
    state.isJoined = false;
    state.hasCreatedOffer = false;
    state.isPatientConnected = false;
    state.hasManualSessionStart = false;
    state.hasShownDoctorJoinedPopup = false;
    state.hasClickedProceed = false;
    state.doctorBeginReceived = false;
    state.doctorClickedBegin = false;
    sessionStorage.removeItem(getJoinSessionKey("doctor"));
    sessionStorage.removeItem(getJoinSessionKey("patient"));
    isStarted = false;
    window.callStarted = false;
    window.started = false;
    clearRemoteVideo();
    resetVideoPlaceholders();
    hideDoctorJoinedPopup();
    showInitialUI();
  }

  function bindStaticButtons() {
    if (dom.testingBtn) {
      dom.testingBtn.onclick = (event) => {
        if (dom.testingBtn.disabled) {
          event.preventDefault();
          return;
        }

        handleTestingClick(event);
      };
    }

    if (dom.backBtn) {
      dom.backBtn.addEventListener("click", () => {
        cleanupConnection();
        stopMediaStreams();
        
        const params = new URLSearchParams(window.location.search);
        const role = params.get('role');
        const room = params.get('room') || '';
        
        if (role === 'doctor') {
          window.location.href = `doctor-dashboard.html${window.location.search}`;
        } else {
          showInitialState();
        }
      });
    }

    if (dom.doctorJoinedModalAction) {
      dom.doctorJoinedModalAction.addEventListener("click", hideDoctorJoinedPopup);
    }

    if (dom.doctorJoinedModal) {
      dom.doctorJoinedModal.addEventListener("click", (event) => {
        if (event.target === dom.doctorJoinedModal) {
          hideDoctorJoinedPopup();
        }
      });
    }

    if (dom.endBtn) {
      dom.endBtn.addEventListener("click", () => {
        cleanupConnection();
        stopMediaStreams();
      });
    }

    if (dom.flipBtn) {
      dom.flipBtn.addEventListener("click", () => {
        isFlipped = !isFlipped;
        const video = document.getElementById("localVideo");
        if (video) {
          video.style.transform = isFlipped ? "scaleX(-1)" : "scaleX(1)";
        }
      });
    }

    dom.panelFullscreenButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        const panel = button.closest(".feed-card");
        if (!panel) return;

        try {
          if (!document.fullscreenElement) {
            await panel.requestFullscreen();
          } else {
            await document.exitFullscreen();
          }
        } catch (error) {
          console.error("Fullscreen error", error);
        }
      });
    });

    dom.panelMenuButtons.forEach((button) => {
      button.addEventListener("click", () => {
        console.log("Panel menu clicked", button.closest(".feed-card")?.id || "unknown-panel");
      });
    });
  }

  function bindPremiumButtonEffects() {
    const buttons = document.querySelectorAll(".btn-primary, .btn-danger, .primary-btn, .danger-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const rect = btn.getBoundingClientRect();
        const ripple = document.createElement("span");
        ripple.classList.add("ripple");
        ripple.style.left = `${e.clientX - rect.left}px`;
        ripple.style.top = `${e.clientY - rect.top}px`;
        btn.appendChild(ripple);
        window.setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  function getJoinSessionKey(role) {
    return `${role || "unknown"}-joined:${state.roomId || "default"}`;
  }

  async function init() {
    isStarted = false;
    window.callStarted = false;
    window.started = false;
    readConfig();
    cacheDom();
    bindStaticButtons();
    bindPremiumButtonEffects();
    setInitialState();

    // Warn about HTTPS requirement on mobile
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
      const isHttps = window.location.protocol === "https:";
      const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

      if (!isHttps && !isLocalhost) {
        console.warn("Mobile requires HTTPS for camera access, but using HTTP. Some devices may need tunneling.");
      }
    }

    if (state.roomId) {
      setSubtitle(`Patient Video Consultation - Room ${state.roomId}`);
    }

    if (state.role === "doctor" && !state.roomId) {
      setSubtitle("Patient Video Consultation - Ready to create room");
    }

    ensureDoctorRoomGenerated();

    try {
      // Start the local camera on page load for the active role.
      // Doctor and patient previews are initialized automatically; remote peer media stays untouched.
      if (state.role === "doctor" || state.role === "patient") {
        await startInitialCameraPreview();
      }

      if ((state.role === "doctor" || state.role === "patient") && sessionStorage.getItem(getJoinSessionKey(state.role)) !== "1") {
        await startConsultationSession();
        sessionStorage.setItem(getJoinSessionKey(state.role), "1");
      }

    } catch (error) {
      setCallState(CALL_STATE.WAITING, "Waiting...");
      setConnectionLabel("Waiting");
      console.error("Init error:", error);
    }
  }



  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
