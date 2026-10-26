import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./components/Header";
import type { LibraryView } from "./components/Header";
import { QueueList } from "./components/QueueList";
import { Sidebar } from "./components/Sidebar";
import { VideoList } from "./components/VideoList";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  categoryCounts,
  filterAndSortVideos,
  statusCounts,
} from "./lib/library";
import {
  applyQueueOp,
  emptyQueue,
  fetchQueue,
  queueIds,
  queuedVideos,
  reorderIds,
  sendQueueOp,
} from "./lib/queue";
import type { Queue, QueueOp } from "./lib/queue";
import type {
  LibraryFilters,
  SortKey,
  Video,
  VideoCategory,
  VideoLibrary,
  WatchStatus,
} from "./types";

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<LibraryView>("all");
  const [queue, setQueue] = useState<Queue>(emptyQueue);
  const [queueReady, setQueueReady] = useState(false);
  const [queueAvailable, setQueueAvailable] = useState(true);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const queueRef = useRef<Queue>(queue);
  const queuePending = useRef(0);
  // Bumped on every local change so an older in-flight read cannot overwrite it.
  const queueEpoch = useRef(0);
  const queueChain = useRef<Promise<unknown>>(Promise.resolve());

  const commitQueue = useCallback((next: Queue) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const loadQueue = useCallback(async () => {
    if (queuePending.current > 0) return;
    const epoch = queueEpoch.current;
    try {
      const next = await fetchQueue();
      if (queuePending.current > 0 || epoch !== queueEpoch.current) return;
      commitQueue(next);
      setQueueAvailable(true);
    } catch {
      setQueueAvailable(false);
    } finally {
      setQueueReady(true);
    }
  }, [commitQueue]);

  const mutateQueue = useCallback(
    (op: QueueOp) => {
      queueEpoch.current += 1;
      commitQueue(applyQueueOp(queueRef.current, op));
      setQueueNotice(null);
      queuePending.current += 1;
      queueChain.current = queueChain.current.then(async () => {
        try {
          const saved = await sendQueueOp(op);
          queuePending.current -= 1;
          if (queuePending.current === 0) {
            queueEpoch.current += 1;
            commitQueue(saved);
          }
        } catch (err) {
          queuePending.current -= 1;
          setQueueNotice(
            err instanceof Error ? err.message : "Could not update the Queue",
          );
          if (queuePending.current === 0) await loadQueue();
        }
      });
    },
    [commitQueue, loadQueue],
  );

  useEffect(() => {
    const first = setTimeout(() => void loadQueue(), 0);
    // The same Queue on phone and laptop: re-read it whenever this tab is shown again.
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadQueue();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [loadQueue]);

  const ids = useMemo(() => queueIds(queue), [queue]);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const queued = useMemo(() => queuedVideos(videos, ids), [videos, ids]);
  // A queued video that is now Done leaves the Queue (the server prunes it too).
  const queuedDone = useMemo(
    () => (videos.length === 0 ? [] : ids.filter((id) => !queued.some((v) => v.id === id) && videos.some((v) => v.id === id))),
    [videos, ids, queued],
  );
  useEffect(() => {
    if (!queueReady) return;
    for (const id of queuedDone) mutateQueue({ type: "remove", id });
  }, [queueReady, queuedDone, mutateQueue]);

  const toggleQueue = useCallback(
    (video: Video) => {
      mutateQueue({ type: queueRef.current.items.some((i) => i.id === video.id) ? "remove" : "add", id: video.id });
    },
    [mutateQueue],
  );

  const moveInQueue = useCallback(
    (id: string, type: "top" | "up" | "down") => mutateQueue({ type, id }),
    [mutateQueue],
  );

  const reorderQueue = useCallback(
    (id: string, insertIndex: number) => {
      // Reorder against the visible order so hidden ids keep their relative place.
      const shown = queuedVideos(videos, queueIds(queueRef.current)).map((v) => v.id);
      const next = reorderIds(shown, id, insertIndex);
      const hidden = queueIds(queueRef.current).filter((x) => !shown.includes(x));
      mutateQueue({ type: "reorder", ids: [...next, ...hidden] });
    },
    [videos, mutateQueue],
  );

  const loadLibrary = useCallback(async () => {
    const apply = (data: VideoLibrary, fromLive: boolean) => {
      setVideos(data.videos);
      setSource(data.source);
      setSyncedAt(data.syncedAt ?? null);
      setLive(fromLive || data.live === true);
      setPartial(data.partial === true);
      setError(null);
    };

    try {
      const liveResponse = await fetch("/api/library", { cache: "no-store" });
      if (liveResponse.ok) {
        const liveData = (await liveResponse.json()) as VideoLibrary;
        if (Array.isArray(liveData.videos) && liveData.videos.length > 0) {
          apply(liveData, true);
          return;
        }
      }
    } catch {
      // Seed JSON remains the fallback until the first successful sync.
    }

    const response = await fetch("/data/videos.json");
    if (!response.ok) {
      throw new Error(`Snapshot request failed (${response.status})`);
    }
    apply((await response.json()) as VideoLibrary, false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await loadLibrary();
        if (cancelled) return;
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadLibrary]);

  const visible = useMemo(
    () => filterAndSortVideos(videos, filters),
    [videos, filters],
  );

  const counts = useMemo(
    () =>
      statusCounts(videos, {
        categories: filters.categories,
        query: filters.query,
      }),
    [videos, filters.categories, filters.query],
  );

  const topicCounts = useMemo(
    () => categoryCounts(videos, { query: filters.query }),
    [videos, filters.query],
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const selectStatus = useCallback((status: WatchStatus) => {
    setFilters((prev) => {
      const already = prev.statuses.length === 1 && prev.statuses[0] === status;
      return { ...prev, statuses: already ? [] : [status] };
    });
  }, []);

  const selectCategory = useCallback((category: VideoCategory) => {
    setFilters((prev) => {
      const already = prev.categories.length === 1 && prev.categories[0] === category;
      return { ...prev, categories: already ? [] : [category] };
    });
  }, []);

  const refreshLibrary = useCallback(async () => {
    setLoading(true);
    void loadQueue();
    try {
      await loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [loadLibrary, loadQueue]);

  return (
    <div
      className={`app${filtersOpen ? " filters-open" : ""}${view === "queue" ? " queue-view" : ""}`}
    >
      <Sidebar
        filters={filters}
        counts={counts}
        categoryCounts={topicCounts}
        resultCount={visible.length}
        onSelectStatus={selectStatus}
        live={live}
        onToggleDropped={() =>
          setFilters((prev) => ({ ...prev, includeDropped: !prev.includeDropped }))
        }
        onSelectCategory={selectCategory}
        onQueryChange={(query) => setFilters((prev) => ({ ...prev, query }))}
        onSortChange={(sort: SortKey) => setFilters((prev) => ({ ...prev, sort }))}
        onReset={resetFilters}
        onClose={() => setFiltersOpen(false)}
      />
      <div className="main">
        <Header
          matchCount={loading ? null : view === "queue" ? queued.length : visible.length}
          totalCount={videos.length}
          source={source}
          syncedAt={syncedAt}
          live={live}
          partial={partial}
          filtersOpen={filtersOpen}
          filters={filters}
          activeFilters={activeFilterCount(filters)}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          onQueryChange={(query) => setFilters((prev) => ({ ...prev, query }))}
          onSortChange={(sort: SortKey) => setFilters((prev) => ({ ...prev, sort }))}
          onRefresh={() => void refreshLibrary()}
          view={view}
          queueCount={queueReady && !loading ? queued.length : null}
          onViewChange={(next) => {
            setView(next);
            setFiltersOpen(false);
          }}
        />
        {queueNotice ? (
          <p className="queue-notice" role="alert">
            {queueNotice}
          </p>
        ) : null}
        {view === "queue" ? (
          <QueueList
            videos={queued}
            loading={loading || !queueReady}
            error={error}
            available={queueAvailable}
            onToggle={toggleQueue}
            onMove={moveInQueue}
            onReorder={reorderQueue}
          />
        ) : (
          <VideoList
            videos={visible}
            loading={loading}
            error={error}
            onReset={resetFilters}
            queue={{ available: queueAvailable, ids: idSet, onToggle: toggleQueue }}
          />
        )}
      </div>
      {filtersOpen ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close filters"
          onClick={() => setFiltersOpen(false)}
        />
      ) : null}
    </div>
  );
}
