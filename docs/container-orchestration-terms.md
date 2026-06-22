# Container Orchestration Terms

This project uses Docker images, ECS/Fargate tasks, and eventually may explore Kubernetes. These are the working analogies.

## Docker Terms

- **Image:** packaged filesystem plus metadata for how to run an app. Example: the Event Agent API image.
- **Container:** a running instance of an image. Example: one running API process from that image.
- **Docker Engine / Docker daemon:** the local service that starts and stops containers on a machine.
- **Docker Compose:** local multi-container runner: run API, DB, and worker with these env vars and networks.

## Kubernetes Terms

- **Image:** same concept. Kubernetes pulls Docker/OCI images.
- **Container:** same concept, but usually managed inside a Pod.
- **Pod:** the smallest Kubernetes deployable unit. Usually one main container, sometimes sidecars. Rough analogy: one or more containers that share network, storage, and lifecycle.
- **Deployment:** says “keep N replicas of this Pod running.” Rough analogy: long-running service manager.
- **Service:** stable internal network name/load balancer for Pods.
- **Ingress:** HTTP routing from outside the cluster into Services.
- **Node:** machine/VM where Pods run.
- **Cluster:** group of nodes plus Kubernetes control plane.
- **Control plane:** Kubernetes brain/scheduler/API server. In EKS, AWS manages much of this.
- **Helm chart / manifest:** config files that define Kubernetes resources.

## ECS/Fargate Terms

- **Image:** same OCI/Docker image.
- **Task Definition:** ECS’s recipe for running one or more containers. Closest analogy: Kubernetes Pod spec, or a Compose service definition. Defines image, CPU, memory, env vars, secrets, ports, command, and logs.
- **Task:** a running copy of a task definition. Closest analogy: Kubernetes Pod. Docker analogy: one running container group.
- **Service:** says “keep N tasks running.” Closest analogy: Kubernetes Deployment.
- **Cluster:** logical ECS grouping for services/tasks. With Fargate, this is mostly an organizational/control-plane concept; you are not managing servers.
- **Launch type: Fargate:** AWS runs the underlying compute for the task. No EC2 instance management.
- **Launch type: EC2:** ECS schedules tasks onto EC2 instances you own/manage.
- **Target Group:** ALB’s list of healthy task IPs to send traffic to.
- **ALB Listener:** public HTTP/HTTPS port/rule.
- **ECR:** AWS image registry. Docker Hub analogy, but AWS-native.

## Analogy Table

| Concept | Docker | Kubernetes | ECS/Fargate |
|---|---|---|---|
| Packaged app | Image | Image | Image in ECR |
| Running app instance | Container | Pod/container | Task/container |
| Run recipe | `docker run` args / Compose service | Pod spec | Task definition |
| Keep N running | Compose-ish locally, manual/restart policy | Deployment | ECS Service |
| Public HTTP routing | Port publish / reverse proxy | Ingress + Service | ALB + Target Group |
| Private service routing | Docker network DNS | Service DNS | Cloud Map or service discovery |
| Machine running containers | Your Docker host | Node | Hidden with Fargate, EC2 if ECS-on-EC2 |
| Orchestrator | Docker Compose-ish | Kubernetes control plane | ECS control plane |
| Registry | Docker Hub | Any OCI registry | ECR |

## Event Agent Stack Mapping

- `Dockerfile`: defines the image.
- CDK `DockerImageAsset`: builds the image and uploads it to ECR during deploy.
- `FargateTaskDefinition`: says how to run that image.
- API `ApplicationLoadBalancedFargateService`: keeps one API task running and attaches an ALB.
- Worker `FargateService`: keeps one worker task running.
- ECS Cluster: the logical home for both services.
- ALB: public entrypoint for API traffic.
- SQS: work queue the worker will consume.
- RDS: durable app state.

Good mental model: Fargate is like asking AWS to run Docker containers for you without showing you the Docker host. ECS is the scheduler/API that tells Fargate what containers to run and how many.

