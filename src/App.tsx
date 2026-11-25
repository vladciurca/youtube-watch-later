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
  isDone,
  withDerivedStatus,
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
import { applyDoneOp, applyDoneOverrides, emptyDone, fetchDone, sendDoneOp } from "./lib/done";
import type { DoneList, DoneOp } from "./lib/done";
import {
  applyDownloadedMarks,
  applyDownloadedOp,
  emptyDownloaded,
  fetchDownloaded,
  sendDownloadedOp,
} from "./lib/downloaded";
import type { DownloadedList, DownloadedOp } from "./lib/downloaded";
import {
  enqueuePendingAction,
  flushPendingActions,
  pendingActionCount,
  readDoneCache,
  readDownloadedCache,
  readLibraryCache,
  readQueueCache,
  writeDoneCache,
  writeDownloadedCache,
  writeLibraryCache,
  writeQueueCache,
} from "./lib/offline-store";
import type {
  LibraryFilters,
  SortKey,
  Video,
  VideoCategory,
  VideoLibrary,
  WatchStatus,
} from "./types";

function formatCachedAt(cachedAt: string): string {
  const date = new Date(cachedAt);
  if (Number.isNaN(date.getTime())) return cachedAt;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function App() {
  const [rawVideos, setVideos] = useState<Video[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [doneList, setDoneList] = useState<DoneList>(emptyDone);
  const [doneAvailable, setDoneAvailable] = useState(true);
  const doneRef = useRef<DoneList>(doneList);
  const doneEpoch = useRef(0);
  const [view, setView] = useState<LibraryView>("all");
  const [queue, setQueue] = useState<Queue>(emptyQueue);
  const [queueReady, setQueueReady] = useState(false);
  const [queueAvailable, setQueueAvailable] = useState(true);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const queueRef = useRef<Queue>(queue);
  const queueEpoch = useRef(0);
  const [downloadedList, setDownloadedList] = useState<DownloadedList>(emptyDownloaded);
  const [downloadedReady, setDownloadedReady] = useState(false);
  const [downloadedAvailable, setDownloadedAvailable] = useState(true);
  const downloadedRef = useRef<DownloadedList>(downloadedList);
  const downloadedEpoch = useRef(0);
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine === false : false,
  );
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const pendingRef = useRef(0);
  const flushing = useRef(false);
  const flushAgain = useRef(false);

  const commitQueue = useCallback((next: Queue) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const commitDone = useCallback((next: DoneList) => {
    doneRef.current = next;
    setDoneList(next);
  }, []);

  const commitDownloaded = useCallback((next: DownloadedList) => {
    downloadedRef.current = next;
    setDownloadedList(next);
  }, []);

  const runFlush = useCallback(async () => {
    if (flushing.current) {
      flushAgain.current = true;
      return;
    }
    flushing.current = true;
    try {
      do {
        flushAgain.current = false;
        const result = await flushPendingActions({
          sendDone: (op) => sendDoneOp(op as DoneOp),
          sendQueue: (op) => sendQueueOp(op as QueueOp),
          sendDownloaded: (op) => sendDownloadedOp(op as DownloadedOp),
        });
        pendingRef.current = result.remaining.length;
        setPendingCount(result.remaining.length);
        if (result.remaining.length === 0 && !flushAgain.current) {
          if (result.results.done) {
            const saved = result.results.done as DoneList;
            doneEpoch.current += 1;
            commitDone(saved);
            await writeDoneCache(saved);
          }
          if (result.results.queue) {
            const saved = result.results.queue as Queue;
            queueEpoch.current += 1;
            commitQueue(saved);
            await writeQueueCache(saved);
          }
          if (result.results.downloaded) {
            const saved = result.results.downloaded as DownloadedList;
            downloadedEpoch.current += 1;
            commitDownloaded(saved);
            await writeDownloadedCache(saved);
          }
          setQueueNotice(null);
        } else if (result.error && typeof navigator !== "undefined" && navigator.onLine) {
          setQueueNotice(
            result.error instanceof Error ? result.error.message : "Could not sync changes",
          );
        }
      } while (flushAgain.current);
    } finally {
      flushing.current = false;
      const pending = await pendingActionCount();
      pendingRef.current = pending;
      setPendingCount(pending);
    }
  }, [commitDone, commitQueue, commitDownloaded]);

  const loadQueue = useCallback(async () => {
    if (pendingRef.current > 0) return;
    const epoch = queueEpoch.current;
    try {
      const next = await fetchQueue();
      if (pendingRef.current > 0 || epoch !== queueEpoch.current) return;
      commitQueue(next);
      await writeQueueCache(next);
      setQueueAvailable(true);
    } catch {
      const cached = await readQueueCache();
      if (cached && pendingRef.current === 0 && epoch === queueEpoch.current) commitQueue(cached);
      setQueueAvailable(true);
    } finally {
      setQueueReady(true);
    }
  }, [commitQueue]);

  const enqueueOp = useCallback(
    async (kind: "done" | "queue" | "downloaded", op: object) => {
      const next = await enqueuePendingAction({ kind, op });
      pendingRef.current = next.length;
      setPendingCount(next.length);
      if (typeof navigator === "undefined" || navigator.onLine) await runFlush();
    },
    [runFlush],
  );

  const mutateQueue = useCallback(
    (op: QueueOp) => {
      queueEpoch.current += 1;
      commitQueue(applyQueueOp(queueRef.current, op));
      setQueueNotice(null);
      void enqueueOp("queue", op);
    },
    [commitQueue, enqueueOp],
  );

  const videos = useMemo(
    () =>
      applyDownloadedMarks(
        withDerivedStatus(applyDoneOverrides(rawVideos, doneList)),
        downloadedList,
      ),
    [rawVideos, doneList, downloadedList],
  );

  const loadDoneList = useCallback(async () => {
    if (pendingRef.current > 0) return;
    const epoch = doneEpoch.current;
    try {
      const next = await fetchDone();
      if (pendingRef.current > 0 || epoch !== doneEpoch.current) return;
      commitDone(next);
      await writeDoneCache(next);
      setDoneAvailable(true);
    } catch {
      const cached = await readDoneCache();
      if (cached && pendingRef.current === 0 && epoch === doneEpoch.current) commitDone(cached);
      setDoneAvailable(true);
    }
  }, [commitDone]);

  const mutateDone = useCallback(
    (op: DoneOp) => {
      doneEpoch.current += 1;
      commitDone(applyDoneOp(doneRef.current, op));
      setQueueNotice(null);
      void enqueueOp("done", op);
    },
    [commitDone, enqueueOp],
  );

  const toggleDone = useCallback(
    (video: Video) => {
      const manual = doneRef.current.items.some((item) => item.id === video.id);
      mutateDone({ type: manual ? "undone" : "done", id: video.id });
    },
    [mutateDone],
  );

  const loadDownloadedList = useCallback(async () => {
    if (pendingRef.current > 0) return;
    const epoch = downloadedEpoch.current;
    try {
      const next = await fetchDownloaded();
      if (pendingRef.current > 0 || epoch !== downloadedEpoch.current) return;
      commitDownloaded(next);
      await writeDownloadedCache(next);
      setDownloadedAvailable(true);
    } catch {
      const cached = await readDownloadedCache();
      if (cached && pendingRef.current === 0 && epoch === downloadedEpoch.current) {
        commitDownloaded(cached);
      }
      setDownloadedAvailable(true);
    } finally {
      setDownloadedReady(true);
    }
  }, [commitDownloaded]);

  const mutateDownloaded = useCallback(
    (op: DownloadedOp) => {
      downloadedEpoch.current += 1;
      commitDownloaded(applyDownloadedOp(downloadedRef.current, op));
      setQueueNotice(null);
      void enqueueOp("downloaded", op);
    },
    [commitDownloaded, enqueueOp],
  );

  const toggleDownloaded = useCallback(
    (video: Video) => {
      const marked = downloadedRef.current.items.some((item) => item.id === video.id);
      mutateDownloaded({ type: marked ? "undownloaded" : "downloaded", id: video.id });
    },
    [mutateDownloaded],
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

    const cached = await readLibraryCache();

    try {
      const liveResponse = await fetch("/api/library", { cache: "no-store" });
      const fromSwCache = liveResponse.headers.get("X-Offline-Cache") === "1";
      if (liveResponse.ok) {
        const liveData = (await liveResponse.json()) as VideoLibrary;
        if (Array.isArray(liveData.videos) && liveData.videos.length > 0) {
          apply(liveData, true);
          if (fromSwCache) {
            setCachedAt(cached?.cachedAt ?? new Date().toISOString());
          } else {
            const savedAt = new Date().toISOString();
            await writeLibraryCache(liveData, savedAt);
            setCachedAt(savedAt);
          }
          return;
        }
      }
    } catch {
      // Seed JSON or the local cache remains the fallback.
    }

    if (cached) {
      apply(cached.library, cached.library.live === true);
      setCachedAt(cached.cachedAt);
      return;
    }

    const response = await fetch("/data/videos.json");
    if (!response.ok) {
      throw new Error(`Snapshot request failed (${response.status})`);
    }
    const seed = (await response.json()) as VideoLibrary;
    apply(seed, false);
    const fromSwCache = response.headers.get("X-Offline-Cache") === "1";
    const savedAt = new Date().toISOString();
    if (!fromSwCache) await writeLibraryCache(seed, savedAt);
    setCachedAt(savedAt);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadQueue();
        void loadDoneList();
        void loadDownloadedList();
        if (typeof navigator === "undefined" || navigator.onLine) void runFlush();
      }
    };
    const onOnline = () => {
      setOffline(false);
      void runFlush().then(() => {
        void loadLibrary();
        void loadQueue();
        void loadDoneList();
        void loadDownloadedList();
      });
    };
    const onOffline = () => setOffline(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [loadQueue, loadDoneList, loadDownloadedList, loadLibrary, runFlush]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const [cachedLib, cachedDone, cachedQueue, cachedDownloaded, pending] = await Promise.all([
          readLibraryCache(),
          readDoneCache(),
          readQueueCache(),
          readDownloadedCache(),
          pendingActionCount(),
        ]);
        if (cancelled) return;
        pendingRef.current = pending;
        setPendingCount(pending);
        if (cachedDone) commitDone(cachedDone);
        if (cachedQueue) {
          commitQueue(cachedQueue);
          setQueueReady(true);
        }
        if (cachedDownloaded) {
          commitDownloaded(cachedDownloaded);
          setDownloadedReady(true);
        }
        if (cachedLib) {
          setVideos(cachedLib.library.videos);
          setSource(cachedLib.library.source);
          setSyncedAt(cachedLib.library.syncedAt ?? null);
          setLive(cachedLib.library.live === true);
          setPartial(cachedLib.library.partial === true);
          setCachedAt(cachedLib.cachedAt);
          setLoading(false);
        }
        if (typeof navigator === "undefined" || navigator.onLine) void runFlush();
        await loadLibrary();
        if (cancelled) return;
        void loadQueue();
        void loadDoneList();
        void loadDownloadedList();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [commitDone, commitQueue, commitDownloaded, loadLibrary, loadQueue, loadDoneList, loadDownloadedList, runFlush]);

  const ids = useMemo(() => queueIds(queue), [queue]);
  const idSet = useMemo(() => new Set(ids), [ids]);
  const queued = useMemo(() => queuedVideos(videos, ids), [videos, ids]);
  // A queued video that is now Done leaves the Queue (the server prunes it too).
  const queuedDone = useMemo(
    () =>
      videos.length === 0
        ? []
        : ids.filter((id) => !queued.some((v) => v.id === id) && videos.some((v) => v.id === id)),
    [videos, ids, queued],
  );
  useEffect(() => {
    if (!queueReady) return;
    for (const id of queuedDone) mutateQueue({ type: "remove", id });
  }, [queueReady, queuedDone, mutateQueue]);

  const downloadedVideos = useMemo(
    () => videos.filter((video) => video.downloaded),
    [videos],
  );
  // Downloaded marks clear once a video is Done (95%+ or explicit), same as the server.
  const downloadedDone = useMemo(() => {
    if (videos.length === 0) return [];
    const doneIds = new Set(videos.filter((video) => isDone(video)).map((video) => video.id));
    return downloadedList.items.filter((item) => doneIds.has(item.id)).map((item) => item.id);
  }, [videos, downloadedList]);
  useEffect(() => {
    if (!downloadedReady) return;
    for (const id of downloadedDone) mutateDownloaded({ type: "undownloaded", id });
  }, [downloadedReady, downloadedDone, mutateDownloaded]);

  const toggleQueue = useCallback(
    (video: Video) => {
      mutateQueue({
        type: queueRef.current.items.some((i) => i.id === video.id) ? "remove" : "add",
        id: video.id,
      });
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

  const visible = useMemo(() => filterAndSortVideos(videos, filters), [videos, filters]);
  const downloadedVisible = useMemo(
    () => filterAndSortVideos(downloadedVideos, filters),
    [downloadedVideos, filters],
  );
  const listVideos = view === "downloaded" ? downloadedVisible : visible;

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
    void loadDoneList();
    void loadDownloadedList();
    if (typeof navigator === "undefined" || navigator.onLine) void runFlush();
    try {
      await loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [loadLibrary, loadQueue, loadDoneList, loadDownloadedList, runFlush]);

  const bannerTime = cachedAt ? formatCachedAt(cachedAt) : null;
  const pendingText =
    pendingCount > 0
      ? `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting to sync`
      : null;
  const offlineText = offline
    ? bannerTime
      ? `Offline, showing saved list from ${bannerTime}`
      : "Offline, showing saved list"
    : null;

  return (
    <div
      className={`app${filtersOpen ? " filters-open" : ""}${view === "queue" ? " queue-view" : ""}`}
    >
      <Sidebar
        filters={filters}
        counts={counts}
        categoryCounts={topicCounts}
        resultCount={listVideos.length}
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
          matchCount={
            loading ? null : view === "queue" ? queued.length : listVideos.length
          }
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
          downloadedCount={downloadedReady && !loading ? downloadedVideos.length : null}
          onViewChange={(next) => {
            setView(next);
            setFiltersOpen(false);
          }}
        />
        {offlineText ? (
          <p className="offline-banner" role="status">
            {offlineText}
            {pendingText ? ` · ${pendingText}` : null}
          </p>
        ) : pendingText ? (
          <p className="offline-banner is-pending" role="status">
            {pendingText}
          </p>
        ) : null}
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
            done={{ available: doneAvailable, onToggle: toggleDone }}
            downloaded={{ available: downloadedAvailable, onToggle: toggleDownloaded }}
            onMove={moveInQueue}
            onReorder={reorderQueue}
          />
        ) : (
          <VideoList
            videos={listVideos}
            loading={loading || (view === "downloaded" && !downloadedReady)}
            error={error}
            onReset={resetFilters}
            done={{ available: doneAvailable, onToggle: toggleDone }}
            downloaded={{ available: downloadedAvailable, onToggle: toggleDownloaded }}
            queue={{ available: queueAvailable, ids: idSet, onToggle: toggleQueue }}
            emptyTitle={
              view === "downloaded" ? "No downloaded videos yet." : undefined
            }
            emptyDetail={
              view === "downloaded"
                ? "After you download a video in the YouTube app, tap the download button on its row."
                : undefined
            }
            hideReset={view === "downloaded" && activeFilterCount(filters) === 0}
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
