import test from "node:test";
import assert from "node:assert/strict";
import { signedPublicCacheTtlMs } from "./public-cache-lifetime.mjs";
test("artifact age plus downstream public caching stays inside signed URL expiry", () => {
  for (const seconds of [10, 60, 119, 120, 180, 300, 900]) {
    const age = signedPublicCacheTtlMs(300_000, seconds);
    const downstream = seconds < 120 ? 0 : 60_000;
    assert.ok(age + downstream < seconds * 1000, `${seconds}s signature expires after downstream caching`);
  }
  assert.equal(signedPublicCacheTtlMs(300_000, 120), 30_000);
  assert.equal(signedPublicCacheTtlMs(90_000, 900), 90_000);
  assert.equal(signedPublicCacheTtlMs(300_000, 0), 300_000);
});
