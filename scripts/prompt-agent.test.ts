import assert from "node:assert/strict";
import { test } from "node:test";
import { LocalArtifactWriter } from "../src/agents/artifact-writer.js";
import { buildDailyStockPromptAgent } from "../src/agents/prompt-agent.js";
import { executePromptAgent } from "../src/agents/prompt-executor.js";
import { StaticModelProvider } from "../src/agents/model-provider.js";
import { MemoryStore } from "../src/server/store.js";
import { processJobMessage } from "../src/worker/runtime.js";

const config = {
  authToken: "test-token",
  host: "127.0.0.1",
  port: 0,
  reportsBucket: "test-bucket",
  stockAgentId: "agent_stock_report_daily",
  stockAgentScheduleId: "sch_stock_report_daily",
  stockAgentScheduleExpression: "cron(0 9 * * ? *)",
  stockAgentScheduleTimezone: "America/Los_Angeles"
};

test("prompt agent resolves stock inputs and creates markdown artifact metadata", async () => {
  const agent = buildDailyStockPromptAgent(config);
  const result = await executePromptAgent({
    agent,
    runId: "run_test",
    modelProvider: new StaticModelProvider(),
    artifactWriter: new LocalArtifactWriter("tmp/test-reports"),
    random: () => 0,
    now: new Date("2026-06-23T16:00:00.000Z")
  });

  assert.equal(result.artifact.ticker, "AAPL");
  assert.equal(result.artifact.bucket, "test-bucket");
  assert.equal(result.artifact.key, "stock-reports/reports/2026-06-23-AAPL.md");
  assert.equal(result.artifact.type, "markdown-report");
});

test("agent trigger message creates run, log, and artifact through generic worker", async () => {
  const store = new MemoryStore();
  const agent = await store.upsertAgent(buildDailyStockPromptAgent(config));
  await processJobMessage({
    message: {
      kind: "agent.trigger",
      scheduleId: "sch_stock_report_daily",
      agentId: agent.id,
      firedAt: "2026-06-23T16:00:00.000Z",
      dedupeKey: "test-dedupe"
    },
    store,
    modelProvider: new StaticModelProvider(),
    artifactWriter: new LocalArtifactWriter("tmp/test-reports"),
    workerId: "worker_test",
    random: () => 0
  });

  const runs = await store.listRuns();
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.ok(run);
  assert.equal(run.status, "succeeded");
  assert.equal(run.artifactCount, 1);

  const artifacts = await store.listRunArtifacts(run.id);
  assert.equal(artifacts.length, 1);
  const artifact = artifacts[0];
  assert.ok(artifact);
  assert.equal(artifact.ticker, "AAPL");
});
