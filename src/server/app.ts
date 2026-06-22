import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConfig, runtimeMode, type AppConfig } from "../shared/config.js";
import type { JobMessage } from "../shared/types.js";
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

export interface AppDependencies {
  config?: AppConfig;
  store?: Store;
  queue?: QueuePublisher;
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const config = deps.config ?? loadConfig();
  const store = deps.store ?? new MemoryStore();
  const queue = deps.queue ?? new MemoryQueuePublisher();
  const app = Fastify({ logger: false });

  app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/api/health") return;
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${config.authToken}`) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  });

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
    const event = await store.createEvent(schedule.event);
    const run = await store.createRun({ eventId: event.id, scheduleId: schedule.id, queue: schedule.queue });
    await queue.publish({ runId: run.id, eventId: event.id, queue: run.queue, attempt: run.attempt });
    await store.appendLog({ runId: run.id, stream: "system", message: `Run queued from schedule ${schedule.name}.` });
    return reply.code(202).send({ event, run });
  });

  app.get("/api/runs", async () => ({ runs: await store.listRuns() }));

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const run = await store.getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });
    return { run, logs: await store.listRunLogs(run.id) };
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

