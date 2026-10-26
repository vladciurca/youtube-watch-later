import type { Video, WatchStatus } from "../types";
import {
  formatRemaining,
  isDone,
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

export interface DoneControls {
  /** False when the Done backend could not be reached. */
  available: boolean;
  onToggle: (video: Video) => void;
}

interface VideoRowProps {
  video: Video;
  queue?: QueueControls;
  done?: DoneControls;
}

const STATUS_CLASS: Record<WatchStatus, string> = {
  Done: "done",
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
  const done = isDone(video);
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

export function DoneButton({ video, done }: { video: Video; done: DoneControls }) {
  const finished = isDone(video);
  const manual = video.markedDone === true;
  // Done from watch progress (95%+) can't be undone here; only an explicit Done can.
  const locked = finished && !manual;
  const label = manual ? "Mark not done" : "Mark done";
  const title = !done.available
    ? "Saving is unavailable right now"
    : locked
      ? "Finished (95%+ watched)"
      : label;
  return (
    <button
      type="button"
      className={`done-btn${finished ? " is-on" : ""}`}
      aria-pressed={finished}
      aria-label={locked ? "Finished (95%+ watched)" : label}
      title={title}
      disabled={!done.available || locked}
      onClick={() => done.onToggle(video)}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          fill={finished ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M7.8 12.4l3 3 5.4-6"
          fill="none"
          stroke={finished ? "#0b0b0d" : "currentColor"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function VideoRow({ video, queue, done }: VideoRowProps) {
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
          {video.markedDone ? (
            <span className="status-pill marked-done">Marked done</span>
          ) : null}
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
          <span className="remaining">{isDone(video) ? "Done" : formatRemaining(video.remainingSec)}</span>
        </div>
      </div>
    </a>
  );

  if (!queue && !done) return row;
  return (
    <div className="video-item">
      {row}
      <div className="row-actions">
        {done ? <DoneButton video={video} done={done} /> : null}
        {queue ? <StarButton video={video} queue={queue} /> : null}
      </div>
    </div>
  );
}
