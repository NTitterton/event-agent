import type { AppConfig } from "../shared/config.js";
import type { AgentDefinition } from "../shared/types.js";

export function buildDailyStockPromptAgent(config: AppConfig): AgentDefinition {
  const at = new Date().toISOString();
  return {
    id: config.stockAgentId,
    slug: "daily-stock-report",
    name: "Daily Stock Report",
    description: "Picks one random S&P 500 stock daily and writes a concise markdown report.",
    enabled: true,
    kind: "prompt",
    modelProvider: "openai",
    model: "gpt-4.1-mini",
    systemPrompt:
      "You are a concise stock research agent. Write practical, readable markdown. This is an example workflow, not financial advice.",
    userPromptTemplate:
      "Today is {{date}}. Write a concise stock research report for {{stock.ticker}} ({{stock.name}}). Include a thesis, risks, key catalysts, and a buy/hold/sell view. Keep it under 900 words.",
    config: {
      inputs: {
        stock: { resolver: "sp500.random" },
        date: { resolver: "date.iso" }
      },
      report: {
        type: "markdown-report",
        tickerPath: "stock.ticker",
        titleTemplate: "{{date}} {{stock.ticker}} stock report"
      }
    },
    output: {
      storage: "s3",
      bucket: config.reportsBucket ?? "event-agent-local-reports",
      prefix: "stock-reports",
      filenameTemplate: "reports/{{date}}-{{stock.ticker}}.md"
    },
    createdAt: at,
    updatedAt: at
  };
}

export function buildDailyStockPromptSchedule(config: AppConfig) {
  return {
    id: config.stockAgentScheduleId,
    name: "Daily stock report",
    expression: config.stockAgentScheduleExpression,
    timezone: config.stockAgentScheduleTimezone,
    enabled: true,
    queue: "default",
    event: {
      source: "event-agent.scheduler",
      type: "agent.trigger",
      subject: "stock-report-daily",
      payload: { agentId: config.stockAgentId }
    }
  };
}
