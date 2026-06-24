# Feature Backlog

This is the living list of features and platform work we want to consider after the first cloud-hosted prompt-agent milestone.

## Near-Term Product Features

- Agent detail view: show prompt, model provider, model, config, output target, schedules, recent runs, logs, and artifacts.
- [Partial] Agent editor: create data-driven prompt agents without adding TypeScript files. Update/delete remains pending.
- [Partial] S3 agent config editor/importer: API-created agents are persisted to account-scoped `agents.json`; full import/diff/rollback remains pending.
- [Done] Manual schedule trigger: queue an existing schedule from the UI with a `Run now` action.
- [Partial] Manual run form: trigger an agent immediately from the Agents list. Optional input overrides remain pending.
- [Done] Run detail page: show logs, status transitions, selected inputs, model metadata, and generated artifacts.
- [Done] Artifact browser: list S3 reports, preview markdown, and download artifacts through authenticated API routes.
- [Partial] Schedule editor: create agent schedules and manually trigger schedules from the UI. Pause/resume/delete/edit remain pending.
- [Done] Report links: show the generated `s3://...` key and optionally a short-lived presigned download URL.

## Agent And Model Runtime

- Provider adapters: add Anthropic, Gemini, and AWS Bedrock behind the existing model-provider interface.
- AWS-local model option: evaluate running local/open-weight models on AWS only when we have a workflow that justifies GPU or managed inference cost.
- [Done] Provider configuration source: store provider/model, prompt text, resolver config, schedules, and output settings in account-scoped S3 config instead of TypeScript files.
- Provider runtime options: support temperature/max tokens/defaults and secret references per agent.
- Input resolvers: add reusable resolvers for HTTP fetches, static lists, date/time, S3 objects, prior artifacts, and API-trigger payload fields.
- [Done] Static-list input resolver: move stock universe data into agent config and select entries with `static.random`.
- Tool permissions: define which tools/resolvers each agent may use.
- Prompt versioning: keep previous prompt/config versions and link each run to the exact version used.
- Multi-artifact output: allow agents to emit markdown, JSON, images, CSV, or arbitrary files.
- Structured output mode: let agents produce validated JSON plus optional human-readable reports.

## Execution And Reliability

- Real run leases: prevent duplicate workers from processing the same run concurrently.
- Retry policy model: store max attempts, backoff, timeout, and dead-letter behavior per agent or schedule.
- Cancellation: make queued/running jobs observe cancellation state.
- Worker heartbeat table: persist worker health, capabilities, queues, and last-seen timestamps.
- Queue routing: support named queues and capability-specific worker services.
- DLQ inspection: show dead-lettered messages/runs and provide replay tooling.
- Idempotency cleanup: make schedule dedupe keys stable by scheduled date/window rather than raw timestamp.
- Cloud integration tests: gated tests for RDS, SQS, S3, EventBridge Scheduler, and ECS task behavior.

## Security And Operations

- HTTPS on the ALB with ACM certificate and DNS.
- Token rotation workflow for the v1 bearer token.
- Move from single bearer token to scoped API keys or OIDC when multi-user access matters.
- Avoid browser `localStorage` for long-lived admin credentials once the UI handles sensitive operations.
- Secret management UI/docs: document how to set OpenAI/Anthropic/Gemini/Bedrock credentials safely.
- Audit log: record API actor, action, target, timestamp, and request metadata.
- Cost dashboard: estimate fixed monthly costs and recent variable costs from CloudWatch/AWS billing signals.
- Alarms: notify on failed runs, DLQ depth, worker crash loops, high API 5xx rate, and RDS/storage thresholds.
- Backups and restore drill: document and periodically test RDS and S3 artifact restore.

## Infrastructure And Hosting

- Separate `dev` and `prod` stacks with explicit naming and deployment commands.
- GitHub Actions CI for typecheck/tests/synth and optional manual deploy.
- CDK context/config for environment-specific sizing, schedules, and feature flags.
- [Partial] Schedule reconciliation: API-created agent schedules are created in EventBridge Scheduler. Full S3/database-to-EventBridge diffing remains pending.
- API Gateway alternative evaluation for lower fixed cost than ALB.
- ECS service autoscaling based on SQS queue depth.
- Per-run ECS tasks for stronger isolation when agents need heavier tools or risky operations.
- EKS/Kubernetes backend as a future learning/scaling path after the worker contract stabilizes.
- Aurora Serverless v2 evaluation if RDS fixed cost or scaling behavior becomes painful.

## Developer Experience

- Local dev proxy for cloud API with token loading from AWS Secrets Manager.
- Seed scripts for agents/schedules separate from API startup.
- Migration system instead of app-startup `create table if not exists`.
- Typed API client for UI and scripts.
- Better fixture/test helpers for prompt agents, fake model providers, and fake artifact stores.
- Docs for adding a new prompt agent entirely as data.

## Current Example Agents

- Daily stock report: S3-configured prompt agent that picks a random stock from a static list in `accounts/default/agents.json` and writes a markdown report to S3.

## Candidate Future Agents

- Daily personal briefing from configured sources.
- Repository maintenance report across selected GitHub repos.
- Cloud cost summary and anomaly report.
- Calendar/email preparation brief, if scoped auth and provider integrations are added.
- Website or API health checker that produces incident-style summaries.
