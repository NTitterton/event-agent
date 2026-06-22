# Event Agent

Event Agent is a cloud-hosted, event-driven agent platform. Instead of running a continuously reasoning assistant loop, it accepts scheduled or triggered events, persists run state, routes work through queues, and executes agent jobs in worker pools with logs, retries, timeouts, and auditability.

The first target architecture is AWS ECS/Fargate, Amazon RDS PostgreSQL, SQS, and EventBridge Scheduler. The laptop is only a development/deployment machine; durable runtime state and execution should live in the cloud.

## Current Status

This repo is an initial scaffold. It includes:

- Living project docs.
- A TypeScript API/control-plane skeleton.
- A TypeScript worker skeleton.
- Shared event, schedule, run, and worker types.
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

`npm run smoke` starts the API on a temporary port, checks health, verifies bearer-token enforcement, creates an in-memory schedule, triggers a run, and confirms run listing works.

## Configuration

Core environment variables:

- `EVENT_AGENT_AUTH_TOKEN`: bearer token required for API access.
- `EVENT_AGENT_PORT`: API port, default `5180`.
- `EVENT_AGENT_AWS_REGION`: AWS region for hosted adapters.
- `EVENT_AGENT_DATABASE_URL`: RDS PostgreSQL connection string.
- `EVENT_AGENT_DATABASE_HOST`, `EVENT_AGENT_DATABASE_PORT`, `EVENT_AGENT_DATABASE_NAME`, `EVENT_AGENT_DATABASE_USER`, `EVENT_AGENT_DATABASE_PASSWORD`: split RDS connection settings used by ECS secrets.
- `EVENT_AGENT_DEFAULT_QUEUE_URL`: default SQS queue URL.
- `EVENT_AGENT_EVENT_BUS_NAME`: optional EventBridge bus name for future fanout.

## Infrastructure

The repo uses AWS CDK as a typed wrapper around CloudFormation:

```sh
npx cdk bootstrap
npm run infra:synth
npm run infra:diff
npm run infra:deploy
```

The initial stack defines VPC networking, RDS PostgreSQL, SQS default/DLQ queues, ECS/Fargate API and worker services, generated API/database secrets, CloudWatch logs, and an EventBridge Scheduler group/role. Deploying it creates billable AWS resources. `npx cdk bootstrap` is required once per AWS account/region before the first asset-based deployment.

Cloud integration tests will require explicit opt-in variables before they touch AWS resources.

## Architecture

The intended flow is:

1. A schedule, API request, webhook, or internal event creates an `EventEnvelope`.
2. The control plane writes durable event/run records.
3. The control plane publishes an executable job to a queue selected by required worker capability.
4. A worker leases the job, executes it in a constrained context, streams logs, and updates run status.
5. Failed jobs retry according to policy and eventually move to dead-letter state.

See [project_spec.md](project_spec.md) and [project_design.md](project_design.md) for the living product and architecture docs.

## GitHub

The intended remote is:

```sh
https://github.com/NTitterton/event-agent
```
