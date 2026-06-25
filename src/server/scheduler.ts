import { CreateScheduleCommand, DeleteScheduleCommand, SchedulerClient, UpdateScheduleCommand } from "@aws-sdk/client-scheduler";
import type { AppConfig } from "../shared/config.js";
import type { Schedule } from "../shared/types.js";

export interface ScheduleReconciler {
  upsertSchedule(schedule: Schedule): Promise<void>;
  deleteSchedule(schedule: Schedule): Promise<void>;
}

export class NoopScheduleReconciler implements ScheduleReconciler {
  async upsertSchedule(_schedule: Schedule): Promise<void> {
    return;
  }

  async deleteSchedule(_schedule: Schedule): Promise<void> {
    return;
  }
}

export class EventBridgeScheduleReconciler implements ScheduleReconciler {
  private readonly client: SchedulerClient;

  constructor(private readonly config: AppConfig) {
    this.client = new SchedulerClient(config.awsRegion ? { region: config.awsRegion } : {});
  }

  async upsertSchedule(schedule: Schedule): Promise<void> {
    const input = buildScheduleInput(this.config, schedule);
    try {
      await this.client.send(new CreateScheduleCommand(input));
    } catch (error) {
      if (!isConflict(error)) throw error;
      await this.client.send(new UpdateScheduleCommand(input));
    }
  }

  async deleteSchedule(schedule: Schedule): Promise<void> {
    if (!this.config.schedulerGroupName) throw new Error("Scheduler group is required");
    try {
      await this.client.send(
        new DeleteScheduleCommand({
          Name: schedule.id,
          GroupName: this.config.schedulerGroupName
        })
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

export function createScheduleReconciler(config: AppConfig): ScheduleReconciler {
  if (!config.schedulerGroupName || !config.schedulerRoleArn || !config.defaultQueueArn) {
    return new NoopScheduleReconciler();
  }
  return new EventBridgeScheduleReconciler(config);
}

function buildScheduleInput(config: AppConfig, schedule: Schedule) {
  if (!config.schedulerGroupName || !config.schedulerRoleArn || !config.defaultQueueArn) {
    throw new Error("Scheduler group, role ARN, and queue ARN are required");
  }
  if (schedule.event.type !== "agent.trigger" || typeof schedule.event.payload.agentId !== "string") {
    throw new Error("Only agent trigger schedules can be reconciled to EventBridge Scheduler");
  }

  return {
    Name: schedule.id,
    GroupName: config.schedulerGroupName,
    ScheduleExpression: schedule.expression,
    ScheduleExpressionTimezone: schedule.timezone,
    FlexibleTimeWindow: { Mode: "OFF" as const },
    State: schedule.enabled ? ("ENABLED" as const) : ("DISABLED" as const),
    Target: {
      Arn: config.defaultQueueArn,
      RoleArn: config.schedulerRoleArn,
      Input: JSON.stringify({
        kind: "agent.trigger",
        scheduleId: schedule.id,
        agentId: schedule.event.payload.agentId,
        firedAt: "<aws.scheduler.scheduled-time>",
        dedupeKey: `${schedule.id}:<aws.scheduler.scheduled-time>:${schedule.event.payload.agentId}`
      })
    }
  };
}

function isConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "ConflictException");
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "ResourceNotFoundException");
}
