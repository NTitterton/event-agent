import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { LocalArtifactWriter, S3ArtifactWriter, type ArtifactWriter } from "../agents/artifact-writer.js";
import { OpenAiModelProvider, type ModelProvider } from "../agents/model-provider.js";
import { executePromptAgent } from "../agents/prompt-executor.js";
import { seedDefaultAgents } from "../server/bootstrap.js";
import { PgStore } from "../server/pg-store.js";
import type { Store } from "../server/store.js";
import type { AppConfig } from "../shared/config.js";
import type { AgentTriggerMessage, JobMessage, RunJobMessage } from "../shared/types.js";

export interface WorkerRuntimeDeps {
  store?: Store;
  modelProvider?: ModelProvider;
  artifactWriter?: ArtifactWriter;
  random?: () => number;
}

export async function processJobMessage(input: {
  message: JobMessage;
  store: Store;
  modelProvider: ModelProvider;
  artifactWriter: ArtifactWriter;
  workerId: string;
  random?: () => number;
}): Promise<void> {
  if (input.message.kind === "agent.trigger") {
    await processAgentTrigger(input.message, input);
    return;
  }
  await processRunJob(input.message, input);
}

export async function startWorkerRuntime(config: AppConfig, workerId: string, deps: WorkerRuntimeDeps = {}): Promise<void> {
  const store = deps.store ?? new PgStore(config);
  await seedDefaultAgents(store, config);
  const modelProvider = deps.modelProvider ?? new OpenAiModelProvider(config);
  const artifactWriter = deps.artifactWriter ?? (config.reportsBucket ? new S3ArtifactWriter(config.awsRegion) : new LocalArtifactWriter());
  const client = new SQSClient(config.awsRegion ? { region: config.awsRegion } : {});
  if (!config.defaultQueueUrl) throw new Error("EVENT_AGENT_DEFAULT_QUEUE_URL is not configured");

  for (;;) {
    const response = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: config.defaultQueueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 900
      })
    );
    for (const message of response.Messages ?? []) {
      if (!message.Body || !message.ReceiptHandle) continue;
      await processJobMessage({
        message: JSON.parse(message.Body) as JobMessage,
        store,
        modelProvider,
        artifactWriter,
        workerId,
        ...(deps.random ? { random: deps.random } : {})
      });
      await client.send(new DeleteMessageCommand({ QueueUrl: config.defaultQueueUrl, ReceiptHandle: message.ReceiptHandle }));
    }
  }
}

async function processAgentTrigger(
  message: AgentTriggerMessage,
  input: {
    store: Store;
    modelProvider: ModelProvider;
    artifactWriter: ArtifactWriter;
    workerId: string;
    random?: () => number;
  }
): Promise<void> {
  const agent = await input.store.getAgent(message.agentId);
  if (!agent) throw new Error(`Agent ${message.agentId} not found`);
  if (!agent.enabled) throw new Error(`Agent ${message.agentId} is disabled`);

  const event = await input.store.createEvent({
    source: message.scheduleId ? "event-agent.scheduler" : "event-agent.manual",
    type: "agent.trigger",
    subject: agent.slug,
    payload: { agentId: agent.id, firedAt: message.firedAt },
    dedupeKey: message.dedupeKey
  });
  const existingRun = await input.store.getRunByEvent(event.id);
  if (existingRun?.status === "succeeded") return;
  const run =
    existingRun ??
    (await input.store.createRun({
      eventId: event.id,
      agentId: agent.id,
      ...(message.scheduleId ? { scheduleId: message.scheduleId } : {}),
      queue: "default"
    }));

  await input.store.updateRun(run.id, {
    status: "running",
    workerId: input.workerId,
    startedAt: new Date().toISOString()
  });
  await input.store.appendLog({ runId: run.id, stream: "system", message: `Executing prompt agent ${agent.slug}.` });

  try {
    const result = await executePromptAgent({
      agent,
      runId: run.id,
      modelProvider: input.modelProvider,
      artifactWriter: input.artifactWriter,
      ...(input.random ? { random: input.random } : {})
    });
    const artifact = await input.store.createArtifact(result.artifact);
    await input.store.appendLog({
      runId: run.id,
      stream: "system",
      message: `Report written to s3://${artifact.bucket}/${artifact.key}.`,
      metadata: { artifactId: artifact.id, ticker: artifact.ticker }
    });
    await input.store.updateRun(run.id, {
      status: "succeeded",
      finishedAt: new Date().toISOString()
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await input.store.appendLog({ runId: run.id, stream: "stderr", message: messageText });
    await input.store.updateRun(run.id, {
      status: "failed",
      error: messageText,
      finishedAt: new Date().toISOString()
    });
    throw error;
  }
}

async function processRunJob(
  message: RunJobMessage,
  input: {
    store: Store;
    workerId: string;
  }
): Promise<void> {
  const run = await input.store.getRun(message.runId);
  if (!run) throw new Error(`Run ${message.runId} not found`);
  await input.store.updateRun(run.id, {
    status: "succeeded",
    workerId: input.workerId,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  });
  await input.store.appendLog({ runId: run.id, stream: "system", message: "Generic run job acknowledged by scaffold worker." });
}
