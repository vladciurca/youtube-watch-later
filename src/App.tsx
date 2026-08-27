import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { VideoList } from "./components/VideoList";
import {
  DEFAULT_FILTERS,
  filterAndSortVideos,
  statusCounts,
} from "./lib/library";
import type { LibraryFilters, SortKey, Video, VideoLibrary, WatchStatus } from "./types";

export default function App() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/data/videos.json");
        if (!response.ok) {
          throw new Error(`Snapshot request failed (${response.status})`);
        }
        const data = (await response.json()) as VideoLibrary;
        if (cancelled) return;
        setVideos(data.videos);
        setSource(data.source);
        setError(null);
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
  }, []);

  const visible = useMemo(
    () => filterAndSortVideos(videos, filters),
    [videos, filters],
  );

  const counts = useMemo(
    () =>
      statusCounts(videos, {
        techBusinessOnly: filters.techBusinessOnly,
        query: filters.query,
      }),
    [videos, filters.techBusinessOnly, filters.query],
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const toggleStatus = useCallback((status: WatchStatus) => {
    setFilters((prev) => {
      const selected = prev.statuses.includes(status)
        ? prev.statuses.filter((item) => item !== status)
        : [...prev.statuses, status];
      return { ...prev, statuses: selected };
    });
  }, []);

  return (
    <div className={`app${filtersOpen ? " filters-open" : ""}`}>
      <Sidebar
        filters={filters}
        counts={counts}
        resultCount={visible.length}
        onToggleStatus={toggleStatus}
        onToggleDropped={() =>
          setFilters((prev) => ({ ...prev, includeDropped: !prev.includeDropped }))
        }
        onToggleTech={() =>
          setFilters((prev) => ({
            ...prev,
            techBusinessOnly: !prev.techBusinessOnly,
          }))
        }
        onQueryChange={(query) => setFilters((prev) => ({ ...prev, query }))}
        onSortChange={(sort: SortKey) => setFilters((prev) => ({ ...prev, sort }))}
        onReset={resetFilters}
      />
      <div className="main">
        <Header
          matchCount={loading ? null : visible.length}
          source={source}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
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
