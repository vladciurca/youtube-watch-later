import type { Video, WatchStatus } from "../types";
import {
  formatRemaining,
  publishedDisplay,
  thumbnailUrl,
  youtubeResumeUrl,
} from "../lib/library";

interface VideoRowProps {
  video: Video;
}

const STATUS_CLASS: Record<WatchStatus, string> = {
  "Almost finished": "almost",
  "Partially watched": "partial",
  "Barely started": "barely",
  "Not started": "notstarted",
};

export function VideoRow({ video }: VideoRowProps) {
  const pct = Math.min(100, Math.max(0, video.watchedPct));
  const published = publishedDisplay(video);

  return (
    <a
      className="video-row"
      href={youtubeResumeUrl(video)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="thumb-wrap">
        <img
          className="thumb"
          src={thumbnailUrl(video.id)}
          alt=""
          width={160}
          height={90}
          loading="lazy"
        />
        <span className="duration-badge">{video.duration}</span>
      </div>
      <div className="video-body">
        <h3 className="video-title">{video.title}</h3>
        <p className="video-meta">
          <span>{video.author}</span>
          {published ? (
            <>
              <span className="dot" aria-hidden="true">
                ·
              </span>
              <span className="published">{published}</span>
            </>
          ) : null}
          <span className="dot" aria-hidden="true">
            ·
          </span>
          <span className={`status-pill ${STATUS_CLASS[video.status]}`}>
            {video.status}
          </span>
          {video.droppedAt ? (
            <span
              className="status-pill dropped"
              title="Not in the last full YouTube Watch Later scrape"
            >
              Dropped
            </span>
          ) : null}
        </p>
        <div className="progress-row">
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label={`${Math.round(pct)}% watched`}
          >
            <span className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="remaining">{formatRemaining(video.remainingSec)}</span>
        </div>
      </div>
    </a>
  );
}
