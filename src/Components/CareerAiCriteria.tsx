import { useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { careerRequest, useCareerResource, type AiCriterion, type AiReviewSettings, type FormDraft } from "../careers";

export default function CareerAiCriteria({ form, value, onChange, disabled, onBusy }: {
  form: FormDraft; value: AiReviewSettings; onChange: (settings: AiReviewSettings) => void; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const { auth } = useAuth();
  useEffect(() => { if (window.location.hash === "#ai-review-guide") document.getElementById("ai-review-guide")?.scrollIntoView({ block: "start" }); }, []);
  const configuration = useCareerResource<{ configured: boolean; model: string }>("/admin/ai-config");
  const [error, setError] = useState(""), [drafting, setDrafting] = useState(false);
  const totalWeight = value.criteria.reduce((sum, c) => sum + c.weight, 0);
  const changeCriterion = (index: number, patch: Partial<AiCriterion>) => onChange({ ...value, criteria: value.criteria.map((c, i) => i === index ? { ...c, ...patch } : c) });
  async function draftGuide() {
    if (!auth || disabled || drafting) return;
    if (value.criteria.length && !window.confirm("Replace the current scoring guide with a new editable draft? Your brief and examples will stay.")) return;
    setError(""); setDrafting(true); onBusy(true);
    try { onChange(await careerRequest<AiReviewSettings>("/admin/ai-criteria/draft", { method: "POST", csrf: auth.csrfToken, body: { settings: value, form } })); }
    catch (reason) { setError((reason as Error).message); }
    finally { setDrafting(false); onBusy(false); }
  }
  return <section id="ai-review-guide" className="career-card career-ai-editor" aria-label="AI review criteria">
    <span className="career-eyebrow">PRIVATE · ADMINISTRATORS ONLY</span><h3>AI review guide</h3>
    <p>Tell Luna what makes a useful application for this opening. This guide and its sample answers are never shown to applicants.</p>
    <details className="career-ai-instructions"><summary>How to set up a review</summary><ol>
      <li>Describe the qualities you value, what weak answers miss, and anything the AI should avoid rewarding.</li>
      <li>Optionally add weak, average or strong sample answers. Explain why you gave each sample its mark.</li>
      <li>Draft a guide with Luna, or add criteria yourself. Each area receives 0–5 marks.</li>
      <li>Choose importance. Normal counts once, High twice, Highest three times. Equal importance is a good starting point.</li>
      <li>Check the guide and Save draft. You can use saved private criteria without republishing the public form.</li>
      <li>Open Review applications, select this form, and run the review. Results support your decision; they never change application status.</li>
    </ol><p>The criteria score measures the saved requirements. The separate relative score compares applicants in this opening, centred on 5/10. Status filters do not change that comparison pool.</p></details>
    <label>What makes a good application?<textarea rows={6} maxLength={8000} value={value.brief} disabled={disabled} onChange={e => onChange({ ...value, brief: e.target.value })} placeholder="For example: Look for clear thinking, practical reproduction steps and specific examples. Prior experience helps, but strong reasoning can compensate. Reward substance rather than length or polished wording." /></label>
    <p className="career-help">You do not need to cover every possible answer. Describe your priorities and accept different valid approaches. Scores follow the saved criteria; additional observations appear separately.</p>
    <div className="career-section-heading"><h4>Sample answers · optional</h4><button type="button" className="career-button" disabled={disabled || value.examples.length >= 8} onClick={() => onChange({ ...value, examples: [...value.examples, { question: "", answer: "", score: 3, notes: "" }] })}>+ Add sample answer</button></div>
    {value.examples.map((example, index) => <div className="career-ai-example" key={index}>
      <div className="career-section-heading"><strong>Sample {index + 1}</strong><button type="button" className="career-link" disabled={disabled} onClick={() => onChange({ ...value, examples: value.examples.filter((_, i) => i !== index) })}>Remove sample</button></div>
      <label>Question for sample {index + 1}<select aria-label={`Question for sample ${index + 1}`} value={example.question} disabled={disabled} onChange={e => onChange({ ...value, examples: value.examples.map((item, i) => i === index ? { ...item, question: e.target.value } : item) })}><option value="">Whole application / general example</option>{example.question && !form.questions.some(q => q.label === example.question) && <option value={example.question}>{example.question}</option>}{form.questions.filter(q => q.label).map(q => <option key={q.id} value={q.label}>{q.label}</option>)}</select></label>
      <label>Sample answer {index + 1}<textarea rows={4} maxLength={5000} disabled={disabled} value={example.answer} onChange={e => onChange({ ...value, examples: value.examples.map((item, i) => i === index ? { ...item, answer: e.target.value } : item) })} /></label>
      <div className="career-input-grid"><label>Sample {index + 1} mark<select aria-label={`Sample ${index + 1} mark`} value={example.score} disabled={disabled} onChange={e => onChange({ ...value, examples: value.examples.map((item, i) => i === index ? { ...item, score: Number(e.target.value) } : item) })}>{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}/5{n === 0 ? " · very weak" : n === 3 ? " · adequate" : n === 5 ? " · strong" : ""}</option>)}</select></label><label>Why this mark?<textarea rows={3} maxLength={1200} disabled={disabled} value={example.notes} onChange={e => onChange({ ...value, examples: value.examples.map((item, i) => i === index ? { ...item, notes: e.target.value } : item) })} /></label></div>
    </div>)}
    <div className="career-section-heading"><h4>Scoring criteria · {value.criteria.length}/8</h4><div className="career-actions"><button type="button" className="career-button is-primary" disabled={disabled || !configuration.data?.configured || !value.brief.trim()} onClick={() => void draftGuide()}>{drafting ? "Drafting guide…" : "Draft guide with Luna"}</button><button type="button" className="career-button" disabled={disabled || value.criteria.length >= 8} onClick={() => onChange({ ...value, criteria: [...value.criteria, { id: crypto.randomUUID(), name: "", description: "", weight: 1, low: "", middle: "", high: "" }] })}>+ Add criterion</button></div></div>
    {!configuration.data?.configured && <p className="career-help">{configuration.loading ? "Checking Luna configuration…" : "You can write and save the guide now. Luna drafting and review need an OpenAI API key configured on the server."}</p>}
    {configuration.error && <p className="career-notice is-error" role="alert">{configuration.error} <button type="button" className="career-link" onClick={configuration.reload}>Retry connection check</button></p>}
    {value.criteria.map((criterion, index) => <div className="career-ai-criterion" key={criterion.id}>
      <div className="career-section-heading"><strong>Criterion {index + 1} <small>· {Math.round(100 * criterion.weight / Math.max(1, totalWeight))}% of criteria score</small></strong><button type="button" className="career-link" disabled={disabled} onClick={() => onChange({ ...value, criteria: value.criteria.filter(c => c.id !== criterion.id) })}>Remove criterion</button></div>
      <div className="career-input-grid"><label>Criterion {index + 1} name<input maxLength={80} disabled={disabled} value={criterion.name} onChange={e => changeCriterion(index, { name: e.target.value })} placeholder="e.g. Practical problem solving" /></label><label>Criterion {index + 1} importance<select aria-label={`Criterion ${index + 1} importance`} disabled={disabled} value={criterion.weight} onChange={e => changeCriterion(index, { weight: Number(e.target.value) })}><option value={1}>Normal · 1×</option><option value={2}>High · 2×</option><option value={3}>Highest · 3×</option></select></label></div>
      <label>What should criterion {index + 1} assess?<textarea rows={3} maxLength={1200} disabled={disabled} value={criterion.description} onChange={e => changeCriterion(index, { description: e.target.value })} placeholder="Describe the evidence to look for. Assess answers rather than assumptions about the person." /></label>
      <details><summary>Marking examples · optional</summary><label>Low · 0–1/5<textarea rows={2} maxLength={500} disabled={disabled} value={criterion.low} onChange={e => changeCriterion(index, { low: e.target.value })} /></label><label>Adequate · 3/5<textarea rows={2} maxLength={500} disabled={disabled} value={criterion.middle} onChange={e => changeCriterion(index, { middle: e.target.value })} /></label><label>Strong · 5/5<textarea rows={2} maxLength={500} disabled={disabled} value={criterion.high} onChange={e => changeCriterion(index, { high: e.target.value })} /></label></details>
    </div>)}
    {!value.criteria.length && <p className="career-help">Add at least one named criterion with a description before requesting a review. The brief, examples and guide save with Save draft.</p>}
    {error && <p className="career-notice is-error" role="alert">{error}</p>}
  </section>;
}
