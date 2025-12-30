#!/usr/bin/env node

import * as cdk from "aws-cdk-lib/core";
import { BaseAccountStack } from "../lib/base-account-stack";
import { SignatureStack } from "../lib/signature-stack";
import { CF_PREFIX } from "../lib/constants";
import {
  HYPERLANE_ACCOUNTS,
  getNetworkType,
  accountsForNetwork,
  ECR_ENV,
  CORE_ACCOUNTS,
  normalizeAccountName,
} from "../configs/accounts";
import { EcrStack } from "../lib/ecr-stack";

function capitalize(str: string): string {
  const s = str.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const app = new cdk.App();
const region = process.env.AWS_REGION || "us-east-1";

// Deploy ECR repository in central production account
const ecr = new EcrStack(app, `${CF_PREFIX}-EcrStack`, {
  env: ECR_ENV,
});

const signatureBuckets: SignatureStack[] = [];

// Deploy validator signature buckets
for (const account of CORE_ACCOUNTS) {
  const network = getNetworkType(account);
  // Allow other accounts on this network to access s3 signatures bucket
  const trustedAccountIds = accountsForNetwork(network)
    .filter((a) => a.id !== account.id)
    .map((a) => a.id);
  const stack = new SignatureStack(
    app,
    `${CF_PREFIX}-SignatureStack-${capitalize(network)}`,
    {
      env: {
        account: account.id,
        region,
      },
      trustedAccountIds,
    },
  );

  signatureBuckets.push(stack);
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
    `${CF_PREFIX}-BaseInfra-${capitalize(network)}-${accountName}`,
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

// Create all validator keys
// This is done as a separate stack so we can create the keys before starting the agents
// We need to create the keys, announce the validator on chain, then deploy the validator
