import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/server/app.js";

test("api smoke flow", async () => {
  const app = await buildApp({ config: { authToken: "test-token", port: 0 } });
  await app.ready();

  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);

  const unauthorized = await app.inject({ method: "GET", url: "/api/schedules" });
  assert.equal(unauthorized.statusCode, 401);

  const auth = { authorization: "Bearer test-token" };
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

  await app.close();
});

