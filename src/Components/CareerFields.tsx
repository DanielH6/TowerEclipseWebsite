import { useId } from "react";
import { moveItem, type Answers, type CareerQuestion } from "../careers";

export function CareerResourceState({ error, loading, reload }: { error: string; loading: boolean; reload: () => void }) {
  return error ? <div className="career-notice is-error" role="alert">{error} <button className="career-link" onClick={reload}>Try again</button></div> : loading ? <p className="career-muted" role="status">Loading…</p> : null;
}
export function CareerPagination({ pages, setPages, nextCursor, loading }: { pages: (string | null)[]; setPages: (pages: (string | null)[]) => void; nextCursor?: string | null; loading: boolean }) {
  return <nav className="career-pagination" aria-label="Results pages"><button className="career-button" disabled={pages.length === 1 || loading} onClick={() => setPages(pages.slice(0, -1))}>← Previous</button><span>Page {pages.length}</span><button className="career-button" disabled={!nextCursor || loading} onClick={() => setPages([...pages, nextCursor!])}>Next →</button></nav>;
}
export default function CareerFields({ questions, answers, onChange, disabled = false }: { questions: CareerQuestion[]; answers: Answers; onChange: (answers: Answers) => void; disabled?: boolean }) {
  const prefix = useId();
  return <div className="career-questions">{questions.map((q, index) => {
    const fieldId = `${prefix}-${q.id}`, helpId = `${fieldId}-help`;
    const value = answers[q.id];
    const update = (next: Answers[string]) => onChange({ ...answers, [q.id]: next });
    const selected = Array.isArray(value) ? value : [];
    return <fieldset className="career-question" key={q.id} disabled={disabled} aria-describedby={helpId}>
      <legend><span className="career-question-number">{String(index + 1).padStart(2, "0")}</span> {q.label || "Untitled question"} {q.required && <span className="career-required">*</span>}</legend>
      <p className="career-help" id={helpId}>{q.help}{q.help ? " · " : ""}{q.required ? "Required" : "Optional"}{q.type === "ranking" ? " · Rank every option, with your first choice at the top." : ""}</p>
      {(q.type === "short" || q.type === "paragraph") && <><label className="sr-only" htmlFor={fieldId}>{q.label}</label>{q.type === "short" ? <input id={fieldId} value={typeof value === "string" ? value : ""} required={q.required} maxLength={500} onChange={e => update(e.target.value)} placeholder="Your answer" /> : <textarea id={fieldId} value={typeof value === "string" ? value : ""} required={q.required} maxLength={5000} rows={5} onChange={e => update(e.target.value)} placeholder="Tell us a little more…" />}<small className="career-character-count">{typeof value === "string" ? value.length : 0} / {q.type === "short" ? 500 : 5000}</small></>}
      {q.type === "choice" && <div className="career-options">{q.options?.map(option => <label className="career-option" key={option}><input name={fieldId} type="radio" value={option} checked={value === option} required={q.required} onChange={() => update(option)} />{option}</label>)}</div>}
      {q.type === "checkboxes" && <div className="career-options">{q.options?.map(option => <label className="career-option" key={option}><input type="checkbox" checked={selected.includes(option)} onChange={e => update(e.target.checked ? [...selected, option] : selected.filter(item => item !== option))} />{option}</label>)}</div>}
      {q.type === "scale" && <><div className="career-scale">{Array.from({ length: q.max! - q.min! + 1 }, (_, i) => q.min! + i).map(number => <label key={number}><input name={fieldId} type="radio" checked={value === number} required={q.required} onChange={() => update(number)} /><span>{number}</span></label>)}</div><div className="career-scale-labels"><span>{q.minLabel}</span><span>{q.maxLabel}</span></div></>}
      {q.type === "ranking" && <><ol className="career-ranking">{(selected.length ? selected : q.options ?? []).map((option, position, list) => <li key={option}><span className="career-rank-number">{position + 1}</span><span>{option}</span><div><button type="button" disabled={position === 0 || disabled} aria-label={`Move ${option} up`} onClick={() => update(moveItem(list, position, -1))}>↑</button><button type="button" disabled={position === list.length - 1 || disabled} aria-label={`Move ${option} down`} onClick={() => update(moveItem(list, position, 1))}>↓</button></div></li>)}</ol><label className="career-check"><input type="checkbox" checked={selected.length === q.options?.length} required={q.required} onChange={e => update(e.target.checked ? [...q.options!] : [])} />Use this ranking</label></>}
      {!q.required && value !== undefined && <button type="button" className="career-link" onClick={() => { const next = { ...answers }; delete next[q.id]; onChange(next); }}>Clear answer</button>}
    </fieldset>;
  })}</div>;
}
