import type { CareerPaginationInfo } from "../careers";

export default function CareerApplicationPagination({ pagination, loading, onPageChange }: {
  pagination: CareerPaginationInfo;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const { page, totalPages, total } = pagination;
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const numbers = [...new Set([1, ...Array.from({ length: Math.min(5, totalPages) }, (_, i) => start + i), totalPages])];
  return <nav className="career-pagination career-numbered-pagination" aria-label="Application pages" aria-busy={loading}>
    <span className="career-page-summary" aria-live="polite">Page {page.toLocaleString()} of {totalPages.toLocaleString()} · {total.toLocaleString()} {total === 1 ? "application" : "applications"}</span>
    <div className="career-page-controls">
      <div className="career-page-direction">
        <button type="button" className="career-button" aria-label="Back 5 pages" title="Back 5 pages" disabled={loading || page === 1} onClick={() => onPageChange(Math.max(1, page - 5))}>−5</button>
        <button type="button" className="career-button" aria-label="Previous page" disabled={loading || page === 1} onClick={() => onPageChange(page - 1)}>← Previous</button>
      </div>
      <div className="career-page-numbers">
        {numbers.map((number, index) => <span className="career-page-item" key={number}>
          {index > 0 && number > numbers[index - 1]! + 1 && <span className="career-page-ellipsis" aria-hidden="true">…</span>}
          <button type="button" className={`career-button${number === page ? " is-primary" : ""}`} aria-label={`Go to page ${number}`} aria-current={number === page ? "page" : undefined} disabled={loading} onClick={() => onPageChange(number)}>{number.toLocaleString()}</button>
        </span>)}
      </div>
      <div className="career-page-direction">
        <button type="button" className="career-button" aria-label="Next page" disabled={loading || page === totalPages} onClick={() => onPageChange(page + 1)}>Next →</button>
        <button type="button" className="career-button" aria-label="Forward 5 pages" title="Forward 5 pages" disabled={loading || page === totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 5))}>+5</button>
      </div>
    </div>
  </nav>;
}
