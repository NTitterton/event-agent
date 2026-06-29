# Event Agent Spec

## Goal

Event Agent is a cloud-hosted event-based agent platform. It should run personal cron-like agent tasks first, while being designed as a scalable platform for scheduled, externally triggered, internally triggered, and eventually provider-webhook-triggered work.

Unlike OpenClaw/Hermes-like continuously running personal assistants, Event Agent should be idle until an event arrives or a schedule fires. Every execution should produce durable run state, logs, retry metadata, and an auditable relationship to the triggering event.

## Non-Goals For V1

- No required local Docker Postgres or laptop-hosted durable runtime.
- No full multi-user account system; v1 uses a single bearer token.
- No full schedule reconciliation loop yet; v1 can create, update, pause/resume, and delete API-created EventBridge schedules, but it does not continuously diff every S3 config schedule against AWS.
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
- Agent definitions, prompt text, model provider/model selection, resolver config, output targets, and default schedule definitions should live in account-scoped JSON config in S3, with a local file fallback for development/tests.
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

Implemented schedule management includes create, edit, pause/resume, delete, and manual trigger from the UI/API. Editing a schedule updates Postgres, account-scoped S3 config, and the matching EventBridge Scheduler resource when the schedule was created through the API.

### Agent Config

Prompt agents are configuration, not per-agent TypeScript files. The initial config source is a versioned S3 JSON document:

- `version`
- `account.id`
- `agents[]`
- `schedules[]`

Each agent config includes:

- `id`
- `slug`
- `name`
- `description`
- `enabled`
- `kind`
- `modelProvider`
- `model`
- `systemPrompt`
- `userPromptTemplate`
- `config`
- `output`
- `createdAt`
- `updatedAt`

For v1, the deployed stack writes runtime-created agents to `accounts/default/agents.json`. The runtime also supports looking up a token-derived account key before falling back to `default`, so future scoped API tokens can map to separate S3 config objects. CDK deploys the starter document under `seed/accounts/default/agents.json` so future deployments do not overwrite the account's runtime-edited config.

Implemented agent management includes listing, creation, detail inspection, prompt/config/output viewing, associated schedules, recent runs, and manual triggering. Agent update/delete is a near-term requirement, but not part of the current implemented API surface yet.

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
- Agent list.
- Agent creation form for data-driven prompt agents.
- Schedule creation form for agent cron schedules.
- Agent detail panel.
- Schedule detail panel with edit, pause/resume, run-now, and delete actions.
- Run list.
- Run detail and logs.
- Manual trigger action.
- Retry and cancel actions.
- Worker health summary when available.

Operational UI pattern: the three top swim lanes should remain scannable lists. Rows should expose compact primary actions such as `Details` or `Run now`; destructive or multi-step management actions should live in the selected detail panel. Only one detail panel should be visible at a time. Status colors should be consistent across list rows: green for enabled/succeeded, yellow for paused/disabled or waiting states, blue for running, and red for failed/deleted/destructive states.

### API

Initial API:

- `GET /api/health`
- `POST /api/events`
- `GET /api/agents`
- `GET /api/agents/:id`
- `POST /api/agents`
- Future: `PATCH /api/agents/:id`
- Future: `DELETE /api/agents/:id`
- `POST /api/agents/:id/trigger`
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
- Schedule create/edit/pause/resume/delete flows update durable state and account-scoped config, and reconcile API-created EventBridge Scheduler resources in hosted mode.
- The default prompt agent and its stock universe are loaded from `config/accounts/default/agents.json`, not from stock-specific TypeScript modules.
- The docs clearly state that cloud runtime is required for durable operation.
- The architecture cleanly separates control-plane APIs, trigger adapters, queue adapters, worker execution, and persistence.

## Open Questions

- Which first real personal automation workflow should drive the first cloud integration?
- Should hosted API/UI live behind an Application Load Balancer, API Gateway, or another ingress?
- Should the first infrastructure implementation use Terraform, AWS CDK, Pulumi, or documented manual setup?
- How much sandboxing should be inside the worker process versus delegated to per-run ECS tasks?
