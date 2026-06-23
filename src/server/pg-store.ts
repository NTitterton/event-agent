import pg from "pg";
import type { AgentDefinition, EventEnvelope, Run, RunArtifact, RunLog, RunStatus, Schedule } from "../shared/types.js";
import type { AppConfig } from "../shared/config.js";
import type { CreateScheduleInput, Store, UpdateScheduleInput } from "./store.js";

const { Pool } = pg;

export class PgStore implements Store {
  private readonly pool: pg.Pool;
  private initialized = false;

  constructor(config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      host: config.databaseHost,
      port: config.databasePort,
      database: config.databaseName,
      user: config.databaseUser,
      password: config.databasePassword,
      ssl: config.databaseHost ? { rejectUnauthorized: false } : false
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      create table if not exists agents (
        id text primary key,
        slug text not null unique,
        name text not null,
        description text not null,
        enabled boolean not null,
        kind text not null,
        model_provider text not null,
        model text not null,
        system_prompt text not null,
        user_prompt_template text not null,
        config jsonb not null,
        output jsonb not null,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );

      create table if not exists schedules (
        id text primary key,
        name text not null,
        expression text not null,
        timezone text not null,
        enabled boolean not null,
        event jsonb not null,
        queue text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );

      create table if not exists events (
        id text primary key,
        source text not null,
        type text not null,
        subject text not null,
        payload jsonb not null,
        dedupe_key text unique,
        created_at timestamptz not null
      );

      create table if not exists runs (
        id text primary key,
        event_id text not null references events(id),
        agent_id text references agents(id),
        schedule_id text references schedules(id),
        status text not null,
        attempt integer not null,
        queue text not null,
        worker_id text,
        artifact_count integer not null default 0,
        started_at timestamptz,
        finished_at timestamptz,
        error text,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );

      create table if not exists run_logs (
        id text primary key,
        run_id text not null references runs(id),
        at timestamptz not null,
        stream text not null,
        message text not null,
        metadata jsonb
      );

      create table if not exists run_artifacts (
        id text primary key,
        run_id text not null references runs(id),
        agent_id text not null references agents(id),
        type text not null,
        title text not null,
        storage text not null,
        bucket text not null,
        key text not null,
        content_type text not null,
        ticker text,
        metadata jsonb not null,
        created_at timestamptz not null
      );
    `);
    this.initialized = true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listSchedules(): Promise<Schedule[]> {
    await this.init();
    const result = await this.pool.query("select * from schedules order by created_at asc");
    return result.rows.map(scheduleFromRow);
  }

  async createSchedule(input: CreateScheduleInput): Promise<Schedule> {
    await this.init();
    const schedule = buildSchedule(input);
    await this.pool.query(
      `insert into schedules (id, name, expression, timezone, enabled, event, queue, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        schedule.id,
        schedule.name,
        schedule.expression,
        schedule.timezone,
        schedule.enabled,
        JSON.stringify(schedule.event),
        schedule.queue,
        schedule.createdAt,
        schedule.updatedAt
      ]
    );
    return schedule;
  }

  async upsertSchedule(input: CreateScheduleInput): Promise<Schedule> {
    await this.init();
    const schedule = buildSchedule(input);
    await this.pool.query(
      `insert into schedules (id, name, expression, timezone, enabled, event, queue, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         name = excluded.name,
         expression = excluded.expression,
         timezone = excluded.timezone,
         enabled = excluded.enabled,
         event = excluded.event,
         queue = excluded.queue,
         updated_at = excluded.updated_at`,
      [
        schedule.id,
        schedule.name,
        schedule.expression,
        schedule.timezone,
        schedule.enabled,
        JSON.stringify(schedule.event),
        schedule.queue,
        schedule.createdAt,
        new Date().toISOString()
      ]
    );
    const result = await this.pool.query("select * from schedules where id = $1", [schedule.id]);
    return scheduleFromRow(result.rows[0]);
  }

  async updateSchedule(id: string, input: UpdateScheduleInput): Promise<Schedule | undefined> {
    await this.init();
    const current = await this.pool.query("select * from schedules where id = $1", [id]);
    if (!current.rowCount) return undefined;
    const existing = scheduleFromRow(current.rows[0]);
    const updated: Schedule = {
      ...existing,
      name: input.name ?? existing.name,
      expression: input.expression ?? existing.expression,
      timezone: input.timezone ?? existing.timezone,
      enabled: input.enabled ?? existing.enabled,
      event: input.event ?? existing.event,
      queue: input.queue ?? existing.queue,
      updatedAt: new Date().toISOString()
    };
    await this.pool.query(
      `update schedules set name = $2, expression = $3, timezone = $4, enabled = $5, event = $6, queue = $7, updated_at = $8 where id = $1`,
      [id, updated.name, updated.expression, updated.timezone, updated.enabled, JSON.stringify(updated.event), updated.queue, updated.updatedAt]
    );
    return updated;
  }

  async deleteSchedule(id: string): Promise<boolean> {
    await this.init();
    const result = await this.pool.query("delete from schedules where id = $1", [id]);
    return Boolean(result.rowCount);
  }

  async createEvent(input: Omit<EventEnvelope, "id" | "createdAt">): Promise<EventEnvelope> {
    await this.init();
    if (input.dedupeKey) {
      const existing = await this.pool.query("select * from events where dedupe_key = $1", [input.dedupeKey]);
      if (existing.rowCount) return eventFromRow(existing.rows[0]);
    }
    const event: EventEnvelope = { ...input, id: id("evt"), createdAt: new Date().toISOString() };
    await this.pool.query(
      `insert into events (id, source, type, subject, payload, dedupe_key, created_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (dedupe_key) do nothing`,
      [event.id, event.source, event.type, event.subject, JSON.stringify(event.payload), event.dedupeKey, event.createdAt]
    );
    if (event.dedupeKey) {
      const result = await this.pool.query("select * from events where dedupe_key = $1", [event.dedupeKey]);
      if (result.rowCount) return eventFromRow(result.rows[0]);
    }
    return event;
  }

  async createRun(input: { eventId: string; agentId?: string; scheduleId?: string; queue: string }): Promise<Run> {
    await this.init();
    const at = new Date().toISOString();
    const run: Run = {
      id: id("run"),
      eventId: input.eventId,
      agentId: input.agentId,
      scheduleId: input.scheduleId,
      status: "queued",
      attempt: 1,
      queue: input.queue,
      artifactCount: 0,
      createdAt: at,
      updatedAt: at
    };
    await this.pool.query(
      `insert into runs (id, event_id, agent_id, schedule_id, status, attempt, queue, artifact_count, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [run.id, run.eventId, run.agentId, run.scheduleId, run.status, run.attempt, run.queue, run.artifactCount, run.createdAt, run.updatedAt]
    );
    return run;
  }

  async listRuns(): Promise<Run[]> {
    await this.init();
    const result = await this.pool.query("select * from runs order by created_at desc limit 100");
    return result.rows.map(runFromRow);
  }

  async getRun(id: string): Promise<Run | undefined> {
    await this.init();
    const result = await this.pool.query("select * from runs where id = $1", [id]);
    return result.rowCount ? runFromRow(result.rows[0]) : undefined;
  }

  async getRunByEvent(eventId: string): Promise<Run | undefined> {
    await this.init();
    const result = await this.pool.query("select * from runs where event_id = $1 order by created_at asc limit 1", [eventId]);
    return result.rowCount ? runFromRow(result.rows[0]) : undefined;
  }

  async updateRun(idValue: string, patch: Partial<Run>): Promise<Run | undefined> {
    await this.init();
    const existing = await this.getRun(idValue);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.pool.query(
      `update runs set
        agent_id = $2,
        schedule_id = $3,
        status = $4,
        attempt = $5,
        queue = $6,
        worker_id = $7,
        artifact_count = $8,
        started_at = $9,
        finished_at = $10,
        error = $11,
        updated_at = $12
       where id = $1`,
      [
        idValue,
        updated.agentId,
        updated.scheduleId,
        updated.status,
        updated.attempt,
        updated.queue,
        updated.workerId,
        updated.artifactCount ?? 0,
        updated.startedAt,
        updated.finishedAt,
        updated.error,
        updated.updatedAt
      ]
    );
    return updated;
  }

  async appendLog(input: Omit<RunLog, "id" | "at">): Promise<RunLog> {
    await this.init();
    const log: RunLog = { ...input, id: id("log"), at: new Date().toISOString() };
    await this.pool.query(
      `insert into run_logs (id, run_id, at, stream, message, metadata) values ($1, $2, $3, $4, $5, $6)`,
      [log.id, log.runId, log.at, log.stream, log.message, JSON.stringify(log.metadata ?? null)]
    );
    return log;
  }

  async listRunLogs(runId: string): Promise<RunLog[]> {
    await this.init();
    const result = await this.pool.query("select * from run_logs where run_id = $1 order by at asc", [runId]);
    return result.rows.map(logFromRow);
  }

  async listAgents(): Promise<AgentDefinition[]> {
    await this.init();
    const result = await this.pool.query("select * from agents order by name asc");
    return result.rows.map(agentFromRow);
  }

  async getAgent(idValue: string): Promise<AgentDefinition | undefined> {
    await this.init();
    const result = await this.pool.query("select * from agents where id = $1", [idValue]);
    return result.rowCount ? agentFromRow(result.rows[0]) : undefined;
  }

  async upsertAgent(input: AgentDefinition): Promise<AgentDefinition> {
    await this.init();
    const at = new Date().toISOString();
    await this.pool.query(
      `insert into agents (id, slug, name, description, enabled, kind, model_provider, model, system_prompt, user_prompt_template, config, output, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         description = excluded.description,
         enabled = excluded.enabled,
         kind = excluded.kind,
         model_provider = excluded.model_provider,
         model = excluded.model,
         system_prompt = excluded.system_prompt,
         user_prompt_template = excluded.user_prompt_template,
         config = excluded.config,
         output = excluded.output,
         updated_at = excluded.updated_at`,
      [
        input.id,
        input.slug,
        input.name,
        input.description,
        input.enabled,
        input.kind,
        input.modelProvider,
        input.model,
        input.systemPrompt,
        input.userPromptTemplate,
        JSON.stringify(input.config),
        JSON.stringify(input.output),
        input.createdAt,
        at
      ]
    );
    const result = await this.pool.query("select * from agents where id = $1", [input.id]);
    return agentFromRow(result.rows[0]);
  }

  async createArtifact(input: Omit<RunArtifact, "id" | "createdAt">): Promise<RunArtifact> {
    await this.init();
    const artifact: RunArtifact = { ...input, id: id("art"), createdAt: new Date().toISOString() };
    await this.pool.query(
      `insert into run_artifacts (id, run_id, agent_id, type, title, storage, bucket, key, content_type, ticker, metadata, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        artifact.id,
        artifact.runId,
        artifact.agentId,
        artifact.type,
        artifact.title,
        artifact.storage,
        artifact.bucket,
        artifact.key,
        artifact.contentType,
        artifact.ticker,
        JSON.stringify(artifact.metadata),
        artifact.createdAt
      ]
    );
    await this.pool.query("update runs set artifact_count = artifact_count + 1, updated_at = $2 where id = $1", [
      artifact.runId,
      new Date().toISOString()
    ]);
    return artifact;
  }

  async listRunArtifacts(runId: string): Promise<RunArtifact[]> {
    await this.init();
    const result = await this.pool.query("select * from run_artifacts where run_id = $1 order by created_at asc", [runId]);
    return result.rows.map(artifactFromRow);
  }
}

