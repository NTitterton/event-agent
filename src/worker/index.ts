import { loadConfig, runtimeMode } from "../shared/config.js";

const config = loadConfig();
const workerId = `worker_${crypto.randomUUID()}`;

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

console.log("Worker queue consumption is scaffolded. The next milestone wires SQS and RDS adapters.");

