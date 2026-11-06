import { useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { Link } from "../router";
import { careerDate, careerRequest, useCareerResource, type AiReviewOverview, type AiRun } from "../careers";
import { CareerResourceState } from "./CareerFields";

export default function CareerAiReviewPanel({ formId, onComplete }: { formId: string; onComplete: () => void }) {
  const { auth } = useAuth();
  const resource = useCareerResource<AiReviewOverview>(`/admin/forms/${encodeURIComponent(formId)}/ai-reviews`);
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  const [live, setLive] = useState<{ run: AiRun; completedRun: AiReviewOverview["completedRun"] } | null>(null);
  const [history, setHistory] = useState<AiRun[] | null>(null), [historyLoading, setHistoryLoading] = useState(false);
  const lastCompleted = useRef<string | null | undefined>(undefined);
  const latest = live?.run ?? resource.data?.runs[0], active = latest?.state === "queued" || latest?.state === "running";
  useEffect(() => { if (resource.data) setLive(null); }, [resource.data]);
  useEffect(() => {
    if (!active || !latest) return;
    let disposed = false, generation = 0, timer: number | undefined, controller: AbortController | undefined;
    const poll = async () => {
      if (disposed || document.hidden) return;
      const requestGeneration = ++generation, requestController = new AbortController();
      controller = requestController;
      try {
        const result = await careerRequest<{ run: AiRun; completedRun: AiReviewOverview["completedRun"] }>(`/admin/forms/${encodeURIComponent(formId)}/ai-reviews/${encodeURIComponent(latest.id)}`, { signal: requestController.signal });
        if (disposed || requestGeneration !== generation) return;
        setLive(result);
        if (!["queued", "running"].includes(result.run.state)) { resource.reload(); return; }
      } catch (reason) { if (!requestController.signal.aborted && !disposed && requestGeneration === generation) setError((reason as Error).message); }
      if (!disposed && requestGeneration === generation && !document.hidden) timer = window.setTimeout(() => void poll(), 5000);
    };
    const visibility = () => { generation++; window.clearTimeout(timer); controller?.abort(); if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visibility);
    if (!document.hidden) timer = window.setTimeout(() => void poll(), 5000);
    return () => { disposed = true; window.clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); };
  }, [active, latest?.id, latest?.state, formId]);
  useEffect(() => {
    if (!resource.data && !live) return;
    const completed = (live ? live.completedRun : resource.data?.completedRun)?.id ?? null;
    if (lastCompleted.current !== undefined && lastCompleted.current !== completed) onComplete();
    lastCompleted.current = completed;
  }, [resource.data, live, onComplete]);
  async function start() {
    if (!auth || !resource.data || working) return;
    setWorking(true); setError("");
    try { await careerRequest(`/admin/forms/${formId}/ai-reviews`, { method: "POST", csrf: auth.csrfToken, body: { revision: resource.data.criteriaRevision } }); setHistory(null); resource.reload(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }
  async function cancel() {
    if (!auth || !latest || working) return;
    setWorking(true); setError("");
    try { await careerRequest(`/admin/forms/${formId}/ai-reviews/${latest.id}/cancel`, { method: "POST", csrf: auth.csrfToken, body: {} }); resource.reload(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setWorking(false); }
  }
  async function loadHistory() {
    if (history || historyLoading) return;
    setHistoryLoading(true);
    try { const result = await careerRequest<AiReviewOverview>(`/admin/forms/${encodeURIComponent(formId)}/ai-reviews?history=1`); setHistory(result.runs); }
    catch (reason) { setError((reason as Error).message); }
    finally { setHistoryLoading(false); }
  }
  return <section className="career-ai-panel" aria-label="AI application review">
    <div className="career-section-heading"><div><span className="career-eyebrow">LUNA · PRIVATE REVIEW ASSISTANT</span><h3>Review this applicant pool</h3></div><div className="career-actions"><Link className="career-button" to={`/admin/careers/forms/${formId}#ai-review-guide`}>Edit AI criteria</Link><button type="button" className="career-button is-primary" disabled={working || resource.loading || active || !resource.data?.configured || !resource.data.hasCriteria} onClick={() => void start()}>{working ? "Working…" : active ? "Review in progress…" : "Run AI review"}</button><button type="button" className="career-link" disabled={working || resource.loading} onClick={resource.reload}>Refresh AI status</button></div></div>
    <p className="career-help">Reviews every non-withdrawn application for this form, across all pages and statuses. Search and status filters only change the rows you see. A new run sends the current answers to OpenAI again; it never accepts, rejects or messages applicants.</p>
    <CareerResourceState {...resource} />
    {resource.data && <>
      {!resource.data.configured && <div className="career-notice">Luna needs an OpenAI API key configured on the server. You can prepare the private criteria in the form editor now. Eligible subscription credits apply to the API organisation owning that key. <a href="https://developers.openai.com/api/docs/guides/chatgpt-api-credits" target="_blank" rel="noopener noreferrer">Subscription credit setup ↗</a></div>}
      {!resource.data.hasCriteria && <p className="career-notice">Write your brief and save at least one criterion in the form editor before running a review.</p>}
      {resource.data.completedRun && <p className="career-help">Current ranking: {resource.data.completedRun.total} applications · {careerDate(resource.data.completedRun.completedAt)}{resource.data.completedRun.criteriaRevision !== resource.data.criteriaRevision ? " · Criteria have changed; rerun to apply the saved guide." : ""}. New applications stay unranked until the next completed run.</p>}
      {latest && <div className="career-ai-run" role="status"><strong>{latest.state === "completed" ? "Review completed" : latest.state === "failed" ? "Review failed" : latest.state === "cancelled" ? "Review cancelled" : latest.state === "queued" ? "Queued for review" : "Reviewing applications"}</strong><span>{latest.processed} / {latest.total} assessed · Requested {careerDate(latest.createdAt)} by {latest.requestedBy.displayName}</span>{active && <><progress aria-label="Applications reviewed" max={latest.total} value={latest.processed} /><button type="button" className="career-link" disabled={working} onClick={() => void cancel()}>Cancel review</button><small>Cancellation stops further requests. A request already in progress may still be billed.</small></>}{latest.error && <p>{latest.error}</p>}{["failed", "cancelled"].includes(latest.state) && <small>The last completed ranking remains visible.</small>}</div>}
      {resource.data.hasHistory && <details onToggle={event => { if (event.currentTarget.open) void loadHistory(); }}><summary>Previous review runs</summary>{historyLoading ? <p role="status">Loading previous reviews…</p> : <ul className="career-ai-history">{history?.filter(run => run.id !== latest?.id).map(run => <li key={run.id}><span>{careerDate(run.createdAt)} · {run.state}</span><span>{run.processed}/{run.total} assessed · Criteria version {run.criteriaRevision}</span></li>)}</ul>}</details>}
    </>}
    <div className="career-score-spectrum" aria-label="AI score colour guide"><div /><span>0 · Lower relative score</span><span>5 · Middle of pool</span><span>10 · Higher relative score</span></div>
    <p className="career-help">Colours show relative scores: red → orange → yellow → yellow-green → green. Grey and -/10 mean unranked. The weighted criteria score is shown separately. Equal scores stay tied; small pools will not form a smooth bell curve.</p>
    {error && <p className="career-notice is-error" role="alert">{error}</p>}
  </section>;
}
