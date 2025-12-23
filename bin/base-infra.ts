#!/usr/bin/env node

import * as cdk from "aws-cdk-lib/core";
import { BaseAccountStack } from "../lib/base-account-stack";
import { StorageStack } from "../lib/storage-stack";
import {
  HYPERLANE_ACCOUNTS,
  isCoreAccount,
  getNetworkType,
  accountsForNetwork,
} from "../configs/accounts";

const app = new cdk.App();

const region = process.env.AWS_REGION || "us-east-1";

for (const account of HYPERLANE_ACCOUNTS) {
  // Deploy base infrastructure to each account
  // Includes VPC, ECS Cluster, EFS, etc used by all hyperlane agents in this account
  new BaseAccountStack(app, `BaseInfra-${account.name}`, {
    env: {
      account: account.id,
      region,
    },
    accountName: account.name.toLowerCase(),
    maxAzs: 2,
    natGateways: 1,
    enableVpcEndpoints: true,
    createEfs: true,
  });

  // Deploy ECR/S3 to core account
  if (isCoreAccount(account)) {
    const network = getNetworkType(account);
    // Allow other accounts on this network to access s3 signatures bucket
    const trustedAccountIds = accountsForNetwork(network)
      .filter((a) => a.id !== account.id)
      .map((a) => a.id);

    new StorageStack(app, `StorageStack-${account.name}`, {
      env: {
        account: account.id,
        region,
      },
      accountName: account.name.toLowerCase(),
      trustedAccountIds,
    });
  }
}
