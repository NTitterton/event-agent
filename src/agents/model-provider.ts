import type { AppConfig } from "../shared/config.js";
import type { AgentDefinition } from "../shared/types.js";

export interface ModelRequest {
  agent: AgentDefinition;
  prompt: string;
}

export interface ModelProvider {
  generateText(request: ModelRequest): Promise<string>;
}

export class OpenAiModelProvider implements ModelProvider {
  constructor(private readonly config: AppConfig) {}

  async generateText(request: ModelRequest): Promise<string> {
    if (!this.config.openaiApiKey || this.config.openaiApiKey === "replace-me") {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.openaiApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.agent.model,
        input: [
          { role: "system", content: request.agent.systemPrompt },
          { role: "user", content: request.prompt }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(formatOpenAiError(response.status, body));
    }

    const json = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
    };
    const nestedText = json.output?.flatMap((item) => item.content ?? []).map((content) => content.text).find(Boolean);
    const text = json.output_text ?? nestedText;
    if (!text) throw new Error("OpenAI response did not contain text output");
    return text;
  }
}

function formatOpenAiError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: string;
        type?: string;
        code?: string | null;
      };
    };
    const error = parsed.error;
    if (error?.message) {
      const code = error.code ?? error.type ?? "unknown";
      return `OpenAI request failed with ${status} ${code}: ${error.message}`;
    }
  } catch {
    // Fall through to the raw snippet when OpenAI returns non-JSON.
  }
  return `OpenAI request failed with ${status}: ${body.replace(/\s+/g, " ").slice(0, 400)}`;
}

export class StaticModelProvider implements ModelProvider {
  async generateText(request: ModelRequest): Promise<string> {
    return `${request.prompt}\n\n## Example Output\n\nThis deterministic report was produced by the local test provider.`;
  }
}
