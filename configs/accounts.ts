export type Account = {
  name: string;
  id: string;
  // Can be manually provided in case the account doesn't follow naming conventions
  network?: NetworkType;
  // Can be manually provided in case the account doesn't follow naming conventions
  team?: string;
};

export enum NetworkType {
  Devnet = "devnet",
  Testnet = "testnet",
  Mainnet = "mainnet",
}

// List of core Hyperlane accounts.
// Core accounts have core infrastructure deployed such as relayers, S3 buckets, etc.
// Unless there's a specific reason, these should be Sovereign accounts.
export const CORE_ACCOUNTS: Account[] = [
  {
    name: "Sovereign Mainnet",
    id: "744159939852",
  },
  {
    name: "Sovereign Testnet",
    id: "455162986047",
  },
];

export const CUSTOMER_ACCOUNTS: Account[] = [];

// We use a 2 of 3 validator set, 1 in customers account, 1 in core sovereing account
// and 1 in overflow accounts
export const OVERFLOW_HYPERLANE_ACCOUNTS: Account[] = [
  {
    name: "Hyperlane Mainnet",
    id: "245760921112",
    team: "sovereign",
  },
  {
    name: "Hyperlane Testnet",
    id: "189265240691",
    team: "sovereign",
  },
];

export function isCoreAccount(account: Account): boolean {
  return CORE_ACCOUNTS.some((core) => core.id === account.id);
}

export function getNetworkType(account: Account): NetworkType {
  if (account.network) {
    return account.network;
  }

  const lowerName = account.name.toLowerCase().split(" ")[1];

  switch (lowerName) {
    case "devnet":
      return NetworkType.Devnet;
    case "testnet":
      return NetworkType.Testnet;
    case "mainnet":
      return NetworkType.Mainnet;
    default:
      throw new Error(`Unknown network type for account: ${account.name}`);
  }
}

export function getTeamName(account: Account): string {
  if (account.team) {
    return account.team.toLowerCase();
  }

  if (isCoreAccount(account)) {
    return "sovereign";
  }

  return account.name.toLowerCase().split(" ")[0];
}

// List of accounts that use hyperlane and thus will have base infrastructure deployed.
// Each account in this list has a `BaseAccountStack` deployed.
export const HYPERLANE_ACCOUNTS: Account[] = [
  ...CORE_ACCOUNTS,
  ...CUSTOMER_ACCOUNTS,
  ...OVERFLOW_HYPERLANE_ACCOUNTS,
];

export function accountsForNetwork(network: NetworkType): Account[] {
  return HYPERLANE_ACCOUNTS.filter((account) => {
    const netType = getNetworkType(account);
    return netType === network;
  });
}

// Account that hosts the ECR repository for hyperlane agent images.
// This should be considered a production account and will be used by all agents
// regardless of network.
//
// Sovereign mainnet
export const ECR_ACCOUNT_ID = "744159939852";

if (!CORE_ACCOUNTS.some((acc) => acc.id === ECR_ACCOUNT_ID)) {
  throw new Error(
    `ECR_ACCOUNT ${ECR_ACCOUNT_ID} must be a core account in CORE_ACCOUNTS`,
  );
}
