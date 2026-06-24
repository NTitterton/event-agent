import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../shared/config.js";
import type { AgentDefinition } from "../shared/types.js";
import type { CreateScheduleInput, Store } from "./store.js";

const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  enabled: z.boolean(),
  kind: z.literal("prompt"),
  modelProvider: z.enum(["openai", "anthropic", "gemini", "bedrock"]),
  model: z.string().min(1),
  systemPrompt: z.string(),
  userPromptTemplate: z.string(),
  config: z.record(z.unknown()),
  output: z.object({
    storage: z.literal("s3"),
    bucket: z.string().min(1),
    prefix: z.string(),
    filenameTemplate: z.string().min(1)
  }),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

const scheduleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  expression: z.string().min(1),
  timezone: z.string().default("UTC"),
  enabled: z.boolean().default(true),
  queue: z.string().default("default"),
  event: z.object({
    source: z.string().min(1),
    type: z.string().min(1),
    subject: z.string().min(1),
    payload: z.record(z.unknown()).default({}),
    dedupeKey: z.string().optional()
  })
});

const agentConfigDocumentSchema = z.object({
  version: z.literal(1),
  account: z.object({
    id: z.string().min(1),
    name: z.string().optional()
  }),
  agents: z.array(agentDefinitionSchema),
  schedules: z.array(scheduleSchema).default([])
});

type AgentConfigDocument = z.infer<typeof agentConfigDocumentSchema>;

export async function seedDefaultAgents(store: Store, config: AppConfig): Promise<void> {
  const document = await loadAgentConfigDocument(config);
  for (const agentInput of document.agents) {
    const at = new Date().toISOString();
    const agent: AgentDefinition = {
      ...agentInput,
      output: hydrateValue(agentInput.output, config) as AgentDefinition["output"],
      config: hydrateValue(agentInput.config, config) as AgentDefinition["config"],
      createdAt: agentInput.createdAt ?? at,
      updatedAt: agentInput.updatedAt ?? at
    };
    await store.upsertAgent(agent);
  }

  for (const schedule of document.schedules) {
    await store.upsertSchedule(hydrateValue(schedule, config) as CreateScheduleInput);
  }
}

export async function loadAgentConfigDocument(config: AppConfig): Promise<AgentConfigDocument> {
  const raw = config.agentConfigBucket ? await loadS3AgentConfigDocument(config) : await loadLocalAgentConfigDocument(config);
  const parsed = agentConfigDocumentSchema.parse(JSON.parse(raw));
  return parsed;
}

async function loadS3AgentConfigDocument(config: AppConfig): Promise<string> {
  if (!config.agentConfigBucket) throw new Error("EVENT_AGENT_CONFIG_BUCKET is not configured");
  const client = new S3Client(config.awsRegion ? { region: config.awsRegion } : {});
  const accountIds = [accountIdFor(config), "default"];
  let lastError: unknown;
  for (const accountId of accountIds) {
    const key = joinS3Key(config.agentConfigPrefix, accountId, "agents.json");
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: config.agentConfigBucket, Key: key }));
      if (!response.Body) throw new Error(`S3 config object s3://${config.agentConfigBucket}/${key} is empty`);
      return await response.Body.transformToString();
    } catch (error) {
      lastError = error;
      if (error instanceof NoSuchKey || isS3NoSuchKey(error)) continue;
      throw error;
    }
  }
  throw new Error(`No agent config found in s3://${config.agentConfigBucket}/${config.agentConfigPrefix}/ for ${accountIds.join(" or ")}: ${String(lastError)}`);
}

async function loadLocalAgentConfigDocument(config: AppConfig): Promise<string> {
  return readFile(resolve(config.localAgentConfigPath), "utf8");
}

function accountIdFor(config: AppConfig): string {
  if (config.agentConfigAccountId) return config.agentConfigAccountId;
  return `token-${createHash("sha256").update(config.authToken).digest("hex").slice(0, 16)}`;
}

function hydrateValue(value: unknown, config: AppConfig): unknown {
  if (typeof value === "string") return hydrateString(value, config);
  if (Array.isArray(value)) return value.map((item) => hydrateValue(item, config));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateValue(item, config)]));
  }
  return value;
}

function hydrateString(value: string, config: AppConfig): string {
  return value
    .replaceAll("{{reportsBucket}}", config.reportsBucket ?? "event-agent-local-reports")
    .replaceAll("{{accountId}}", accountIdFor(config));
}

function joinS3Key(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function isS3NoSuchKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "NoSuchKey");
}
