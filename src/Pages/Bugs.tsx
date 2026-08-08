import { useEffect, useState } from "react";
import { Link } from "../router";
import { loadBugs, loadDictionaries } from "../api";
import { useAuth } from "../AuthContext";
import RoleBadge from "../Components/RoleBadge";
import UserAvatar from "../Components/UserAvatar";
import { synchronizeReportDictionaries } from "../dictionary-sync";
import { isBugStaff } from "../roles";
import type { BugFilters, BugPagination } from "../api";
import type { BugReport, Dictionaries, DictionaryName, DictionarySnapshot } from "../types";
import "./Bugs.css";

const emptyFilters: BugFilters = {
  search: "",
  status: "",
  version: "",
  priority: "",
  category: "",
  type: "",
  device: "",
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
  value: string;
  dictionaries: Dictionaries | null;
  onChange: (name: keyof BugFilters, value: string) => void;
}) {
  return (
    <label className="filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(name, event.target.value)}>
        <option value="">All</option>
        {dictionaries?.[dictionary].map((entry) => (
          <option value={entry.code} key={entry.id}>{entry.label}</option>
        ))}
      </select>
    </label>
  );
}

export default function BugsPage() {
  const { auth, loading: authLoading } = useAuth();
  const [reports, setReports] = useState<BugReport[]>([]);
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [filters, setFilters] = useState<BugFilters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<BugFilters>(emptyFilters);
  const [pagination, setPagination] = useState<BugPagination>(initialPagination);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh(nextFilters = filters, nextPage = pagination.page) {
    setLoading(true);
    setError(null);
    try {
      const result = await loadBugs(nextFilters, nextPage);
      setReports(result.reports);
      setPagination(result.pagination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load bug reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    Promise.all([refresh(emptyFilters, 1), loadDictionaries().then(setDictionaries)]).catch(() => undefined);
  }, []);

  function setFilter(name: keyof BugFilters, value: string) {
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
        {!authLoading && canCreateReports ? (
          <Link className="primary-action" to="/bugs/new">NEW BUG REPORT</Link>
        ) : !authLoading ? (
          <span className="read-only-label">READ-ONLY VIEW</span>
        ) : null}
      </div>

      <form
        className="bug-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedFilters(filters);
          refresh(filters, 1);
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
        <FilterSelect name="status" label="Status" dictionary="statuses" value={filters.status ?? ""} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="priority" label="Priority" dictionary="priorities" value={filters.priority ?? ""} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="version" label="Version" dictionary="versions" value={filters.version ?? ""} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="category" label="Category" dictionary="categories" value={filters.category ?? ""} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="type" label="Type" dictionary="types" value={filters.type ?? ""} dictionaries={dictionaries} onChange={setFilter} />
        <FilterSelect name="device" label="Device" dictionary="devices" value={filters.device ?? ""} dictionaries={dictionaries} onChange={setFilter} />
        <div className="filter-actions">
          <button type="submit">APPLY</button>
          <button
            type="button"
            className="ghost-action"
            onClick={() => {
              setFilters(emptyFilters);
              setAppliedFilters(emptyFilters);
              refresh(emptyFilters, 1);
            }}
          >
            RESET
          </button>
        </div>
      </form>

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
                const report = synchronizeReportDictionaries(savedReport, dictionaries);
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
