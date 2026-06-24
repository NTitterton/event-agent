import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadConfig, runtimeMode, type AppConfig } from "../shared/config.js";
import type { AgentDefinition } from "../shared/types.js";
import type { AgentTriggerMessage, JobMessage } from "../shared/types.js";
import { LocalArtifactUrlSigner, S3ArtifactUrlSigner, type ArtifactUrlSigner } from "./artifacts.js";
import { loadAgentConfigDocument, saveAgentConfigDocument } from "./bootstrap.js";
import { MemoryQueuePublisher, type QueuePublisher } from "./queue.js";
import { MemoryStore, type Store } from "./store.js";

const eventInputSchema = z.object({
  source: z.string().min(1),
  type: z.string().min(1),
  subject: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  dedupeKey: z.string().optional()
});

const scheduleInputSchema = z.object({
  name: z.string().min(1),
  expression: z.string().min(1),
  timezone: z.string().default("UTC"),
  enabled: z.boolean().default(true),
  event: eventInputSchema,
  queue: z.string().min(1).default("default")
});

const agentInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  enabled: z.boolean().default(true),
  modelProvider: z.enum(["openai", "anthropic", "gemini", "bedrock"]).default("openai"),
  model: z.string().min(1).default("gpt-4.1-mini"),
  systemPrompt: z.string().min(1),
  userPromptTemplate: z.string().min(1),
  outputPrefix: z.string().min(1).optional()
});

