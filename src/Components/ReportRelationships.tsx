import { useEffect, useState } from 'react';
import { apiJson } from '../api';
import { Link } from '../router';
import { useAuth } from '../AuthContext';
import type { BugReport, BugDetailsResponse } from '../types';
import RelatedReports, { type RelatedReport } from './RelatedReports';
export default function ReportRelationships({ report, updates, editable }: { report: BugReport; updates: BugDetailsResponse['relatedUpdates']; editable: boolean }) {
  const { auth } = useAuth();
  const [canonical, setCanonical] = useState(report.duplicateOf);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RelatedReport | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setCanonical(report.duplicateOf); }, [report.duplicateOf]);
  async function save(targetId: string | null) {
    setWorking(true); setMessage('');
    try { const result = await apiJson<{ duplicateOf: BugReport['duplicateOf'] }>(`/api/bugs/${report.id}/duplicate`, 'PUT', { targetId }, auth!.csrfToken); setCanonical(result.duplicateOf); setSelected(null); setSearch(''); setMessage('Duplicate relationship saved. Original reports and author credit are preserved.'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not save relationship.'); }
    finally { setWorking(false); }
  }
  return <section className="panel-card workflow-panel"><h3>REPORT CONNECTIONS</h3>
    {canonical ? <p>Duplicate of <Link to={`/bugs/${canonical.id}`}>{canonical.displayId}</Link>. This report and its author credit remain available.</p> : <p>No canonical duplicate linked.</p>}
    {!!updates?.length && <><h4>LINKED RELEASE NOTES</h4><ul>{updates.map(update => <li key={update.id}><Link to={`/news/${update.id}`}>{update.title} {update.version}</Link><p>{update.summary}</p></li>)}</ul></>}
    {editable && <details><summary>Manage duplicate link</summary><label className="editor-field"><span>Find the original report</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Report ID or a description of the issue" /></label><RelatedReports search={search} exclude={report.id} onSelect={setSelected} />
      {selected && <p>Selected: {selected.displayId} <button type="button" className="primary-action" disabled={working} onClick={() => void save(selected.duplicateOf?.id ?? selected.id)}>LINK AS DUPLICATE</button></p>}
      {canonical && <button type="button" className="ghost-link" disabled={working} onClick={() => void save(null)}>REMOVE DUPLICATE LINK</button>}
    </details>}{message && <p role="status">{message}</p>}
  </section>;
}
