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
  agentId?: string | undefined;
  scheduleId?: string | undefined;
  status: RunStatus;
  attempt: number;
  queue: string;
  workerId?: string | undefined;
  artifactCount?: number | undefined;
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

export interface RunJobMessage {
  kind?: "run";
  runId: string;
  eventId: string;
  queue: string;
  attempt: number;
}

export interface AgentTriggerMessage {
  kind: "agent.trigger";
  scheduleId: string;
  agentId: string;
  firedAt: string;
  dedupeKey: string;
}

export type JobMessage = RunJobMessage | AgentTriggerMessage;

export type AgentKind = "prompt";
export type ModelProviderName = "openai" | "anthropic" | "gemini" | "bedrock";

export interface AgentDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  kind: AgentKind;
  modelProvider: ModelProviderName;
  model: string;
  systemPrompt: string;
  userPromptTemplate: string;
  config: Record<string, unknown>;
  output: {
    storage: "s3";
    bucket: string;
    prefix: string;
    filenameTemplate: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface RunArtifact {
  id: string;
  runId: string;
  agentId: string;
  type: "markdown-report";
  title: string;
  storage: "s3";
  bucket: string;
  key: string;
  contentType: string;
  ticker?: string | undefined;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface HealthResponse {
  ok: true;
  name: "event-agent";
  mode: "memory" | "cloud";
  time: string;
}
