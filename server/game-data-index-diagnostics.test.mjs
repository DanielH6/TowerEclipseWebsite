import test from "node:test";
import assert from "node:assert/strict";
import { createPlayerIndexReporter, classifyPlayerIndexFailure } from "./game-data-index-diagnostics.mjs";
import { createFirestoreSummaryIndex } from "./game-data-readers.mjs";
import { parsePlayerQuery } from "./game-data-service.mjs";

const privateMarker = "private-token-document-header-message-must-not-leave";
const filters = parsePlayerQuery({ mode: "main", sort: "level", order: "desc", limit: "25" });
const page = { snapshotAt: "2026-10-12T04:00:00.123Z", after: null };
function database({ failure, records = [] } = {}) {
  const calls = [];
  const query = { async get() { calls.push(["get"]); if (failure) throw failure; return { docs: records.map(value => ({ data: () => value })) }; } };
  for (const method of ["where", "orderBy", "select", "limit", "atReadTime", "startAfter"]) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  return { calls, db: { collection(name) { calls.push(["collection", name]); return query; } } };
}

test("classifies provider failures without returning raw messages, URLs or unknown codes", () => {
  const cases = [
    ["FAILED_PRECONDITION", 400, `The query requires an index. https://private.invalid/${privateMarker}`, "missing_index"],
    ["FAILED_PRECONDITION", 400, privateMarker, "query_precondition"],
    [9, 400, privateMarker, "query_precondition"],
    ["UNAUTHENTICATED", 401, privateMarker, "authentication"],
    [undefined, undefined, `Could not obtain Google access token (400): ${privateMarker}`, "authentication"],
    ["PERMISSION_DENIED", 403, privateMarker, "permission_denied"],
    ["PERMISSION_DENIED", 403, `Cloud Firestore API has not been used or has been disabled: ${privateMarker}`, "provider_configuration"],
    ["UNIMPLEMENTED", 501, privateMarker, "provider_configuration"],
    ["NOT_FOUND", 404, privateMarker, "database_or_project_not_found"],
    ["INVALID_ARGUMENT", 400, `readTime is invalid ${privateMarker}`, "snapshot_time_invalid"],
    ["INVALID_ARGUMENT", 400, privateMarker, "query_argument_invalid"],
    ["RESOURCE_EXHAUSTED", 429, privateMarker, "provider_rate_limit"],
    ["DEADLINE_EXCEEDED", 504, privateMarker, "provider_timeout"],
    ["UNAVAILABLE", 503, privateMarker, "provider_unavailable"],
    [privateMarker, privateMarker, privateMarker, "adapter_or_provider_failure"],
  ];
  for (const [code, status, message, kind] of cases) {
    const result = classifyPlayerIndexFailure({ code, status, message, stack: privateMarker, cause: { headers: privateMarker } }, "query");
    assert.equal(result.kind, kind); assert.ok(!JSON.stringify(result).includes(privateMarker)); assert.ok(!JSON.stringify(result).includes("https://"));
  }
  assert.equal(classifyPlayerIndexFailure({ code: "UNAUTHENTICATED", status: 401, message: privateMarker }, "records").kind, "invalid_index_record");
});

test("empty collection succeeds with the exact bounded query and no failure diagnostic", async () => {
  const fixture = database(), events = [];
  const index = createFirestoreSummaryIndex(fixture.db, { log: event => events.push(event) });
  assert.equal(events.length, 0); assert.equal(fixture.calls.length, 0, "constructor is lazy");
  const result = await index.list(filters, page);
  assert.deepEqual(result.items, []); assert.deepEqual(events, []);
  assert.ok(fixture.calls.some(call => call[0] === "limit" && call[1] === 26));
  assert.ok(fixture.calls.some(call => call[0] === "atReadTime" && call[1] === page.snapshotAt));
  assert.deepEqual(fixture.calls.filter(call => call[0] === "orderBy"), [["orderBy", "stats.level", "desc"], ["orderBy", "__name__", "desc"]]);
});