export interface AppDependencies {
  config?: AppConfig;
  store?: Store;
  queue?: QueuePublisher;
  artifactUrlSigner?: ArtifactUrlSigner;
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const config = deps.config ?? loadConfig();
  const store = deps.store ?? new MemoryStore();
  const queue = deps.queue ?? new MemoryQueuePublisher();
  const artifactUrlSigner = deps.artifactUrlSigner ?? (config.reportsBucket ? new S3ArtifactUrlSigner(config) : new LocalArtifactUrlSigner());
  const app = Fastify({ logger: false });
  const uiDistPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/ui");

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/api/health") return;
    if (!request.url.startsWith("/api/")) return;
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${config.authToken}`) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/", async (_request, reply) => sendUiAsset(reply, uiDistPath, "index.html"));

  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) =>
    sendUiAsset(reply, uiDistPath, `assets/${request.params["*"]}`)
  );

  app.get("/api/health", async () => ({
    ok: true,
    name: "event-agent",
    mode: runtimeMode(config),
    time: new Date().toISOString()
  }));

  app.post("/api/events", async (request, reply) => {
    const parsed = eventInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid event", details: parsed.error.flatten() });
    const event = await store.createEvent(parsed.data);
    const run = await store.createRun({ eventId: event.id, queue: "default" });
    const job: JobMessage = { runId: run.id, eventId: event.id, queue: run.queue, attempt: run.attempt };
    await queue.publish(job);
    await store.appendLog({ runId: run.id, stream: "system", message: "Run queued from API event." });
    return reply.code(202).send({ event, run });
  });

  app.get("/api/schedules", async () => ({ schedules: await store.listSchedules() }));

  app.get("/api/agents", async () => ({ agents: await store.listAgents() }));

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    return { agent };
  });

  app.post("/api/agents", async (request, reply) => {
    const parsed = agentInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid agent", details: parsed.error.flatten() });
    const existingAgents = await store.listAgents();
    const agent = buildPromptAgent(parsed.data, existingAgents, config);
    if (existingAgents.some((existing) => existing.id === agent.id || existing.slug === agent.slug)) {
      return reply.code(409).send({ error: "Agent already exists" });
    }

    const document = await loadAgentConfigDocument(config);
    if (document.agents.some((existing) => existing.id === agent.id || existing.slug === agent.slug)) {
      return reply.code(409).send({ error: "Agent already exists in config" });
    }
    document.agents.push({
      ...agent,
      output: { ...agent.output, bucket: "{{reportsBucket}}" }
    });
    await saveAgentConfigDocument(config, document);
    await store.upsertAgent(agent);
    return reply.code(201).send({ agent });
  });

  app.post<{ Params: { id: string } }>("/api/agents/:id/trigger", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const firedAt = new Date().toISOString();
    const message: AgentTriggerMessage = {
      kind: "agent.trigger",
      agentId: agent.id,
      firedAt,
      dedupeKey: `manual-agent:${agent.id}:${firedAt}:${crypto.randomUUID()}`
    };
    await queue.publish(message);
    return reply.code(202).send({ queued: true, message });
  });

  app.post("/api/schedules", async (request, reply) => {
    const parsed = scheduleInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid schedule", details: parsed.error.flatten() });
    const schedule = await store.createSchedule(parsed.data);
    return reply.code(201).send({ schedule });
  });

  app.patch<{ Params: { id: string } }>("/api/schedules/:id", async (request, reply) => {
    const parsed = scheduleInputSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid schedule", details: parsed.error.flatten() });
    const schedule = await store.updateSchedule(request.params.id, parsed.data);
    if (!schedule) return reply.code(404).send({ error: "Schedule not found" });
    return { schedule };
  });

  app.delete<{ Params: { id: string } }>("/api/schedules/:id", async (request, reply) => {
    const deleted = await store.deleteSchedule(request.params.id);
    if (!deleted) return reply.code(404).send({ error: "Schedule not found" });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/schedules/:id/trigger", async (request, reply) => {
    const schedule = (await store.listSchedules()).find((candidate) => candidate.id === request.params.id);
    if (!schedule) return reply.code(404).send({ error: "Schedule not found" });
    if (schedule.event.type === "agent.trigger" && typeof schedule.event.payload.agentId === "string") {
      const firedAt = new Date().toISOString();
      const message: AgentTriggerMessage = {
        kind: "agent.trigger",
        scheduleId: schedule.id,
        agentId: schedule.event.payload.agentId,
        firedAt,
        dedupeKey: `manual:${schedule.id}:${firedAt}:${crypto.randomUUID()}`
      };
      await queue.publish(message);
      return reply.code(202).send({ queued: true, message });
    }
    const event = await store.createEvent(schedule.event);
    const run = await store.createRun({ eventId: event.id, scheduleId: schedule.id, queue: schedule.queue });
    await queue.publish({ kind: "run", runId: run.id, eventId: event.id, queue: run.queue, attempt: run.attempt });
    await store.appendLog({ runId: run.id, stream: "system", message: `Run queued from schedule ${schedule.name}.` });
    return reply.code(202).send({ event, run });
  });

  app.get("/api/runs", async () => ({ runs: await store.listRuns() }));

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = await store.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return { run, logs: await store.listRunLogs(run.id), artifacts: await store.listRunArtifacts(run.id) };
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id/artifacts", async (request, reply) => {
    const run = await store.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return { artifacts: await store.listRunArtifacts(run.id) };
  });

  app.get<{ Params: { id: string } }>("/api/artifacts/:id/access-url", async (request, reply) => {
    const artifact = await store.getArtifact(request.params.id);
    if (!artifact) return reply.code(404).send({ error: "Artifact not found" });
    return { artifact, access: await artifactUrlSigner.sign(artifact) };
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (request, reply) => {
    const run = await store.updateRun(request.params.id, {
      status: "cancelled",
      finishedAt: new Date().toISOString()
    });
    if (!run) return reply.code(404).send({ error: "Run not found" });
    await store.appendLog({ runId: run.id, stream: "system", message: "Run cancelled." });
    return { run };
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/retry", async (request, reply) => {
    const existing = await store.getRun(request.params.id);
    if (!existing) return reply.code(404).send({ error: "Run not found" });
    const run = await store.updateRun(existing.id, {
      status: "queued",
      attempt: existing.attempt + 1,
      finishedAt: undefined,
      error: undefined
    });
    if (!run) return reply.code(404).send({ error: "Run not found" });
    await queue.publish({ runId: run.id, eventId: run.eventId, queue: run.queue, attempt: run.attempt });
    await store.appendLog({ runId: run.id, stream: "system", message: `Run retry queued as attempt ${run.attempt}.` });
    return reply.code(202).send({ run });
  });

  return app;
}

function buildPromptAgent(
  input: z.infer<typeof agentInputSchema>,
  existingAgents: AgentDefinition[],
  config: AppConfig
): AgentDefinition {
  const at = new Date().toISOString();
  const slug = uniqueSlug(slugify(input.name), existingAgents);
  return {
    id: `agent_${slug.replace(/-/g, "_")}`,
    slug,
    name: input.name,
    description: input.description,
    enabled: input.enabled,
    kind: "prompt",
    modelProvider: input.modelProvider,
    model: input.model,
    systemPrompt: input.systemPrompt,
    userPromptTemplate: input.userPromptTemplate,
    config: {
      inputs: {
        date: { resolver: "date.iso" }
      },
      report: {
        type: "markdown-report",
        titleTemplate: `{{date}} ${input.name}`
      }
    },
    output: {
      storage: "s3",
      bucket: config.reportsBucket ?? "event-agent-local-reports",
      prefix: input.outputPrefix ?? `agents/${slug}`,
      filenameTemplate: `reports/{{date}}-${slug}.md`
    },
    createdAt: at,
    updatedAt: at
  };
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `agent-${crypto.randomUUID().slice(0, 8)}`
  );
}

function uniqueSlug(base: string, existingAgents: AgentDefinition[]): string {
  const used = new Set(existingAgents.map((agent) => agent.slug));
  if (!used.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function sendUiAsset(reply: FastifyReply, uiDistPath: string, assetPath: string) {
  const absoluteAssetPath = resolve(uiDistPath, assetPath);
  if (!absoluteAssetPath.startsWith(`${uiDistPath}/`) && absoluteAssetPath !== uiDistPath) {
    return reply.code(404).send({ error: "Not found" });
  }

  try {
    await access(absoluteAssetPath, constants.R_OK);
  } catch {
    return reply.code(404).send({ error: "UI has not been built" });
  }

  return reply.type(contentTypeFor(absoluteAssetPath)).send(createReadStream(absoluteAssetPath));
}

function contentTypeFor(assetPath: string): string {
  const extension = extname(assetPath);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".png") return "image/png";
  return "application/octet-stream";
}
