export type Account = {
  name: string;
  id: string;
  // Can be manually provided in case the account doesn't follow naming conventions
  network?: NetworkType;
  // Can be manually provided in case the account doesn't follow naming conventions
  customer?: string;
};

export enum NetworkType {
  Devnet = "devnet",
  Testnet = "testnet",
  Mainnet = "mainnet",
}

// List of core Hyperlane accounts.
// Core accounts have core infrastructure deployed such as ECR, relayer, S3 buckets, etc.
// The core resources are shared by other Hyperlane accounts.
// Generally these should be Sovereign accounts.
export const CORE_ACCOUNTS: Account[] = [
  {
    name: "Ross",
    id: "590183691025",
    network: NetworkType.Devnet,
    customer: "sovereign",
  },
];

export const CUSTOMER_ACCOUNTS: Account[] = [];

export function isCoreAccount(account: Account): boolean {
  return CORE_ACCOUNTS.some((core) => core.id === account.id);
}

export function getNetworkType(account: Account): NetworkType {
  if (account.network) {
    return account.network;
  }

  const lowerName = account.name.toLowerCase().split("-")[1];

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

export function getCustomerName(account: Account): string {
  if (account.customer) {
    return account.customer.toLowerCase();
  }

  if (isCoreAccount(account)) {
    return "sovereign";
  }

  return account.name.toLowerCase().split("-")[0];
}

// List of accounts that use hyperlane and thus will have base infrastructure deployed.
// Each account in this list has a `BaseAccountStack` deployed.
export const HYPERLANE_ACCOUNTS: Account[] = [
  ...CORE_ACCOUNTS,
  ...CUSTOMER_ACCOUNTS,
];

export function accountsForNetwork(network: NetworkType): Account[] {
  return HYPERLANE_ACCOUNTS.filter((account) => {
    const netType = getNetworkType(account);
    return netType === network;
  });
}