function buildSchedule(input: CreateScheduleInput): Schedule {
  const at = new Date().toISOString();
  return {
    id: input.id ?? id("sch"),
    name: input.name,
    expression: input.expression,
    timezone: input.timezone ?? "UTC",
    enabled: input.enabled ?? true,
    event: input.event,
    queue: input.queue ?? "default",
    createdAt: at,
    updatedAt: at
  };
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function agentFromRow(row: Record<string, unknown>): AgentDefinition {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    description: row.description as string,
    enabled: row.enabled as boolean,
    kind: row.kind as AgentDefinition["kind"],
    modelProvider: row.model_provider as AgentDefinition["modelProvider"],
    model: row.model as string,
    systemPrompt: row.system_prompt as string,
    userPromptTemplate: row.user_prompt_template as string,
    config: row.config as Record<string, unknown>,
    output: row.output as AgentDefinition["output"],
    createdAt: iso(row.created_at as string),
    updatedAt: iso(row.updated_at as string)
  };
}

function scheduleFromRow(row: Record<string, unknown>): Schedule {
  return {
    id: row.id as string,
    name: row.name as string,
    expression: row.expression as string,
    timezone: row.timezone as string,
    enabled: row.enabled as boolean,
    event: row.event as Schedule["event"],
    queue: row.queue as string,
    createdAt: iso(row.created_at as string),
    updatedAt: iso(row.updated_at as string)
  };
}

