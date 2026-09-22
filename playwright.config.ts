import { defineConfig } from '@playwright/test';
const baseURL = process.env.STAGING_BASE_URL;
if (!baseURL) throw new Error('Set STAGING_BASE_URL to a separate test website. No production fallback is allowed.');
const url = new URL(baseURL);
if (['towereclipse.com', 'www.towereclipse.com'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('These checks must not run against the production website.');
export default defineConfig({ testDir: './tests/staging', workers: 1, retries: 0, timeout: 60_000,
  use: { baseURL, trace: 'off', screenshot: 'off', video: 'off', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) },
  projects: ['member', 'qa', 'dev'].map(role => ({ name: role, use: { storageState: `.runtime/browser-auth/${role}.json` }, metadata: { role } })),
});
