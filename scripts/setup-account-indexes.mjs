import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { fieldIndexConfig, fieldIndexMatches } from './firestore-index-config.mjs';

// Additive index setup: existing indexes and database records are never deleted.
const apply = process.argv.includes('--apply');
const project = process.env.FIREBASE_PROJECT_ID?.trim();
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
if (!project || !credentialsPath) throw new Error('Configure FIREBASE_PROJECT_ID and GOOGLE_APPLICATION_CREDENTIALS first.');
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const definitions = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));
const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/collectionGroups`;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString('base64url')}`;
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
if (!tokenResponse.ok) throw new Error(`Google authentication failed (${tokenResponse.status}).`);
const token = (await tokenResponse.json()).access_token;
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Index setup failed (${response.status}): ${result.error?.message ?? 'Unknown error'}`);
  return result;
}
console.log(`Website indexes: ${project} / (default) / ${apply ? 'apply additions' : 'read-only check'}`);
const byCollection = new Map();
for (const group of new Set(definitions.indexes.map(index => index.collectionGroup))) {
  let pageToken;
  const indexes = [];
  do {
    const result = await request(`${base}/${group}/indexes${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    indexes.push(...(result.indexes ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  byCollection.set(group, indexes);
}
let ready = true;
for (const definition of definitions.indexes) {
  const { collectionGroup, ...body } = definition;
  const existing = byCollection.get(collectionGroup).find(index => index.queryScope === body.queryScope
    && JSON.stringify(index.fields.filter(field => field.fieldPath !== '__name__').map(field => [field.fieldPath, field.order])) === JSON.stringify(body.fields.map(field => [field.fieldPath, field.order])));
  const label = `${collectionGroup} [${body.fields.map(field => `${field.fieldPath} ${field.order}`).join(', ')}]`;
  if (existing) {
    console.log(`${existing.state}: ${label}`);
    if (existing.state !== 'READY') ready = false;
  } else if (apply) {
    await request(`${base}/${collectionGroup}/indexes`, 'POST', body);
    console.log(`BUILDING: ${label}`);
    ready = false;
  } else {
    console.log(`MISSING: ${label}`);
    ready = false;
  }
}
// Apply only the explicitly listed exemptions/overrides; unrelated configuration is untouched.
for (const definition of definitions.fieldOverrides) {
  const url = `${base}/${definition.collectionGroup}/fields/${encodeURIComponent(definition.fieldPath)}`;
  const current = await request(url);
  const matches = fieldIndexMatches(current, definition);
  const building = (current.indexConfig?.indexes ?? []).some(index => index.state && index.state !== 'READY');
  const label = `${definition.collectionGroup}.${definition.fieldPath} indexing`;
  if (!matches && apply) {
    await request(`${url}?updateMask=indexConfig`, 'PATCH', { indexConfig: fieldIndexConfig(definition) });
    console.log(`REQUESTED: ${label}`);
    ready = false;
  } else {
    console.log(`${matches ? building ? 'BUILDING' : 'READY' : 'MISSING'}: ${label}`);
    if (!matches) ready = false;
    if (building) ready = false;
  }
}
console.log(ready ? 'All website query indexes are ready.' : 'Run this script again without --apply to check build progress.');
