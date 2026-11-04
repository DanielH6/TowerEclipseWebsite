import { useEffect, useRef, useState } from "react";
import { careerImageUrl, careerRequest, type CareerQuestion } from "../careers";
import { formatFileSize, mergeSelectedFiles } from "../attachments";
import type { AttachmentPolicy } from "../types";

export function QuestionImage({ image }: { image?: CareerQuestion["image"] }) {
  return image ? <figure className="career-question-image"><a href={careerImageUrl(image.id)} target="_blank" rel="noopener noreferrer"><img src={careerImageUrl(image.id)} alt={image.alt} loading="lazy" /></a><figcaption>{image.alt}</figcaption></figure> : null;
}
export default function CareerQuestionImage({ formId, image, policy, csrf, disabled, onChange, onBusy }: {
  formId: string; image?: CareerQuestion["image"]; policy?: AttachmentPolicy | null; csrf: string; disabled: boolean; onChange: (image: CareerQuestion["image"]) => void; onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState(""), [uploading, setUploading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function upload(file: File) {
    if (!policy?.enabled || disabled || uploading) return;
    const abort = new AbortController(); controller.current = abort;
    setError(""); setUploading(true); onBusy(true);
    try {
      mergeSelectedFiles([], [file], policy);
      const localUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read the image.")); reader.readAsDataURL(file);
      });
      try { const preview = new Image(); preview.src = localUrl; await preview.decode(); } catch { throw new Error("This file could not be opened as an image. Choose a valid PNG or JPG."); }
      if (abort.signal.aborted) return;
      const result = await careerRequest<{ uploadId: string; uploadUrl: string; uploadHeaders: Record<string, string> }>(`/admin/forms/${formId}/images`, { method: "POST", body: { fileName: file.name, size: file.size, contentType: file.type || (file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg") }, csrf, signal: abort.signal });
      const response = await fetch(result.uploadUrl, { method: "PUT", headers: result.uploadHeaders, body: file, signal: abort.signal });
      if (!response.ok) throw new Error("Image upload failed. Please try again.");
      const completed = await careerRequest<{ imageId: string }>(`/admin/forms/${formId}/images/${result.uploadId}/complete`, { method: "POST", body: {}, csrf, signal: abort.signal });
      if (!abort.signal.aborted) onChange({ id: completed.imageId, alt: image?.alt ?? "" });
    } catch (reason) { if (!abort.signal.aborted) setError((reason as Error).message); }
    finally { setUploading(false); onBusy(false); }
  }
  return <div className="career-image-editor">
    <QuestionImage image={image} />
    <label>{image ? "Replace question image" : "Attach question image (optional)"}<input type="file" accept=".png,.jpg,.jpeg" disabled={disabled || uploading || !policy?.enabled} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} /></label>
    <p className="career-help">{policy?.enabled ? `PNG or JPG · up to ${formatFileSize(policy.maxFileSizeBytes)}. Save the draft, then publish to show it to applicants.` : policy ? "Image uploads are unavailable until the existing image storage is configured." : "Loading image upload settings…"}</p>
    {image && <><label>Image description (required before publishing)<input maxLength={200} value={image.alt} disabled={disabled} placeholder="Describe the image so everyone can understand the question." onChange={e => onChange({ ...image, alt: e.target.value })} /></label><button type="button" className="career-link" disabled={disabled} onClick={() => onChange(undefined)}>Remove image</button></>}
    {uploading && <p role="status">Uploading question image…</p>}{error && <p className="career-notice is-error" role="alert">{error}</p>}
  </div>;
}
