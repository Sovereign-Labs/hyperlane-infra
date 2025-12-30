#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { AgentStack, AgentType } from "../lib/agent-stack";
import { HYPERLANE_ACCOUNTS, isCoreAccount } from "../configs/accounts";

const app = new cdk.App();

/**
 * Test Relayer Deployment
 *
 * Deploys a single relayer agent to test the AgentStack auto-discovery.
 *
 * Prerequisites:
 * 1. BaseAccountStack must be deployed to the target account
 * 2. StorageStack must be deployed (for ECR and S3 bucket)
 * 3. Hyperlane agent image must be pushed to ECR
 *
 * Usage:
 *   cdk deploy -a "npx ts-node bin/test-relayer.ts" TestRelayer
 */

const region = process.env.AWS_REGION || "ap-southeast-2";

// Find the first core account for testing
const coreAccount = HYPERLANE_ACCOUNTS.find((acc) => isCoreAccount(acc));

if (!coreAccount) {
  throw new Error(
    "No core account found in HYPERLANE_ACCOUNTS. Please add a core account to configs/accounts.ts",
  );
}

new AgentStack(app, "TestRelayer", {
  env: {
    account: coreAccount.id,
    region,
  },
  uniqueId: "relayer-test-1",
  agentType: AgentType.Relayer,
  ecrRepositoryUri: `${coreAccount.id}.dkr.ecr.${region}.amazonaws.com/hyperlane-agents`,
  bucketArn: `arn:aws:s3:::hyperlane-${coreAccount.name.toLowerCase()}-signatures`,
  environment: {
    HYP_RELAYCHAINS: "sovstarter,ethtest",
  },
});
