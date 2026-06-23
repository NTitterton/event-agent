import { loadConfig } from "../shared/config.js";
import { buildApp } from "./app.js";
import { seedDefaultAgents } from "./bootstrap.js";
import { SqsQueuePublisher } from "./queue.js";
import { PgStore } from "./pg-store.js";

const config = loadConfig();
const store = config.defaultQueueUrl ? new PgStore(config) : undefined;
if (store) await seedDefaultAgents(store, config);
const deps = {
  config,
  ...(store ? { store } : {}),
  ...(config.defaultQueueUrl ? { queue: new SqsQueuePublisher(config) } : {})
};
const app = await buildApp(deps);

await app.listen({ port: config.port, host: config.host });
console.log(`Event Agent API listening on http://${config.host}:${config.port}`);
