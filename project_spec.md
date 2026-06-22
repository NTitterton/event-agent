# Event Agent Spec

## Goal

Event Agent is a cloud-hosted event-based agent platform. It should run personal cron-like agent tasks first, while being designed as a scalable platform for scheduled, externally triggered, internally triggered, and eventually provider-webhook-triggered work.

Unlike OpenClaw/Hermes-like continuously running personal assistants, Event Agent should be idle until an event arrives or a schedule fires. Every execution should produce durable run state, logs, retry metadata, and an auditable relationship to the triggering event.

## Non-Goals For V1

- No required local Docker Postgres or laptop-hosted durable runtime.
- No full multi-user account system; v1 uses a single bearer token.
- No Kubernetes requirement in v1; EKS remains a future worker backend.
- No provider-specific webhook verification in the first engine milestone unless it is needed for an early workflow.
- No guarantee of exactly-once execution; v1 targets at-least-once execution with idempotency keys.

## V1 Requirements

### Runtime And Hosting

- Durable state must live in cloud Postgres, with Amazon RDS PostgreSQL as the default hosted target.
- Scheduled triggers should map to EventBridge Scheduler in AWS.
- Executable work should move through SQS queues with dead-letter queues.
- Workers should run as ECS/Fargate services.
- Secrets should live in AWS Secrets Manager or SSM Parameter Store in hosted environments.
- Local development may run API/worker processes for iteration, but local state is not authoritative.

### Trigger Types

- Cron/rate schedules.
- Authenticated API-triggered events.
- Internal events emitted by the control plane or workers.
- Future provider-specific webhooks.

### Event Envelope

Every trigger normalizes into an event envelope:

- `id`
- `source`
- `type`
- `subject`
- `payload`
- `dedupeKey`
- `createdAt`

### Schedules

Schedules should support:

- `id`
- `name`
- `expression`
- `timezone`
- `enabled`
- `event`
- `queue`
- `createdAt`
- `updatedAt`

The first implementation may store and trigger schedules through an in-memory adapter for smoke tests, but the production design is RDS plus EventBridge Scheduler.

### Runs

Runs should support:

- `id`
- `eventId`
- `scheduleId`
- `status`
- `attempt`
- `queue`
- `workerId`
- `startedAt`
- `finishedAt`
- `error`
- `createdAt`
- `updatedAt`

Initial statuses:

- `queued`
- `leased`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `dead-lettered`

### Workers

Workers should:

- Consume one or more named queues.
- Advertise capability labels.
- Take leases before executing work.
- Apply timeouts.
- Stream run logs.
- Update run status.
- Retry transient failures according to run policy.
- Treat execution as at-least-once and idempotent.

### Minimal UI

The first UI should show:

- Schedule list.
- Run list.
- Run detail and logs.
- Manual trigger action.
- Retry and cancel actions.
- Worker health summary when available.

### API

Initial API:

- `GET /api/health`
- `POST /api/events`
- `GET /api/schedules`
- `POST /api/schedules`
- `PATCH /api/schedules/:id`
- `DELETE /api/schedules/:id`
- `POST /api/schedules/:id/trigger`
- `GET /api/runs`
- `GET /api/runs/:id`
- `POST /api/runs/:id/cancel`
- `POST /api/runs/:id/retry`

All non-health API routes require `Authorization: Bearer <EVENT_AGENT_AUTH_TOKEN>`.

## Acceptance Criteria

- Repo contains durable documentation, setup instructions, and verification scripts.
- `npm run check` type-checks the TypeScript code.
- `npm run smoke` verifies health, auth, schedule creation, manual triggering, and run listing without touching AWS.
- The docs clearly state that cloud runtime is required for durable operation.
- The architecture cleanly separates control-plane APIs, trigger adapters, queue adapters, worker execution, and persistence.

## Open Questions

- Which first real personal automation workflow should drive the first cloud integration?
- Should hosted API/UI live behind an Application Load Balancer, API Gateway, or another ingress?
- Should the first infrastructure implementation use Terraform, AWS CDK, Pulumi, or documented manual setup?
- How much sandboxing should be inside the worker process versus delegated to per-run ECS tasks?

