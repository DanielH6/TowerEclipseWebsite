import { useState } from "react";
import { useAuth } from "../AuthContext";
import { careerDate, careerRequest, type Answers, type CareerApplicationDraft, type FormDraft } from "../careers";
import { RichText } from "./CareerRichText";

const sameAnswers = (left: Answers, right: Answers) => JSON.stringify(left) === JSON.stringify(right);
function restoreAnswers(draft: CareerApplicationDraft | null | undefined, versionId: string, form: FormDraft, fallback: Answers): Answers {
  if (!draft) return fallback;
  if (draft.versionId === versionId) return draft.answers;
  // Carry answers only when the entire question is unchanged; keep the old draft visible for recovery.
  return Object.fromEntries(form.questions.filter(question => draft.answers[question.id] !== undefined && draft.form?.questions.some(old => JSON.stringify(old) === JSON.stringify(question))).map(question => [question.id, draft.answers[question.id]!]));
}

export function useApplicationDraft({ initialDraft, versionId, formId, form, applicationRevision, fallback = {} }: { initialDraft?: CareerApplicationDraft | null; versionId: string; formId: string; form: FormDraft; applicationRevision?: number; fallback?: Answers }) {
  const { auth } = useAuth();
  const [draft, setDraft] = useState(initialDraft ?? null);
  const [answers, setAnswerState] = useState<Answers>(() => restoreAnswers(initialDraft, versionId, form, fallback));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const versionChanged = Boolean(draft && draft.versionId !== versionId);
  const reviewChanged = Boolean(draft && applicationRevision !== undefined && draft.applicationRevision !== applicationRevision);
  const dirty = versionChanged || !sameAnswers(answers, draft?.answers ?? fallback);
  function setAnswers(value: Answers) { setAnswerState(value); setNotice(""); setError(""); }
  async function saveDraft() {
    if (!auth || saving) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const saved = await careerRequest<CareerApplicationDraft>(`/forms/${formId}/draft`, { method: "PUT", csrf: auth.csrfToken, body: { versionId, answers, revision: draft?.revision ?? null, ...(applicationRevision !== undefined ? { applicationRevision } : {}) } });
      setDraft(saved); setAnswerState(saved.answers); setNotice("Draft saved. Only you can see it; your edits have not been submitted.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  function resetAnswers() { setAnswers(restoreAnswers(draft, versionId, form, fallback)); setError(""); setNotice(""); }
  return { answers, setAnswers, draft, draftRevision: draft?.revision ?? null, saving, notice, error, dirty, versionChanged, reviewChanged, saveDraft, resetAnswers };
}

export function ApplicationDraftNotice({ draft, versionChanged = false, reviewChanged = false, readOnlyForm }: { draft?: CareerApplicationDraft | null; versionChanged?: boolean; reviewChanged?: boolean; readOnlyForm?: FormDraft }) {
  if (!draft) return null;
  const recoveryForm = draft.form ?? readOnlyForm;
  return <div className="career-notice career-draft-notice" role="status"><strong>Saved draft</strong> · {careerDate(draft.updatedAt)}. Only you can see these answers until you submit.
    {reviewChanged && <p>The team updated your application after this draft was saved. Review the current status and feedback before resubmitting your edits.</p>}
    {versionChanged && <p>The opening has changed since you saved. Answers to unchanged questions have been carried over. Review the latest questions before submitting. Saving this version replaces your previous draft.</p>}
    {readOnlyForm && <p>Editing is closed. You can still read and copy your saved draft; these edits have not been submitted.</p>}
    {(versionChanged || readOnlyForm) && <details><summary>{readOnlyForm ? "View saved draft answers" : "View previous draft answers"}</summary>{recoveryForm?.questions.map(question => <div key={question.id}><h4><RichText text={question.label} runs={question.formatting?.label} /></h4><p className="career-answer">{draft.answers[question.id] === undefined ? <em>No answer saved</em> : Array.isArray(draft.answers[question.id]) ? (draft.answers[question.id] as string[]).join(" · ") : String(draft.answers[question.id])}</p></div>)}</details>}
  </div>;
}
