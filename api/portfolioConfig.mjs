// All three Ethereum Morpho Vault V1 addresses were checked against Morpho's public API.
// Amounts are demo assumptions, not observed wallet holdings.
export const DEMO_POSITIONS = [
  { id: 'steakhouse-usdc', address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', amountUsd: '1000000', description: 'USDC lending across Morpho markets. The primary cbBTC incident walkthrough.' },
  { id: 'gauntlet-usdc-core', address: '0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458', amountUsd: '500000', description: 'A second USDC vault with verified market allocations and cbBTC exposure.' },
  { id: 'gauntlet-weth-prime', address: '0x2371e134e3455e0593363cBF89d3b6cf53740618', amountUsd: '250000', description: 'WETH lending position used to show unaffected capital alongside the incident.' },
];
