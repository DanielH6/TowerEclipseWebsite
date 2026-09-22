import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Exercise the actual REST adapter against a stubbed transport, without real credentials or network.
test("Firestore REST adapter encodes scoped range counts, projections, cursors, and collection-group queries", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "te-firestore-query-"));
  const originalFetch = globalThis.fetch;
  const previousProject = process.env.FIREBASE_PROJECT_ID;
  const previousCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const calls = [];
  try {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const credentialsPath = path.join(directory, "fixture.json");
    writeFileSync(credentialsPath, JSON.stringify({ client_email: "fixture@example.invalid", private_key: privateKey }));
    process.env.FIREBASE_PROJECT_ID = "fixture-project";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "fixture-token", expires_in: 3600 }));
      calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : undefined });
      if (String(url).endsWith(':listCollectionIds')) return new Response(JSON.stringify({ collectionIds: String(url).includes('/sample/') ? [] : ['sample'] }));
      if (String(url).includes('/documents/sample?')) return new Response(JSON.stringify({ documents: [{ name: 'projects/fixture-project/databases/(default)/documents/sample/one', fields: { label: { stringValue: 'Preserved' } }, createTime: '2026-09-23T12:00:00Z' }] }));
      return new Response(JSON.stringify(String(url).endsWith(":runAggregationQuery") ? [{ result: { aggregateFields: { total: { integerValue: "1234" } } } }] : []));
    };
    const { db, Timestamp, firestoreMaintenance } = await import(`./firebase.mjs?fixture=${Date.now()}`);
    const since = new Date("2026-09-13T12:00:00Z");
    const base = db.collection("bugReports").where("reporter.discordId", "==", "alice").where("createdAt", ">=", since).orderBy("createdAt", "desc");
    assert.equal(await base.count(), 1234);
    const aggregation = calls.at(-1).body.structuredAggregationQuery;
    assert.equal(aggregation.aggregations[0].alias, "total");
    assert.deepEqual(aggregation.structuredQuery.where.compositeFilter.filters[1].fieldFilter, { field: { fieldPath: "createdAt" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: since.toISOString() } });
    await base.orderBy("__name__", "desc").startAfter(since, "bugReports/report-a").select("displayId", "createdAt").limit(21).get();
    const query = calls.at(-1).body.structuredQuery;
    assert.equal(query.limit, 21);
    assert.equal(query.startAt.before, false);
    assert.equal(query.startAt.values[1].referenceValue, "projects/fixture-project/databases/(default)/documents/bugReports/report-a");
    assert.deepEqual(query.select.fields, [{ fieldPath: "displayId" }, { fieldPath: "createdAt" }]);
    await db.collection("bugReports").orderBy("createdAt", "desc").startAfter(new Timestamp("2026-09-14T12:00:00.123456Z")).get();
    assert.equal(calls.at(-1).body.structuredQuery.startAt.values[0].timestampValue, "2026-09-14T12:00:00.123456Z");
    await db.collection("bugReports").atReadTime("2026-09-23T12:00:00.123Z").limit(500).get();
    assert.equal(calls.at(-1).body.readTime, "2026-09-23T12:00:00.123Z");
    await db.collection("updates").where("linkedReportIds", "array-contains", "a").get();
    assert.equal(calls.at(-1).body.structuredQuery.where.fieldFilter.op, "ARRAY_CONTAINS");
    await db.collectionGroup("activity").where("recipientId", "==", "alice").orderBy("createdAt", "desc").limit(30).get();
    assert.deepEqual(calls.at(-1).body.structuredQuery.from, [{ collectionId: "activity", allDescendants: true }]);
    assert.match(calls.at(-1).url, /\/documents:runQuery$/);
    await db.doc("bugReports/a").collection("comments").orderBy("createdAt").limit(300).get();
    assert.match(calls.at(-1).url, /\/documents\/bugReports\/a:runQuery$/);
    assert.deepEqual(calls.at(-1).body.structuredQuery.from, [{ collectionId: "comments" }], "existing subcollection queries retain their shape");
    const backupDocs = [];
    for await (const doc of firestoreMaintenance.documents("2026-09-23T12:00:00Z")) backupDocs.push(doc);
    assert.deepEqual(backupDocs, [{ path: 'sample/one', fields: { label: { stringValue: 'Preserved' } } }]);
    assert.ok(calls.some(call => call.url.includes('readTime=2026-09-23T12%3A00%3A00Z')));
    await firestoreMaintenance.createDocument('sample/one', backupDocs[0].fields);
    assert.ok(calls.at(-1).url.endsWith('?currentDocument.exists=false'));
  } finally {
    globalThis.fetch = originalFetch;
    if (previousProject === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = previousProject;
    if (previousCredentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS; else process.env.GOOGLE_APPLICATION_CREDENTIALS = previousCredentials;
    rmSync(directory, { recursive: true, force: true });
  }
});
