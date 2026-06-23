import { loadConfig, runtimeMode } from "../shared/config.js";

const config = loadConfig();
const workerId = `worker_${crypto.randomUUID()}`;
const heartbeatMs = Number.parseInt(process.env.EVENT_AGENT_WORKER_HEARTBEAT_MS ?? "30000", 10);

console.log(
  JSON.stringify(
    {
      name: "event-agent-worker",
      workerId,
      mode: runtimeMode(config),
      queues: ["default"],
      capabilities: ["agent-job"],
      status: "ready"
    },
    null,
    2
  )
);

console.log("Worker queue consumption is scaffolded. The worker stays alive so ECS can supervise it.");

setInterval(() => {
  console.log(
    JSON.stringify({
      name: "event-agent-worker",
      workerId,
      mode: runtimeMode(config),
      queues: ["default"],
      status: "idle",
      at: new Date().toISOString()
    })
  );
}, heartbeatMs);
