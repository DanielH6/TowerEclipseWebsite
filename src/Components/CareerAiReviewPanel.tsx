import { useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { Link } from "../router";
import { careerDate, careerRequest, useCareerResource, type AiReviewOverview } from "../careers";
import { CareerResourceState } from "./CareerFields";

export default function CareerAiReviewPanel({ formId, onComplete }: { formId: string; onComplete: () => void }) {
  const { auth } = useAuth();
  const resource = useCareerResource<AiReviewOverview>(`/admin/forms/${encodeURIComponent(formId)}/ai-reviews`);
  const [working, setWorking] = useState(false), [error, setError] = useState("");
  const lastCompleted = useRef<string | null | undefined>(undefined);
  const latest = resource.data?.runs[0], active = latest?.state === "queued" || latest?.state === "running";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(resource.reload, 5000);
    return () => window.clearInterval(timer);
  }, [active, formId]);
  useEffect(() => {
    if (!resource.data) return;
    const completed = resource.data.completedRun?.id ?? null;
    if (lastCompleted.current !== undefined && lastCompleted.current !== completed) onComplete();
    lastCompleted.current = completed;
  }, [resource.data, onComplete]);
  async function start() {
    if (!auth || !resource.data || working) return;
    setWorking(true); setError("");
    try { await careerRequest(`/admin/forms/${formId}/ai-reviews`, { method: "POST", csrf: auth.csrfToken, body: { revision: resource.data.criteriaRevision } }); resource.reload(); }
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
  return <section className="career-ai-panel" aria-label="AI application review">
    <div className="career-section-heading"><div><span className="career-eyebrow">LUNA · PRIVATE REVIEW ASSISTANT</span><h3>Review this applicant pool</h3></div><div className="career-actions"><Link className="career-button" to={`/admin/careers/forms/${formId}#ai-review-guide`}>Edit AI criteria</Link><button type="button" className="career-button is-primary" disabled={working || resource.loading || active || !resource.data?.configured || !resource.data.hasCriteria} onClick={() => void start()}>{working ? "Working…" : active ? "Review in progress…" : "Run AI review"}</button><button type="button" className="career-link" disabled={working || resource.loading} onClick={resource.reload}>Refresh AI status</button></div></div>
    <p className="career-help">Reviews every non-withdrawn application for this form, across all pages and statuses. Search and status filters only change the rows you see. A new run sends the current answers to OpenAI again; it never accepts, rejects or messages applicants.</p>
    <CareerResourceState {...resource} />
    {resource.data && <>
      {!resource.data.configured && <div className="career-notice">Luna needs an OpenAI API key configured on the server. You can prepare the private criteria in the form editor now. Eligible subscription credits apply to the API organisation owning that key. <a href="https://developers.openai.com/api/docs/guides/chatgpt-api-credits" target="_blank" rel="noopener noreferrer">Subscription credit setup ↗</a></div>}
      {!resource.data.hasCriteria && <p className="career-notice">Write your brief and save at least one criterion in the form editor before running a review.</p>}
      {resource.data.completedRun && <p className="career-help">Current ranking: {resource.data.completedRun.total} applications · {careerDate(resource.data.completedRun.completedAt)}{resource.data.completedRun.criteriaRevision !== resource.data.criteriaRevision ? " · Criteria have changed; rerun to apply the saved guide." : ""}. New applications stay unranked until the next completed run.</p>}
      {latest && <div className="career-ai-run" role="status"><strong>{latest.state === "completed" ? "Review completed" : latest.state === "failed" ? "Review failed" : latest.state === "cancelled" ? "Review cancelled" : latest.state === "queued" ? "Queued for review" : "Reviewing applications"}</strong><span>{latest.processed} / {latest.total} assessed · Requested {careerDate(latest.createdAt)} by {latest.requestedBy.displayName}</span>{active && <><progress aria-label="Applications reviewed" max={latest.total} value={latest.processed} /><button type="button" className="career-link" disabled={working} onClick={() => void cancel()}>Cancel review</button><small>Cancellation stops further requests. A request already in progress may still be billed.</small></>}{latest.error && <p>{latest.error}</p>}{["failed", "cancelled"].includes(latest.state) && <small>The last completed ranking remains visible.</small>}</div>}
      {resource.data.runs.length > 1 && <details><summary>Previous review runs</summary><ul className="career-ai-history">{resource.data.runs.slice(1).map(run => <li key={run.id}><span>{careerDate(run.createdAt)} · {run.state}</span><span>{run.processed}/{run.total} assessed · Criteria version {run.criteriaRevision}</span></li>)}</ul></details>}
    </>}
    <div className="career-score-spectrum" aria-label="AI score colour guide"><div /><span>0 · Lower relative score</span><span>5 · Middle of pool</span><span>10 · Higher relative score</span></div>
    <p className="career-help">Colours show relative scores: red → orange → yellow → yellow-green → green. Grey and -/10 mean unranked. The weighted criteria score is shown separately. Equal scores stay tied; small pools will not form a smooth bell curve.</p>
    {error && <p className="career-notice is-error" role="alert">{error}</p>}
  </section>;
}
