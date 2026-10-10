import type { LibraryFilters, SortKey } from "../types";
import { SORT_OPTIONS } from "../lib/library";

interface HeaderProps {
  matchCount: number | null;
  totalCount: number;
  source: string | null;
  syncedAt: string | null;
  live: boolean;
  partial: boolean;
  filtersOpen: boolean;
  filters: LibraryFilters;
  activeFilters: number;
  onToggleFilters: () => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: SortKey) => void;
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
  filters,
  activeFilters,
  onToggleFilters,
  onQueryChange,
  onSortChange,
  onRefresh,
}: HeaderProps) {
  const stale = isStale(syncedAt, live);
  const hint = partial
    ? {
        full: "Sync incomplete — the last scrape looked truncated, so missing videos were not marked Dropped. Run Sync Watch Later again, then Refresh.",
        short: "Sync incomplete. Missing videos were kept. Sync again, then Refresh.",
      }
    : stale
      ? {
          full: "Progress is stale or still the 2026-08-27 seed. Run Sync Watch Later in the Chrome extension after you watch on YouTube, then Refresh.",
          short: "Progress may be stale. Sync in the extension, then Refresh.",
        }
      : {
          full: "Refresh loads the last extension sync. Opening a video here does not mark it watched.",
          short: "Refresh loads the last sync.",
        };

  return (
    <header className="topbar">
      <div className="mobile-tools">
        <label className="search-field mobile-search">
          <span className="sr-only">Search title or author</span>
          <input
            type="search"
            placeholder="Title or author"
            value={filters.query}
            onChange={(event) => onQueryChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
          />
        </label>
        <label className="mobile-sort-field">
          <span className="sr-only">Sort videos</span>
          <select
            className="mobile-sort"
            value={filters.sort}
            onChange={(event) => onSortChange(event.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="library-filters"
          onClick={onToggleFilters}
        >
          Filters
          {activeFilters > 0 ? (
            <span className="filters-badge">{activeFilters}</span>
          ) : null}
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
      </div>
      <p className={`sync-hint${partial ? " is-partial" : stale ? " is-stale" : ""}`}>
        <span className="hint-full">{hint.full}</span>
        <span className="hint-short">{hint.short}</span>
      </p>
    </header>
  );
}
