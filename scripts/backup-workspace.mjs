import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { createBackup, restoreBackup, validateBackup } from '../server/backup.mjs';
import { firestoreMaintenance as store } from '../server/firebase.mjs';
import { config } from '../server/config.mjs';
import { createAttachmentDownloadUrl, createAttachmentUploadUrl, headAttachmentObject } from '../server/r2.mjs';
const [action, file] = process.argv.slice(2);
if (!['create', 'verify', 'restore-disposable'].includes(action) || !file) throw Error('Usage: node scripts/backup-workspace.mjs create|verify|restore-disposable FILE.json');
const identity = { project: store.projectId, bucket: config.r2?.bucket ?? null };
async function readObject(key) { const response = await fetch(createAttachmentDownloadUrl(key)); if (!response.ok) throw Error(`Object download failed (${response.status}).`); return Buffer.from(await response.arrayBuffer()); }
function objectKeys(value, found = new Set()) { if (!value || typeof value !== 'object') return found; if (value.objectKey?.stringValue && !["pending", "uploading"].includes(value.status?.stringValue)) found.add(value.objectKey.stringValue); Object.values(value).forEach(item => objectKeys(item, found)); return found; }
if (action === 'create') {
  const capturedAt = new Date(Date.now() - 1000).toISOString();
  const bundle = await createBackup({ identity, capturedAt, documents: () => store.documents(capturedAt), async *objects(documents) {
    const keys = new Set(); documents.forEach(doc => objectKeys(doc.fields, keys));
    for (const key of keys) { const metadata = await headAttachmentObject(key); if (!metadata) throw Error('A referenced storage object is missing. Backup was not saved.'); yield { key, contentType: metadata.contentType ?? 'application/octet-stream', bytes: await readObject(key) }; }
  } });
  await writeFile(file, JSON.stringify(bundle), { flag: 'wx', mode: 0o600 });
  console.log(`Backup verified and written: ${bundle.documents.length} documents, ${bundle.objects.length} referenced objects.`);
} else {
  const bundle = JSON.parse(await readFile(file, 'utf8')); validateBackup(bundle);
  if (action === 'verify') console.log('Backup integrity verified.');
  else {
    if (process.env.RESTORE_DISPOSABLE_TARGET !== `${identity.project}/${identity.bucket ?? 'none'}`) throw Error('Set RESTORE_DISPOSABLE_TARGET to the exact disposable project/bucket. Never use a production target.');
    const result = await restoreBackup(bundle, { identity, mode: 'disposable', async isEmpty(keys) {
      for await (const _doc of store.documents(new Date(Date.now() - 1000).toISOString())) return false;
      for (const key of keys) { try { if (await headAttachmentObject(key)) return false; } catch (error) { if (error.status !== 404) throw error; } }
      return true;
    }, writeDocument: (path, fields) => store.createDocument(path, fields), readDocument: path => store.readDocument(path), readObject,
    async writeObject(key, bytes, contentType) { const upload = createAttachmentUploadUrl(key, contentType); const response = await fetch(upload.url, { method: 'PUT', headers: { ...upload.headers, 'If-None-Match': '*' }, body: bytes }); if (!response.ok) throw Error(`Object restore failed (${response.status}).`); } });
    console.log(JSON.stringify(result));
  }
}
