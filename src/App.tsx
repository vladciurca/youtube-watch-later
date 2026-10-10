import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { VideoList } from "./components/VideoList";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  categoryCounts,
  filterAndSortVideos,
  statusCounts,
} from "./lib/library";
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
    try {
      await loadLibrary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [loadLibrary]);

  return (
    <div className={`app${filtersOpen ? " filters-open" : ""}`}>
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
          matchCount={loading ? null : visible.length}
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
        />
        <VideoList
          videos={visible}
          loading={loading}
          error={error}
          onReset={resetFilters}
        />
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
