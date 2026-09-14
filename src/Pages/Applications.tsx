import { useState } from "react";
import { useAuth } from "../AuthContext";
import { Link, useLocation } from "../router";
import { applicationStatuses, careerDate, careerRequest, useCareerResource, useUnsavedChanges, type ApplicationDetail, type ApplicationStatus, type CareerApplication, type CareerPageResult } from "../careers";
import { CareerPagination, CareerResourceState } from "../Components/CareerFields";
import "./Careers.css";

export function StatusBadge({ status }: { status: ApplicationStatus }) { return <span className={`career-status status-${status}`}>{applicationStatuses[status]}</span>; }
export function MyApplications({ preview = false }: { preview?: boolean }) {
  return <section className="career-card career-tracker"><div className="career-section-heading"><div><span className="career-eyebrow">YOUR NEXT CHAPTER</span><h3>{preview ? "Recent applications" : "My applications"}</h3></div><Link className="career-link" to="/careers">Explore openings ↗</Link></div><ApplicationList preview={preview} /></section>;
}
export function ApplicationList({ admin = false, formId = "", preview = false }: { admin?: boolean; formId?: string; preview?: boolean }) {
  const [status, setStatus] = useState("");
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const query = new URLSearchParams({ ...(status ? { status } : {}), ...(formId ? { formId } : {}), ...(pages.at(-1) ? { cursor: pages.at(-1)! } : {}) });
  const resource = useCareerResource<CareerPageResult<CareerApplication>>(`${admin ? "/admin" : ""}/applications?${query}`);
  return <>{!preview && <div className="career-toolbar"><label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPages([null]); }}><option value="">All statuses</option>{Object.entries(applicationStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="career-link" disabled={resource.loading} onClick={resource.reload}>↻ Refresh</button></div>}<CareerResourceState {...resource} />{resource.data && (resource.data.items.length ? <div className="career-application-list">{resource.data.items.slice(0, preview ? 3 : 20).map(item => <Link className="career-application-row" key={item.id} to={`${admin ? "/admin/careers/review" : "/applications"}/${item.id}`}><div><span className="career-eyebrow">{item.category}</span><h4>{item.title}</h4>{admin && <p>@{item.applicant.username} · Roblox: @{item.applicant.roblox.username}</p>}<small>Submitted {careerDate(item.createdAt)}</small>{item.updatedAt !== item.createdAt && <small>Updated {careerDate(item.updatedAt)}</small>}</div><StatusBadge status={item.status} /><span aria-hidden="true">↗</span></Link>)}</div> : <div className="career-empty"><h4>{status ? "No applications with this status." : admin ? "No applications received yet." : "Your next chapter is waiting."}</h4><p>{admin ? "Submitted applications will appear here for review." : "Applications you submit will appear here with review updates and feedback."}</p></div>)}{!preview && resource.data && <CareerPagination pages={pages} setPages={setPages} nextCursor={resource.data.nextCursor} loading={resource.loading} />}{preview && !!resource.data?.items.length && <Link className="career-link" to="/login?tab=applications">View all applications →</Link>}</>;
}

