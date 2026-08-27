import type { Video } from "../types";
import { VideoRow } from "./VideoRow";

interface VideoListProps {
  videos: Video[];
  loading: boolean;
  error: string | null;
  onReset: () => void;
}

export function VideoList({ videos, loading, error, onReset }: VideoListProps) {
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
        <p>Could not load the Watch Later snapshot.</p>
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
        <VideoRow key={video.id} video={video} />
      ))}
    </div>
  );
}
