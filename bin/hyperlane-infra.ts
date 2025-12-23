#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { StorageStack } from "../lib/storage-stack";
import { NetworkStack } from "../lib/network-stack";
import { CICDStack } from "../lib/cicd-stack";
import { AgentStack, AgentType } from "../lib/agent-stack";

const app = new cdk.App();

// Deploy the CI/CD stack (GitHub Actions OIDC)
// new CICDStack(app, "HyperlaneCICDStack", {
//   env: {
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//     region: process.env.CDK_DEFAULT_REGION,
//   },
//   githubRepos: "your-org/your-repo", // TODO: Update with your GitHub org/repo
//   ecrRepositoryArn: storageStack.repository.repositoryArn,
// });

// ============================================================================
// SAME-ACCOUNT DEPLOYMENT (agents in same account as storage)
// ============================================================================
//
// Deploy agent stacks (uncomment when ready to deploy)
//
// Example: Relayer
// new AgentStack(app, "HyperlaneRelayerStack", {
//   env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
//   uniqueId: "relayer-ethereum-polygon",
//   agentType: AgentType.RELAYER,
//   ecrRepositoryUri: storageStack.repository.repositoryUri,
//   bucket: storageStack.bucket,  // Same-account bucket reference
//   vpc: networkStack.vpc,
//   environment: {
//     HYP_CHAINS: 'ethereum,polygon',
//     HYP_RELAYCHAINS: 'ethereum,polygon',
//   },
// });
//
// Example: Validator
// new AgentStack(app, "HyperlaneValidatorStack", {
//   env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
//   uniqueId: "validator-ethereum-1",
//   agentType: AgentType.VALIDATOR,
//   ecrRepositoryUri: storageStack.repository.repositoryUri,
//   bucket: storageStack.bucket,  // Same-account bucket reference
//   vpc: networkStack.vpc,
//   environment: {
//     HYP_ORIGINCHAINNAME: 'ethereum',
//     HYP_VALIDATOR_INTERVAL: '5',
//   },
// });

// ============================================================================
// CROSS-ACCOUNT DEPLOYMENT (agents in customer account, storage in main account)
// ============================================================================
//
// Prerequisites:
// 1. Deploy storage stack in main account with trustedAccountIds
// 2. Note the ECR URI and S3 bucket ARN from outputs
// 3. Deploy network stack in customer account
// 4. Deploy agent stacks in customer account using cross-account references
//
// Example: Validator in customer account
// new AgentStack(app, "CustomerValidatorStack", {
//   env: { account: '123456789012', region: 'ap-southeast-2' },  // Customer account
//   uniqueId: "validator-ethereum-customer1",
//   agentType: AgentType.VALIDATOR,
//   // Cross-account ECR reference (from main account)
//   ecrRepositoryUri: '590183691025.dkr.ecr.ap-southeast-2.amazonaws.com/hyperlane-agents',
//   // Cross-account S3 bucket ARN (from main account)
//   bucketArn: 'arn:aws:s3:::hyperlaneagentsbucket-xyz',  // Get from storage stack outputs
//   vpc: customerNetworkStack.vpc,  // Customer's VPC
//   environment: {
//     HYP_ORIGINCHAINNAME: 'ethereum',
//     HYP_VALIDATOR_INTERVAL: '5',
//   },
// });
//
// See CROSS_ACCOUNT_SETUP.md for complete cross-account deployment guide
