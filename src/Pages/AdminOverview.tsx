import { useEffect, useState } from 'react';
import { apiJson } from '../api';
import { Link } from '../router';
import SavedQueues from '../Components/SavedQueues';
import './Bugs.css';
type Overview = { counts: Record<string, number>; refreshedAt: string; drafts: { id: string; title: string; contentType: string }[] };
const cards = [
  ['pending', 'Awaiting triage', '/bugs?status=pending_approval'],
  ['needsInfo', 'Needs more information', '/bugs?status=needs_info'],
  ['readyForQa', 'Ready for QA', '/bugs?status=ready_for_qa'],
  ['draftUpdates', 'News drafts', '/admin/updates'],
  ['applications', 'New applications', '/admin/careers/review?status=submitted'],
  ['testers', 'Connected testers', '/admin/testers'],
];
export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(''); apiJson<Overview>('/api/admin/overview', 'GET', undefined, undefined, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [revision]);
  return <section className="workspace-page"><div className="workspace-header"><div><p className="workspace-kicker">DEVELOPER ADMIN</p><h2>TEAM OVERVIEW</h2><p>The queues, drafts and resources that keep development moving.</p></div><button className="primary-action" disabled={loading} onClick={() => setRevision(value => value + 1)}>REFRESH</button></div>
    <nav className="button-row admin-destinations" aria-label="Admin tools"><Link className="ghost-link" to="/admin/dictionaries">DICTIONARIES</Link><Link className="ghost-link" to="/admin/updates">NEWS EDITOR</Link><Link className="ghost-link" to="/admin/careers">CAREERS</Link><Link className="ghost-link" to="/admin/testers">TESTER OVERVIEW</Link><Link className="ghost-link" to="/login?tab=onboarding">TESTER RESOURCES</Link></nav>
    {loading && <p role="status">Loading overview…</p>}{error && <p role="alert" className="workspace-error">{error}</p>}
    {data && !loading && !error && <><p>Report data refreshed {new Date(data.refreshedAt).toLocaleString()}. Tester ranks reflect their last Discord verification.</p><div className="admin-overview-grid">{cards.map(([key, title, path]) => <Link className="panel-card admin-stat" key={key} to={path!}><strong>{data.counts[key!] ?? 0}</strong><span>{title} →</span></Link>)}</div><div className="panel-card workflow-panel"><h3>REPORT HEALTH</h3><p>{data.counts.reports} submitted reports · {data.counts.submittedToday} submitted in the last 24 hours · {data.counts.urgentOpen} unresolved High/Critical reports.</p><Link to="/bugs?priority=high&priority=critical&status=pending_approval&status=approved&status=in_progress&status=needs_info&status=ready_for_qa">Review urgent reports →</Link></div><section className="panel-card workflow-panel"><h3>DRAFTS TO CONTINUE</h3>{data.drafts.length ? <ul>{data.drafts.map(draft => <li key={draft.id}><Link to={`/admin/updates/${draft.id}`}>{draft.title || 'Untitled draft'}</Link> · {draft.contentType === 'developer_blog' ? 'Developer blog' : 'Game update'}</li>)}</ul> : <p>No unpublished news drafts.</p>}<Link to="/admin/updates">Open all drafts →</Link></section></>}
    <SavedQueues />
  </section>;
}
