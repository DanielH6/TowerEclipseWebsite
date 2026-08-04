import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from "react";
import "./RichTextEditor.css";

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}

function execute(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export default function RichTextEditor({
  label,
  value,
  onChange,
  placeholder = "Write here…",
  disabled = false,
  compact = false,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const labelId = useId();
  const [tableBuilderOpen, setTableBuilderOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [tableHasHeader, setTableHasHeader] = useState(true);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    if (editor.innerHTML !== value) editor.innerHTML = value;
  }, [value]);

  function updateValue() {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(editor.innerHTML === "<br>" ? "" : editor.innerHTML);
  }

  function rememberSelection() {
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange();
  }

  function restoreSelection() {
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection) return;
    editor.focus();
    if (!selectionRef.current) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
  }

  function toolbarAction(event: MouseEvent<HTMLButtonElement>, command: string, commandValue?: string) {
    event.preventDefault();
    if (disabled) return;
    restoreSelection();
    execute(command, commandValue);
    updateValue();
    rememberSelection();
  }

  function insertTable() {
    const rows = Math.max(1, Math.min(12, tableRows));
    const columns = Math.max(1, Math.min(8, tableColumns));
    const makeRow = (tag: "th" | "td", rowIndex: number) => `<tr>${Array.from(
      { length: columns },
      (_value, columnIndex) => `<${tag}>${tag === "th" ? `Heading ${columnIndex + 1}` : `Cell ${rowIndex + 1}.${columnIndex + 1}`}</${tag}>`,
    ).join("")}</tr>`;
    const header = tableHasHeader ? `<thead>${makeRow("th", 0)}</thead>` : "";
    const bodyStart = tableHasHeader ? 1 : 0;
    const bodyRows = Array.from(
      { length: rows - bodyStart },
      (_value, index) => makeRow("td", index + bodyStart),
    ).join("");
    restoreSelection();
    execute("insertHTML", `<table>${header}<tbody>${bodyRows}</tbody></table><p><br></p>`);
    updateValue();
    rememberSelection();
    setTableBuilderOpen(false);
  }

  return (
    <div className={`rich-editor-field ${compact ? "compact" : ""}`}>
      <span className="rich-editor-label" id={labelId}>{label}</span>
      <div className="rich-editor-shell">
        <div className="rich-editor-toolbar" aria-label={`${label} formatting controls`}>
          <select
            aria-label="Text style"
            disabled={disabled}
            defaultValue="p"
            onChange={(event) => {
              editorRef.current?.focus();
              execute("formatBlock", event.target.value);
              updateValue();
            }}
          >
            <option value="p">Paragraph</option>
            <option value="h3">Heading</option>
            <option value="h4">Subheading</option>
            <option value="blockquote">Quote</option>
          </select>
          <button type="button" disabled={disabled} title="Bold" aria-label="Bold" onMouseDown={(event) => toolbarAction(event, "bold")}><strong>B</strong></button>
          <button type="button" disabled={disabled} title="Italic" aria-label="Italic" onMouseDown={(event) => toolbarAction(event, "italic")}><em>I</em></button>
          <button type="button" disabled={disabled} title="Underline" aria-label="Underline" onMouseDown={(event) => toolbarAction(event, "underline")}><u>U</u></button>
          <button type="button" disabled={disabled} title="Bulleted list" aria-label="Bulleted list" onMouseDown={(event) => toolbarAction(event, "insertUnorderedList")}>• LIST</button>
          <button type="button" disabled={disabled} title="Numbered list" aria-label="Numbered list" onMouseDown={(event) => toolbarAction(event, "insertOrderedList")}>1. LIST</button>
          <button
            type="button"
            className={tableBuilderOpen ? "active" : ""}
            disabled={disabled}
            title="Insert table"
            aria-label="Insert table"
            aria-expanded={tableBuilderOpen}
            onMouseDown={(event) => {
              event.preventDefault();
              rememberSelection();
              setTableBuilderOpen((current) => !current);
            }}
          >
            TABLE
          </button>
          <button
            type="button"
            disabled={disabled}
            title="Add link"
            aria-label="Add link"
            onMouseDown={(event) => {
              event.preventDefault();
              if (disabled) return;
              const href = window.prompt("Enter an https:// link:");
              if (!href) return;
              editorRef.current?.focus();
              execute("createLink", href);
              updateValue();
            }}
          >
            LINK
          </button>
          <button type="button" disabled={disabled} title="Undo" aria-label="Undo" onMouseDown={(event) => toolbarAction(event, "undo")}>UNDO</button>
          <button type="button" disabled={disabled} title="Redo" aria-label="Redo" onMouseDown={(event) => toolbarAction(event, "redo")}>REDO</button>
          <button type="button" disabled={disabled} title="Remove formatting" aria-label="Remove formatting" onMouseDown={(event) => toolbarAction(event, "removeFormat")}>CLEAR</button>
          {tableBuilderOpen && (
            <div className="rich-table-builder" role="group" aria-label="Table options">
              <label>
                <span>Rows</span>
                <input type="number" min="1" max="12" value={tableRows} onChange={(event) => setTableRows(Number(event.target.value))} />
              </label>
              <label>
                <span>Columns</span>
                <input type="number" min="1" max="8" value={tableColumns} onChange={(event) => setTableColumns(Number(event.target.value))} />
              </label>
              <label className="rich-table-header-toggle">
                <input type="checkbox" checked={tableHasHeader} onChange={(event) => setTableHasHeader(event.target.checked)} />
                <span>Header row</span>
              </label>
              <button type="button" className="rich-table-insert" onClick={insertTable}>INSERT TABLE</button>
              <button type="button" onClick={() => setTableBuilderOpen(false)}>CANCEL</button>
            </div>
          )}
        </div>
        <div
          ref={editorRef}
          className="rich-editor-canvas"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-labelledby={labelId}
          aria-multiline="true"
          data-placeholder={placeholder}
          onInput={(_event: FormEvent<HTMLDivElement>) => {
            updateValue();
            rememberSelection();
          }}
          onBlur={updateValue}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
        />
      </div>
    </div>
  );
}
