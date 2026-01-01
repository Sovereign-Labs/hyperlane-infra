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
    chains: ["sepolia", "aledrynet"],
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

// This isn't fool proof, if we use multiple validator sets for the same chain
// we could have duplicate/uniqueId collisions etc. But I'm not sure there will
// ever be a need for multiple validator sets for the same chain so this should do for now.
export const validatorSets: ValidatorConfig[][] = [
  new ValidatorSetBuilder("sovstarter")
    .addAccount("590183691025") // Ross (customer)
    .addAccount("455162986047") // Sovereign Testnet (core)
    .addAccount("189265240691") // Hyperlane Testnet (overflow)
    .build(),
  new ValidatorSetBuilder("ethtest")
    .addAccount("590183691025") // Ross (customer)
    .addAccount("455162986047") // Sovereign Testnet (core)
    .addAccount("189265240691") // Hyperlane Testnet (overflow)
    .build(),
];
