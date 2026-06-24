# Event Agent

Event Agent is a cloud-hosted, event-driven agent platform. Instead of running a continuously reasoning assistant loop, it accepts scheduled or triggered events, persists run state, routes work through queues, and executes agent jobs in worker pools with logs, retries, timeouts, and auditability.

The first target architecture is AWS ECS/Fargate, Amazon RDS PostgreSQL, SQS, and EventBridge Scheduler. The laptop is only a development/deployment machine; durable runtime state and execution should live in the cloud.

## Current Status

This repo is an initial scaffold. It includes:

- Living project docs.
- A TypeScript API/control-plane skeleton.
- A TypeScript worker skeleton.
- Shared event, schedule, run, and worker types.
- S3/local JSON configuration for data-driven prompt agents.
- A minimal browser UI shell.
- Verification scripts that run without provisioning AWS resources.
- Infrastructure notes for the AWS-first deployment path.

## Run Locally

Install dependencies:

```sh
npm install
```

Run the API skeleton:

```sh
npm run dev:api
```

Run the worker skeleton:

```sh
npm run dev:worker
```

Run the UI shell:

```sh
npm run dev:ui
```

Local runs use mock/in-memory behavior unless cloud environment variables are provided. They are not a durable runtime.

## Verify

```sh
npm run check
npm run test
npm run smoke
```

`npm run smoke` starts the API on a temporary port, checks health, verifies bearer-token enforcement, seeds the example prompt agent, creates an in-memory schedule, triggers a run, and confirms run listing works.

## Configuration

Core environment variables:

- `EVENT_AGENT_AUTH_TOKEN`: bearer token required for API access.
- `EVENT_AGENT_PORT`: API port, default `5180`.
- `EVENT_AGENT_AWS_REGION`: AWS region for hosted adapters.
- `EVENT_AGENT_DATABASE_URL`: RDS PostgreSQL connection string.
- `EVENT_AGENT_DATABASE_HOST`, `EVENT_AGENT_DATABASE_PORT`, `EVENT_AGENT_DATABASE_NAME`, `EVENT_AGENT_DATABASE_USER`, `EVENT_AGENT_DATABASE_PASSWORD`: split RDS connection settings used by ECS secrets.
- `EVENT_AGENT_DEFAULT_QUEUE_URL`: default SQS queue URL.
- `EVENT_AGENT_REPORTS_BUCKET`: S3 bucket for generated report artifacts.
- `EVENT_AGENT_CONFIG_BUCKET`: private S3 bucket containing account-scoped agent config documents.
- `EVENT_AGENT_CONFIG_PREFIX`: S3 prefix for account config, default `accounts`.
- `EVENT_AGENT_CONFIG_ACCOUNT_ID`: account config id to load. The deployed dev stack uses `default`; future scoped tokens can map to token-specific account ids.
- `EVENT_AGENT_LOCAL_CONFIG_PATH`: local fallback config document path, default `config/accounts/default/agents.json`.
- `OPENAI_API_KEY`: direct OpenAI API key. Hosted OpenAI-backed agents fail clearly if this is unset or still `replace-me`; deterministic model output is only used by tests or explicit local dependency injection.
- `EVENT_AGENT_EVENT_BUS_NAME`: optional EventBridge bus name for future fanout.

## Infrastructure

The repo uses AWS CDK as a typed wrapper around CloudFormation:

```sh
npx cdk bootstrap
npm run infra:synth
npm run infra:diff
npm run infra:deploy
```

The initial stack defines VPC networking, RDS PostgreSQL, SQS default/DLQ queues, S3 reports and agent-config buckets, ECS/Fargate API and worker services, generated API/database secrets, an OpenAI API key secret placeholder, CloudWatch logs, and an EventBridge Scheduler group/role with a daily stock-report schedule. Deploying it creates billable AWS resources. `npx cdk bootstrap` is required once per AWS account/region before the first asset-based deployment.

Cloud integration tests will require explicit opt-in variables before they touch AWS resources.

## Architecture

The intended flow is:

1. A schedule, API request, webhook, or internal event creates an `EventEnvelope`.
2. The control plane writes durable event/run records.
3. The control plane publishes an executable job to a queue selected by required worker capability.
4. A worker leases the job, resolves prompt-agent inputs, calls the configured model provider, writes artifacts to S3, streams logs, and updates run status.
5. Failed jobs retry according to policy and eventually move to dead-letter state.

Agents are data, not per-agent TypeScript modules. The daily stock example lives in `config/accounts/default/agents.json`, which the CDK stack deploys into the private config bucket under `seed/accounts/default/agents.json`. Runtime-created agents are written to account config such as `accounts/default/agents.json` through the API/UI. The document contains prompt text, input resolver config, model provider/model, schedules, and S3 output settings. TypeScript code supplies reusable execution primitives such as SQS polling, input resolution, model-provider adapters, and artifact writing.

See [project_spec.md](project_spec.md) and [project_design.md](project_design.md) for the living product and architecture docs.

## GitHub

The intended remote is:

```sh
https://github.com/NTitterton/event-agent
```
