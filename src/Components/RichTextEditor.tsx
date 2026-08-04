import {
  useEffect,
  useId,
  useRef,
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
  const labelId = useId();

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

  function toolbarAction(event: MouseEvent<HTMLButtonElement>, command: string, commandValue?: string) {
    event.preventDefault();
    if (disabled) return;
    editorRef.current?.focus();
    execute(command, commandValue);
    updateValue();
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
          <button type="button" disabled={disabled} title="Remove formatting" aria-label="Remove formatting" onMouseDown={(event) => toolbarAction(event, "removeFormat")}>CLEAR</button>
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
          onInput={(_event: FormEvent<HTMLDivElement>) => updateValue()}
          onBlur={updateValue}
        />
      </div>
    </div>
  );
}