function eventFromRow(row: Record<string, unknown>): EventEnvelope {
  return {
    id: row.id as string,
    source: row.source as string,
    type: row.type as string,
    subject: row.subject as string,
    payload: row.payload as Record<string, unknown>,
    dedupeKey: row.dedupe_key as string | undefined,
    createdAt: iso(row.created_at as string)
  };
}

function runFromRow(row: Record<string, unknown>): Run {
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    agentId: row.agent_id as string | undefined,
    scheduleId: row.schedule_id as string | undefined,
    status: row.status as RunStatus,
    attempt: row.attempt as number,
    queue: row.queue as string,
    workerId: row.worker_id as string | undefined,
    artifactCount: row.artifact_count as number,
    startedAt: row.started_at ? iso(row.started_at as string) : undefined,
    finishedAt: row.finished_at ? iso(row.finished_at as string) : undefined,
    error: row.error as string | undefined,
    createdAt: iso(row.created_at as string),
    updatedAt: iso(row.updated_at as string)
  };
}

function logFromRow(row: Record<string, unknown>): RunLog {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    at: iso(row.at as string),
    stream: row.stream as RunLog["stream"],
    message: row.message as string,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined
  };
}

function artifactFromRow(row: Record<string, unknown>): RunArtifact {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    agentId: row.agent_id as string,
    type: row.type as RunArtifact["type"],
    title: row.title as string,
    storage: row.storage as "s3",
    bucket: row.bucket as string,
    key: row.key as string,
    contentType: row.content_type as string,
    ticker: row.ticker as string | undefined,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: iso(row.created_at as string)
  };
}
