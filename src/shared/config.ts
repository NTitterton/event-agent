export interface AppConfig {
  authToken: string;
  port: number;
  awsRegion?: string | undefined;
  databaseUrl?: string | undefined;
  defaultQueueUrl?: string | undefined;
  eventBusName?: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    authToken: env.EVENT_AGENT_AUTH_TOKEN ?? "dev-token",
    port: Number.parseInt(env.EVENT_AGENT_PORT ?? "5180", 10),
    awsRegion: env.EVENT_AGENT_AWS_REGION,
    databaseUrl: env.EVENT_AGENT_DATABASE_URL,
    defaultQueueUrl: env.EVENT_AGENT_DEFAULT_QUEUE_URL,
    eventBusName: env.EVENT_AGENT_EVENT_BUS_NAME
  };
}

export function runtimeMode(config: AppConfig): "memory" | "cloud" {
  return config.databaseUrl && config.defaultQueueUrl ? "cloud" : "memory";
}
