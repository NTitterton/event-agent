import type { AgentDefinition, EventEnvelope, Run, RunArtifact, RunLog, Schedule } from "../shared/types.js";

export interface CreateScheduleInput {
  id?: string | undefined;
  name: string;
  expression: string;
  timezone?: string;
  enabled?: boolean;
  event: Omit<EventEnvelope, "id" | "createdAt">;
  queue?: string;
}

export interface UpdateScheduleInput {
  name?: string | undefined;
  expression?: string | undefined;
  timezone?: string | undefined;
  enabled?: boolean | undefined;
  event?: Omit<EventEnvelope, "id" | "createdAt"> | undefined;
  queue?: string | undefined;
}

export interface Store {
  listSchedules(): Promise<Schedule[]>;
  createSchedule(input: CreateScheduleInput): Promise<Schedule>;
  upsertSchedule(input: CreateScheduleInput): Promise<Schedule>;
  updateSchedule(id: string, input: UpdateScheduleInput): Promise<Schedule | undefined>;
  deleteSchedule(id: string): Promise<boolean>;
  createEvent(input: Omit<EventEnvelope, "id" | "createdAt">): Promise<EventEnvelope>;
  createRun(input: { eventId: string; agentId?: string; scheduleId?: string; queue: string }): Promise<Run>;
  listRuns(): Promise<Run[]>;
  getRun(id: string): Promise<Run | undefined>;
  getRunByEvent(eventId: string): Promise<Run | undefined>;
  updateRun(id: string, patch: Partial<Run>): Promise<Run | undefined>;
  appendLog(input: Omit<RunLog, "id" | "at">): Promise<RunLog>;
  listRunLogs(runId: string): Promise<RunLog[]>;
  listAgents(): Promise<AgentDefinition[]>;
  getAgent(id: string): Promise<AgentDefinition | undefined>;
  upsertAgent(input: AgentDefinition): Promise<AgentDefinition>;
  createArtifact(input: Omit<RunArtifact, "id" | "createdAt">): Promise<RunArtifact>;
  listRunArtifacts(runId: string): Promise<RunArtifact[]>;
}

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export class MemoryStore implements Store {
  private schedules = new Map<string, Schedule>();
  private events = new Map<string, EventEnvelope>();
  private runs = new Map<string, Run>();
  private logs = new Map<string, RunLog[]>();
  private agents = new Map<string, AgentDefinition>();
  private artifacts = new Map<string, RunArtifact[]>();

  async listSchedules(): Promise<Schedule[]> {
    return [...this.schedules.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createSchedule(input: CreateScheduleInput): Promise<Schedule> {
    const at = now();
    const schedule: Schedule = {
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
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  async upsertSchedule(input: CreateScheduleInput): Promise<Schedule> {
    const existing = input.id ? this.schedules.get(input.id) : undefined;
    if (!existing) return this.createSchedule(input);
    const updated: Schedule = {
      ...existing,
      name: input.name,
      expression: input.expression,
      timezone: input.timezone ?? "UTC",
      enabled: input.enabled ?? true,
      event: input.event,
      queue: input.queue ?? "default",
      updatedAt: now()
    };
    this.schedules.set(updated.id, updated);
    return updated;
  }

  async updateSchedule(idValue: string, input: UpdateScheduleInput): Promise<Schedule | undefined> {
    const existing = this.schedules.get(idValue);
    if (!existing) return undefined;
    const updated: Schedule = {
      ...existing,
      name: input.name ?? existing.name,
      expression: input.expression ?? existing.expression,
      timezone: input.timezone ?? existing.timezone,
      enabled: input.enabled ?? existing.enabled,
      event: input.event ?? existing.event,
      queue: input.queue ?? existing.queue,
      updatedAt: now()
    };
    this.schedules.set(updated.id, updated);
    return updated;
  }

  async deleteSchedule(idValue: string): Promise<boolean> {
    return this.schedules.delete(idValue);
  }

  async createEvent(input: Omit<EventEnvelope, "id" | "createdAt">): Promise<EventEnvelope> {
    if (input.dedupeKey) {
      const existing = [...this.events.values()].find((event) => event.dedupeKey === input.dedupeKey);
      if (existing) return existing;
    }
    const event: EventEnvelope = {
      ...input,
      id: id("evt"),
      createdAt: now()
    };
    this.events.set(event.id, event);
    return event;
  }

  async createRun(input: { eventId: string; agentId?: string; scheduleId?: string; queue: string }): Promise<Run> {
    const at = now();
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
    this.runs.set(run.id, run);
    return run;
  }

  async listRuns(): Promise<Run[]> {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRun(idValue: string): Promise<Run | undefined> {
    return this.runs.get(idValue);
  }

  async getRunByEvent(eventId: string): Promise<Run | undefined> {
    return [...this.runs.values()].find((run) => run.eventId === eventId);
  }

  async updateRun(idValue: string, patch: Partial<Run>): Promise<Run | undefined> {
    const existing = this.runs.get(idValue);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: now() };
    this.runs.set(idValue, updated);
    return updated;
  }

  async appendLog(input: Omit<RunLog, "id" | "at">): Promise<RunLog> {
    const log: RunLog = {
      ...input,
      id: id("log"),
      at: now()
    };
    const current = this.logs.get(log.runId) ?? [];
    current.push(log);
    this.logs.set(log.runId, current);
    return log;
  }

  async listRunLogs(runId: string): Promise<RunLog[]> {
    return this.logs.get(runId) ?? [];
  }

  async listAgents(): Promise<AgentDefinition[]> {
    return [...this.agents.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getAgent(idValue: string): Promise<AgentDefinition | undefined> {
    return this.agents.get(idValue);
  }

  async upsertAgent(input: AgentDefinition): Promise<AgentDefinition> {
    const existing = this.agents.get(input.id);
    const agent = existing ? { ...input, createdAt: existing.createdAt, updatedAt: now() } : input;
    this.agents.set(agent.id, agent);
    return agent;
  }

  async createArtifact(input: Omit<RunArtifact, "id" | "createdAt">): Promise<RunArtifact> {
    const artifact: RunArtifact = {
      ...input,
      id: id("art"),
      createdAt: now()
    };
    const current = this.artifacts.get(artifact.runId) ?? [];
    current.push(artifact);
    this.artifacts.set(artifact.runId, current);
    const run = this.runs.get(artifact.runId);
    if (run) {
      this.runs.set(run.id, { ...run, artifactCount: current.length, updatedAt: now() });
    }
    return artifact;
  }

  async listRunArtifacts(runId: string): Promise<RunArtifact[]> {
    return this.artifacts.get(runId) ?? [];
  }
}
