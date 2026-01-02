import * as cdk from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import { AgentType } from "./agent-stack";

export type ValidatorKeyConfig = {
  /** Alias for the KMS key */
  alias: string;
  /**
   * Removal policy for the keys created in this stack.
   * Note: This should be left to RETAIN unless using short-lived throw away stacks
   * for testing purposes.
   *
   * Default: RETAIN
   **/
  removalPolicy?: cdk.RemovalPolicy;
  /** Blockchain chain the validator is for (used for tagging) */
  chain: string;
};

export interface ValidatorKeyProps extends cdk.StackProps {
  configs: ValidatorKeyConfig[];
}

/**
 * This stack creates and controls all validator keys for validators assigned
 * to this AWS account.
 */
export class ValidatorKeyStack extends cdk.Stack {
  public readonly keys: { [uniqueId: string]: kms.IAlias } = {};

  constructor(scope: cdk.App, id: string, props?: ValidatorKeyProps) {
    super(scope, id, props);

    const configs = props?.configs || [];

    for (const config of configs) {
      const { alias, removalPolicy, chain } = config;

      const key = new kms.Key(this, `ValidatorKey-${alias}`, {
        // validators always use EVM compatible keys regardless of blockchain network
        keySpec: kms.KeySpec.ECC_SECG_P256K1,
        keyUsage: kms.KeyUsage.SIGN_VERIFY,
        // never rotate to maintain signature validity
        enableKeyRotation: false,
        // Will RETAIN if removalPolicy is undefined
        removalPolicy,
      });
      const keyAlias = new kms.Alias(this, `ValidatorKeyAlias-${alias}`, {
        aliasName: `alias/${config.alias}`,
        targetKey: key,
      });

      cdk.Tags.of(key).add("Chain", chain);
      cdk.Tags.of(key).add("Agent", AgentType.Validator);
      this.keys[alias] = keyAlias;
    }
  }
}
