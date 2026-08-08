import type { AttachmentPolicy } from "./types";

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

const CLIPBOARD_IMAGE_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function extractClipboardImageFiles(clipboardData: DataTransfer): File[] {
  const clipboardFiles = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const sourceFiles = clipboardFiles.length > 0
    ? clipboardFiles
    : Array.from(clipboardData.files ?? []).filter((file) => file.type.toLowerCase().startsWith("image/"));

  const pastedAt = Date.now();
  return sourceFiles.map((file, index) => {
    const mimeType = file.type.toLowerCase();
    const extension = CLIPBOARD_IMAGE_EXTENSION[mimeType];
    if (!extension) return file;

    return new File(
      [file],
      `pasted-image-${pastedAt}-${index + 1}.${extension}`,
      { type: mimeType, lastModified: pastedAt + index },
    );
  });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function attachmentAccept(policy: AttachmentPolicy | null): string | undefined {
  if (!policy?.enabled) return undefined;
  return policy.allowedExtensions.map((extension) => `.${extension}`).join(",");
}

export function mergeSelectedFiles(
  current: File[],
  selected: File[],
  policy: AttachmentPolicy,
  alreadyUploaded = 0,
): File[] {
  const remaining = policy.maxFilesPerReport - alreadyUploaded;
  if (remaining <= 0) {
    throw new Error(`This report already has the maximum of ${policy.maxFilesPerReport} attachments.`);
  }

  const allowed = new Set(policy.allowedExtensions.map((value) => value.toLowerCase()));
  const result = [...current];

  for (const file of selected) {
    const extension = file.name.includes(".")
      ? file.name.split(".").pop()?.toLowerCase() ?? ""
      : "";

    if (!allowed.has(extension)) {
      throw new Error(`${file.name} must be a PNG, JPG, or JPEG image.`);
    }
    if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
      throw new Error(`${file.name} must use the PNG or JPEG image format.`);
    }
    if (file.size < 1) {
      throw new Error(`${file.name} is empty.`);
    }
    if (file.size > policy.maxFileSizeBytes) {
      throw new Error(
        `${file.name} exceeds the ${formatFileSize(policy.maxFileSizeBytes)} file limit.`,
      );
    }
    if (result.length >= remaining) {
      throw new Error(`A report can contain at most ${policy.maxFilesPerReport} attachments.`);
    }

    const duplicate = result.some((existing) =>
      existing.name === file.name
      && existing.size === file.size
      && existing.lastModified === file.lastModified,
    );
    if (!duplicate) result.push(file);
  }

  return result;
}
