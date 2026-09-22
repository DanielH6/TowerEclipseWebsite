import { useEffect, useState } from 'react';
import { apiJson, type BugFilters } from '../api';
import { useAuth } from '../AuthContext';
import { filtersToSearch } from '../bug-filters';
import { Link } from '../router';
type Queue = { id: string; name: string; filters: BugFilters };
export default function SavedQueues({ filters }: { filters?: BugFilters }) {
  const { auth } = useAuth();
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const controller = new AbortController(); apiJson<{ queues: Queue[] }>('/api/account/queues', 'GET', undefined, undefined, controller.signal).then(data => { setQueues(data.queues); setLoaded(true); }).catch(reason => { if (!controller.signal.aborted) setMessage(reason.message); }); return () => controller.abort(); }, []);
  async function save(next: Queue[]) { setBusy(true); setMessage(''); try { const data = await apiJson<{ queues: Queue[] }>('/api/account/queues', 'PUT', { queues: next }, auth!.csrfToken); setQueues(data.queues); setName(''); setMessage('Saved.'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Could not save queues.'); } finally { setBusy(false); } }
  return <section className="saved-queues"><h3>YOUR SAVED QUEUES</h3><div className="button-row">{queues.map(queue => <span key={queue.id}><Link className="ghost-link" to={`/bugs?${filtersToSearch(queue.filters)}`}>{queue.name}</Link><button className="queue-remove" aria-label={`Remove queue ${queue.name}`} disabled={busy} onClick={() => void save(queues.filter(item => item.id !== queue.id))}>×</button></span>)}</div>{!queues.length && <p>Save a set of bug filters here and reopen it from any device.</p>}
    {filters && <div className="queue-save"><label className="editor-field"><span>Queue name</span><input maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Mobile reports to retest" /></label><button type="button" className="ghost-link" disabled={!loaded || busy || !name.trim() || queues.length >= 20} onClick={() => void save([...queues, { id: crypto.randomUUID(), name, filters }])}>SAVE APPLIED FILTERS</button><button type="button" className="ghost-link" onClick={async () => { try { await navigator.clipboard.writeText(`${location.origin}/bugs?${filtersToSearch(filters)}`); setMessage('Queue link copied.'); } catch { setMessage('Copy the page address to share this queue.'); } }}>COPY QUEUE LINK</button></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
