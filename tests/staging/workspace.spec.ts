import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

test('signed-in role sees only its allowed workspace and private resource routes', async ({ page, request }, info) => {
  const role = info.project.name;
  const auth = await (await request.get('/api/auth/me')).json();
  expect(auth.authenticated).toBe(true); expect(auth.user.role).toBe(role);
  await page.goto('/bugs');
  await expect(page.getByRole('button', { name: 'EXPORT DATA', exact: true })).toBeVisible();
  if (role === 'member') await expect(page.getByRole('link', { name: 'NEW BUG REPORT', exact: true })).toHaveCount(0);
  else await expect(page.getByRole('link', { name: 'NEW BUG REPORT', exact: true })).toBeVisible();
  expect((await request.get('/api/admin/overview')).status()).toBe(role === 'dev' ? 200 : 403);
  expect((await request.get('/api/account/testers')).status()).toBe(role === 'dev' ? 200 : 403);
  expect((await request.get('/api/account/onboarding')).status()).toBe(role === 'member' ? 403 : 200);
  await page.goto('/login?tab=onboarding');
  if (role !== 'member') await expect(page.getByRole('heading', { name: 'Your testing handbook' })).toBeVisible();
  else await expect(page.getByRole('tab', { name: 'Tester resources' })).toHaveCount(0);
});

test('filtered export contains every matching page from the same snapshot', async ({ request }) => {
  const first = await (await request.get('/api/bugs?status=approved')).json();
  expect(first.snapshot).toBeTruthy();
  const url = `/api/bugs/export?status=approved&snapshot=${encodeURIComponent(first.snapshot)}`;
  const response = await request.get(url); expect(response.ok()).toBe(true);
  const exported = await response.json(); expect(exported.refreshedAt).toBe(first.refreshedAt); expect(exported.total).toBe(first.pagination.total);
  expect(new Set(exported.reports.map((item: { id: string }) => item.id)).size).toBe(exported.total);
  for (const report of exported.reports) { expect(report.status.code).toBe('approved'); expect(report.submissionState).not.toBe('uploading'); expect(report.developerNotes).toBeUndefined(); }
});

test('QA can upload evidence and retrieve the same image bytes', async ({ request }, info) => {
  test.skip(info.project.name !== 'qa', 'One dedicated QA account performs the upload check.');
  if (process.env.STAGING_ALLOW_WRITES !== 'yes') throw new Error('Set STAGING_ALLOW_WRITES=yes only for the isolated test website. This creates one labelled report.');
  const auth = await (await request.get('/api/auth/me')).json();
  const headers = { 'X-CSRF-Token': auth.csrfToken, Origin: new URL(process.env.STAGING_BASE_URL!).origin };
  const dictionaries = (await (await request.get('/api/dictionaries')).json()).dictionaries;
  const input: Record<string, unknown> = { description: `[AUTOMATED STAGING CHECK] Attachment integrity ${Date.now()}`, expectedAttachments: 1 };
  for (const [field, dictionary] of Object.entries({ versionId: 'versions', priorityId: 'priorities', categoryId: 'categories', typeId: 'types', deviceId: 'devices' })) input[field] = dictionaries[dictionary][0].id;
  const created = await request.post('/api/bugs', { headers, data: input }); expect(created.status()).toBe(201);
  const report = (await created.json()).report;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPVcAAAAASUVORK5CYII=', 'base64');
  const start = await request.post(`/api/bugs/${report.id}/attachments`, { headers, data: { fileName: 'staging-check.png', contentType: 'image/png', size: bytes.length } }); expect(start.ok()).toBe(true);
  const upload = await start.json();
  const uploaded = await request.put(upload.uploadUrl, { headers: upload.uploadHeaders, data: bytes }); expect(uploaded.ok()).toBe(true);
  const completed = await request.post(`/api/bugs/${report.id}/attachments/${upload.attachmentId}/complete`, { headers }); expect(completed.ok()).toBe(true);
  expect((await request.post(`/api/bugs/${report.id}/finalize`, { headers })).ok()).toBe(true);
  const detail = await (await request.get(`/api/bugs/${report.id}`)).json();
  const download = await request.get(detail.attachments[0].downloadUrl); expect(download.ok()).toBe(true);
  const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex'); expect(hash(await download.body())).toBe(hash(bytes));
  // Leave the labelled staging report for inspection; this suite never deletes production or test records.
});
