# AWS Infrastructure Notes

This project is cloud-only for durable runtime. Do not require local Docker Postgres for normal operation.

## V1 Target

- ECS/Fargate service for the API and minimal UI.
- ECS/Fargate service for workers.
- RDS PostgreSQL for schedules, events, runs, logs, and worker heartbeats.
- SQS standard queue per worker capability, each with a dead-letter queue.
- EventBridge Scheduler for cron/rate/one-time schedule delivery.
- Secrets Manager or SSM Parameter Store for API token, database credentials, provider credentials, and worker secrets.
- CloudWatch Logs for API and worker logs.

## Later Targets

- Aurora Serverless v2 when workload variability or tenant growth justifies it.
- EKS worker backend when Kubernetes learning and workload diversity justify cluster operations.
- SNS/EventBridge bus fanout for multi-consumer events.
- API Gateway if the public API needs managed ingress features beyond an ALB.

