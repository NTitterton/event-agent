import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig, runtimeMode } from "../src/shared/config.js";

test("config defaults to memory mode without cloud resources", () => {
  const config = loadConfig({});
  assert.equal(config.authToken, "dev-token");
  assert.equal(config.port, 5180);
  assert.equal(runtimeMode(config), "memory");
});

test("config switches to cloud mode when database and queue are configured", () => {
  const config = loadConfig({
    EVENT_AGENT_DATABASE_URL: "postgres://example",
    EVENT_AGENT_DEFAULT_QUEUE_URL: "https://sqs.example/default"
  });
  assert.equal(runtimeMode(config), "cloud");
});

