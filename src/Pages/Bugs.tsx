import SavedQueues from "../Components/SavedQueues";
import { filtersFromSearch, filtersToSearch } from "../bug-filters";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "../router";
import { exportBugs, loadBugs, loadDictionaries } from "../api";
import { useAuth } from "../AuthContext";
import RoleBadge from "../Components/RoleBadge";
import UserAvatar from "../Components/UserAvatar";
import { isBugStaff } from "../roles";
import type { BugFilters, BugPagination } from "../api";
import type { BugReport, Dictionaries, DictionaryName, DictionarySnapshot } from "../types";
import "./Bugs.css";

const emptyFilters: BugFilters = {
  search: "",
  status: [],
  version: [],
  priority: [],
  category: [],
  type: [],
  device: [],
};

const initialPagination: BugPagination = {
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 1,
};

function paginationItems(page: number, totalPages: number): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | "ellipsis-left" | "ellipsis-right"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) items.push("ellipsis-left");
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < totalPages - 1) items.push("ellipsis-right");
  items.push(totalPages);

  return items;
}

function PaginationControls({
  pagination,
  onPageChange,
  compact = false,
}: {
  pagination: BugPagination;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`pagination-controls${compact ? " is-compact" : ""}`}>
      <button
        type="button"
        className="pagination-nav"
        disabled={pagination.page <= 1}
        onClick={() => onPageChange(pagination.page - 1)}
      >
        PREVIOUS
      </button>

      {paginationItems(pagination.page, pagination.totalPages).map((item) =>
        typeof item === "number" ? (
          <button
            type="button"
            className={`pagination-page${item === pagination.page ? " is-active" : ""}`}
            aria-current={item === pagination.page ? "page" : undefined}
            key={item}
            onClick={() => onPageChange(item)}
          >
            {item}
          </button>
        ) : (
          <span className="pagination-ellipsis" aria-hidden="true" key={item}>…</span>
        ),
      )}

      <button
        type="button"
        className="pagination-nav"
        disabled={pagination.page >= pagination.totalPages}
        onClick={() => onPageChange(pagination.page + 1)}
      >
        NEXT
      </button>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function Badge({ value }: { value: DictionarySnapshot }) {
  return (
    <span
      className="dictionary-badge"
      style={value.color ? { borderColor: value.color, color: value.color } : undefined}
    >
      {value.label}
    </span>
  );
}

function FilterSelect({
  name,
  label,
  dictionary,
  value,
  dictionaries,
  onChange,
}: {
  name: keyof BugFilters;
  label: string;
  dictionary: DictionaryName;
  value: string[];
  dictionaries: Dictionaries | null;
  onChange: (name: keyof BugFilters, value: string[]) => void;
}) {
  const entries = dictionaries?.[dictionary] ?? [];
  const allSelected = entries.length > 0 && value.length === entries.length;
  const summary = value.length === 0 || allSelected
    ? "All"
    : `${value.length} selected`;

  return (
    <div className="filter-field">
      <span>{label}</span>
      <details className="multi-filter">
        <summary>{summary}</summary>
        <div className="multi-filter-options">
          <label>
            <input
              type="checkbox"
              checked={allSelected || value.length === 0}
              onChange={(event) => onChange(name, event.target.checked ? entries.map((entry) => entry.code) : [])}
            />
            <span>All</span>
          </label>
          {entries.map((entry) => (
            <label key={entry.id}>
              <input
                type="checkbox"
                checked={value.includes(entry.code)}
                onChange={(event) => onChange(name, event.target.checked
                  ? [...value, entry.code]
                  : value.filter((code) => code !== entry.code))}
              />
              <span>{entry.label}</span>
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

export default function BugsPage() {
  const { search: locationSearch } = useLocation();
  const navigate = useNavigate();
  const requestSequence = useRef(0);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const { auth, loading: authLoading } = useAuth();
  const [reports, setReports] = useState<BugReport[]>([]);
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [filters, setFilters] = useState<BugFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<BugFilters>(emptyFilters);
  const [pagination, setPagination] = useState<BugPagination>(initialPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState("");

  async function prepareExport() {
    setExporting(true);
    setExportText(null);
    setExportMessage("");
    try { setExportText(await exportBugs(appliedFilters, snapshot)); }
    catch (reason) { setExportMessage(reason instanceof Error ? reason.message : "Export failed."); }
    finally { setExporting(false); }
  }

  async function refresh(nextFilters = filters, nextPage = pagination.page, nextSnapshot: string | null = snapshot) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loadBugs(nextFilters, nextPage, nextSnapshot);
      if (sequence !== requestSequence.current) return;
      setSnapshot(result.snapshot);
      setRefreshedAt(result.refreshedAt);
      setReports(result.reports);
      setPagination(result.pagination);
      setAppliedFilters(nextFilters);
    } catch (reason) {
      if (sequence === requestSequence.current) setError(reason instanceof Error ? reason.message : "Could not load bug reports.");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const next = filtersFromSearch(locationSearch);
    setFilters(next);
    void refresh(next, 1, null);
  }, [locationSearch]);

  useEffect(() => { loadDictionaries().then(setDictionaries).catch(() => undefined); }, []);

  function apply(next: BugFilters) {
    const search = filtersToSearch(next);
    if (search === locationSearch.replace(/^\?/, "")) void refresh(next, 1, null);
    else navigate(`/bugs${search ? `?${search}` : ""}`);
  }

  function setFilter(name: keyof BugFilters, value: string | string[]) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  const canCreateReports = isBugStaff(auth?.user.role);

  return (
    <section className="workspace-page bugs-page">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">QA WORKSPACE</p>
          <h2>BUG REPORTS</h2>
          <div className="bug-results-line">
            <p>
              {pagination.total} report{pagination.total === 1 ? "" : "s"} match the current filters.
              {pagination.total > 0 ? ` Page ${pagination.page} of ${pagination.totalPages}.` : ""}
            </p>
            {!loading && pagination.total > 0 && pagination.totalPages > 1 && (
              <PaginationControls
                pagination={pagination}
                compact
                onPageChange={(page) => refresh(appliedFilters, page)}
              />
            )}
          </div>
        </div>
        <div className="workspace-header-actions">
        <button className="primary-action" disabled={loading || exporting || !!error} onClick={() => void prepareExport()}>{exporting ? "EXPORTING…" : "EXPORT DATA"}</button>
        {!authLoading && canCreateReports ? (
          <Link className="primary-action" to="/bugs/new">NEW BUG REPORT</Link>
        ) : !authLoading ? (
          <span className="read-only-label">READ-ONLY VIEW</span>
        ) : null}
        </div>
      </div>

      <form
        className="bug-filters"
        onSubmit={(event) => {
          event.preventDefault();
          apply(filters);
        }}
      >
        <label className="filter-field filter-search">
          <span>Search</span>
          <input
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
            placeholder="ID, description, reporter…"
          />
        </label>
        <FilterSelect name="status" label="Status" dictionary="statuses" value={filters.status ?? []} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="priority" label="Priority" dictionary="priorities" value={filters.priority ?? []} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="version" label="Version" dictionary="versions" value={filters.version ?? []} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="category" label="Category" dictionary="categories" value={filters.category ?? []} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="type" label="Type" dictionary="types" value={filters.type ?? []} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="device" label="Device" dictionary="devices" value={filters.device ?? []} dictionaries={dictionaries} onChange={setFilter} />
        <div className="filter-actions">
          <button type="submit">APPLY</button>
          <button
            type="button"
            className="ghost-action"
            onClick={() => {
              setFilters(emptyFilters);
              apply(emptyFilters);
            }}
          >
            RESET
          </button>
        </div>
      </form>

      <div className="snapshot-controls"><p>{refreshedAt ? `Data refreshed ${new Date(refreshedAt).toLocaleString()}.` : "Loading snapshot…"} Pages and exports use the same snapshot for up to 45 minutes.</p><button type="button" className="ghost-link" disabled={loading || exporting} onClick={() => void refresh(appliedFilters, 1, null)}>REFRESH DATA</button></div>
      {canCreateReports && <SavedQueues filters={appliedFilters} />}
      <p>Export includes all matching reports across every page, public comments, and attachment links.</p>
      {exportMessage && <p role="status">{exportMessage}</p>}
      {exportText !== null && <div className="panel-card bug-export">
        <h3>EXPORTED BUG REPORTS</h3>
        <p>This is a snapshot of the filters applied when you clicked Export Data. Internal notes are excluded.</p>
        <div className="button-row">
          <button className="primary-action" onClick={async () => {
            try { await navigator.clipboard.writeText(exportText); setExportMessage("Copied JSON."); }
            catch { setExportMessage("Copy unavailable. Select the text below or download the file."); }
          }}>COPY JSON</button>
          <button className="primary-action" onClick={() => {
            const url = URL.createObjectURL(new Blob([exportText], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url;
            link.download = `tower-eclipse-bugs-${new Date().toISOString().slice(0, 10)}.json`;
            link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>DOWNLOAD JSON</button>
          <button className="ghost-link" onClick={() => setExportText(null)}>CLOSE</button>
        </div>
        <textarea aria-label="Exported bug reports JSON" readOnly value={exportText} onFocus={event => event.target.select()} />
      </div>}
      {error && <div className="workspace-error" role="alert">{error}</div>}

      <div className="bug-table-wrapper">
        <table className="bug-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Version</th>
              <th>Priority</th>
              <th>Description</th>
              <th>Category</th>
              <th>Type</th>
              <th>Discord username</th>
              <th>Device</th>
              <th>Attachments</th>
              <th>Comments</th>
              <th>Developer notes</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="table-message">Loading reports…</td></tr>
            ) : reports.length === 0 ? (
              <tr><td colSpan={13} className="table-message">No bug reports match these filters.</td></tr>
            ) : (
              reports.map((savedReport) => {
                const report = savedReport;
                return (
                <tr key={report.id}>
                  <td><Link className="report-id-link" to={`/bugs/${report.id}`}>{report.displayId}</Link></td>
                  <td><Badge value={report.status} /></td>
                  <td>{report.version.label}</td>
                  <td><Badge value={report.priority} /></td>
                  <td className="description-cell"><Link to={`/bugs/${report.id}`}>{report.description}</Link></td>
                  <td>{report.category.label}</td>
                  <td>{report.type.label}</td>
                  <td>
                    <div className="reporter-cell">
                      <UserAvatar
                        avatarUrl={report.reporter.avatarUrl}
                        displayName={report.reporter.displayName}
                        size={34}
                      />
                      <span className="reporter-copy">
                        <span className="reporter-name">
                          {report.reporter.displayName}
                          <RoleBadge role={report.reporter.role} />
                        </span>
                        <span className="reporter-handle">@{report.reporter.username}</span>
                      </span>
                    </div>
                  </td>
                  <td>{report.device.label}</td>
                  <td>{report.attachmentsCount}</td>
                  <td>{report.commentsCount}</td>
                  <td>{report.developerNotesCount}</td>
                  <td className="date-cell">{formatDate(report.submittedAt)}</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && pagination.total > 0 && (
        <nav className="bug-pagination" aria-label="Bug report pages">
          <span className="pagination-summary">
            {((pagination.page - 1) * pagination.pageSize) + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>

          <PaginationControls
            pagination={pagination}
            onPageChange={(page) => refresh(appliedFilters, page)}
          />
        </nav>
      )}
    </section>
  );
}
