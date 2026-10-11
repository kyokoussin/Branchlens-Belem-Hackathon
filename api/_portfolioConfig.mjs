// All six Ethereum Morpho Vault V1 addresses were checked against Morpho's public API.
// Amounts are demo assumptions, not observed wallet holdings.
export const DEMO_POSITIONS = [
  { id: 'steakhouse-usdc', address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', amountUsd: '1000000', description: 'USDC lending across Morpho V1 markets.' },
  { id: 'gauntlet-usdc-core', address: '0x8eB67A509616cd6A7c1B3c8C21D48FF57df3d458', amountUsd: '500000', description: 'USDC lending with cbBTC-linked market exposure.' },
  { id: 'gauntlet-weth-prime', address: '0x2371e134e3455e0593363cBF89d3b6cf53740618', amountUsd: '250000', description: 'WETH lending across Morpho V1 markets.' },
  { id: 'gauntlet-usdc-prime', address: '0xdd0f28e19C1780eb6396170735D45153D261490d', amountUsd: '400000', description: 'USDC lending with shared cbBTC and oracle dependencies.' },
  { id: 'smokehouse-usdc', address: '0xBEeFFF209270748ddd194831b3fa287a5386f5bC', amountUsd: '300000', description: 'USDC lending across verified Morpho markets.' },
  { id: 'yearn-usdc', address: '0x68Aea7b82Df6CcdF76235D46445Ed83f85F845A3', amountUsd: '200000', description: 'USDC lending with cbBTC-linked market allocations.' },
];
