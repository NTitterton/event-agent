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
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
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

    const openAiApiKey = new secretsmanager.Secret(this, "OpenAiApiKey", {
      secretName: `${name}/openai-api-key`,
      secretStringValue: cdk.SecretValue.unsafePlainText("replace-me")
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

    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com")
    });
    defaultQueue.grantSendMessages(schedulerRole);

    const reportsBucket = new s3.Bucket(this, "ReportsBucket", {
      bucketName: `${name}-reports-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          exposedHeaders: ["etag"],
          maxAge: 300
        }
      ],
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const configBucket = new s3.Bucket(this, "ConfigBucket", {
      bucketName: `${name}-config-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const defaultAgentConfigDeployment = new s3deploy.BucketDeployment(this, "DefaultAgentConfigDeployment", {
      sources: [s3deploy.Source.asset("config")],
      destinationBucket: configBucket,
      destinationKeyPrefix: "seed",
      prune: false
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: name,
      containerInsightsV2: ecs.ContainerInsights.ENABLED
    });

    const image = new ecrAssets.DockerImageAsset(this, "AppImage", {
      directory: ".",
      platform: ecrAssets.Platform.LINUX_AMD64
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
          EVENT_AGENT_DEFAULT_QUEUE_ARN: defaultQueue.queueArn,
          EVENT_AGENT_REPORTS_BUCKET: reportsBucket.bucketName,
          EVENT_AGENT_CONFIG_BUCKET: configBucket.bucketName,
          EVENT_AGENT_CONFIG_PREFIX: "accounts",
          EVENT_AGENT_CONFIG_ACCOUNT_ID: "default",
          EVENT_AGENT_SCHEDULER_GROUP_NAME: name,
          EVENT_AGENT_SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
          ...databaseEnvironment
        },
        secrets: {
          EVENT_AGENT_AUTH_TOKEN: ecs.Secret.fromSecretsManager(authToken),
          EVENT_AGENT_DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password"),
          OPENAI_API_KEY: ecs.Secret.fromSecretsManager(openAiApiKey)
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
        EVENT_AGENT_REPORTS_BUCKET: reportsBucket.bucketName,
        EVENT_AGENT_CONFIG_BUCKET: configBucket.bucketName,
        EVENT_AGENT_CONFIG_PREFIX: "accounts",
        EVENT_AGENT_CONFIG_ACCOUNT_ID: "default",
        ...databaseEnvironment
      },
      secrets: {
        EVENT_AGENT_AUTH_TOKEN: ecs.Secret.fromSecretsManager(authToken),
        EVENT_AGENT_DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentials, "password"),
        OPENAI_API_KEY: ecs.Secret.fromSecretsManager(openAiApiKey)
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
    apiService.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:GetSchedule"],
        resources: [`arn:${Stack.of(this).partition}:scheduler:${Stack.of(this).region}:${Stack.of(this).account}:schedule/${name}/*`]
      })
    );
    apiService.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [schedulerRole.roleArn],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "scheduler.amazonaws.com"
          }
        }
      })
    );
    reportsBucket.grantRead(apiService.taskDefinition.taskRole);
    reportsBucket.grantWrite(workerTask.taskRole);
    configBucket.grantReadWrite(apiService.taskDefinition.taskRole);
    configBucket.grantRead(workerTask.taskRole);
    database.secret?.grantRead(apiService.taskDefinition.taskRole);
    database.secret?.grantRead(workerTask.taskRole);
    authToken.grantRead(apiService.taskDefinition.taskRole);
    authToken.grantRead(workerTask.taskRole);
    openAiApiKey.grantRead(apiService.taskDefinition.taskRole);
    openAiApiKey.grantRead(workerTask.taskRole);

    const scheduleGroup = new scheduler.CfnScheduleGroup(this, "ScheduleGroup", {
      name
    });

    const dailyStockReportSchedule = new scheduler.CfnSchedule(this, "DailyStockReportSchedule", {
      name: "daily-stock-report",
      groupName: name,
      scheduleExpression: "cron(0 9 * * ? *)",
      scheduleExpressionTimezone: "America/Los_Angeles",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: defaultQueue.queueArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({
          kind: "agent.trigger",
          scheduleId: "sch_stock_report_daily",
          agentId: "agent_stock_report_daily",
          firedAt: "<aws.scheduler.scheduled-time>",
          dedupeKey: "sch_stock_report_daily:<aws.scheduler.scheduled-time>:agent_stock_report_daily"
        })
      },
      state: "ENABLED"
    });
    dailyStockReportSchedule.node.addDependency(scheduleGroup);

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `http://${apiService.loadBalancer.loadBalancerDnsName}`
    });
    new cdk.CfnOutput(this, "DefaultQueueUrl", {
      value: defaultQueue.queueUrl
    });
    new cdk.CfnOutput(this, "DeadLetterQueueUrl", {
      value: deadLetterQueue.queueUrl
    });
    new cdk.CfnOutput(this, "ReportsBucketName", {
      value: reportsBucket.bucketName
    });
    new cdk.CfnOutput(this, "ConfigBucketName", {
      value: configBucket.bucketName
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
    workerService.node.addDependency(defaultAgentConfigDeployment);
    apiService.node.addDependency(defaultAgentConfigDeployment);
  }
}
