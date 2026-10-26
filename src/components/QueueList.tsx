import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Video } from "../types";
import { DoneButton, StarButton, VideoRow } from "./VideoRow";
import type { DoneControls, QueueControls } from "./VideoRow";

interface QueueListProps {
  videos: Video[];
  loading: boolean;
  error: string | null;
  available: boolean;
  onToggle: (video: Video) => void;
  done: DoneControls;
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

interface DragHandleProps {
  label: string;
  onStart: (clientY: number) => void;
  onMove: (clientY: number) => void;
  onEnd: (commit: boolean) => void;
  onNudge: (type: "up" | "down") => void;
}

/**
 * Touch uses native, non-passive touch listeners on the handle itself: iOS
 * Safari only lets a page stop scrolling from touchstart/touchmove with
 * preventDefault (React's synthetic touch handlers are passive), and touch
 * events keep going to the element they started on. Mouse and pen use pointer
 * events with capture. Only the handle blocks scrolling (touch-action: none).
 */
function DragHandle({ label, onStart, onMove, onEnd, onNudge }: DragHandleProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const handlers = useRef({ onStart, onMove, onEnd });
  useEffect(() => {
    handlers.current = { onStart, onMove, onEnd };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active: number | null = null;
    const find = (event: TouchEvent) =>
      Array.from(event.changedTouches).find((touch) => touch.identifier === active);

    const start = (event: TouchEvent) => {
      if (active !== null) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      active = touch.identifier;
      event.preventDefault();
      handlers.current.onStart(touch.clientY);
    };
    const move = (event: TouchEvent) => {
      const touch = find(event);
      if (!touch) return;
      event.preventDefault();
      handlers.current.onMove(touch.clientY);
    };
    const end = (event: TouchEvent) => {
      if (!find(event)) return;
      event.preventDefault();
      active = null;
      handlers.current.onEnd(event.type === "touchend");
    };

    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end, { passive: false });
    el.addEventListener("touchcancel", end, { passive: false });
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, []);

  const mouse = (event: ReactPointerEvent<HTMLElement>) => event.pointerType !== "touch";

  return (
    <button
      ref={ref}
      type="button"
      className="drag-handle"
      aria-label={`Drag to reorder: ${label}`}
      title="Drag to reorder"
      onPointerDown={(event) => {
        if (!mouse(event) || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        handlers.current.onStart(event.clientY);
      }}
      onPointerMove={(event) => {
        if (mouse(event) && event.currentTarget.hasPointerCapture(event.pointerId)) {
          handlers.current.onMove(event.clientY);
        }
      }}
      onPointerUp={(event) => {
        if (!mouse(event) || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        handlers.current.onEnd(true);
      }}
      onPointerCancel={(event) => {
        if (mouse(event)) handlers.current.onEnd(false);
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onNudge("up");
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onNudge("down");
        }
      }}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          d="M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export function QueueList({
  videos,
  loading,
  error,
  available,
  onToggle,
  done,
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

  const startDrag = (id: string, y: number) => {
    stop();
    session.current = {
      id,
      startY: y,
      startScroll: window.scrollY,
      lastY: y,
      raf: 0,
    };
    setDrag(measure());
    session.current.raf = requestAnimationFrame(tick);
  };

  const updateDrag = (y: number) => {
    if (!session.current) return;
    session.current.lastY = y;
    setDrag(measure());
  };

  const finishDrag = (commit: boolean) => {
    if (!session.current) return;
    const final = commit ? measure() : null;
    stop();
    if (final) {
      const original = videos.findIndex((video) => video.id === final.id);
      if (final.insertIndex !== original) onReorder(final.id, final.insertIndex);
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
            <DragHandle
              label={video.title}
              onStart={(y) => startDrag(video.id, y)}
              onMove={updateDrag}
              onEnd={finishDrag}
              onNudge={(type) => onMove(video.id, type)}
            />
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
              <DoneButton video={video} done={done} />
              <StarButton video={video} queue={controls} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
