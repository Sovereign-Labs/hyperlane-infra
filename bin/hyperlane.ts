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
  getTeamName,
  Account,
} from "../configs/accounts";
import { relayerConfigs, validatorSets } from "../configs/agents";
import { EcrStack } from "../lib/ecr-stack";
import { ValidatorKeyStack } from "../lib/validator-key-stack";

function capitalize(str: string): string {
  const s = str.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// So we can have consistent stack ids
function id(purpose: string, network?: string, ...parts: string[]): string {
  let id = `Hyperlane-${purpose}`;

  if (network) {
    id += `-${capitalize(network)}`;
  }

  for (const part of parts) {
    id += `-${part}`;
  }

  return id;
}

function applyAccountTags(stack: cdk.Stack, account: Account) {
  stack.addStackTag("Team", getTeamName(account));
  stack.addStackTag("Network", getNetworkType(account));
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
    network,
  });
  applyAccountTags(stack, account);

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
  applyAccountTags(stack, account);

  baseStacks[account.id] = stack;
}

// Deploy relayers
for (const relayer of relayerConfigs) {
  const account = getAccountById(relayer.accountId);
  const accountName = normalizeAccountName(account.name);
  const network = getNetworkType(account);
  const agentType = AgentType.Relayer;
  const { cluster, fileSystem, efsSecurityGroup } = baseStacks[account.id];
  const bucket = signatureBuckets[network].bucket;

  const stack = new AgentStack(
    app,
    id(capitalize(agentType), network, accountName),
    {
      env: {
        account: account.id,
        region,
      },
      uniqueId: relayer.uniqueId,
      agentType,
      cluster,
      fileSystem,
      efsSecurityGroup,
      repository: ecr.repository,
      bucket,
      environment: {
        HYP_RELAYCHAINS: relayer.chains.join(","),
      },
    },
  );

  stack.addStackTag("Agent", agentType);
  applyAccountTags(stack, account);
}

let validatorKeyStacks: { [accountId: string]: ValidatorKeyStack } = {};

const validatorAccounts = Object.groupBy(
  validatorSets.flat(),
  (v) => v.accountId,
);

// deploy validator keys
for (const [accountId, configs] of Object.entries(validatorAccounts)) {
  if (!configs) continue;

  const account = getAccountById(accountId);
  const accountName = normalizeAccountName(account.name);
  const network = getNetworkType(account);
  const keyConfs = configs.map((c) => ({
    alias: c.uniqueId,
    chain: c.chain,
  }));

  const stack = new ValidatorKeyStack(
    app,
    id("ValidatorKey", network, accountName),
    {
      env: {
        account: accountId,
        region,
      },
      configs: keyConfs,
    },
  );

  applyAccountTags(stack, account);
  validatorKeyStacks[accountId] = stack;
}

// deploy validator sets
for (const validatorSet of validatorSets) {
  for (const validator of validatorSet) {
    const { accountId, uniqueId, chain } = validator;
    const validatorKey = validatorKeyStacks[accountId]?.keys[uniqueId];
    const account = getAccountById(accountId);
    const network = getNetworkType(account);
    const agentType = AgentType.Validator;
    const { cluster, fileSystem, efsSecurityGroup } = baseStacks[account.id];
    const bucket = signatureBuckets[network].bucket;
    const stack = new AgentStack(
      app,
      id(capitalize(agentType), network, uniqueId),
      {
        env: {
          account: accountId,
          region,
        },
        uniqueId,
        agentType,
        cluster,
        fileSystem,
        efsSecurityGroup,
        repository: ecr.repository,
        bucket,
        validatorKey,
        environment: {
          HYP_ORIGINCHAINNAME: chain,
        },
      },
    );

    stack.addStackTag("Agent", agentType);
    stack.addStackTag("Chain", chain);
    applyAccountTags(stack, account);
  }
}
