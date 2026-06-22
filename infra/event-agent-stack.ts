import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface EventAgentStackProps extends StackProps {
  projectName: string;
  environmentName: string;
}

export class EventAgentStack extends Stack {
  constructor(scope: Construct, id: string, props: EventAgentStackProps) {
    super(scope, id, props);

    const name = `${props.projectName}-${props.environmentName}`;

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
        }
      ]
    });

    const authToken = new secretsmanager.Secret(this, "ApiAuthToken", {
      secretName: `${name}/api-auth-token`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 48
      }
    });

    const dbCredentials = new secretsmanager.Secret(this, "DatabaseCredentials", {
      secretName: `${name}/database-credentials`,
      generateSecretString: {
        excludeCharacters: "\"@/\\",
        generateStringKey: "password",
        passwordLength: 32,
        secretStringTemplate: JSON.stringify({ username: "event_agent" })
      }
    });

    const apiSecurityGroup = new ec2.SecurityGroup(this, "ApiSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Event Agent API service"
    });

    const workerSecurityGroup = new ec2.SecurityGroup(this, "WorkerSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Event Agent worker service"
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "Event Agent PostgreSQL database"
    });
    dbSecurityGroup.addIngressRule(apiSecurityGroup, ec2.Port.tcp(5432), "API access to Postgres");
    dbSecurityGroup.addIngressRule(workerSecurityGroup, ec2.Port.tcp(5432), "Worker access to Postgres");

    const database = new rds.DatabaseInstance(this, "Database", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_13
      }),
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: "event_agent",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      multiAz: false,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const deadLetterQueue = new sqs.Queue(this, "DefaultDeadLetterQueue", {
      queueName: `${name}-default-dlq`,
      retentionPeriod: Duration.days(14)
    });

    const defaultQueue = new sqs.Queue(this, "DefaultQueue", {
      queueName: `${name}-default`,
      visibilityTimeout: Duration.minutes(15),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 5
      }
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: name,
      containerInsightsV2: ecs.ContainerInsights.ENABLED
    });

    const image = new ecrAssets.DockerImageAsset(this, "AppImage", {
      directory: "."
    });

    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: `/aws/ecs/${name}/api`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const databaseEnvironment = {
      EVENT_AGENT_DATABASE_HOST: database.dbInstanceEndpointAddress,
      EVENT_AGENT_DATABASE_PORT: "5432",
      EVENT_AGENT_DATABASE_NAME: "event_agent",
      EVENT_AGENT_DATABASE_USER: "event_agent"
    };

    const apiService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "ApiService", {
      cluster,
      serviceName: `${name}-api`,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      publicLoadBalancer: true,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [apiSecurityGroup],
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(image),
        containerPort: 5180,
        environment: {
          EVENT_AGENT_PORT: "5180",
          EVENT_AGENT_HOST: "0.0.0.0",
          EVENT_AGENT_AWS_REGION: Stack.of(this).region,
          EVENT_AGENT_DEFAULT_QUEUE_URL: defaultQueue.queueUrl,
          ...databaseEnvironment
        },
        secrets: {
          EVENT_AGENT_AUTH_TOKEN: ecs.Secret.fromSecretsManager(authToken),
          EVENT_AGENT_DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password")
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: "api",
          logGroup: apiLogGroup
        })
      }
    });
    apiService.targetGroup.configureHealthCheck({
      path: "/api/health",
      healthyHttpCodes: "200"
    });

    const workerLogGroup = new logs.LogGroup(this, "WorkerLogGroup", {
      logGroupName: `/aws/ecs/${name}/worker`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const workerTask = new ecs.FargateTaskDefinition(this, "WorkerTask", {
      cpu: 512,
      memoryLimitMiB: 1024
    });
    workerTask.addContainer("worker", {
      image: ecs.ContainerImage.fromDockerImageAsset(image),
      command: ["node", "--import", "tsx", "src/worker/index.ts"],
      environment: {
        EVENT_AGENT_AWS_REGION: Stack.of(this).region,
        EVENT_AGENT_DEFAULT_QUEUE_URL: defaultQueue.queueUrl,
        ...databaseEnvironment
      },
      secrets: {
        EVENT_AGENT_AUTH_TOKEN: ecs.Secret.fromSecretsManager(authToken),
        EVENT_AGENT_DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password")
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "worker",
        logGroup: workerLogGroup
      })
    });

    const workerService = new ecs.FargateService(this, "WorkerService", {
      cluster,
      serviceName: `${name}-worker`,
      taskDefinition: workerTask,
      desiredCount: 1,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [workerSecurityGroup]
    });

    defaultQueue.grantConsumeMessages(workerTask.taskRole);
    defaultQueue.grantSendMessages(apiService.taskDefinition.taskRole);
    database.secret?.grantRead(apiService.taskDefinition.taskRole);
    database.secret?.grantRead(workerTask.taskRole);
    authToken.grantRead(apiService.taskDefinition.taskRole);
    authToken.grantRead(workerTask.taskRole);

    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com")
    });
    defaultQueue.grantSendMessages(schedulerRole);

    new scheduler.CfnScheduleGroup(this, "ScheduleGroup", {
      name
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `http://${apiService.loadBalancer.loadBalancerDnsName}`
    });
    new cdk.CfnOutput(this, "DefaultQueueUrl", {
      value: defaultQueue.queueUrl
    });
    new cdk.CfnOutput(this, "DeadLetterQueueUrl", {
      value: deadLetterQueue.queueUrl
    });
    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: database.dbInstanceEndpointAddress
    });
    new cdk.CfnOutput(this, "SchedulerRoleArn", {
      value: schedulerRole.roleArn
    });
    new cdk.CfnOutput(this, "ScheduleGroupName", {
      value: name
    });

    workerService.node.addDependency(database);
    apiService.node.addDependency(database);
  }
}
