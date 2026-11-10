import test from "node:test";
import assert from "node:assert/strict";
import { createCareerAiProvider } from "./careers-ai-provider.mjs";

const input = { settings: { criteria: [{ id: "practical" }] }, questions: [{ id: "question", answerExcerpts: [{ id: "a1", text: "Reproduce the bug and capture the logs." }] }] };
const completed = (usage = {}) => new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "Assessment", observations: "", grades: [] }) }] }], usage }));

test("assessment requests honor allowlisted models and effort-specific output budgets without adding sampling controls", async () => {
  const bodies = [];
  const provider = createCareerAiProvider({ apiKey: "synthetic-test-key", fetch: async (_url, options) => { bodies.push(JSON.parse(options.body)); return completed(); } });
  for (const model of ["gpt-6-luna", "gpt-6.1-sol"]) {
    for (const [reasoningEffort, budget] of Object.entries({ low: 6000, medium: 16000, high: 32000, xhigh: 48000, max: 64000 })) {
      await provider.assess(input, { model, reasoningEffort });
      const body = bodies.at(-1);
      assert.equal(body.model, model);
      assert.deepEqual(body.reasoning, { effort: reasoningEffort });
      assert.equal(body.max_output_tokens, budget);
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.equal(body.temperature, undefined);
      assert.equal(body.top_p, undefined);
    }
  }
  const calls = bodies.length;
  for (const options of [{ model: "gpt-6-astra" }, { model: "untrusted-model" }, { reasoningEffort: "none" }, { reasoningEffort: "ultra" }, { reasoningEffort: null }]) {
    await assert.rejects(provider.assess(input, options), { status: 400 });
  }
  assert.equal(bodies.length, calls, "invalid settings never issue a request");
});

test("direct assessments and rubric drafting retain Luna low defaults while usage exposes cache and reasoning totals", async () => {
  const bodies = [];
  const provider = createCareerAiProvider({ apiKey: "synthetic-test-key", fetch: async (_url, options) => { bodies.push(JSON.parse(options.body)); return completed({ input_tokens: 1000, output_tokens: 300, input_tokens_details: { cached_tokens: 600 }, output_tokens_details: { reasoning_tokens: 200 } }); } });
  const result = await provider.assess(input);
  assert.deepEqual(result.usage, { inputTokens: 1000, outputTokens: 300, cachedInputTokens: 600, reasoningTokens: 200 });
  await provider.draftCriteria({ brief: "Use practical examples." });
  for (const body of bodies) {
    assert.equal(body.model, "gpt-6-luna");
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.max_output_tokens, 6000);
  }
});

test("request timeout and caller cancellation remain bounded with provider details kept private", async () => {
  const interruptedFetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("synthetic private timeout diagnostic")), 200);
    const abort = () => { clearTimeout(timer); reject(new Error("synthetic private aborted diagnostic")); };
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
  const timed = createCareerAiProvider({ apiKey: "synthetic-test-key", timeoutMs: 5, fetch: interruptedFetch });
  await assert.rejects(timed.assess(input, { model: "gpt-6.1-sol", reasoningEffort: "high" }), error => error.status === 503 && /timed out/.test(error.message) && !/synthetic/.test(error.message));
  const controller = new AbortController();
  controller.abort();
  const cancelled = createCareerAiProvider({ apiKey: "synthetic-test-key", fetch: interruptedFetch });
  await assert.rejects(cancelled.assess(input, { signal: controller.signal }), error => error.status === 503 && /interrupted/.test(error.message) && !/synthetic/.test(error.message));
  for (const status of [401, 403, 429, 500]) {
    const provider = createCareerAiProvider({ apiKey: "synthetic-test-key", fetch: async () => new Response("synthetic private upstream diagnostic", { status }) });
    await assert.rejects(provider.assess(input, { model: "gpt-6.1-sol", reasoningEffort: "medium" }), error => error.status === 503 && !/synthetic|Luna/.test(error.message));
  }
});
