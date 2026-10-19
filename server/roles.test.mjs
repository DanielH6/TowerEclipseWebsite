import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
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
  const { admin, dev, leadqa, owner, pentester, qa } = config.discord.roleIds;

  assert.equal(mapDiscordRole([qa]), "qa");
  assert.equal(mapDiscordRole([pentester]), "pentester");
  assert.equal(roleLabel("pentester"), "PEN Tester");
  assert.equal(mapDiscordRole([qa, pentester]), "pentester");
  assert.equal(mapDiscordRole([qa, pentester, leadqa]), "leadqa");
  for (const developerRole of [dev, owner, admin]) {
    assert.equal(mapDiscordRole([qa, pentester, leadqa, developerRole]), "dev");
  }
  assert.equal(mapDiscordRole([qa, leadqa]), "leadqa");
  assert.equal(mapDiscordRole([qa, leadqa, dev]), "dev");
  assert.equal(mapDiscordRole([qa, leadqa, owner]), "dev");
  assert.equal(mapDiscordRole([qa, leadqa, admin]), "dev");
});

test("Discord Owner role maps to Developer access", () => {
  assert.equal(mapDiscordRole([config.discord.roleIds.owner]), "dev");
  assert.equal(roleLabel(mapDiscordRole([config.discord.roleIds.owner])), "Developer");
});

test("Discord Admin role maps to Developer access", () => {
  assert.equal(config.discord.roleIds.admin, "1543793914643882084");
  assert.equal(mapDiscordRole([config.discord.roleIds.admin]), "dev");
  assert.equal(roleLabel(mapDiscordRole([config.discord.roleIds.admin])), "Developer");
});

test("Member is rejected by bug staff authorization", () => {
  const response = responseRecorder();
  let continued = false;

  requireRole("qa", "pentester", "leadqa", "dev")(
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

for (const role of ["qa", "pentester"]) test(`${role} passes bug staff authorization`, () => {
  const response = responseRecorder();
  let continued = false;

  requireRole("qa", "pentester", "leadqa", "dev")(
    { authSession: { role } },
    response,
    () => {
      continued = true;
    },
  );

  assert.equal(continued, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, null);
});

test("PEN Tester does not inherit QA lead or Developer privileges through requireRole", () => {
  for (const allowedRoles of [["qa"], ["leadqa"], ["dev"], ["leadqa", "dev"]]) {
    const response = responseRecorder();
    let continued = false;
    requireRole(...allowedRoles)(
      { authSession: { role: "pentester" } }, response, () => { continued = true; },
    );
    assert.equal(continued, false);
    assert.equal(response.statusCode, 403);
  }
});

test("PEN Tester Discord ID has the requested default, validates overrides, and stays unique", () => {
  const script = `import { config } from ${JSON.stringify(new URL("./config.mjs", import.meta.url).href)}; process.stdout.write(config.discord.roleIds.pentester);`;
  const load = value => spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    env: { ...process.env, DISCORD_ROLE_PENTESTER_ID: value }, encoding: "utf8",
  });
  const fallback = load("");
  assert.equal(fallback.status, 0);
  assert.equal(fallback.stdout, "1369651343010299995");
  const custom = load("1234567890123456789");
  assert.equal(custom.status, 0);
  assert.equal(custom.stdout, "1234567890123456789");
  assert.match(load("invalid").stderr, /DISCORD_ROLE_PENTESTER_ID must be a Discord ID/);
  assert.match(load(config.discord.roleIds.qa).stderr, /Discord role IDs must be different/);
});
