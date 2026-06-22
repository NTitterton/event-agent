# AGENTS.md

## Project

Event Agent is a cloud-hosted, event-driven agent platform. It should run scheduled, API-triggered, internal, and eventually webhook-triggered agent jobs without depending on a continuously running local laptop process. Durable state, schedules, queues, workers, logs, retries, and secrets belong in cloud services.

## Operating Rules

- Read the current worktree before making assumptions. Treat local files and command output as authoritative.
- Keep changes scoped to the active Event Agent request.
- Do not overwrite or revert user changes unless explicitly asked.
- Preserve unrelated local files and dirty worktree changes.
- Prefer existing repo patterns over new abstractions.
- Use `rg` or `rg --files` for search.
- Use `apply_patch` for manual file edits.

## Project Documentation

- Update `project_spec.md` when requirements, product behavior, data model fields, APIs, acceptance criteria, or open questions change.
- Update `project_design.md` when architecture, hosting decisions, worker contracts, queue semantics, diagrams, security model, or implementation tradeoffs change.
- Keep README commands and environment variable lists current.
- If a user gives product requirements in chat, capture them in the relevant project doc before they fade into conversation history.

## Git And GitHub

- Commit after meaningful, coherent checkpoints.
- Push to GitHub after passing verification or before a context pause.
- Keep commits focused and descriptive.
- Do not stage unrelated changes outside this repo.
- The intended GitHub remote is `https://github.com/NTitterton/event-agent`.

## Verification

- Run `npm run check` after TypeScript changes.
- Run `npm run smoke` after API, event, queue, worker, auth, config, or cloud adapter behavior changes.
- Run `npm run test` when adding or changing testable logic.
- Cloud integration tests must be opt-in and gated by explicit environment variables so normal checks do not provision or mutate AWS resources.

## Local Runtime

- This project is cloud-only for durable runtime. Do not add local Docker Postgres as a required path.
- Local development may run the API, worker, and UI against mocked adapters or explicitly configured cloud development resources.
- Secrets should come from environment variables locally and AWS Secrets Manager or SSM Parameter Store in hosted environments.

## Cloud Direction

- Default cloud: AWS.
- Default hosted database: Amazon RDS PostgreSQL.
- Default event/schedule layer: EventBridge Scheduler.
- Default queue layer: SQS with dead-letter queues.
- Default worker pool: ECS/Fargate.
- EKS/Kubernetes is a future worker backend after the job contract and Fargate deployment are stable.

