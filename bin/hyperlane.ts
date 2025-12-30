#!/usr/bin/env node

import * as cdk from "aws-cdk-lib/core";
import { BaseAccountStack } from "../lib/base-account-stack";
import { AgentStack, AgentType } from "../lib/agent-stack";
import { SignatureStack } from "../lib/signature-stack";
import {
  HYPERLANE_ACCOUNTS,
  getNetworkType,
  accountsForNetwork,
  ECR_ENV,
  CORE_ACCOUNTS,
  normalizeAccountName,
  getAccountById,
} from "../configs/accounts";
import { relayerConfigs } from "../configs/agents";
import { EcrStack } from "../lib/ecr-stack";

function capitalize(str: string): string {
  const s = str.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// So we can have consistent stack ids
function id(purpose: string, network?: string, accountName?: string): string {
  let id = `Hyperlane-${purpose}`;

  if (network) {
    id += `-${capitalize(network)}`;
  }

  if (accountName) {
    id += `-${accountName}`;
  }

  return id;
}

const app = new cdk.App();
const region = process.env.AWS_REGION || "us-east-1";

// Deploy ECR repository in central production account
const ecr = new EcrStack(app, id("EcrStack"), {
  env: ECR_ENV,
});

const signatureBuckets: { [network: string]: SignatureStack } = {};

// Deploy validator signature buckets
for (const account of CORE_ACCOUNTS) {
  const network = getNetworkType(account);
  // Allow other accounts on this network to access s3 signatures bucket
  const trustedAccountIds = accountsForNetwork(network)
    .filter((a) => a.id !== account.id)
    .map((a) => a.id);
  const stack = new SignatureStack(app, id("SignatureStack", network), {
    env: {
      account: account.id,
      region,
    },
    trustedAccountIds,
  });

  signatureBuckets[network] = stack;
}

const baseStacks: { [accountId: string]: BaseAccountStack } = {};

// Deploy base infrastructure to all hyperlane accounts
// Includes VPC, ECS Cluster, EFS, etc used by all hyperlane agents in this account
for (const account of HYPERLANE_ACCOUNTS) {
  const network = getNetworkType(account);
  const accountName = normalizeAccountName(account.name);

  // Deploy base infrastructure to each account
  // Includes VPC, ECS Cluster, EFS, etc used by all hyperlane agents in this account
  const stack = new BaseAccountStack(
    app,
    id("BaseInfra", network, accountName),
    {
      env: {
        account: account.id,
        region,
      },
      maxAzs: 2,
      natGateways: 1,
      enableVpcEndpoints: true,
    },
  );
  baseStacks[account.id] = stack;
}

// Deploy relayers
for (const relayer of relayerConfigs) {
  const account = getAccountById(relayer.accountId);
  const accountName = normalizeAccountName(account.name);
  const network = getNetworkType(account);
  const agentType = AgentType.Relayer;
  const baseStack = baseStacks[account.id];
  const bucket = signatureBuckets[network].bucket;

  new AgentStack(app, id(capitalize(agentType), network, accountName), {
    env: {
      account: account.id,
      region,
    },
    uniqueId: relayer.uniqueId,
    agentType,
    cluster: baseStack.cluster,
    fileSystem: baseStack.fileSystem,
    efsSecurityGroup: baseStack.efsSecurityGroup,
    repository: ecr.repository,
    bucket,
    environment: {
      HYP_RELAYCHAINS: relayer.chains.join(","),
    },
  });
}

// Create validator keys
// This is done as a separate stack so we can create the keys before starting the agents
// We need to create the keys, announce the validator on chain, then deploy the validator
//
// Deploy validator sets
