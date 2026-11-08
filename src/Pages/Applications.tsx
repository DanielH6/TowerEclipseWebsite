import { useEffect, useRef, useState } from "react";
import { useAuth } from "../AuthContext";
import { Link, useLocation, useNavigate } from "../router";
import { applicationStatuses, applicationUnsavedMessage, answerWordCount, applicationWordCount, careerDate, careerRequest, useCareerResource, useUnsavedChanges, type ApplicationStats, type ApplicationDetail, type ApplicationStatus, type CareerApplication, type CareerPageResult } from "../careers";
import CareerFields, { CareerPagination, CareerResourceState } from "../Components/CareerFields";
import CareerRichText, { RichText, updateFormatting, type TextFormatting } from "../Components/CareerRichText";
import { QuestionImage } from "../Components/CareerQuestionImage";
import { AiScoreBadge, scoreStyle } from "../Components/CareerAiScore";
import { ApplicationDraftNotice, useApplicationDraft } from "../Components/CareerApplicationDraft";
import "./Careers.css";

export function StatusBadge({ status }: { status: ApplicationStatus }) { return <span className={`career-status status-${status}`}>{applicationStatuses[status]}</span>; }
export function MyApplications({ preview = false }: { preview?: boolean }) {
  return <section className="career-card career-tracker"><div className="career-section-heading"><div><h3>{preview ? "Recent applications" : "My applications"}</h3></div><Link className="career-link" to="/careers">Explore openings ↗</Link></div><ApplicationList preview={preview} /></section>;
}
export function ApplicationList({ admin = false, formId = "", preview = false, refreshToken = 0 }: { admin?: boolean; formId?: string; preview?: boolean; refreshToken?: number }) {
  const [status, setStatus] = useState(() => { const value = admin ? new URLSearchParams(window.location.search).get("status") ?? "" : ""; return value in applicationStatuses ? value : ""; });
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [manualRefresh, setManualRefresh] = useState("");
  const [sort, setSort] = useState(() => { const value = new URLSearchParams(window.location.search).get("sort") ?? "newest"; return formId && ["newest", "oldest", "ai_rank", "quality"].includes(value) ? value : "newest"; });
  const [searchDraft, setSearchDraft] = useState(() => formId ? new URLSearchParams(window.location.search).get("search") ?? "" : "");
  const [search, setSearch] = useState(searchDraft);
  useEffect(() => { const timer = setTimeout(() => { setSearch(searchDraft.trim()); setPages([null]); }, 300); return () => clearTimeout(timer); }, [searchDraft]);
  const returnTo = `/admin/careers/review?${new URLSearchParams({ formId, ...(status ? { status } : {}), ...(sort !== "newest" ? { sort } : {}), ...(search ? { search } : {}) })}`;
  const query = new URLSearchParams({ ...(status ? { status } : {}), ...(formId ? { formId } : {}), ...(admin && sort !== "newest" ? { sort } : {}), ...(admin && search ? { search } : {}), ...(pages.at(-1) ? { cursor: pages.at(-1)! } : {}), ...(admin && manualRefresh ? { refresh: manualRefresh } : {}) });
  const resource = useCareerResource<CareerPageResult<CareerApplication>>(`${admin ? "/admin" : ""}/applications?${query}`);
  const stats = useCareerResource<ApplicationStats>(admin ? `/admin/application-stats?${new URLSearchParams({ ...(status ? { status } : {}), ...(formId ? { formId } : {}), ...(manualRefresh ? { refresh: manualRefresh } : {}) })}` : null);
  const previousRefresh = useRef(refreshToken);
  useEffect(() => {
    if (previousRefresh.current === refreshToken) return;
    previousRefresh.current = refreshToken;
    if (pages.length > 1) setPages([null]); else resource.reload();
    if (admin) stats.reload();
  }, [refreshToken]);
  return <>{admin && <section className="career-review-stats" aria-label="Applicant counts"><CareerResourceState {...stats} />{stats.data && <><div className="career-stat-totals"><div><strong>{stats.data.applicants.toLocaleString()}</strong><span>Total applicants</span></div><div><strong>{stats.data.applications.toLocaleString()}</strong><span>Applications</span></div></div><p className="career-help">{status || formId ? "Counts match the selected status and opening. " : "Across all openings and statuses. "}Applicants are unique people; someone can apply to several openings.</p>{stats.data.asOf && <p className="career-help">Counts checked {careerDate(stats.data.asOf)}. Refresh for the latest updates from other sessions.</p>}<div className="career-stat-categories">{stats.data.categories.map(group => <div key={group.category}><strong>{group.category}</strong><span>{group.applicants.toLocaleString()} applicants · {group.applications.toLocaleString()} applications</span></div>)}</div>{stats.data.openings.length > 0 && <details><summary>Applicants by opening</summary><div className="career-stat-openings">{stats.data.openings.map(group => <Link key={group.id} to={`/admin/careers/review?${new URLSearchParams({ formId: group.id, ...(status ? { status } : {}) })}`}><span>{group.title}</span><strong>{group.applicants.toLocaleString()} applicants</strong></Link>)}</div></details>}</>}</section>}{!preview && <div className="career-toolbar"><label>Status<select aria-label="Application status filter" value={status} onChange={e => { setStatus(e.target.value); setPages([null]); }}><option value="">All statuses</option>{Object.entries(applicationStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{admin && formId && <><label>Sort by<select aria-label="Sort applications" value={sort} onChange={e => { setSort(e.target.value); setPages([null]); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="ai_rank">AI relative score · highest first</option><option value="quality">Criteria score · highest first</option></select></label><label>Search applicants<input aria-label="Search applicants" maxLength={100} value={searchDraft} onChange={e => setSearchDraft(e.target.value)} placeholder="Discord or Roblox name" /></label></>}<button className="career-link" disabled={resource.loading} onClick={() => { if (admin) { setPages([null]); setManualRefresh(String(Date.now())); } else resource.reload(); }}>↻ Refresh</button></div>}<CareerResourceState {...resource} />{resource.data && (resource.data.items.length ? <div className="career-application-list">{resource.data.items.slice(0, preview ? 3 : 20).map(item => <Link className={`career-application-row${admin ? " career-scored-application" : ""}`} style={admin ? scoreStyle(item.aiReview?.relativeScore) : undefined} key={item.id} to={`${admin ? "/admin/careers/review" : "/applications"}/${item.id}${admin ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`}><div><span className="career-eyebrow">{item.category}</span><h4>{item.title}</h4>{admin && <p>@{item.applicant.username} · Roblox: @{item.applicant.roblox.username}</p>}<small>Submitted {careerDate(item.createdAt)}</small>{item.updatedAt !== item.createdAt && <small>Updated {careerDate(item.updatedAt)}</small>}{admin && item.aiReview?.criteriaChanged && <small>Previous criteria · rerun needed</small>}</div>{admin && <AiScoreBadge review={item.aiReview} />}<StatusBadge status={item.status} /><span aria-hidden="true">↗</span></Link>)}</div> : <div className="career-empty"><h4>{status ? "No applications with this status." : admin ? "No applications received yet." : "Your next chapter is waiting."}</h4><p>{admin ? "Submitted applications will appear here for review." : "Applications you submit will appear here with review updates and feedback."}</p></div>)}{!preview && resource.data && <CareerPagination pages={pages} setPages={setPages} nextCursor={resource.data.nextCursor} loading={resource.loading} />}{preview && !!resource.data?.items.length && <Link className="career-link" to="/login?tab=applications">View all applications →</Link>}</>;
}

function ApplicationContent({ data, admin, reload }: { data: ApplicationDetail; admin: boolean; reload: () => void }) {
  const { auth } = useAuth();
  const canEdit = admin && auth?.user.role === "dev";
  const { search } = useLocation();
  const navigate = useNavigate();
  const { application: item, form } = data;
  const [status, setStatus] = useState(item.status);
  const [feedback, setFeedback] = useState(item.feedback);
  const [notes, setNotes] = useState(item.internalNotes ?? "");
  const [feedbackFormatting, setFeedbackFormatting] = useState<TextFormatting>(item.feedbackFormatting ?? {});
  const [notesFormatting, setNotesFormatting] = useState<TextFormatting>(item.notesFormatting ?? {});
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [editing, setEditing] = useState(false);
  const savedDraft = useApplicationDraft({ initialDraft: data.draft, versionId: item.versionId, formId: item.formId, form, applicationRevision: item.revision, fallback: item.answers });
  const { answers, setAnswers } = savedDraft;
  const [consent, setConsent] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now);
  useEffect(() => {
    if (admin || !data.canResubmit || !data.closesAt) return;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [admin, data.canResubmit, data.closesAt]);
  const canResubmit = !admin && data.canResubmit && (!data.closesAt || Date.parse(data.closesAt) > currentTime);
  const busy = working || savedDraft.saving;
  const answersChanged = JSON.stringify(answers) !== JSON.stringify(item.answers);
  const dirty = canEdit && !saved && (status !== item.status || feedback !== item.feedback || notes !== (item.internalNotes ?? "") || JSON.stringify(feedbackFormatting) !== JSON.stringify(item.feedbackFormatting ?? {}) || JSON.stringify(notesFormatting) !== JSON.stringify(item.notesFormatting ?? {}));
  const clearUnsavedWarning = useUnsavedChanges(dirty || (!saved && editing && savedDraft.dirty), canEdit ? "Leave this page? Unsaved review changes will be lost." : applicationUnsavedMessage);
  function cancelEditing() {
    if (savedDraft.dirty && !window.confirm("Discard unsaved edits? Use Save draft first to keep them. Your saved draft and submitted answers will stay as they were.")) return;
    setEditing(false); savedDraft.resetAnswers(); setConsent(false); setError("");
  }
  async function resubmit() {
    if (!auth || busy || !canResubmit) return;
    setWorking(true); setError("");
    try {
      await careerRequest(`/applications/${item.id}/resubmit`, { method: "POST", csrf: auth.csrfToken, body: { revision: item.revision, answers, consent, draftRevision: savedDraft.draftRevision } });
      setSaved(true);
      clearUnsavedWarning();
      navigate(`/applications/${item.id}?resubmitted=1`, { replace: true });
      reload();
    } catch (reason) { setError((reason as Error).message); setWorking(false); }
  }
  async function mutate(withdraw = false) {
    if (!auth || working || (admin && !canEdit)) return;
    setWorking(true); setError("");
    try { await careerRequest(`${admin ? "/admin" : ""}/applications/${item.id}${withdraw ? "/withdraw" : ""}`, { method: withdraw ? "POST" : "PUT", csrf: auth.csrfToken, body: { revision: item.revision, status, feedback, internalNotes: notes, feedbackFormatting, notesFormatting } }); setSaved(true); reload(); }
    catch (reason) { setError((reason as Error).message); setWorking(false); }
  }
  return <>
    {!admin && new URLSearchParams(search).has("submitted") && <div className="career-notice" role="status"><strong>Application received.</strong> <RichText text={form.confirmation || "Thank you for applying. You can follow updates here."} runs={form.formatting?.confirmation} /></div>}
    {!admin && new URLSearchParams(search).has("resubmitted") && <div className="career-notice" role="status"><strong>Application resubmitted.</strong> Your updated answers have been sent to the team for a fresh review.</div>}
    <header className="career-detail-header"><div><span className="career-eyebrow">{admin ? "APPLICATION REVIEW" : "YOUR APPLICATION"} / {item.category}</span><h2><RichText text={item.title} runs={form.formatting?.title} /></h2><p>Submitted {careerDate(item.createdAt)}{item.resubmittedAt && <> · Last resubmitted {careerDate(item.resubmittedAt)}</>}</p></div><StatusBadge status={item.status} /></header>
    <div className="career-form-layout"><div className="career-detail-main">
      {admin && <section className="career-card career-ai-assessment career-scored-application" style={scoreStyle(item.aiReview?.relativeScore)} aria-label="AI assessment">
        <div className="career-section-heading"><div><span className="career-eyebrow">ADVISORY · ADMIN REVIEW</span><h3>Luna assessment</h3></div><AiScoreBadge review={item.aiReview} /></div>
        {item.aiReview ? <><p><strong>Criteria score: {item.aiReview.qualityScore.toFixed(1)}/10</strong> · {careerDate(item.aiReview.reviewedAt)}</p><p className="career-answer">{item.aiReview.summary}</p>
          <p className="career-help">The coloured score is relative to {item.aiReview.poolSize} assessed applications in this opening. The criteria score measures the saved guide.{item.aiReview.criteriaChanged ? " The criteria have since changed; ask an administrator to rerun the review." : ""}</p>
          <div className="career-ai-grade-list">{item.aiReview.grades.map(grade => <article key={grade.criterionId}><h4>{grade.name} <strong>{grade.score.toFixed(1)}/5</strong></h4><small>Importance: {grade.weight}×</small><p className="career-answer">{grade.explanation}</p>{grade.evidence.map((evidence, index) => <blockquote key={index}><small>{evidence.question}</small><p>{evidence.quote}</p></blockquote>)}</article>)}</div>
          {item.aiReview.observations && <details><summary>Additional observations · not included in scores</summary><p className="career-answer">{item.aiReview.observations}</p></details>}
        </> : <p className="career-help">This application has no completed AI assessment. An administrator can review its form's applicant pool from the review queue.</p>}
      </section>}
      <section className="career-card"><h3>Connected accounts at submission</h3><div className="career-identity"><img src="/social/discord.png" alt="Discord" /><div><strong>{item.applicant.displayName} · @{item.applicant.username}</strong><small>Discord ID: {item.applicant.discordId}</small></div></div><div className="career-identity"><img src="/social/roblox.png" alt="Roblox" /><div><a href={`https://www.roblox.com/users/${item.applicant.roblox.userId}/profile`} target="_blank" rel="noopener noreferrer">@{item.applicant.roblox.username} ↗</a><small>Roblox ID: {item.applicant.roblox.userId}</small></div></div></section>
      {!admin && !editing && !canResubmit && data.draft && <ApplicationDraftNotice draft={data.draft} readOnlyForm={form} />}
      {editing ? <form className="career-application-editor" onSubmit={event => { event.preventDefault(); void resubmit(); }}>
        <section className="career-card"><span className="career-eyebrow">EDIT YOUR APPLICATION</span><h3>Update your answers</h3><p>You are editing the same questions you originally answered. Your current submission stays with the team until you resubmit.</p><p className="career-help">{data.closesAt ? `Resubmit before ${careerDate(data.closesAt)}.` : "You can resubmit until the opening closes."} Resubmitting returns your application to Submitted for a fresh review. Previous feedback stays in your timeline.</p></section>
        <ApplicationDraftNotice draft={savedDraft.draft} versionChanged={savedDraft.versionChanged} reviewChanged={savedDraft.reviewChanged} />
        <CareerFields questions={form.questions} answers={answers} onChange={setAnswers} disabled={busy} />
        <section className="career-card career-submit"><h3>Send your updated application</h3><p>The team will review your updated answers under the same application. Do not include passwords, your home address, or sensitive personal information.</p><label className="career-check"><input type="checkbox" required checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>I have read the <Link to="/privacy" target="_blank">Privacy Policy</Link> and <Link to="/terms" target="_blank">Terms of Service</Link>, and understand how my application will be reviewed.</span></label>
          {!canResubmit && <p className="career-notice is-error" role="alert">The deadline has passed. Your edits have not been submitted.</p>}
          {(error || savedDraft.error) && <p className="career-notice is-error" role="alert">{error || savedDraft.error}</p>}{savedDraft.notice && <p className="career-notice" role="status">{savedDraft.notice}</p>}
          <div className="career-actions"><button className="career-button" type="button" disabled={busy || !canResubmit || !savedDraft.dirty} onClick={() => void savedDraft.saveDraft()}>{savedDraft.saving ? "Saving draft…" : "Save draft"}</button><button className="career-button is-primary" type="submit" disabled={busy || !canResubmit || !answersChanged}>{working ? "Resubmitting…" : "Resubmit application"}</button><button className="career-button" type="button" disabled={busy} onClick={cancelEditing}>Cancel editing</button></div><p className="career-help">Save a private draft to continue later. The team sees your current submitted answers until you resubmit. Leaving this page discards unsaved edits.</p>
        </section>
      </form> : <section className="career-card career-answers"><div className="career-section-heading"><h3>Submitted answers</h3><div className="career-actions"><span className="career-muted">Original form version{!admin && data.draft ? " · Saved draft available" : ""}</span>{canResubmit && <button type="button" className="career-button" disabled={working} onClick={() => { setEditing(true); setWithdrawing(false); setError(""); }}>Edit application</button>}</div></div>{form.questions.map((q, index) => <div key={q.id}><h4><span>{String(index + 1).padStart(2, "0")}</span> <RichText text={q.label} runs={q.formatting?.label} /></h4>{q.help && <p className="career-help"><RichText text={q.help} runs={q.formatting?.help} /></p>}<QuestionImage image={q.image} />{Array.isArray(item.answers[q.id]) ? (q.type === "ranking" ? <ol>{(item.answers[q.id] as string[]).map(value => <li key={value}><RichText text={value} runs={q.formatting?.[`option${q.options?.indexOf(value)}`]} /></li>)}</ol> : <ul>{(item.answers[q.id] as string[]).map(value => <li key={value}><RichText text={value} runs={q.formatting?.[`option${q.options?.indexOf(value)}`]} /></li>)}</ul>) : <p className="career-answer">{item.answers[q.id] === undefined ? <em>No answer provided</em> : <RichText text={String(item.answers[q.id])} runs={q.type === "choice" ? q.formatting?.[`option${q.options?.indexOf(String(item.answers[q.id]))}`] : undefined} />}{q.type === "scale" && item.answers[q.id] !== undefined && <small> (scale {q.min}–{q.max}{q.minLabel || q.maxLabel ? `: ${q.minLabel || q.min} → ${q.maxLabel || q.max}` : ""})</small>}</p>}{["short", "paragraph"].includes(q.type) && <small className="career-word-count">{answerWordCount(item.answers[q.id]).toLocaleString()} words</small>}</div>)}<footer className="career-word-total"><strong>{applicationWordCount(form, item.answers).toLocaleString()} words in this application</strong><small>Written answers only; selected options and scale values are excluded.</small></footer></section>}
    </div><aside className="career-detail-sidebar">
      {canEdit && <form className="career-card career-review-form" onSubmit={e => { e.preventDefault(); void mutate(); }}><span className="career-eyebrow">REVIEW DESK</span><h3>Make a decision</h3>{item.reviewer && <p className="career-help">Last reviewed by {item.reviewer.displayName}</p>}<label>Status<select aria-label="Review status" value={status} disabled={working} onChange={e => setStatus(e.target.value as ApplicationStatus)}>{Object.entries(applicationStatuses).filter(([value]) => value !== "withdrawn" || item.status === "withdrawn").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><CareerRichText label="Feedback to applicant" maxLength={2000} value={feedback} runs={feedbackFormatting.feedback} disabled={working} multiline placeholder="Visible on their profile. Explain the decision or next steps." onChange={(text, runs) => { setFeedback(text); setFeedbackFormatting(updateFormatting(feedbackFormatting, "feedback", runs)); }} /><CareerRichText label="Private review notes" maxLength={6000} value={notes} runs={notesFormatting.internalNotes} disabled={working} multiline placeholder="Visible to authorized application reviewers." onChange={(text, runs) => { setNotes(text); setNotesFormatting(updateFormatting(notesFormatting, "internalNotes", runs)); }} /><p className="career-help">Decisions do not automatically assign Discord or Roblox roles. Contact the applicant separately if needed.</p>{error && <p className="career-notice is-error" role="alert">{error}</p>}<button className="career-button is-primary" disabled={working || !dirty || status === "withdrawn"}>{working ? "Saving…" : "Save review"}</button>{item.status === "withdrawn" && <p className="career-help">The applicant withdrew this application. Choose another status and save to restore it, even after the opening closes.</p>}</form>}
      {admin && !canEdit && <section className="career-card"><span className="career-eyebrow">READ-ONLY REVIEW</span><h3>Review details</h3>{item.reviewer && <p className="career-help">Last reviewed by {item.reviewer.displayName}</p>}<p className="career-help">Feedback to applicant</p><p className="career-answer"><RichText text={item.feedback || "No feedback yet."} runs={item.feedbackFormatting?.feedback} /></p><p className="career-help">Private review notes</p><p className="career-answer"><RichText text={item.internalNotes || "No private notes yet."} runs={item.notesFormatting?.internalNotes} /></p></section>}
      {!admin && <section className="career-card"><span className="career-eyebrow">LATEST FROM THE TEAM</span><h3>{applicationStatuses[item.status]}</h3><p className="career-answer"><RichText text={item.feedback || "Review updates and feedback will appear here."} runs={item.feedbackFormatting?.feedback} /></p><p className="career-help">Updated {careerDate(item.updatedAt)}</p>{!editing && <p className="career-help">{canResubmit ? (data.closesAt ? `You can edit and resubmit before ${careerDate(data.closesAt)}.` : "You can edit and resubmit until this opening closes.") : item.status === "withdrawn" ? "This application is withdrawn. An administrator can restore it." : "Editing is closed for this opening."}</p>}{!editing && !["accepted", "rejected", "withdrawn"].includes(item.status) && (withdrawing ? <div className="career-withdraw-confirm"><p>Withdraw this application? You cannot apply again to this same opening. To update your answers, edit and resubmit before the deadline instead. An administrator can restore a withdrawn application.</p><div className="career-actions"><button className="career-button is-danger" disabled={working} onClick={() => void mutate(true)}>{working ? "Withdrawing…" : "Confirm withdrawal"}</button><button className="career-button" disabled={working} onClick={() => setWithdrawing(false)}>Keep application</button></div></div> : <button className="career-link" onClick={() => setWithdrawing(true)}>Withdraw application</button>)}{!editing && error && <p className="career-notice is-error" role="alert">{error}</p>}</section>}
      <section className="career-card"><span className="career-eyebrow">APPLICATION TIMELINE</span><h3>Your progress</h3><ol className="career-timeline">{[...item.history].reverse().map((event, index) => <li key={`${event.at}-${index}`}><strong>{applicationStatuses[event.status]}</strong><time>{careerDate(event.at)}</time>{event.feedback && <p><RichText text={event.feedback} runs={event.feedbackFormatting?.feedback} /></p>}</li>)}</ol><p className="career-help">Latest 50 submission, status and feedback updates. Private notes are visible only to reviewers.</p></section>
    </aside></div>
  </>;
}
export default function Applications({ applicationId, admin = false }: { applicationId: string; admin?: boolean }) {
  const resource = useCareerResource<ApplicationDetail>(`${admin ? "/admin" : ""}/applications/${encodeURIComponent(applicationId)}`);
  const { search } = useLocation();
  const requestedReturn = new URLSearchParams(search).get("returnTo");
  const returnTo = requestedReturn?.startsWith("/admin/careers/review?") ? requestedReturn : resource.data ? `/admin/careers/review?formId=${encodeURIComponent(resource.data.application.formId)}` : "/admin/careers/review";
  return <section className="content-band careers-page"><Link className="career-back" to={admin ? returnTo : "/login?tab=applications"}>← {admin ? "Review queue" : "My applications"}</Link><CareerResourceState {...resource} />{resource.data && <ApplicationContent key={`${applicationId}-${resource.data.application.revision}`} data={resource.data} admin={admin} reload={resource.reload} />}</section>;
}
