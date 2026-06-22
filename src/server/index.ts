import { loadConfig } from "../shared/config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp({ config });

await app.listen({ port: config.port, host: config.host });
console.log(`Event Agent API listening on http://${config.host}:${config.port}`);
