import type { Video, WatchStatus } from "../types";
import {
  formatRemaining,
  publishedDisplay,
  thumbnailUrl,
  youtubeResumeUrl,
} from "../lib/library";

export interface QueueControls {
  /** False when the queue backend could not be reached. */
  available: boolean;
  queued: boolean;
  onToggle: (video: Video) => void;
}

interface VideoRowProps {
  video: Video;
  queue?: QueueControls;
}

const STATUS_CLASS: Record<WatchStatus, string> = {
  "Almost finished": "almost",
  "Partially watched": "partial",
  "Barely started": "barely",
  "Not started": "notstarted",
};

export function StarButton({
  video,
  queue,
}: {
  video: Video;
  queue: QueueControls;
}) {
  const done = video.remainingSec <= 0;
  const disabled = !queue.available || (done && !queue.queued);
  const label = queue.queued ? "Remove from Queue" : "Add to Queue";
  const title = !queue.available
    ? "Queue is unavailable right now"
    : done && !queue.queued
      ? "Done videos can't be queued"
      : label;
  return (
    <button
      type="button"
      className={`star-btn${queue.queued ? " is-on" : ""}`}
      aria-pressed={queue.queued}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => queue.onToggle(video)}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.6l6.1-.8z"
          fill={queue.queued ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function VideoRow({ video, queue }: VideoRowProps) {
  const pct = Math.min(100, Math.max(0, video.watchedPct));
  const published = publishedDisplay(video);

  const row = (
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

  if (!queue) return row;
  return (
    <div className="video-item">
      {row}
      <div className="row-actions">
        <StarButton video={video} queue={queue} />
      </div>
    </div>
  );
}
