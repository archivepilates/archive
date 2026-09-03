(function archivePilatesVideoWatchTracker() {
  "use strict";

  const TRACKER_VERSION = "2026-09-01.1";
  const TRACKER_MARKER = "data-archive-pilates-video-watch-tracker";
  const EVENT_ENDPOINT = "https://asia-northeast3-archive-pilates.cloudfunctions.net/videoWatchEventApi";
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  const HEARTBEAT_MS = 60 * 1000;
  const SAMPLE_MS = 5 * 1000;
  const MILESTONES = [25, 50, 75, 90];
  const STUDENT_SHARE_ROUTES = Object.freeze({
    "/private-lesson-support-movement-a-260829": {
      videoCode: "A260829",
      videoTitle: "8/29 지지와 움직임 A팀 · 수강생 공유",
    },
    "/private-lesson-support-movement-b-260829": {
      videoCode: "B260829",
      videoTitle: "8/29 지지와 움직임 B팀 · 수강생 공유",
    },
    "/private-lesson-support-movement-c-260830": {
      videoCode: "C260830",
      videoTitle: "8/30 지지와 움직임 C팀 · 수강생 공유",
    },
    "/private-lesson-support-movement-d-260830": {
      videoCode: "D260830",
      videoTitle: "8/30 지지와 움직임 D팀 · 수강생 공유 (B팀 영상 대체)",
    },
  });

  const trackedRoute = resolveTrackedVideoRoute(window.location.pathname);
  const memberIdentity = String(window.MEMBER_HASH || "").trim();
  if (!trackedRoute || !memberIdentity || !window.crypto?.subtle) return;
  if (document.documentElement.hasAttribute(TRACKER_MARKER)) return;
  document.documentElement.setAttribute(TRACKER_MARKER, TRACKER_VERSION);

  void startTracker().catch(function ignoreTrackerFailure() {
    // Playback must remain independent from analytics availability.
  });

  async function startTracker() {
    const iframe = await waitForYouTubeIframe();
    if (!iframe) return;

    const buyerKey = await sha256(memberIdentity);
    const videoCode = trackedRoute.videoCode;
    const contentType = trackedRoute.contentType;
    const pagePath = trackedRoute.pagePath;
    const accountHint = maskAccount(String(window.MEMBER_UID || ""));
    let buyerName = readBuyerName();
    const videoTitle = trackedRoute.videoTitle || readVideoTitle(videoCode);
    const sessionStorageKey = `ap-video-watch:${contentType}:${buyerKey.slice(0, 16)}:${videoCode}`;
    const trackerState = {
      activeSeconds: 0,
      completed: false,
      currentPlayerState: -1,
      lastHeartbeatAt: Date.now(),
      lastSampleAt: Date.now(),
      milestones: new Set(),
      player: null,
      pollId: 0,
      sessionId: "",
      sessionLastActivityAt: 0,
    };

    configureYouTubeIframe(iframe);
    restoreSession();
    emit("page_view");

    const youtubeApi = await waitForYouTubeApi();
    if (!youtubeApi) return;

    trackerState.player = new youtubeApi.Player(iframe, {
      events: {
        onReady: handlePlayerReady,
        onStateChange: handlePlayerStateChange,
        onError: handlePlayerError,
      },
    });

    window.addEventListener("pagehide", handlePageHide, { capture: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    function handlePlayerReady() {
      trackerState.currentPlayerState = safePlayerNumber("getPlayerState", -1);
      trackerState.lastSampleAt = Date.now();
      if (trackerState.currentPlayerState === youtubeApi.PlayerState.PLAYING) emit("play");
      trackerState.pollId = window.setInterval(samplePlayback, SAMPLE_MS);
    }

    function handlePlayerStateChange(event) {
      sampleActiveTime();
      trackerState.currentPlayerState = Number(event.data);
      trackerState.lastSampleAt = Date.now();

      if (event.data === youtubeApi.PlayerState.PLAYING) {
        emit("play");
        return;
      }
      if (event.data === youtubeApi.PlayerState.PAUSED) {
        checkMilestones();
        emit("pause", true);
        return;
      }
      if (event.data === youtubeApi.PlayerState.ENDED) {
        checkMilestones();
        if (!trackerState.completed) {
          trackerState.completed = true;
          emit("complete", true);
        }
      }
    }

    function handlePlayerError() {
      emit("player_error");
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "hidden") return;
      sampleActiveTime();
      if (trackerState.activeSeconds > 0) emit("heartbeat", true);
    }

    function handlePageHide() {
      sampleActiveTime();
      emit("pagehide", true, true);
      if (trackerState.pollId) window.clearInterval(trackerState.pollId);
    }

    function samplePlayback() {
      sampleActiveTime();
      checkMilestones();
      const now = Date.now();
      if (trackerState.activeSeconds > 0 && now - trackerState.lastHeartbeatAt >= HEARTBEAT_MS) {
        trackerState.lastHeartbeatAt = now;
        emit("heartbeat", true);
      }
    }

    function sampleActiveTime() {
      const now = Date.now();
      if (trackerState.currentPlayerState === youtubeApi.PlayerState.PLAYING) {
        trackerState.activeSeconds += Math.min(15, Math.max(0, (now - trackerState.lastSampleAt) / 1000));
      }
      trackerState.lastSampleAt = now;
    }

    function checkMilestones() {
      const duration = safePlayerNumber("getDuration", 0);
      const position = safePlayerNumber("getCurrentTime", 0);
      if (duration <= 0) return;
      const progress = Math.min(100, Math.max(0, (position / duration) * 100));
      for (const milestone of MILESTONES) {
        if (progress < milestone || trackerState.milestones.has(milestone)) continue;
        trackerState.milestones.add(milestone);
        emit(`progress_${milestone}`, true);
      }
    }

    function emit(eventType, includeActiveTime, keepalive) {
      if (!buyerName) buyerName = readBuyerName();
      const sessionId = currentSessionId();
      const activeDeltaSeconds = includeActiveTime
        ? Math.round(trackerState.activeSeconds * 10) / 10
        : 0;
      if (includeActiveTime) trackerState.activeSeconds = 0;

      const payload = {
        eventId: createId(),
        sessionId,
        buyerKey,
        buyerName,
        accountHint,
        contentType,
        videoCode,
        videoTitle,
        eventType,
        pagePath,
        positionSeconds: safePlayerNumber("getCurrentTime", 0),
        durationSeconds: safePlayerNumber("getDuration", 0),
        activeDeltaSeconds,
        clientOccurredAt: new Date().toISOString(),
        trackerVersion: TRACKER_VERSION,
      };

      void fetch(EVENT_ENDPOINT, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        keepalive: Boolean(keepalive),
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
      }).catch(function ignoreNetworkFailure() {
        // Analytics failure must never interrupt playback.
      });
    }

    function safePlayerNumber(method, fallback) {
      try {
        const value = Number(trackerState.player?.[method]?.());
        return Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : fallback;
      } catch {
        return fallback;
      }
    }

    function restoreSession() {
      try {
        const stored = JSON.parse(window.sessionStorage.getItem(sessionStorageKey) || "null");
        if (
          stored &&
          typeof stored.id === "string" &&
          /^[A-Za-z0-9_-]{16,80}$/.test(stored.id) &&
          Date.now() - Number(stored.lastActivityAt || 0) <= SESSION_IDLE_MS
        ) {
          trackerState.sessionId = stored.id;
          trackerState.sessionLastActivityAt = Number(stored.lastActivityAt || 0);
        }
      } catch {
        // A blocked sessionStorage only reduces session continuity.
      }
    }

    function currentSessionId() {
      const now = Date.now();
      if (!trackerState.sessionId || now - trackerState.sessionLastActivityAt > SESSION_IDLE_MS) {
        trackerState.sessionId = createId();
        trackerState.milestones.clear();
        trackerState.completed = false;
      }
      trackerState.sessionLastActivityAt = now;
      try {
        window.sessionStorage.setItem(
          sessionStorageKey,
          JSON.stringify({ id: trackerState.sessionId, lastActivityAt: now }),
        );
      } catch {
        // The in-memory session remains valid when storage is unavailable.
      }
      return trackerState.sessionId;
    }
  }

  function resolveTrackedVideoRoute(pathname) {
    const normalizedPath = `/${String(pathname || "").replace(/^\/+|\/+$/g, "")}`.toLowerCase();
    const paidMatch = normalizedPath.match(/^\/archive-method-watch-([a-z0-9-]{2,60})$/i);
    if (paidMatch) {
      return {
        contentType: "paid",
        pagePath: normalizedPath,
        videoCode: paidMatch[1].toUpperCase(),
        videoTitle: "",
      };
    }
    const studentShare = STUDENT_SHARE_ROUTES[normalizedPath];
    if (!studentShare) return null;
    return {
      contentType: "student_share",
      pagePath: normalizedPath,
      videoCode: studentShare.videoCode,
      videoTitle: studentShare.videoTitle,
    };
  }

  function configureYouTubeIframe(iframe) {
    const original = iframe.getAttribute("src") || iframe.src;
    const url = new URL(original, window.location.href);
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("origin", window.location.origin);
    url.searchParams.set("playsinline", "1");
    const next = url.toString();
    if (original !== next) iframe.src = next;
  }

  function waitForYouTubeIframe() {
    return new Promise(function resolveIframe(resolve) {
      const find = function findIframe() {
        return document.querySelector(
          'iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"]',
        );
      };
      const existing = find();
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(function inspectMutations() {
        const iframe = find();
        if (!iframe) return;
        observer.disconnect();
        window.clearTimeout(timeoutId);
        resolve(iframe);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const timeoutId = window.setTimeout(function stopWaiting() {
        observer.disconnect();
        resolve(null);
      }, 45_000);
    });
  }

  function waitForYouTubeApi() {
    return new Promise(function resolveApi(resolve) {
      if (window.YT?.Player) {
        resolve(window.YT);
        return;
      }
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        document.head.appendChild(script);
      }
      const startedAt = Date.now();
      const pollId = window.setInterval(function checkApi() {
        if (window.YT?.Player) {
          window.clearInterval(pollId);
          resolve(window.YT);
          return;
        }
        if (Date.now() - startedAt > 20_000) {
          window.clearInterval(pollId);
          resolve(null);
        }
      }, 100);
    });
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(`archive-pilates-video-watch:v1:${value}`);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), function toHex(byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function maskAccount(value) {
    const account = value.trim();
    if (!account) return "";
    const at = account.indexOf("@");
    if (at > 0) {
      const local = account.slice(0, at);
      const domain = account.slice(at + 1);
      return `${local.slice(0, 1)}***@${domain}`.slice(0, 80);
    }
    return `${account.slice(0, 2)}***`.slice(0, 80);
  }

  function readBuyerName() {
    const globals = [
      window.MEMBER_NAME,
      window.MEMBER_NICKNAME,
      window.MEMBER_NICK,
    ];
    for (const value of globals) {
      const name = normalizeBuyerName(value);
      if (name) return name;
    }

    const selectors = [
      "#member_profile .profile-info > .sm-padding",
      "#member_profile .profile-info > div:first-child",
      "#mobile_slide_menu_wrap .member-info",
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const clone = element.cloneNode(true);
      clone.querySelectorAll(".email-info, a, button, small").forEach(function removeMetadata(node) {
        node.remove();
      });
      const name = normalizeBuyerName(clone.textContent);
      if (name) return name;
    }
    return "";
  }

  function normalizeBuyerName(value) {
    const name = String(value || "")
      .replace(/[<>\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s*님$/, "")
      .slice(0, 40);
    if (name.length < 2 || name.includes("@") || /\d{3,}/.test(name)) return "";
    if (!/^[가-힣A-Za-z][가-힣A-Za-z .'-]{1,39}$/.test(name)) return "";
    if (/^(관리자|소유자|로그인|회원|마이페이지)$/i.test(name)) return "";
    return name;
  }

  function readVideoTitle(videoCode) {
    const heading = document.querySelector(".ap-watch h1, .ap-watch-title, main h1");
    return String(heading?.textContent || `ARCHIVE METHOD ${videoCode}`).replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function createId() {
    if (typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    const random = new Uint8Array(16);
    window.crypto.getRandomValues(random);
    return `${Date.now().toString(36)}_${Array.from(random, function toHex(byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("")}`;
  }
})();