function ApplicationContent({ data, admin, reload }: { data: ApplicationDetail; admin: boolean; reload: () => void }) {
  const { auth } = useAuth();
  const { search } = useLocation();
  const { application: item, form } = data;
  const [status, setStatus] = useState(item.status);
  const [feedback, setFeedback] = useState(item.feedback);
  const [notes, setNotes] = useState(item.internalNotes ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const dirty = admin && !saved && (status !== item.status || feedback !== item.feedback || notes !== (item.internalNotes ?? ""));
  useUnsavedChanges(dirty);
  async function mutate(withdraw = false) {
    if (!auth || working) return;
    setWorking(true); setError("");
    try { await careerRequest(`${admin ? "/admin" : ""}/applications/${item.id}${withdraw ? "/withdraw" : ""}`, { method: withdraw ? "POST" : "PUT", csrf: auth.csrfToken, body: { revision: item.revision, status, feedback, internalNotes: notes } }); setSaved(true); reload(); }
    catch (reason) { setError((reason as Error).message); setWorking(false); }
  }
  return <>
    {!admin && new URLSearchParams(search).has("submitted") && <div className="career-notice" role="status"><strong>Application received.</strong> {form.confirmation || "Thank you for applying. You can follow updates here."}</div>}
    <header className="career-detail-header"><div><span className="career-eyebrow">{admin ? "APPLICATION REVIEW" : "YOUR APPLICATION"} / {item.category}</span><h2>{item.title}</h2><p>Submitted {careerDate(item.createdAt)}</p></div><StatusBadge status={item.status} /></header>
    <div className="career-form-layout"><div className="career-detail-main">
      <section className="career-card"><h3>Connected accounts at submission</h3><div className="career-identity"><img src="/social/discord.png" alt="Discord" /><div><strong>{item.applicant.displayName} · @{item.applicant.username}</strong><small>Discord ID: {item.applicant.discordId}</small></div></div><div className="career-identity"><img src="/social/roblox.png" alt="Roblox" /><div><a href={`https://www.roblox.com/users/${item.applicant.roblox.userId}/profile`} target="_blank" rel="noopener noreferrer">@{item.applicant.roblox.username} ↗</a><small>Roblox ID: {item.applicant.roblox.userId}</small></div></div></section>
      <section className="career-card career-answers"><div className="career-section-heading"><h3>Submitted answers</h3><span className="career-muted">Original form version</span></div>{form.questions.map((q, index) => <div key={q.id}><h4><span>{String(index + 1).padStart(2, "0")}</span> {q.label}</h4>{q.help && <p className="career-help">{q.help}</p>}{Array.isArray(item.answers[q.id]) ? (q.type === "ranking" ? <ol>{(item.answers[q.id] as string[]).map(value => <li key={value}>{value}</li>)}</ol> : <ul>{(item.answers[q.id] as string[]).map(value => <li key={value}>{value}</li>)}</ul>) : <p className="career-answer">{item.answers[q.id] === undefined ? <em>No answer provided</em> : String(item.answers[q.id])}{q.type === "scale" && item.answers[q.id] !== undefined && <small> (scale {q.min}–{q.max}{q.minLabel || q.maxLabel ? `: ${q.minLabel || q.min} → ${q.maxLabel || q.max}` : ""})</small>}</p>}</div>)}</section>
    </div><aside className="career-detail-sidebar">
      {admin && <form className="career-card career-review-form" onSubmit={e => { e.preventDefault(); void mutate(); }}><span className="career-eyebrow">REVIEW DESK</span><h3>Make a decision</h3>{item.reviewer && <p className="career-help">Last reviewed by {item.reviewer.displayName}</p>}<label>Status<select value={status} disabled={working || item.status === "withdrawn"} onChange={e => setStatus(e.target.value as ApplicationStatus)}>{Object.entries(applicationStatuses).filter(([value]) => value !== "withdrawn" || item.status === "withdrawn").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Feedback to applicant<textarea rows={5} maxLength={2000} value={feedback} disabled={working || item.status === "withdrawn"} onChange={e => setFeedback(e.target.value)} placeholder="Visible on their profile. Explain the decision or next steps." /></label><label>Private review notes<textarea rows={6} maxLength={6000} value={notes} disabled={working || item.status === "withdrawn"} onChange={e => setNotes(e.target.value)} placeholder="Only admins and developers can read these notes." /></label><p className="career-help">Decisions do not automatically assign Discord or Roblox roles. Contact the applicant separately if needed.</p>{error && <p className="career-notice is-error" role="alert">{error}</p>}<button className="career-button is-primary" disabled={working || !dirty || item.status === "withdrawn"}>{working ? "Saving…" : "Save review"}</button>{item.status === "withdrawn" && <p className="career-help">The applicant withdrew this application. Review is closed.</p>}</form>}
      {!admin && <section className="career-card"><span className="career-eyebrow">LATEST FROM THE TEAM</span><h3>{applicationStatuses[item.status]}</h3><p className="career-answer">{item.feedback || "Review updates and feedback will appear here. There is no need to submit again."}</p><p className="career-help">Updated {careerDate(item.updatedAt)}</p>{!["accepted", "rejected", "withdrawn"].includes(item.status) && (withdrawing ? <div className="career-withdraw-confirm"><p>Withdraw this application? You won’t be able to apply again to this same opening.</p><div className="career-actions"><button className="career-button is-danger" disabled={working} onClick={() => void mutate(true)}>{working ? "Withdrawing…" : "Confirm withdrawal"}</button><button className="career-button" disabled={working} onClick={() => setWithdrawing(false)}>Keep application</button></div></div> : <button className="career-link" onClick={() => setWithdrawing(true)}>Withdraw application</button>)}{error && <p className="career-notice is-error" role="alert">{error}</p>}</section>}
      <section className="career-card"><span className="career-eyebrow">APPLICATION TIMELINE</span><h3>Your progress</h3><ol className="career-timeline">{[...item.history].reverse().map((event, index) => <li key={`${event.at}-${index}`}><strong>{applicationStatuses[event.status]}</strong><time>{careerDate(event.at)}</time>{event.feedback && <p>{event.feedback}</p>}</li>)}</ol><p className="career-help">Latest 50 status and feedback updates. Private notes are visible only to reviewers.</p></section>
    </aside></div>
  </>;
}
export default function Applications({ applicationId, admin = false }: { applicationId: string; admin?: boolean }) {
  const resource = useCareerResource<ApplicationDetail>(`${admin ? "/admin" : ""}/applications/${encodeURIComponent(applicationId)}`);
  return <section className="content-band careers-page"><Link className="career-back" to={admin ? "/admin/careers/review" : "/login?tab=applications"}>← {admin ? "Review queue" : "My applications"}</Link><CareerResourceState {...resource} />{resource.data && <ApplicationContent key={`${applicationId}-${resource.data.application.revision}`} data={resource.data} admin={admin} reload={resource.reload} />}</section>;
}
