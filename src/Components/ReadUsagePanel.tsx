import { useEffect, useState } from "react";
import { apiJson } from "../api";

type Usage = { startedAt: string; measuredAt: string; processId: number; totals: Counts; scopes: (Counts & { scope: string })[]; note: string };
type Counts = { requests: number; queries: number; lookups: number; aggregations: number; documents: number; estimatedReadFloor: number; retries: number; cacheHits: number; cacheMisses: number; cacheShared: number };
const number = (value: number) => value.toLocaleString();
export default function ReadUsagePanel() {
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0);
  const [data, setData] = useState<Usage | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); setLoading(true); setError("");
    apiJson<Usage>("/api/admin/read-metrics", "GET", undefined, undefined, controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, revision]);
  return <details className="panel-card workflow-panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Database read usage</summary>
    <p>View measured read operations by feature. Loading these metrics does not query Firestore.</p>
    <button className="ghost-link" type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh usage</button>
    {loading && <p role="status">Loading usage…</p>}{error && <p role="alert">{error}</p>}
    {data && <><p>Since {new Date(data.startedAt).toLocaleString()} · server process {data.processId}. Resets when this process restarts.</p>
      <p><strong>{number(data.totals.estimatedReadFloor)} estimated minimum reads</strong> · {number(data.totals.cacheHits)} cached responses · {number(data.totals.cacheShared)} shared refreshes · {number(data.totals.retries)} transaction retries.</p>
      <p>These are local operation estimates. Use Firebase billing and monitoring for the complete project total, including index and aggregation charges.</p>
      <div style={{ overflowX: "auto" }}><table><thead><tr><th>Feature / route</th><th>Read estimate</th><th>Queries</th><th>Lookups</th><th>Cache hits</th></tr></thead><tbody>{data.scopes.slice(0, 25).map(scope => <tr key={scope.scope}><td>{scope.scope}</td><td>{number(scope.estimatedReadFloor)}</td><td>{number(scope.queries + scope.aggregations)}</td><td>{number(scope.lookups)}</td><td>{number(scope.cacheHits)}</td></tr>)}</tbody></table></div>
    </>}
  </details>;
}
