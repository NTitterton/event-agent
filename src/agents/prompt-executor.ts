import type { ArtifactWriter } from "./artifact-writer.js";
import type { ModelProvider } from "./model-provider.js";
import { pickRandomStock } from "./stock-universe.js";
import type { AgentDefinition, RunArtifact } from "../shared/types.js";

export interface PromptAgentResult {
  artifact: Omit<RunArtifact, "id" | "createdAt">;
}

export async function executePromptAgent(input: {
  agent: AgentDefinition;
  runId: string;
  modelProvider: ModelProvider;
  artifactWriter: ArtifactWriter;
  random?: () => number;
  now?: Date;
}): Promise<PromptAgentResult> {
  const context = resolveInputs(input.agent, input.now ?? new Date(), input.random);
  const prompt = renderTemplate(input.agent.userPromptTemplate, context);
  const report = await input.modelProvider.generateText({ agent: input.agent, prompt });
  const key = joinS3Key(input.agent.output.prefix, renderTemplate(input.agent.output.filenameTemplate, context));
  await input.artifactWriter.writeMarkdown({ bucket: input.agent.output.bucket, key, body: report });

  const ticker = getPath(context, stringConfig(input.agent.config.report, "tickerPath") ?? "stock.ticker");
  const title = renderTemplate(
    stringConfig(input.agent.config.report, "titleTemplate") ?? "{{date}} report",
    context
  );

  return {
    artifact: {
      runId: input.runId,
      agentId: input.agent.id,
      type: "markdown-report",
      title,
      storage: "s3",
      bucket: input.agent.output.bucket,
      key,
      contentType: "text/markdown; charset=utf-8",
      ticker,
      metadata: {
        modelProvider: input.agent.modelProvider,
        model: input.agent.model,
        context
      }
    }
  };
}

function resolveInputs(agent: AgentDefinition, now: Date, random?: () => number): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  const inputs = recordConfig(agent.config.inputs);
  for (const [name, value] of Object.entries(inputs)) {
    const resolver = stringConfig(value, "resolver");
    if (resolver === "sp500.random") context[name] = pickRandomStock(random);
    if (resolver === "date.iso") context[name] = now.toISOString().slice(0, 10);
  }
  return context;
}

function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (_match, key: string) => getPath(values, key) ?? "");
}

function getPath(values: Record<string, unknown>, path: string): string | undefined {
  let current: unknown = values;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function joinS3Key(prefix: string, key: string): string {
  return [prefix, key]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function recordConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringConfig(value: unknown, key: string): string | undefined {
  const record = recordConfig(value);
  return typeof record[key] === "string" ? record[key] : undefined;
}
