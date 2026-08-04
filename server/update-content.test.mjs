import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_IMAGES_PER_ENTRY,
  MAX_IMAGES_PER_UPDATE,
  assertPublishableNewsContent,
  dateOnlyFromValue,
  normalizeEntryImages,
  normalizeMinorFlag,
  normalizeNewsContentType,
  normalizePublishedOn,
  sanitizeUpdateRichText,
  storedEntryImages,
} from "./update-content.mjs";

test("manual publication dates preserve historical calendar days", () => {
  assert.equal(normalizePublishedOn("2024-01-31"), "2024-01-31");
  assert.equal(dateOnlyFromValue("2026-08-02T23:45:00.000Z"), "2026-08-02");
  assert.throws(() => normalizePublishedOn("2024-02-30"), /real calendar date/);
  assert.throws(() => normalizePublishedOn("02\/08\/2024"), /YYYY-MM-DD/);
});

test("the update-wide image policy is five hundred references", () => {
  assert.equal(MAX_IMAGES_PER_UPDATE, 500);
});

test("news content types keep minor flags exclusive to game updates", () => {
  assert.equal(normalizeNewsContentType("game_update"), "game_update");
  assert.equal(normalizeNewsContentType("developer_blog"), "developer_blog");
  assert.equal(normalizeMinorFlag(true, "game_update"), true);
  assert.equal(normalizeMinorFlag(true, "developer_blog"), false);
  assert.throws(() => normalizeNewsContentType("announcement"), /contentType/);
  assert.throws(() => normalizeMinorFlag("true", "game_update"), /true or false/);
});

test("developer blogs and game updates have distinct publish requirements", () => {
  assert.doesNotThrow(() => assertPublishableNewsContent({
    contentType: "developer_blog",
    version: "",
    blogHtml: "<p>Monthly progress and next steps.</p>",
    itemCount: 0,
  }));
  assert.throws(() => assertPublishableNewsContent({
    contentType: "developer_blog",
    version: "",
    blogHtml: "<p><br></p>",
    itemCount: 0,
  }), /needs content/);
  assert.throws(() => assertPublishableNewsContent({
    contentType: "game_update",
    version: "",
    blogHtml: "",
    itemCount: 1,
  }), /needs a version/);
  assert.throws(() => assertPublishableNewsContent({
    contentType: "game_update",
    version: "1.2.0",
    blogHtml: "",
    itemCount: 0,
  }), /at least one entry/);
});

test("rich-text sanitizer preserves editor tables and strips unsafe content", () => {
  const result = sanitizeUpdateRichText(
    '<table class="ignored"><thead><tr><th onclick="bad()">Tower</th><th>Damage</th></tr></thead>' +
      '<tbody><tr><td>Aegis</td><td><strong>120</strong><script>alert(1)</script></td></tr></tbody></table>',
    "bodyHtml",
  );

  assert.equal(
    result,
    "<table><thead><tr><th>Tower</th><th>Damage</th></tr></thead>" +
      "<tbody><tr><td>Aegis</td><td><strong>120</strong></td></tr></tbody></table>",
  );
});

test("entry image normalization accepts twenty ordered images with captions", () => {
  const images = Array.from({ length: MAX_IMAGES_PER_ENTRY }, (_value, index) => ({
    imageId: `image-${index + 1}`,
    caption: ` Figure ${index + 1} `,
  }));

  const result = normalizeEntryImages({ images }, "sections.new_features.items.0", "Feature");

  assert.equal(result.length, 20);
  assert.deepEqual(result[0], { imageId: "image-1", caption: "Figure 1" });
  assert.deepEqual(result[19], { imageId: "image-20", caption: "Figure 20" });
});

test("entry image normalization rejects a twenty-first or duplicate image", () => {
  const tooMany = Array.from({ length: MAX_IMAGES_PER_ENTRY + 1 }, (_value, index) => ({
    imageId: `image-${index + 1}`,
    caption: "",
  }));
  assert.throws(
    () => normalizeEntryImages({ images: tooMany }, "entry", "Feature"),
    /at most 20 images/,
  );
  assert.throws(
    () => normalizeEntryImages({ images: [
      { imageId: "same-image", caption: "One" },
      { imageId: "same-image", caption: "Two" },
    ] }, "entry", "Feature"),
    /same image more than once/,
  );
});

test("legacy single-image entries hydrate through the multi-image contract", () => {
  assert.deepEqual(
    storedEntryImages({ imageId: "legacy-image", caption: "Legacy caption" }),
    [{ imageId: "legacy-image", caption: "Legacy caption" }],
  );
  assert.deepEqual(
    normalizeEntryImages(
      { imageId: "legacy-image", caption: " Legacy caption " },
      "entry",
      "Feature",
    ),
    [{ imageId: "legacy-image", caption: "Legacy caption" }],
  );
});
