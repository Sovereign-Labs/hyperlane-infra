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
