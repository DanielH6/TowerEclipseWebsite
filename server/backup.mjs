import { createHash } from 'node:crypto';
export const checksum = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const jsonHash = value => checksum(JSON.stringify(canonical(value)));
const validPath = path => typeof path === 'string' && path.length <= 1500 && !path.split('/').some(part => !part || part === '.' || part === '..');
export async function createBackup(source) {
  const documents = [];
  for await (const document of source.documents()) documents.push({ ...document, sha256: jsonHash(document.fields) });
  const objects = [];
  for await (const object of source.objects(documents)) {
    const bytes = Buffer.from(object.bytes);
    objects.push({ key: object.key, contentType: object.contentType, bytes: bytes.toString('base64'), sha256: checksum(bytes) });
  }
  const payload = { schemaVersion: 1, source: source.identity, capturedAt: source.capturedAt, documents, objects };
  return { ...payload, sha256: jsonHash(payload) };
}
export function validateBackup(bundle) {
  const { sha256, ...payload } = bundle ?? {};
  if (payload.schemaVersion !== 1 || !payload.source?.project || !payload.capturedAt || !Array.isArray(payload.documents) || !Array.isArray(payload.objects) || jsonHash(payload) !== sha256) throw Error('Backup manifest is invalid or corrupt.');
  const paths = new Set(), keys = new Set();
  for (const document of payload.documents) {
    if (!validPath(document.path) || document.path.split('/').length % 2 !== 0 || paths.has(document.path) || !document.fields || jsonHash(document.fields) !== document.sha256) throw Error('Backup document is invalid or corrupt.');
    paths.add(document.path);
  }
  for (const object of payload.objects) {
    if (!validPath(object.key) || keys.has(object.key) || typeof object.bytes !== 'string' || checksum(Buffer.from(object.bytes, 'base64')) !== object.sha256) throw Error('Backup object is invalid or corrupt.');
    keys.add(object.key);
  }
  return payload;
}
export async function restoreBackup(bundle, target) {
  const payload = validateBackup(bundle); // Verify everything before making any target writes.
  if (target.mode !== 'disposable' || target.identity.project === payload.source.project || (payload.objects.length && (!target.identity.bucket || target.identity.bucket === payload.source.bucket))) throw Error('Restore requires a separate disposable project and bucket.');
  if (!await target.isEmpty(payload.objects.map(item => item.key))) throw Error('Restore target is not empty. No data was changed.');
  for (const object of payload.objects) await target.writeObject(object.key, Buffer.from(object.bytes, 'base64'), object.contentType);
  const remap = value => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'referenceValue' && typeof item === 'string' ? item.replace(`projects/${payload.source.project}/databases/`, `projects/${target.identity.project}/databases/`) : remap(item)]));
  };
  for (const document of payload.documents) await target.writeDocument(document.path, remap(document.fields));
  for (const document of payload.documents) if (jsonHash(await target.readDocument(document.path)) !== jsonHash(remap(document.fields))) throw Error(`Restored document verification failed: ${document.path}`);
  for (const object of payload.objects) if (checksum(await target.readObject(object.key)) !== object.sha256) throw Error(`Restored object verification failed: ${object.key}`);
  return { documents: payload.documents.length, objects: payload.objects.length, verified: true };
}
