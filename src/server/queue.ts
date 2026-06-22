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

