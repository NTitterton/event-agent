import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { AppConfig } from "../shared/config.js";
import type { JobMessage } from "../shared/types.js";

export interface QueuePublisher {
  publish(job: JobMessage): Promise<void>;
  publishedJobs?(): JobMessage[];
}

export class MemoryQueuePublisher implements QueuePublisher {
  private jobs: JobMessage[] = [];

  async publish(job: JobMessage): Promise<void> {
    this.jobs.push(job);
  }

  publishedJobs(): JobMessage[] {
    return [...this.jobs];
  }
}

export class SqsQueuePublisher implements QueuePublisher {
  private readonly client: SQSClient;

  constructor(private readonly config: AppConfig) {
    this.client = new SQSClient(config.awsRegion ? { region: config.awsRegion } : {});
  }

  async publish(job: JobMessage): Promise<void> {
    if (!this.config.defaultQueueUrl) throw new Error("EVENT_AGENT_DEFAULT_QUEUE_URL is not configured");
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.config.defaultQueueUrl,
        MessageBody: JSON.stringify(job)
      })
    );
  }
}
