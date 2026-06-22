# Initial Cloud-Only Plan

Date: 2026-06-22

This is the preserved Plan Mode output that established the first project direction. Treat this file as an archived planning artifact. The living requirements and architecture docs are `project_spec.md` and `project_design.md`.

## Summary

Create `~/event-agent` as a public TypeScript/Node project for a cloud-hosted event-driven agent platform. It will not depend on local Docker, local Postgres, or laptop uptime. Local development can run the API/UI against cloud services, but all durable execution, schedules, queues, workers, and database state live in AWS.

The system will use a control plane for schedules/API triggers, durable cloud state, queue-backed worker pools, container-isolated job execution, run logs, retries, and a minimal operations UI.

## Key Changes

- Initialize `~/event-agent` as a git repo and create `https://github.com/NTitterton/event-agent` as a public GitHub remote.
- Add initial docs modeled after `~/agent-monitor`:
  - `AGENTS.md`: repo rules, verification commands, doc update expectations, git/GitHub workflow.
  - `README.md`: project purpose, cloud setup, commands, architecture summary.
  - `project_spec.md`: goals, non-goals, v1 requirements, APIs, data model, acceptance criteria.
  - `project_design.md`: AWS architecture, hosting tradeoffs, queue/worker design, safety model.
- Scaffold a TypeScript Node app:
  - Fastify API/control plane.
  - Minimal Vite browser UI for schedules, runs, logs, retries, and manual triggers.
  - Worker process package sharing the same job contract as cloud workers.
  - Infrastructure docs/scripts targeting AWS from the start.
- Use AWS-hosted Postgres as the only durable database:
  - Default: Amazon RDS PostgreSQL.
  - Later option: Aurora Serverless v2 if workload variability or multi-tenant scaling justifies it.
- Use AWS-managed event and queue services:
  - EventBridge Scheduler for cron/rate/one-time schedules.
  - SQS queues for executable jobs, queue-specific worker routing, retries, visibility timeouts, and dead-letter queues.
  - Optional SNS/EventBridge bus later for fanout and broader pub-sub.
- Use ECS/Fargate for the first worker pool:
  - API/control plane runs as a hosted service.
  - Workers run as Fargate services consuming SQS queues.
  - Each worker executes jobs with scoped env/secrets, timeouts, logs, and container isolation.
  - EKS/Kubernetes remains a future backend once the worker contract is stable.

## Public Interfaces

- Auth: single-user bearer token for v1 API and UI.
- Initial API:
  - `GET /api/health`
  - `POST /api/events` to enqueue external events.
  - `GET /api/schedules`, `POST /api/schedules`, `PATCH /api/schedules/:id`, `DELETE /api/schedules/:id`
  - `POST /api/schedules/:id/trigger`
  - `GET /api/runs`, `GET /api/runs/:id`
  - `POST /api/runs/:id/cancel`, `POST /api/runs/:id/retry`
- Core persisted types:
  - `Schedule`: id, name, cron/rate expression, timezone, enabled flag, event payload, queue/capability target.
  - `EventEnvelope`: id, source, type, subject, payload, dedupe key, created time.
  - `Run`: id, event id, schedule id when applicable, status, attempt, queue, worker id, timestamps, error summary.
  - `RunLog`: run id, timestamp, stream/type, message, metadata.
  - `WorkerHeartbeat`: worker id, queues, capabilities, lease count, last seen.
- Job semantics:
  - At-least-once execution.
  - Idempotency via event/run dedupe keys.
  - SQS visibility timeout plus application-level run leases.
  - Retry policy per job.
  - Dead-letter state after retry exhaustion.

## Hosting Direction

- Required cloud baseline: AWS ECS/Fargate + RDS PostgreSQL + SQS + EventBridge Scheduler.
- No local Docker Postgres. No local durable runtime assumptions.
- Local machine usage is limited to editing code, running tests that can target mocks or cloud dev resources, and deploying infrastructure.
- Recommended environments:
  - `dev`: cloud RDS/SQS/EventBridge/ECS resources for real testing.
  - `prod`: separate cloud resources once the first workflows matter.
- Secrets live in AWS Secrets Manager or SSM Parameter Store, not local config files.
- The minimal UI should be hosted with the API or as static assets behind the same authenticated service.

## Test Plan

- Add `npm run check` for TypeScript compile and static checks.
- Add unit tests using mocked AWS clients for schedule/event/queue logic.
- Add cloud integration smoke tests gated by env vars, covering:
  - Auth rejection.
  - Schedule CRUD.
  - EventBridge schedule creation/update/delete.
  - API event enqueue to SQS.
  - Worker consuming a test queue message.
  - Run success, timeout, retry, cancel, and dead-letter behavior.
  - RDS migration verification against the cloud dev database.
- Add minimal UI verification for schedules/runs loading and manual trigger submission.
- Add docs verification checklist in `AGENTS.md` requiring `project_spec.md` and `project_design.md` updates when behavior or architecture changes.

## Assumptions

- Stack: TypeScript Node.
- Repo visibility: public under `NTitterton/event-agent`.
- Product direction: personal cron-like agent tasks first, designed as a scalable agent platform.
- V1 includes cron, API triggers, internal events, and queue-targeted workers.
- Auth starts as single-user bearer token, not full multi-user accounts.
- AWS is the default cloud. RDS PostgreSQL is the default database. ECS/Fargate is the default worker pool.
- Kubernetes/EKS is documented as a future learning and scaling path, not required for v1.

