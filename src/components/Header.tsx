import { TOTAL_VIDEOS } from "../lib/library";

interface HeaderProps {
  matchCount: number | null;
  source: string | null;
  filtersOpen: boolean;
  onToggleFilters: () => void;
}

export function Header({
  matchCount,
  source,
  filtersOpen,
  onToggleFilters,
}: HeaderProps) {
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
          <span> of {TOTAL_VIDEOS}</span>
        </p>
        <p className="source">{source ?? "Loading snapshot…"}</p>
      </div>
    </header>
  );
}
