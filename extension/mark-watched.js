// Injected into a youtube.com/watch tab by the extension (isolated world) to
// push one video to "watched" the legitimate way: seek the player near the end
// and let it play, so YouTube's own player saves the progress. It never calls
// YouTube internals and never fakes network pings.
(() => {
  const DEFAULTS = {
    beforeEndSec: 4, // seek this far before the end
    playTimeoutMs: 20000, // max wait for the tail to play out
    settleMs: 3500, // after the end, let the player flush progress
    metaTimeoutMs: 25000, // wait for a <video> with a duration
    adTimeoutMs: 45000, // max time spent waiting out / skipping ads
    hiddenGraceMs: 8000, // hidden page that still has no video after this: report "hidden"
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function seekTarget(durationSec, beforeEndSec) {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
    return Math.max(0, durationSec - beforeEndSec);
  }

  /** Map the visible player error text to a result status. */
  function classifyErrorText(text) {
    const t = String(text || "").toLowerCase();
    if (!t.trim()) return null;
    if (/(confirm your age|age-restricted|age restricted|inappropriate for some users)/.test(t)) {
      return "age_restricted";
    }
    if (/private video|this video is private/.test(t)) return "private";
    if (/(unavailable|has been removed|no longer available|isn.t available|not available|deleted)/.test(t)) {
      return "unavailable";
    }
    if (/(members-only|join this channel|requires payment|rent or buy)/.test(t)) return "unavailable";
    return null;
  }

  function currentVideoId() {
    try {
      return new URL(location.href).searchParams.get("v");
    } catch {
      return null;
    }
  }

  function playerErrorText() {
    const nodes = document.querySelectorAll(
      "ytd-player-error-message-renderer, yt-player-error-message-renderer, #error-screen, .ytp-error, .ytp-error-content-wrap",
    );
    for (const node of nodes) {
      const text = node.textContent?.trim();
      if (text) return text;
    }
    return "";
  }

  function adShowing() {
    return !!document.querySelector(".html5-video-player.ad-showing, .ad-showing");
  }

  function clickSkipIfAny() {
    const skip = document.querySelector(
      ".ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button-container",
    );
    if (skip instanceof HTMLElement && skip.offsetParent !== null) {
      skip.click();
      return true;
    }
    return false;
  }

  function mainVideo() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("#movie_player video") ||
      document.querySelector("video")
    );
  }

  async function markWatched(userOptions = {}) {
    const o = { ...DEFAULTS, ...userOptions };
    const expectedId = userOptions.videoId || currentVideoId();
    const started = Date.now();
    const result = (status, detail = "") => ({ status, detail, ms: Date.now() - started });

    // 1. Wait for the player (or a visible error page).
    let video = null;
    while (Date.now() - started < o.metaTimeoutMs) {
      const errorStatus = classifyErrorText(playerErrorText());
      if (errorStatus) return result(errorStatus, playerErrorText().slice(0, 120));
      video = mainVideo();
      if (video && (video.readyState >= 1 || Number.isFinite(video.duration))) break;
      // Chrome does not load media in hidden tabs/windows. Say so quickly so the
      // extension can bring the window forward instead of waiting out the timeout.
      if (document.hidden && Date.now() - started > o.hiddenGraceMs) return result("hidden");
      await sleep(300);
    }
    if (!video) return result(document.hidden ? "hidden" : "unavailable", "no player found");
    video.muted = true;
    video.volume = 0;

    // 2. Wait out / skip ads, then make sure real content is loaded.
    const adStart = Date.now();
    while (adShowing()) {
      if (Date.now() - adStart > o.adTimeoutMs) return result("ad_timeout");
      clickSkipIfAny();
      await sleep(500);
      video.muted = true;
    }
    video = mainVideo() || video;
    video.muted = true;

    const metaDeadline = Date.now() + 10000;
    while (!Number.isFinite(video.duration) && video.duration !== Infinity && Date.now() < metaDeadline) {
      await sleep(250);
    }
    if (!Number.isFinite(video.duration)) {
      // Live streams report Infinity.
      return result(video.duration === Infinity ? "live" : "stalled", "no duration");
    }
    if (document.querySelector(".html5-video-player.ytp-live")) return result("live");
    const duration = video.duration;

    // 3. Seek near the end and let the player play the tail.
    video.currentTime = seekTarget(duration, o.beforeEndSec);
    try {
      await video.play();
    } catch {
      // autoplay of a muted video should be allowed; keep going and check progress below
    }

    const playDeadline = Date.now() + o.playTimeoutMs;
    let reachedEnd = false;
    let lastTime = video.currentTime;
    let lastAdvance = Date.now();
    while (Date.now() < playDeadline) {
      if (expectedId && currentVideoId() !== expectedId) return result("navigated");
      if (adShowing()) {
        // A mid/post-roll: let it finish or skip it, then carry on.
        clickSkipIfAny();
        video.muted = true;
        if (Date.now() - adStart > o.adTimeoutMs + o.playTimeoutMs) return result("ad_timeout");
        await sleep(500);
        continue;
      }
      video = mainVideo() || video;
      video.muted = true;
      if (video.ended || video.currentTime >= duration - 0.25) {
        reachedEnd = true;
        break;
      }
      if (video.paused) {
        try {
          await video.play();
        } catch {
          // ignore
        }
      }
      if (video.currentTime > lastTime + 0.05) {
        lastTime = video.currentTime;
        lastAdvance = Date.now();
      } else if (Date.now() - lastAdvance > 8000) {
        return result("stalled", "playback stopped advancing");
      }
      await sleep(250);
    }
    if (!reachedEnd) return result("timeout", "tail did not finish playing");

    // 4. Give YouTube's player time to save progress, then confirm nothing navigated away.
    const settleUntil = Date.now() + o.settleMs;
    while (Date.now() < settleUntil) {
      if (expectedId && currentVideoId() !== expectedId) return result("navigated");
      await sleep(250);
    }
    return { ...result("ok"), duration };
  }

  window.__wlMarkWatched = markWatched;
  window.__wlMarkWatchedHelpers = { seekTarget, classifyErrorText, DEFAULTS };
})();
