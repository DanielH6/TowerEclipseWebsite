import { useEffect, useState } from 'react';
import { apiJson } from '../api';
import { Link } from '../router';
import type { BugReport } from '../types';
export type RelatedReport = Pick<BugReport, 'id' | 'displayId' | 'description' | 'status' | 'reporter' | 'duplicateOf'>;
export default function RelatedReports({ search, categoryId, exclude, onSelect }: { search: string; categoryId?: string; exclude?: string; onSelect?: (report: RelatedReport) => void }) {
  const [reports, setReports] = useState<RelatedReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setReports([]); setError('');
    if (search.trim().length < 5) { setLoading(false); return; }
    setLoading(true);
    const timeout = setTimeout(() => {
      apiJson<{ reports: RelatedReport[] }>(`/api/bugs/related?${new URLSearchParams({ search: search.slice(0, 1500), ...(categoryId ? { categoryId } : {}), ...(exclude ? { exclude } : {}) })}`, 'GET', undefined, undefined, controller.signal)
        .then(value => { if (!controller.signal.aborted) setReports(value.reports); })
        .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 700);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [search, categoryId, exclude]);
  return <div className="related-reports"><h3>RELATED REPORTS</h3><p>Check for the same issue before creating a new report. Suggestions are text matches, not confirmed duplicates.</p>
    {loading && <p role="status">Looking for related reports…</p>}{error && <p role="alert">Suggestions unavailable: {error} You can still submit your report.</p>}
    {!loading && !error && !reports.length && <p>{search.trim().length < 5 ? 'Describe the issue to see suggestions.' : 'No close matches found.'}</p>}
    <ul>{reports.map(report => <li key={report.id}><Link to={`/bugs/${report.id}`} target="_blank">{report.displayId} ↗</Link> · {report.status.label} · {report.reporter?.displayName}<p>{report.description}</p>{report.duplicateOf && <p>Duplicate of <Link to={`/bugs/${report.duplicateOf.id}`} target="_blank">{report.duplicateOf.displayId}</Link></p>}{onSelect && <button type="button" className="ghost-link" onClick={() => onSelect(report)}>SELECT REPORT</button>}</li>)}</ul>
  </div>;
}
