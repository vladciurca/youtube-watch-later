interface HeaderProps {
  matchCount: number | null;
  totalCount: number;
  source: string | null;
  syncedAt: string | null;
  live: boolean;
  partial: boolean;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onRefresh: () => void;
}

function formatSyncedAt(syncedAt: string): string {
  const date = new Date(syncedAt);
  if (Number.isNaN(date.getTime())) return syncedAt;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isStale(syncedAt: string | null, live: boolean): boolean {
  if (!live || !syncedAt) return true;
  const then = new Date(syncedAt).getTime();
  if (Number.isNaN(then)) return true;
  return Date.now() - then > 24 * 60 * 60 * 1000;
}

export function Header({
  matchCount,
  totalCount,
  source,
  syncedAt,
  live,
  partial,
  filtersOpen,
  onToggleFilters,
  onRefresh,
}: HeaderProps) {
  const stale = isStale(syncedAt, live);

  return (
    <header className="topbar">
      <button
        type="button"
        className="filters-toggle"
        aria-expanded={filtersOpen}
        onClick={onToggleFilters}
      >
        Filters
      </button>
      <div className="topbar-copy">
        <p className="count">
          <strong>{matchCount === null ? "—" : matchCount}</strong>
          <span> of {totalCount || "—"}</span>
        </p>
        <div className="sync-meta">
          <p className="source">
            {source ?? "Loading library…"}
            {syncedAt ? ` · last synced ${formatSyncedAt(syncedAt)}` : null}
            {partial ? " · sync incomplete" : null}
          </p>
          <button type="button" className="refresh-btn" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>
      <p className={`sync-hint${partial ? " is-partial" : stale ? " is-stale" : ""}`}>
        {partial
          ? "Sync incomplete — the last scrape looked truncated, so missing videos were not marked Dropped. Run Sync Watch Later again, then Refresh."
          : stale
            ? "Progress is stale or still the 2026-08-27 seed. Run Sync Watch Later in the Chrome extension after you watch on YouTube, then Refresh."
            : "Refresh loads the last extension sync. Opening a video here does not mark it watched."}
      </p>
    </header>
  );
}
