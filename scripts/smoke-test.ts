import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/server/app.js";
import { seedDefaultAgents } from "../src/server/bootstrap.js";
import { MemoryStore } from "../src/server/store.js";

test("api smoke flow", async () => {
  const store = new MemoryStore();
  await seedDefaultAgents(store, {
    authToken: "test-token",
    host: "127.0.0.1",
    port: 0,
    reportsBucket: "test-bucket",
    agentConfigPrefix: "accounts",
    localAgentConfigPath: "config/accounts/default/agents.json"
  });
  const app = await buildApp({
    config: {
      authToken: "test-token",
      host: "127.0.0.1",
      port: 0,
      agentConfigPrefix: "accounts",
      localAgentConfigPath: "config/accounts/default/agents.json"
    },
    store
  });
  await app.ready();

  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);

  const unauthorized = await app.inject({ method: "GET", url: "/api/schedules" });
  assert.equal(unauthorized.statusCode, 401);

  const auth = { authorization: "Bearer test-token" };
  const agentsResponse = await app.inject({ method: "GET", url: "/api/agents", headers: auth });
  assert.equal(agentsResponse.statusCode, 200);
  assert.equal(agentsResponse.json().agents.length, 1);

  const seededTriggerResponse = await app.inject({
    method: "POST",
    url: "/api/schedules/sch_stock_report_daily/trigger",
    headers: auth
  });
  assert.equal(seededTriggerResponse.statusCode, 202);
  const seededTrigger = seededTriggerResponse.json() as { queued: boolean; message: { kind: string; dedupeKey: string } };
  assert.equal(seededTrigger.queued, true);
  assert.equal(seededTrigger.message.kind, "agent.trigger");
  assert.match(seededTrigger.message.dedupeKey, /^manual:sch_stock_report_daily:/);

  const scheduleResponse = await app.inject({
    method: "POST",
    url: "/api/schedules",
    headers: auth,
    payload: {
      name: "Morning brief",
      expression: "cron(0 14 * * ? *)",
      timezone: "America/Los_Angeles",
      queue: "default",
      event: {
        source: "schedule",
        type: "brief.daily",
        subject: "morning-brief",
        payload: { topic: "daily planning" }
      }
    }
  });
  assert.equal(scheduleResponse.statusCode, 201);
  const schedule = scheduleResponse.json().schedule as { id: string };
  assert.ok(schedule.id);

  const triggerResponse = await app.inject({
    method: "POST",
    url: `/api/schedules/${schedule.id}/trigger`,
    headers: auth
  });
  assert.equal(triggerResponse.statusCode, 202);
  assert.ok(triggerResponse.json().run.id);

  const runsResponse = await app.inject({ method: "GET", url: "/api/runs", headers: auth });
  assert.equal(runsResponse.statusCode, 200);
  assert.equal(runsResponse.json().runs.length, 1);

  const missingArtifactResponse = await app.inject({
    method: "GET",
    url: "/api/artifacts/art_missing/access-url",
    headers: auth
  });
  assert.equal(missingArtifactResponse.statusCode, 404);

  await app.close();
});
