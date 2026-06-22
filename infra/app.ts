import * as cdk from "aws-cdk-lib";
import { EventAgentStack } from "./event-agent-stack.js";

const app = new cdk.App();
const projectName = app.node.tryGetContext("projectName") ?? "event-agent";
const environmentName = app.node.tryGetContext("environmentName") ?? "dev";

new EventAgentStack(app, "EventAgentDevStack", {
  projectName,
  environmentName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "us-west-2"
  }
});

