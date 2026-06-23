export interface AppConfig {
  authToken: string;
  port: number;
  host: string;
  awsRegion?: string | undefined;
  databaseUrl?: string | undefined;
  databaseHost?: string | undefined;
  databasePort?: number | undefined;
  databaseName?: string | undefined;
  databaseUser?: string | undefined;
  databasePassword?: string | undefined;
  defaultQueueUrl?: string | undefined;
  reportsBucket?: string | undefined;
  openaiApiKey?: string | undefined;
  stockAgentId: string;
  stockAgentScheduleId: string;
  stockAgentScheduleExpression: string;
  stockAgentScheduleTimezone: string;
  eventBusName?: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    authToken: env.EVENT_AGENT_AUTH_TOKEN ?? "dev-token",
    port: Number.parseInt(env.EVENT_AGENT_PORT ?? "5180", 10),
    host: env.EVENT_AGENT_HOST ?? "127.0.0.1",
    awsRegion: env.EVENT_AGENT_AWS_REGION,
    databaseUrl: env.EVENT_AGENT_DATABASE_URL,
    databaseHost: env.EVENT_AGENT_DATABASE_HOST,
    databasePort: env.EVENT_AGENT_DATABASE_PORT ? Number.parseInt(env.EVENT_AGENT_DATABASE_PORT, 10) : undefined,
    databaseName: env.EVENT_AGENT_DATABASE_NAME,
    databaseUser: env.EVENT_AGENT_DATABASE_USER,
    databasePassword: env.EVENT_AGENT_DATABASE_PASSWORD,
    defaultQueueUrl: env.EVENT_AGENT_DEFAULT_QUEUE_URL,
    reportsBucket: env.EVENT_AGENT_REPORTS_BUCKET,
    openaiApiKey: env.OPENAI_API_KEY,
    stockAgentId: env.EVENT_AGENT_STOCK_AGENT_ID ?? "agent_stock_report_daily",
    stockAgentScheduleId: env.EVENT_AGENT_STOCK_AGENT_SCHEDULE_ID ?? "sch_stock_report_daily",
    stockAgentScheduleExpression: env.EVENT_AGENT_STOCK_AGENT_SCHEDULE_EXPRESSION ?? "cron(0 9 * * ? *)",
    stockAgentScheduleTimezone: env.EVENT_AGENT_STOCK_AGENT_SCHEDULE_TIMEZONE ?? "America/Los_Angeles",
    eventBusName: env.EVENT_AGENT_EVENT_BUS_NAME
  };
}

export function runtimeMode(config: AppConfig): "memory" | "cloud" {
  const hasDatabaseUrl = Boolean(config.databaseUrl);
  const hasSplitDatabase =
    Boolean(config.databaseHost) &&
    Boolean(config.databaseName) &&
    Boolean(config.databaseUser) &&
    Boolean(config.databasePassword);
  return (hasDatabaseUrl || hasSplitDatabase) && config.defaultQueueUrl ? "cloud" : "memory";
}
