import { loadConfig } from "../shared/config.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = await buildApp({ config });

await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`Event Agent API listening on http://127.0.0.1:${config.port}`);

