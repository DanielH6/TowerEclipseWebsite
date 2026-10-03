import { useEffect, useRef, useState } from "react";
import { apiJson, uploadAchievementThumbnail } from "../api";
import { attachmentAccept, formatFileSize, mergeSelectedFiles } from "../attachments";
import type { AttachmentPolicy } from "../types";
import { achievementThumbnailUrl } from "../../shared/achievement-list.mjs";

export default function AchievementThumbnailEditor({ entryId, thumbnailId, csrfToken, onChange, onBusyChange }: { entryId: string; thumbnailId?: string; csrfToken: string; onChange: (id: string) => void; onBusyChange: (busy: boolean) => void }) {
  const [policy, setPolicy] = useState<AttachmentPolicy | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setError("");
    apiJson<AttachmentPolicy>("/api/list/thumbnail-config", "GET", undefined, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) setPolicy(result); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => () => uploadController.current?.abort(), []);

  async function upload(file: File) {
    if (!policy?.enabled || uploading) return;
    setError(""); setNotice("");
    const controller = new AbortController(); uploadController.current = controller;
    try {
      mergeSelectedFiles([], [file], policy);
      setUploading(true); onBusyChange(true);
      // Catch corrupt/renamed files before sending them to the existing image storage.
      const localUrl = URL.createObjectURL(file);
      try {
        const preview = new Image(); preview.src = localUrl;
        await preview.decode();
      } catch { throw new Error("This file could not be opened as an image. Choose a valid PNG or JPG."); }
      finally { URL.revokeObjectURL(localUrl); }
      if (controller.signal.aborted) return;
      const id = await uploadAchievementThumbnail(entryId, file, csrfToken, controller.signal);
      if (!controller.signal.aborted) { onChange(id); setNotice("Thumbnail uploaded. Publish the list to apply it."); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not upload the thumbnail.");
    } finally { setUploading(false); onBusyChange(false); }
  }

  return <section className="list-thumbnail-editor full" aria-label="Thumbnail override">
    <div className="list-thumbnail-heading"><div><h4>Thumbnail override</h4><p>Upload an image to use instead of the automatic YouTube thumbnail.</p></div>{thumbnailId && <button type="button" className="list-button secondary" disabled={uploading} onClick={() => { onChange(""); setError(""); setNotice("Override removed. Publish to restore the automatic thumbnail."); }}>REMOVE OVERRIDE</button>}</div>
    {thumbnailId && <img className="list-thumbnail-preview" src={achievementThumbnailUrl(thumbnailId)} alt="Uploaded thumbnail preview" />}
    <label className="list-field">{thumbnailId ? "Replace thumbnail image" : "Upload thumbnail image"}<input type="file" accept={attachmentAccept(policy) ?? ".png,.jpg,.jpeg"} disabled={!policy?.enabled || uploading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label>
    <p className="list-thumbnail-help">{policy?.enabled ? `PNG or JPG · up to ${formatFileSize(policy.maxFileSizeBytes)} · 16:9 recommended. Uploads keep the video link unchanged.` : policy ? "Image uploads are unavailable until image storage is configured." : error ? "Upload settings could not be loaded." : "Loading upload settings…"}</p>
    {uploading && <p role="status">Uploading thumbnail…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <div className="list-alert error" role="alert">{error}{!policy && <button type="button" className="list-button secondary" onClick={() => setRetry(value => value + 1)}>RETRY</button>}</div>}
  </section>;
}