test("query failure produces one safe classification and preserves the public 503 body", async () => {
  const fixture = database({ failure: Object.assign(new Error(`The query requires an index ${privateMarker}`), { code: "FAILED_PRECONDITION", status: 400 }) });
  const events = [], index = createFirestoreSummaryIndex(fixture.db, { log: event => events.push(event) });
  await assert.rejects(index.list(filters, page), failure => {
    assert.equal(failure.code, "INDEX_UNAVAILABLE"); assert.equal(failure.status, 503);
    assert.equal(failure.message, "The player index is unavailable. You can still try an exact UserId lookup.");
    assert.equal(failure.cause, undefined); return true;
  });
  assert.equal(events.length, 1); assert.equal(events[0].kind, "missing_index"); assert.equal(events[0].phase, "query");
  assert.equal(events[0].rpcCode, "FAILED_PRECONDITION"); assert.equal(events[0].httpStatus, 400);
  assert.ok(!JSON.stringify(events).includes(privateMarker));
});

test("invalid records are distinguished from provider errors and never logged", async () => {
  for (const record of [{ userId: privateMarker, mode: "main", schemaVersion: 1 }, { userId: "123", mode: "main", schemaVersion: 99, identity: { username: privateMarker } }]) {
    const fixture = database({ records: [record] }), events = [];
    const index = createFirestoreSummaryIndex(fixture.db, { log: event => events.push(event) });
    await assert.rejects(index.list(filters, page), { code: "INDEX_UNAVAILABLE", status: 503 });
    assert.equal(events[0].kind, "invalid_index_record"); assert.equal(events[0].phase, "records");
    assert.equal(events[0].rpcCode, null); assert.equal(events[0].httpStatus, null);
    assert.ok(!JSON.stringify(events).includes(privateMarker));
  }
});

test("valid projection excludes arbitrary record fields with no diagnostic", async () => {
  const fixture = database({ records: [{ schemaVersion: 1, mode: "main", userId: "123", stats: { level: 4 }, Extra: privateMarker, identity: { Extra: privateMarker } }] });
  const events = [], result = await createFirestoreSummaryIndex(fixture.db, { log: event => events.push(event) }).list(filters, page);
  assert.equal(result.items[0].stats.level, 4); assert.ok(!JSON.stringify(result).includes(privateMarker)); assert.equal(events.length, 0);
});

test("diagnostics exclude user filters/cursors/invalid metadata and throttle repeated failures", () => {
  const events = []; let clock = 0;
  const report = createPlayerIndexReporter({ log: event => events.push(event), now: () => clock });
  const failure = { code: privateMarker, status: privateMarker, message: privateMarker, rawDocuments: [privateMarker] };
  const request = { mode: privateMarker, sort: privateMarker, order: privateMarker, search: privateMarker, minLevel: 42 };
  const cursor = { after: [privateMarker, privateMarker] };
  report(failure, "query", request, cursor); report(failure, "query", request, cursor);
  assert.equal(events.length, 1); assert.ok(!JSON.stringify(events).includes(privateMarker)); assert.equal(events[0].mode, "unknown");
  clock = 60000; report(failure, "query", request, cursor); assert.equal(events.length, 2);
  assert.deepEqual(Object.keys(events[0]).sort(), ["event", "phase", "kind", "rpcCode", "httpStatus", "mode", "sort", "order", "hasSearch", "hasMinLevel", "hasCursor"].sort());
});

test("logger failures cannot change public errors or expose their own exception", async () => {
  const fixture = database({ failure: new Error(privateMarker) });
  const index = createFirestoreSummaryIndex(fixture.db, { log() { throw new Error(privateMarker); } });
  await assert.rejects(index.list(filters, page), failure => failure.code === "INDEX_UNAVAILABLE" && !failure.message.includes(privateMarker));
  const malformed = { get code() { throw new Error(privateMarker); } };
  assert.doesNotThrow(() => createPlayerIndexReporter({ log() { throw new Error(privateMarker); } })(malformed, "query", filters, page));
});
