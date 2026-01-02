import {
  KMSClient,
  ListAliasesCommand,
  GetPublicKeyCommand,
  DescribeKeyCommand,
} from "@aws-sdk/client-kms";

import { keccak256, getAddress } from "ethers";

async function getValidatorKeys() {
  const client = new KMSClient({});

  const response = await client.send(new ListAliasesCommand({}));

  const validatorAliases =
    response.Aliases?.filter((alias) =>
      alias.AliasName?.startsWith("alias/validator-"),
    ) || [];

  const keys = [];

  for (const alias of validatorAliases) {
    // Get key metadata
    const keyInfo = await client.send(
      new DescribeKeyCommand({ KeyId: alias.TargetKeyId }),
    );

    if (!keyInfo.KeyMetadata) {
      throw new Error(`No metadata found for key ID ${alias.TargetKeyId}`);
    }

    // Get public key
    const publicKeyResponse = await client.send(
      new GetPublicKeyCommand({ KeyId: alias.TargetKeyId }),
    );

    keys.push({
      alias: alias.AliasName!,
      keyId: keyInfo.KeyMetadata.KeyId!,
      accountId: keyInfo.KeyMetadata.AWSAccountId!,
      arn: keyInfo.KeyMetadata.Arn!,
      keySpec: keyInfo.KeyMetadata.KeySpec,
      enabled: keyInfo.KeyMetadata.Enabled,
      publicKey: publicKeyResponse.PublicKey, // DER-encoded public key bytes
    });
  }

  return keys;
}

function extractRawPublicKey(publicKeyDer: Uint8Array): Buffer {
  // The raw public key is the last 65 bytes of the DER encoding
  const publicKeyBuffer = Buffer.from(publicKeyDer);
  const rawPublicKey = publicKeyBuffer.subarray(-65);

  if (rawPublicKey[0] !== 0x04) {
    throw new Error("Invalid uncompressed public key format");
  }

  return rawPublicKey;
}

function getEthereumAddress(rawPublicKey: Buffer): string {
  // Remove the 0x04 prefix, leaving the 64-byte X,Y coordinates
  const publicKeyCoordinates = rawPublicKey.subarray(1);

  // Keccak-256 hash of the public key coordinates
  const hash = keccak256(publicKeyCoordinates);

  return getAddress("0x" + hash.slice(-40));
}

async function main() {
  console.warn("Announcing validators is not implemented yet!");

  const keys = await getValidatorKeys();

  console.log(`Found ${keys.length} validator keys:\n`);

  for (const key of keys) {
    console.log(key.alias);
    console.log(`  AWS Account ID: ${key.accountId}`);
    console.log(`  Key ID: ${key.keyId}`);
    console.log(`  Spec: ${key.keySpec}`);
    console.log(`  Enabled: ${key.enabled}`);

    const rawPublicKey = extractRawPublicKey(key.publicKey!);
    console.log(`  Raw Public Key: 0x${rawPublicKey.toString("hex")}`);

    const ethAddress = getEthereumAddress(rawPublicKey);
    console.log(`  Ethereum Address: ${ethAddress}`);
    console.log();
  }
}

main().catch(console.error);
