#!/usr/bin/env ts-node

import {
  SecretsManagerClient,
  CreateSecretCommand,
  DescribeSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import walletConfigs from "../secrets/wallet-secrets.json";

async function createSecret(
  client: SecretsManagerClient,
  chain: string,
  privateKey: string,
) {
  const name = `hyperlane/${chain}/wallet`;

  try {
    // Check if secret already exists
    await client.send(new DescribeSecretCommand({ SecretId: name }));
    console.log(`✓ Secret ${name} already exists, skipping`);
    return;
  } catch (error: any) {
    if (error.name !== "ResourceNotFoundException") {
      throw error;
    }
  }

  const response = await client.send(
    new CreateSecretCommand({
      Name: name,
      SecretString: privateKey,
    }),
  );

  console.log(`✓ Created secret: ${name} (ARN: ${response.ARN})`);
}

async function deployWalletSecrets(
  client: SecretsManagerClient,
  network: "mainnet" | "testnet",
) {
  const config = walletConfigs[network];

  for (const [chain, privateKey] of Object.entries(config)) {
    try {
      await createSecret(client, chain, privateKey);
    } catch (error) {
      console.error(
        `✗ Failed to create secret for chain ${chain} on network ${network}:`,
        error,
      );
    }
  }
}

async function main() {
  const client = new SecretsManagerClient({});

  const network = process.argv[2];

  if (!network || (network !== "mainnet" && network !== "testnet")) {
    console.error(
      "Usage: ts-node scripts/create-wallet-secrets.ts <network>\n<network> must be 'mainnet' or 'testnet'",
    );
    process.exit(1);
  }

  console.log(`Deploying in AWS region: ${await client.config.region()}`);

  await deployWalletSecrets(client, network);
}

main().catch((error) => {
  console.error("Error deploying wallet secrets:", error);
  process.exit(1);
});
