import { useEffect, useState } from "react";
import { Link, useNavigate } from "../router";
import { createBug, loadDictionaries } from "../api";
import { useAuth } from "../AuthContext";
import UserAvatar from "../Components/UserAvatar";
import type { BugInput } from "../api";
import type { Dictionaries, DictionaryName } from "../types";
import "./Bugs.css";

const initialForm: BugInput = {
  description: "",
  versionId: "",
  priorityId: "",
  categoryId: "",
  typeId: "",
  deviceId: "",
};

function DictionarySelect({
  label,
  dictionary,
  value,
  dictionaries,
  onChange,
}: {
  label: string;
  dictionary: DictionaryName;
  value: string;
  dictionaries: Dictionaries;
  onChange: (value: string) => void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <select required value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select {label.toLowerCase()}</option>
        {dictionaries[dictionary].map((entry) => (
          <option value={entry.id} key={entry.id}>{entry.label}</option>
        ))}
      </select>
    </label>
  );
}

export default function NewBugPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [form, setForm] = useState<BugInput>(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDictionaries()
      .then((loaded) => {
        setDictionaries(loaded);
        setForm((current) => ({
          ...current,
          versionId: loaded.versions[0]?.id ?? "",
          priorityId: loaded.priorities[0]?.id ?? "",
          categoryId: loaded.categories[0]?.id ?? "",
          typeId: loaded.types[0]?.id ?? "",
          deviceId: loaded.devices[0]?.id ?? "",
        }));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load form dictionaries."))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof BugInput>(field: K, value: BugInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  if (loading) {
    return <section className="workspace-page"><div className="table-message">Loading editor…</div></section>;
  }

  if (!dictionaries) {
    return <section className="workspace-page"><div className="workspace-error">{error || "Dictionaries are unavailable."}</div></section>;
  }

  return (
    <section className="workspace-page editor-page">
      <div className="workspace-header">
        <div>
          <p className="workspace-kicker">CREATE REPORT</p>
          <h2>NEW BUG REPORT</h2>
          {auth && (
            <div className="report-submitter">
              <UserAvatar avatarUrl={auth.user.avatarUrl} displayName={auth.user.displayName} size={42} />
              <p>The reporter will be recorded automatically as {auth.user.displayName}.</p>
            </div>
          )}
        </div>
        <Link className="ghost-link" to="/bugs">BACK TO REPORTS</Link>
      </div>

      <form
        className="bug-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!auth) return;
          setSaving(true);
          setError(null);
          try {
            const report = await createBug(form, auth.csrfToken);
            navigate(`/bugs/${report.id}`);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not create the bug report.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="editor-grid">
          <DictionarySelect label="Version" dictionary="versions" value={form.versionId} dictionaries={dictionaries} onChange={(value) => update("versionId", value)} />
          <DictionarySelect label="Priority" dictionary="priorities" value={form.priorityId} dictionaries={dictionaries} onChange={(value) => update("priorityId", value)} />
          <DictionarySelect label="Category" dictionary="categories" value={form.categoryId} dictionaries={dictionaries} onChange={(value) => update("categoryId", value)} />
          <DictionarySelect label="Type" dictionary="types" value={form.typeId} dictionaries={dictionaries} onChange={(value) => update("typeId", value)} />
          <DictionarySelect label="Device" dictionary="devices" value={form.deviceId} dictionaries={dictionaries} onChange={(value) => update("deviceId", value)} />
        </div>

        <label className="editor-field editor-description">
          <span>Description</span>
          <textarea
            required
            minLength={5}
            maxLength={10000}
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
            placeholder="Describe what happened, how to reproduce it, and what you expected to happen."
          />
          <small>{form.description.length}/10000</small>
        </label>

        {error && <div className="workspace-error" role="alert">{error}</div>}

        <div className="editor-actions">
          <Link className="ghost-link" to="/bugs">CANCEL</Link>
          <button className="primary-action" type="submit" disabled={saving}>
            {saving ? "SUBMITTING…" : "SUBMIT FOR APPROVAL"}
          </button>
        </div>
      </form>
    </section>
  );
}
