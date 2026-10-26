import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Video } from "../types";
import { StarButton, VideoRow } from "./VideoRow";
import type { QueueControls } from "./VideoRow";

interface QueueListProps {
  videos: Video[];
  loading: boolean;
  error: string | null;
  available: boolean;
  onToggle: (video: Video) => void;
  onMove: (id: string, type: "top" | "up" | "down") => void;
  onReorder: (id: string, insertIndex: number) => void;
}

interface DragState {
  id: string;
  /** Pointer travel since the drag started, scroll included. */
  offset: number;
  /** Index among the other rows where the dragged row will land. */
  insertIndex: number;
}

const EDGE = 70;

export function QueueList({
  videos,
  loading,
  error,
  available,
  onToggle,
  onMove,
  onReorder,
}: QueueListProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const session = useRef<{
    id: string;
    startY: number;
    startScroll: number;
    lastY: number;
    raf: number;
  } | null>(null);

  const measure = useCallback((): DragState | null => {
    const s = session.current;
    if (!s) return null;
    const offset = s.lastY - s.startY + (window.scrollY - s.startScroll);
    let insertIndex = 0;
    for (const video of videos) {
      if (video.id === s.id) continue;
      const el = items.current.get(video.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (s.lastY > rect.top + rect.height / 2) insertIndex += 1;
    }
    return { id: s.id, offset, insertIndex };
  }, [videos]);

  const stop = useCallback(() => {
    const s = session.current;
    if (s) cancelAnimationFrame(s.raf);
    session.current = null;
    setDrag(null);
  }, []);

  useEffect(() => stop, [stop]);

  const tick = useCallback(function loop() {
    const s = session.current;
    if (!s) return;
    const vh = window.innerHeight;
    if (s.lastY < EDGE) window.scrollBy(0, -Math.ceil((EDGE - s.lastY) / 4));
    else if (s.lastY > vh - EDGE) window.scrollBy(0, Math.ceil((s.lastY - (vh - EDGE)) / 4));
    setDrag(measure());
    s.raf = requestAnimationFrame(loop);
  }, [measure]);

  const onHandleDown = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = {
      id,
      startY: event.clientY,
      startScroll: window.scrollY,
      lastY: event.clientY,
      raf: 0,
    };
    setDrag(measure());
    session.current.raf = requestAnimationFrame(tick);
  };

  const onHandleMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!session.current) return;
    session.current.lastY = event.clientY;
    setDrag(measure());
  };

  const onHandleUp = (event: ReactPointerEvent<HTMLElement>, commit: boolean) => {
    const s = session.current;
    if (!s) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const final = commit ? measure() : null;
    stop();
    if (final) {
      const original = videos.findIndex((video) => video.id === final.id);
      if (final.insertIndex !== original) {
        onReorder(final.id, final.insertIndex);
      }
    }
  };

  if (loading) {
    return (
      <div className="list" aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
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

  if (!available && videos.length === 0) {
    return (
      <div className="empty-state" role="status">
        <p>The Queue is unavailable right now.</p>
        <p className="empty-detail">It could not be reached. Try Refresh in a moment.</p>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="empty-state">
        <p>Your Queue is empty.</p>
        <p className="empty-detail">Tap the star on any video to add it here.</p>
      </div>
    );
  }

  const originalIndex = drag ? videos.findIndex((video) => video.id === drag.id) : -1;
  const others = drag ? videos.filter((video) => video.id !== drag.id) : videos;

  return (
    <div className={`list queue-list${drag ? " is-dragging" : ""}`}>
      {videos.map((video, index) => {
        const controls: QueueControls = { available, queued: true, onToggle };
        const dragging = drag?.id === video.id;
        let drop = "";
        if (drag && !dragging) {
          const otherIndex = others.findIndex((item) => item.id === video.id);
          if (drag.insertIndex === otherIndex && drag.insertIndex !== originalIndex) {
            drop = " drop-before";
          } else if (
            drag.insertIndex === others.length &&
            otherIndex === others.length - 1 &&
            drag.insertIndex !== originalIndex
          ) {
            drop = " drop-after";
          }
        }
        return (
          <div
            key={video.id}
            ref={(el) => {
              if (el) items.current.set(video.id, el);
              else items.current.delete(video.id);
            }}
            className={`video-item queue-item${dragging ? " is-drag" : ""}${drop}`}
            style={dragging ? { transform: `translateY(${drag.offset}px)` } : undefined}
          >
            <button
              type="button"
              className="drag-handle"
              aria-label={`Drag to reorder: ${video.title}`}
              title="Drag to reorder"
              onPointerDown={(event) => onHandleDown(event, video.id)}
              onPointerMove={onHandleMove}
              onPointerUp={(event) => onHandleUp(event, true)}
              onPointerCancel={(event) => onHandleUp(event, false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  onMove(video.id, "up");
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  onMove(video.id, "down");
                }
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <VideoRow video={video} />
            <div className="row-actions queue-actions">
              <button
                type="button"
                className="move-btn"
                aria-label="Move to top"
                title="Move to top"
                disabled={index === 0}
                onClick={() => onMove(video.id, "top")}
              >
                ⤒
              </button>
              <button
                type="button"
                className="move-btn"
                aria-label="Move up"
                title="Move up"
                disabled={index === 0}
                onClick={() => onMove(video.id, "up")}
              >
                ▲
              </button>
              <button
                type="button"
                className="move-btn"
                aria-label="Move down"
                title="Move down"
                disabled={index === videos.length - 1}
                onClick={() => onMove(video.id, "down")}
              >
                ▼
              </button>
              <StarButton video={video} queue={controls} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
