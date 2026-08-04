import { useEffect, useState } from "react";
import {
  archiveDictionaryEntry,
  createDictionaryEntry,
  loadAdminDictionary,
  updateDictionaryEntry,
} from "../api";
import type { DictionaryInput } from "../api";
import { useAuth } from "../AuthContext";
import { Link } from "../router";
import type { DictionaryEntry, DictionaryName } from "../types";
import "./Bugs.css";

const dictionaryLabels: Record<DictionaryName, string> = {
  statuses: "Statuses",
  versions: "Versions",
  priorities: "Priorities",
  categories: "Categories",
  types: "Types",
  devices: "Devices",
};

const dictionaryNames = Object.keys(dictionaryLabels) as DictionaryName[];

const emptyInput: DictionaryInput = {
  code: "",
  label: "",
  description: "",
  color: null,
  sortOrder: 10,
  active: true,
  initial: false,
  terminal: false,
};

export default function AdminPage() {
  const { auth } = useAuth();
  const [dictionary, setDictionary] = useState<DictionaryName>("statuses");
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [form, setForm] = useState<DictionaryInput>(emptyInput);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(selected = dictionary) {
    setLoading(true);
    setError(null);
    try {
      setEntries(await loadAdminDictionary(selected));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load dictionary entries.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setEditingId(null);
    setForm(emptyInput);
    refresh(dictionary);
  }, [dictionary]);

  function edit(entry: DictionaryEntry) {
    setEditingId(entry.id);
    setForm({
      code: entry.code,
      label: entry.label,
      description: entry.description,
      color: entry.color,
      sortOrder: entry.sortOrder,
      active: entry.active,
      initial: entry.initial ?? false,
      terminal: entry.terminal ?? false,
    });
  }

  async function save() {
    if (!auth) return;
    setWorking(true);
    setError(null);
    try {
      if (editingId) {
        await updateDictionaryEntry(dictionary, editingId, form, auth.csrfToken);
      } else {
        await createDictionaryEntry(dictionary, form, auth.csrfToken);
      }
      setEditingId(null);
      setForm(emptyInput);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save dictionary entry.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="workspace-page admin-page">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">DEVELOPER ADMIN</p>
          <h2>DICTIONARIES</h2>
          <p>Manage the values shown in bug-report dropdowns.</p>
        </div>
        <Link className="primary-action" to="/admin/updates">UPDATE EDITOR</Link>
      </div>

      <div className="admin-layout">
        <nav className="dictionary-navigation" aria-label="Dictionary types">
          {dictionaryNames.map((name) => (
            <button
              type="button"
              className={dictionary === name ? "active" : ""}
              onClick={() => setDictionary(name)}
              key={name}
            >
              {dictionaryLabels[name]}
            </button>
          ))}
        </nav>

        <div className="admin-content">
          <article className="panel-card dictionary-editor">
            <h3>{editingId ? "EDIT ENTRY" : "ADD ENTRY"}</h3>
            <div className="editor-grid">
              <label className="editor-field"><span>Code</span><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></label>
              <label className="editor-field"><span>Label</span><input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
              <label className="editor-field"><span>Sort order</span><input type="number" min={0} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label>
              <label className="editor-field"><span>Color</span><input type="color" value={form.color ?? "#808080"} onChange={(event) => setForm({ ...form, color: event.target.value })} /></label>
            </div>
            <label className="editor-field"><span>Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
            {dictionary === "statuses" && (
              <div className="checkbox-row">
                <label><input type="checkbox" checked={form.initial === true} onChange={(event) => setForm({ ...form, initial: event.target.checked })} /> Initial status</label>
                <label><input type="checkbox" checked={form.terminal === true} onChange={(event) => setForm({ ...form, terminal: event.target.checked })} /> Terminal status</label>
              </div>
            )}
            {error && <div className="workspace-error">{error}</div>}
            <div className="editor-actions">
              {editingId && <button className="ghost-action" type="button" onClick={() => { setEditingId(null); setForm(emptyInput); }}>CANCEL EDIT</button>}
              <button className="primary-action" type="button" disabled={working || !form.code.trim() || !form.label.trim()} onClick={save}>
                {working ? "SAVING…" : editingId ? "SAVE ENTRY" : "CREATE ENTRY"}
              </button>
            </div>
          </article>

          <article className="panel-card dictionary-list-card">
            <h3>{dictionaryLabels[dictionary].toUpperCase()}</h3>
            {loading ? <p className="table-message">Loading entries…</p> : (
              <div className="dictionary-entry-list">
                {entries.map((entry) => (
                  <div className={`dictionary-entry ${entry.active ? "" : "archived"}`} key={entry.id}>
                    <span className="dictionary-color" style={{ background: entry.color ?? "#596173" }} />
                    <div>
                      <strong>{entry.label}</strong>
                      <code>{entry.code}</code>
                      {entry.description && <p>{entry.description}</p>}
                    </div>
                    <span className="dictionary-order">#{entry.sortOrder}</span>
                    <div className="dictionary-entry-actions">
                      <button type="button" onClick={() => edit(entry)}>EDIT</button>
                      {entry.active ? (
                        <button
                          className="danger-action"
                          type="button"
                          onClick={async () => {
                            if (!auth || !window.confirm(`Archive ${entry.label}? Existing reports will keep displaying this value, but it will be hidden from new selections.`)) return;
                            setWorking(true);
                            try {
                              await archiveDictionaryEntry(dictionary, entry.id, auth.csrfToken);
                              await refresh();
                            } catch (reason) {
                              setError(reason instanceof Error ? reason.message : "Could not archive entry.");
                            } finally {
                              setWorking(false);
                            }
                          }}
                        >ARCHIVE</button>
                      ) : (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!auth) return;
                            setWorking(true);
                            try {
                              await updateDictionaryEntry(dictionary, entry.id, { active: true }, auth.csrfToken);
                              await refresh();
                            } finally {
                              setWorking(false);
                            }
                          }}
                        >RESTORE</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
