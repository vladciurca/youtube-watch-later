import type { LibraryFilters, SortKey, VideoCategory, WatchStatus } from "../types";
import { WATCH_STATUSES } from "../types";
import { CATEGORY_OPTIONS, SORT_OPTIONS } from "../lib/library";

interface SidebarProps {
  filters: LibraryFilters;
  counts: Record<WatchStatus | "Dropped", number>;
  categoryCounts: Record<VideoCategory, number>;
  resultCount: number;
  onSelectStatus: (status: WatchStatus) => void;
  live: boolean;
  onToggleDropped: () => void;
  onSelectCategory: (category: VideoCategory) => void;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: SortKey) => void;
  onReset: () => void;
}

function Chip({
  label,
  count,
  selected,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  tone: string;
}) {
  return (
    <button
      type="button"
      className={`chip chip-${tone}${selected ? " is-on" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="chip-label">{label}</span>
      <span className="chip-count">{count}</span>
    </button>
  );
}

export function Sidebar({
  filters,
  counts,
  categoryCounts,
  resultCount,
  onSelectStatus,
  live,
  onToggleDropped,
  onSelectCategory,
  onQueryChange,
  onSortChange,
  onReset,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <p className="eyebrow">{live ? "YouTube · live" : "YouTube · snapshot"}</p>
        <h1>Watch Later</h1>
        <p className="owner">Vlad Ciurca</p>
      </div>

      <section className="filter-block">
        <div className="filter-heading">
          <h2>Status</h2>
          <button type="button" className="text-btn" onClick={onReset}>
            Reset
          </button>
        </div>
        <div className="chip-stack">
          {WATCH_STATUSES.map((status) => (
            <Chip
              key={status}
              label={status}
              count={counts[status]}
              selected={filters.statuses.includes(status)}
              onClick={() => onSelectStatus(status)}
              tone={toneForStatus(status)}
            />
          ))}
          <Chip
            label="Dropped"
            count={counts.Dropped}
            selected={filters.includeDropped}
            onClick={onToggleDropped}
            tone="dropped"
          />
        </div>
      </section>

      <section className="filter-block">
        <h2>Category</h2>
        <div className="chip-stack">
          {CATEGORY_OPTIONS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              count={categoryCounts[option.key]}
              selected={filters.categories.includes(option.key)}
              onClick={() => onSelectCategory(option.key)}
              tone={option.key}
            />
          ))}
        </div>
      </section>

      <section className="filter-block">
        <h2>Search</h2>
        <label className="search-field">
          <span className="sr-only">Search title or author</span>
          <input
            type="search"
            placeholder="Title or author"
            value={filters.query}
            onChange={(event) => onQueryChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </section>

      <section className="filter-block">
        <h2>Sort</h2>
        <div className="sort-stack" role="radiogroup" aria-label="Sort videos">
          {SORT_OPTIONS.map((option) => (
            <label key={option.key} className="sort-option">
              <input
                type="radio"
                name="sort"
                value={option.key}
                checked={filters.sort === option.key}
                onChange={() => onSortChange(option.key)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </section>

      <p className="sidebar-foot">
        {resultCount} showing ·{" "}
        {filters.sort === "saved"
          ? live
            ? "YouTube order, newest saved first"
            : "no WL rank yet; leftover time until first sync"
          : filters.sort === "remaining"
            ? "least leftover first, Done last"
            : filters.sort === "published"
              ? "newest publish date first"
              : filters.sort === "watchedPct"
                ? "highest watched % first"
                : "sorted"}
      </p>
    </aside>
  );
}

function toneForStatus(status: WatchStatus): string {
  switch (status) {
    case "Almost finished":
      return "almost";
    case "Partially watched":
      return "partial";
    case "Barely started":
      return "barely";
    case "Not started":
      return "notstarted";
  }
}
