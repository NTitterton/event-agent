export type RunStatus =
  | "queued"
  | "leased"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "dead-lettered";

export interface EventEnvelope {
  id: string;
  source: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  dedupeKey?: string | undefined;
  createdAt: string;
}

export interface Schedule {
  id: string;
  name: string;
  expression: string;
  timezone: string;
  enabled: boolean;
  event: Omit<EventEnvelope, "id" | "createdAt">;
  queue: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  eventId: string;
  scheduleId?: string | undefined;
  status: RunStatus;
  attempt: number;
  queue: string;
  workerId?: string | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  error?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface RunLog {
  id: string;
  runId: string;
  at: string;
  stream: "system" | "stdout" | "stderr" | "event";
  message: string;
  metadata?: Record<string, unknown> | undefined;
}

export interface WorkerHeartbeat {
  workerId: string;
  queues: string[];
  capabilities: string[];
  leaseCount: number;
  lastSeenAt: string;
}

export interface JobMessage {
  runId: string;
  eventId: string;
  queue: string;
  attempt: number;
}

export interface HealthResponse {
  ok: true;
  name: "event-agent";
  mode: "memory" | "cloud";
  time: string;
}
