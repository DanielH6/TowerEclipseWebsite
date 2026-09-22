import test from 'node:test';
import assert from 'node:assert/strict';
import { checksum } from './backup.mjs';
test('signed attachment upload, HEAD verification and download preserve image bytes using isolated storage', async () => {
  const original = globalThis.fetch;
  const env = { R2_ACCOUNT_ID: 'fixtureaccount0123456789', R2_ACCESS_KEY_ID: 'fixtureaccesskey0123456789', R2_SECRET_ACCESS_KEY: 'fixturesecret01234567890123456789', R2_BUCKET_NAME: 'fixture-test-bucket' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  try {
    const { createAttachmentUploadUrl, createAttachmentDownloadUrl, headAttachmentObject, normalizeAttachmentInput } = await import('./r2.mjs');
    const objects = new Map();
    globalThis.fetch = async (url, options = {}) => {
      const parsed = new URL(url); assert.match(parsed.hostname, /^fixtureaccount/); assert.ok(parsed.searchParams.get('X-Amz-Signature')); assert.ok(Number(parsed.searchParams.get('X-Amz-Expires')) > 0);
      if (options.method === 'PUT') { objects.set(parsed.pathname, { bytes: Buffer.from(options.body), type: options.headers['Content-Type'] }); return new Response(null, { status: 200 }); }
      const object = objects.get(parsed.pathname); if (!object) return new Response(null, { status: 404 });
      return new Response(options.method === 'HEAD' ? null : object.bytes, { headers: { 'Content-Type': object.type, 'Content-Length': String(object.bytes.length), etag: 'fixture-etag' } });
    };
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPVcAAAAASUVORK5CYII=', 'base64');
    const input = normalizeAttachmentInput({ fileName: 'evidence.png', contentType: 'image/png', size: bytes.length });
    assert.equal(input.contentType, 'image/png');
    const key = 'bug-reports/test/evidence.png'; const upload = createAttachmentUploadUrl(key, input.contentType);
    assert.ok((await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: bytes })).ok);
    const head = await headAttachmentObject(key); assert.equal(head.size, bytes.length); assert.equal(head.contentType, 'image/png');
    assert.equal(checksum(Buffer.from(await (await fetch(createAttachmentDownloadUrl(key))).arrayBuffer())), checksum(bytes));
    assert.equal(await headAttachmentObject('missing.png'), null);
    assert.throws(() => normalizeAttachmentInput({ fileName: 'script.html', contentType: 'text/html', size: 10 }));
  } finally { globalThis.fetch = original; for (const key of Object.keys(env)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
});
