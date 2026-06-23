import { buildDailyStockPromptAgent, buildDailyStockPromptSchedule } from "../agents/prompt-agent.js";
import type { AppConfig } from "../shared/config.js";
import type { Store } from "./store.js";

export async function seedDefaultAgents(store: Store, config: AppConfig): Promise<void> {
  const agent = await store.upsertAgent(buildDailyStockPromptAgent(config));
  await store.upsertSchedule(buildDailyStockPromptSchedule({ ...config, stockAgentId: agent.id }));
}
