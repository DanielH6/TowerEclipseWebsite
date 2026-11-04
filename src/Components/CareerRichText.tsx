import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export interface TextRun { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string; highlight?: string; href?: string; size?: "small" | "large" }
export type TextFormatting = Record<string, TextRun[]>;
export function updateFormatting(formatting: TextFormatting | undefined, field: string, runs: TextRun[]) {
  const next = { ...formatting };
  if (runs.some(run => Object.keys(run).length > 1)) next[field] = runs;
  else delete next[field];
  return next;
}
function safeLink(value: string) {
  try { const url = new URL(value); return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
function runStyle(run: TextRun): CSSProperties {
  return { fontWeight: run.bold ? 750 : undefined, fontStyle: run.italic ? "italic" : undefined,
    textDecoration: [run.underline && "underline", run.strike && "line-through"].filter(Boolean).join(" ") || undefined,
    color: /^#[\da-f]{6}$/i.test(run.color ?? "") ? run.color : undefined,
    backgroundColor: /^#[\da-f]{6}$/i.test(run.highlight ?? "") ? run.highlight : undefined,
    fontSize: run.size === "large" ? "1.2em" : run.size === "small" ? ".85em" : undefined };
}
export function RichText({ text, runs }: { text: string; runs?: TextRun[] }) {
  if (!runs?.length || runs.map(run => run.text).join("") !== text) return <>{text}</>;
  return <span className="career-rich-text">{runs.map((run, i) => safeLink(run.href ?? "")
    ? <a key={i} href={safeLink(run.href!)} style={runStyle(run)} target="_blank" rel="noopener noreferrer">{run.text}</a>
    : <span key={i} style={runStyle(run)}>{run.text}</span>)}</span>;
}

// Read only supported text styles. HTML and event handlers are never persisted or rendered.
function readRuns(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  function walk(node: Node, inherited: Omit<TextRun, "text">) {
    if (node.nodeType === Node.TEXT_NODE) { if (node.textContent) runs.push({ text: node.textContent, ...inherited }); return; }
    if (!(node instanceof HTMLElement)) return;
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)) return;
    if (node.tagName === "BR") { runs.push({ text: "\n" }); return; }
    const style = { ...inherited };
    if (["B", "STRONG"].includes(node.tagName) || Number(node.style.fontWeight) >= 600 || node.style.fontWeight === "bold") style.bold = true;
    if (["normal", "400"].includes(node.style.fontWeight)) delete style.bold;
    if (["I", "EM"].includes(node.tagName) || node.style.fontStyle === "italic") style.italic = true;
    if (node.style.fontStyle === "normal") delete style.italic;
    if (node.tagName === "U" || node.style.textDecoration.includes("underline")) style.underline = true;
    if (["S", "STRIKE", "DEL"].includes(node.tagName) || node.style.textDecoration.includes("line-through")) style.strike = true;
    const hex = (value: string) => {
      if (/^#[\da-f]{6}$/i.test(value)) return value;
      const rgb = value.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      return rgb ? `#${rgb.slice(1).map(n => Number(n).toString(16).padStart(2, "0")).join("")}` : undefined;
    };
    const color = hex(node.style.color || node.getAttribute("color") || "");
    const highlight = hex(node.style.backgroundColor);
    if (color) style.color = color;
    if (highlight) style.highlight = highlight;
    if (node.tagName === "A") style.href = safeLink(node.getAttribute("href") ?? "");
    if (node.getAttribute("size") === "5" || node.style.fontSize === "1.2em") style.size = "large";
    if (node.getAttribute("size") === "1" || node.style.fontSize === "0.85em") style.size = "small";
    if (node.getAttribute("size") === "3") delete style.size;
    const block = ["DIV", "P", "LI"].includes(node.tagName);
    if (block && node.previousSibling && !runs.at(-1)?.text.endsWith("\n")) runs.push({ text: "\n" });
    node.childNodes.forEach(child => walk(child, style));
  }
  root.childNodes.forEach(node => walk(node, {}));
  // Browsers use a single BR to keep an empty editor focusable.
  if (root.innerHTML === "<br>") return [];
  return runs;
}
function writeRuns(root: HTMLElement, text: string, runs?: TextRun[]) {
  root.replaceChildren();
  if (!text) return;
  const values = runs?.map(run => run.text).join("") === text ? runs : [{ text }];
  for (const run of values) {
    const span = document.createElement("span");
    Object.assign(span.style, runStyle(run));
    span.textContent = run.text;
    if (safeLink(run.href ?? "")) {
      const link = document.createElement("a"); link.href = safeLink(run.href!)!; link.append(span); root.append(link);
    } else root.append(span);
  }
}

export default function CareerRichText({ label, value, runs, onChange, maxLength, multiline = false, placeholder = "", disabled = false }: {
  label: string; value: string; runs?: TextRun[]; onChange: (text: string, runs: TextRun[]) => void; maxLength: number; multiline?: boolean; placeholder?: string; disabled?: boolean;
}) {
  const id = useId(), editor = useRef<HTMLDivElement>(null), selection = useRef<Range | null>(null);
  const [message, setMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false), [link, setLink] = useState("");
  const [color, setColor] = useState("#76bdff"), [highlight, setHighlight] = useState("#38516e");
  useLayoutEffect(() => {
    const root = editor.current;
    if (root && (readRuns(root).map(run => run.text).join("") !== value || document.activeElement !== root)) writeRuns(root, value, runs);
  }, [value, runs]);
  const remember = () => {
    const current = window.getSelection();
    if (current?.rangeCount && editor.current?.contains(current.anchorNode) && editor.current.contains(current.focusNode)) selection.current = current.getRangeAt(0).cloneRange();
  };
  function change() {
    const root = editor.current!;
    const next = readRuns(root), text = next.map(run => run.text).join("");
    if (text.length > maxLength) { writeRuns(root, value, runs); setMessage(`Keep this field within ${maxLength} characters.`); return; }
    setMessage(""); onChange(text, next); remember();
  }
  function command(name: string, argument?: string) {
    if (disabled || editor.current?.closest("fieldset:disabled")) return;
    editor.current?.focus();
    const current = window.getSelection();
    if (selection.current && editor.current?.contains(selection.current.commonAncestorContainer)) { current?.removeAllRanges(); current?.addRange(selection.current); }
    document.execCommand(name, false, argument); change();
  }
  const button = (name: string, title: string, content: React.ReactNode, argument?: string) => <button type="button" title={title} aria-label={title} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => command(name, argument)}>{content}</button>;
  return <div className="career-rich-field">
    <label id={`${id}-label`} onClick={() => editor.current?.focus()}>{label}</label>
    <div className="career-rich-toolbar" role="group" aria-label={`${label} formatting`}>
      {button("bold", "Bold", <b>B</b>)}{button("italic", "Italic", <i>I</i>)}{button("underline", "Underline", <u>U</u>)}{button("strikeThrough", "Strikethrough", <s>S</s>)}
      <select aria-label="Text size" defaultValue="3" disabled={disabled} onFocus={remember} onChange={e => command("fontSize", e.target.value)}><option value="1">Small</option><option value="3">Normal</option><option value="5">Large</option></select>
      <label className="career-color-control" title="Text colour">A<input aria-label="Text colour" type="color" value={color} disabled={disabled} onFocus={remember} onChange={e => { setColor(e.target.value); command("foreColor", e.target.value); }} /></label>
      <label className="career-color-control" title="Highlight colour">▰<input aria-label="Highlight colour" type="color" value={highlight} disabled={disabled} onFocus={remember} onChange={e => { setHighlight(e.target.value); command("hiliteColor", e.target.value); }} /></label>
      <button type="button" aria-label="Add link" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => { remember(); setLinkOpen(value => !value); }}>Link</button>
      {button("unlink", "Remove link", "Unlink")}
      {multiline && <>{button("insertText", "Bullet point", "• List", "\n• ")}{button("insertText", "Numbered item", "1. List", `\n${(value.match(/(?:^|\n)\d+\. /g)?.length ?? 0) + 1}. `)}</>}
      {button("undo", "Undo", "↶")}{button("redo", "Redo", "↷")}
      <button type="button" aria-label="Clear formatting" disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={() => { command("removeFormat"); command("unlink"); }}>Clear style</button>
    </div>
    {linkOpen && <div className="career-link-editor"><input aria-label="Link URL" type="url" value={link} placeholder="https://example.com" disabled={disabled} onChange={e => setLink(e.target.value)} /><button type="button" className="career-mini-button" disabled={disabled} onClick={() => {
      const href = safeLink(link); if (!href) { setMessage("Enter an https://, http:// or mailto: link."); return; }
      command("createLink", href); setLinkOpen(false); setLink(""); setMessage("");
    }}>Apply link</button></div>}
    <div ref={editor} className={`career-rich-editor${multiline ? " is-multiline" : ""}`} role="textbox" aria-labelledby={`${id}-label`} aria-multiline={multiline} aria-disabled={disabled} contentEditable={!disabled} suppressContentEditableWarning data-placeholder={placeholder} onInput={change} onBlur={remember} onKeyUp={remember} onMouseUp={remember}
      onKeyDown={e => { if (!multiline && e.key === "Enter") e.preventDefault(); }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const dropped = e.dataTransfer.getData("text/plain"); command("insertText", multiline ? dropped : dropped.replace(/[\r\n]+/g, " ")); }}
      onPaste={e => { e.preventDefault(); const pasted = e.clipboardData.getData("text/plain"); command("insertText", multiline ? pasted : pasted.replace(/[\r\n]+/g, " ")); }} />
    <small className="career-character-count">{value.length} / {maxLength}</small>
    {message && <p className="career-help" role="alert">{message}</p>}
  </div>;
}
