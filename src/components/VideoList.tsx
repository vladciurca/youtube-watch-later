import type { Video } from "../types";
import { VideoRow } from "./VideoRow";
import type { DoneControls, QueueControls } from "./VideoRow";

interface VideoListProps {
  videos: Video[];
  loading: boolean;
  error: string | null;
  onReset: () => void;
  done?: DoneControls;
  queue?: {
    available: boolean;
    ids: Set<string>;
    onToggle: QueueControls["onToggle"];
  };
}

export function VideoList({ videos, loading, error, onReset, queue, done }: VideoListProps) {
  if (loading) {
    return (
      <div className="list" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="video-row skeleton" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state" role="alert">
        <p>Could not load the Watch Later library.</p>
        <p className="empty-detail">{error}</p>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="empty-state">
        <p>No videos match these filters.</p>
        <button type="button" className="reset-btn" onClick={onReset}>
          Reset filters
        </button>
      </div>
    );
  }

  return (
    <div className="list">
      {videos.map((video) => (
        <VideoRow
          key={video.id}
          video={video}
          done={done}
          queue={
            queue
              ? {
                  available: queue.available,
                  queued: queue.ids.has(video.id),
                  onToggle: queue.onToggle,
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
