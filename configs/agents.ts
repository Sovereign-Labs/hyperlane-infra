export type RelayerConfig = {
  accountId: string;
  uniqueId: string;
  chains: string[];
};

export const relayerConfigs: RelayerConfig[] = [
  {
    // Sovereign Testnet
    accountId: "455162986047",
    uniqueId: "relayer-testnet-1",
    chains: ["sovstarter", "ethtest"],
  },
];

export type ValidatorConfig = {
  chain: string;
  accountId: string;
  uniqueId: string;
};

class ValidatorSetBuilder {
  public readonly chain: string;
  public readonly size: number;
  private accounts: string[] = [];

  constructor(chain: string, size: number = 3) {
    this.chain = chain;
    this.size = size;
  }

  addAccount(accountId: string): ValidatorSetBuilder {
    this.accounts.push(accountId);
    return this;
  }

  build(): ValidatorConfig[] {
    if (this.accounts.length !== this.size) {
      throw new Error(
        `Validator set for chain ${this.chain} has ${this.accounts.length} accounts, expected ${this.size}`,
      );
    }

    const validators = [];

    for (const [i, accountId] of this.accounts.entries()) {
      validators.push({
        chain: this.chain,
        accountId,
        uniqueId: `validator-${this.chain}-${i + 1}`,
      });
    }

    return validators;
  }
}

// Creates 2 validator sets, one for each end of a hyperlane warp route
function duplexValidatorSet(
  chains: [string, string],
  accountIds: string[],
): ValidatorConfig[][] {
  const sets = [];

  for (const chain of chains) {
    const builder = new ValidatorSetBuilder(chain);

    for (const accountId of accountIds) {
      builder.addAccount(accountId);
    }

    sets.push(builder.build());
  }

  return sets;
}

export const validatorSets: ValidatorConfig[][] = [
  ...duplexValidatorSet(
    ["sovstarter", "ethtest"],
    [
      "590183691025", // Ross (customer)
      "455162986047", // Sovereign Testnet (core)
      "189265240691", // Hyperlane Testnet (overflow)
    ],
  ),
];
