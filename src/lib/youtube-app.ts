import type { Video } from "../types";
import { youtubeResumeUrl } from "./library";

/** iPhone, iPad, and iPadOS 13+ (which reports as MacIntel). */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1;
}

/** youtube:// URL, with a resume time only when one exists. */
export function youtubeAppUrl(video: Pick<Video, "id" | "t">): string {
  const start =
    typeof video.t === "number" && Number.isFinite(video.t) && video.t > 0
      ? `&t=${Math.round(video.t)}s`
      : "";
  return `youtube://www.youtube.com/watch?v=${video.id}${start}`;
}

/** Row href: app scheme on iOS, the existing https resume URL on desktop. */
export function youtubeOpenHref(video: Pick<Video, "id" | "t">): string {
  return isIOS() ? youtubeAppUrl(video) : youtubeResumeUrl(video);
}

/**
 * On iOS Safari and home-screen PWAs, follow the youtube:// href so the
 * YouTube app opens (universal https links often stay inside the PWA). If
 * the app does not open, fall back to the https resume URL.
 * Desktop rows keep a normal target=_blank https link and should not call this.
 */
export function openYouTubeFromRow(
  event: { preventDefault: () => void },
  video: Video,
): void {
  if (!isIOS()) return;
  event.preventDefault();
  const web = youtubeResumeUrl(video);
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
