import assert from "node:assert/strict";
import test from "node:test";
import { requireRole } from "./auth-context.mjs";
import { config } from "./config.mjs";
import { mapDiscordRole, roleLabel } from "./discord.mjs";

function responseRecorder() {
  return {
    body: null,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("Discord guild members without a staff role map to Member", () => {
  assert.equal(mapDiscordRole([]), "member");
  assert.equal(roleLabel("member"), "Member");
});

test("staff roles keep their existing priority over Member", () => {
  const { dev, leadqa, qa } = config.discord.roleIds;

  assert.equal(mapDiscordRole([qa]), "qa");
  assert.equal(mapDiscordRole([qa, leadqa]), "leadqa");
  assert.equal(mapDiscordRole([qa, leadqa, dev]), "dev");
});

test("Member is rejected by bug staff authorization", () => {
  const response = responseRecorder();
  let continued = false;

  requireRole("qa", "leadqa", "dev")(
    { authSession: { role: "member" } },
    response,
    () => {
      continued = true;
    },
  );

  assert.equal(continued, false);
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, {
    error: "You do not have permission to perform this action.",
  });
});

test("QA staff passes bug staff authorization", () => {
  const response = responseRecorder();
  let continued = false;

  requireRole("qa", "leadqa", "dev")(
    { authSession: { role: "qa" } },
    response,
    () => {
      continued = true;
    },
  );

  assert.equal(continued, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, null);
});
