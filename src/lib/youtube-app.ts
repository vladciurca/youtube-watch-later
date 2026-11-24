import type { Video } from "../types";
import { youtubeResumeUrl } from "./library";

/** iPhone, iPad, and iPadOS 13+ (which reports as MacIntel). */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
}

export function youtubeAppUrl(video: Pick<Video, "id">): string {
  return `youtube://www.youtube.com/watch?v=${video.id}`;
}

/**
 * On iOS Safari and home-screen PWAs, the youtube:// scheme hands off to the
 * YouTube app (universal https links often stay inside the PWA). If the app
 * does not open, fall back to the https resume URL, which still works on the
 * web and may open the app via universal links in Safari.
 */
export function openInYouTube(video: Video): void {
  const web = youtubeResumeUrl(video);
  if (!isIOS()) {
    window.open(web, "_blank", "noopener,noreferrer");
    return;
  }

  const fallback = window.setTimeout(() => {
    window.location.href = web;
  }, 900);
  const cancel = () => {
    window.clearTimeout(fallback);
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", cancel);
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") cancel();
  };
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", cancel);
  window.location.href = youtubeAppUrl(video);
}
