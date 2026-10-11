import Decimal from 'decimal.js';

Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
const D = (value) => new Decimal(String(value));
const money = (value) => D(value).toDecimalPlaces(2).toFixed(2);
const ratio = (value) => D(value).toDecimalPlaces(6).toString();
const addr = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : null;
const evidence = (field, source = 'https://api.morpho.org/graphql') => ({ source, field, status: 'OBSERVED' });
const shortAddress = (value) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const unique = (rows) => [...new Map(rows.map((row) => [row.marketId, row])).values()];

export class DataError extends Error {
  constructor(message) { super(message); this.code = 'INVALID_SOURCE_DATA'; }
}

export function normalizeVault(raw, provenance) {
  if (!raw || ![1, 8453].includes(raw.chain?.id) || !addr(raw.address)) throw new DataError('Vault chain or address is invalid.');
  const total = raw.state?.totalAssetsUsd;
  if (total == null || !D(total).isFinite() || D(total).lte(0)) throw new DataError('Vault total USD value is missing or invalid.');
  const asset = raw.asset || {};
  if (!addr(asset.address) || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) throw new DataError('Vault deposit-token address or decimals are missing.');
  const rows = raw.state?.allocation;
  if (!Array.isArray(rows)) throw new DataError('Vault allocation data is unavailable.');
  const warnings = [];
  const seen = new Set();
  const allocations = [];
  for (const [index, row] of rows.entries()) {
    const amount = row?.supplyAssetsUsd;
    if (amount == null || !D(amount).isFinite() || D(amount).lt(0)) {
      warnings.push(`Allocation row ${index + 1} has no usable USD amount; it is unquantified.`);
      continue;
    }
    if (D(amount).eq(0)) continue;
    const market = row.market;
    if (!/^0x[0-9a-fA-F]{64}$/.test(market?.marketId || '') || seen.has(market.marketId.toLowerCase())) {
      warnings.push(`Allocation row ${index + 1} has a missing or repeated market ID; its amount is unquantified.`);
      continue;
    }
    seen.add(market.marketId.toLowerCase());
    const collateral = market.collateralAsset || {};
    const loan = market.loanAsset || {};
    const oracle = market.oracle || {};
    const utilization = market.state?.utilization;
    allocations.push({
      marketId: market.marketId.toLowerCase(),
      allocationUsd: D(amount).toString(),
      collateral: { address: addr(collateral.address), symbol: collateral.symbol || 'Unknown', decimals: Number.isInteger(collateral.decimals) ? collateral.decimals : null },
      loan: { address: addr(loan.address), symbol: loan.symbol || 'Unknown', decimals: Number.isInteger(loan.decimals) ? loan.decimals : null },
      oracleAddress: addr(oracle.address),
      oracleType: oracle.type || null,
      oracleData: oracle.data ? Object.fromEntries(Object.entries(oracle.data).map(([key, value]) => [key, addr(value?.address)]).filter(([, value]) => value)) : null,
      irmAddress: addr(market.irmAddress),
      lltv: market.lltv == null ? null : D(market.lltv).div('1000000000000000000').toString(),
      utilization: utilization == null || !D(utilization).isFinite() ? null : D(utilization).toString(),
      marketSupplyUsd: market.state?.supplyAssetsUsd == null ? null : D(market.state.supplyAssetsUsd).toString(),
      marketBorrowUsd: market.state?.borrowAssetsUsd == null ? null : D(market.state.borrowAssetsUsd).toString(),
      marketLiquidityUsd: market.state?.liquidityAssetsUsd == null ? null : D(market.state.liquidityAssetsUsd).toString(),
    });
  }
  allocations.sort((a, b) => D(b.allocationUsd).comparedTo(a.allocationUsd));
  const known = allocations.reduce((sum, item) => sum.plus(item.allocationUsd), D(0));
  if (known.gt(D(total).mul('1.000001'))) throw new DataError('Funded allocation USD sum exceeds the reported vault total; exposure cannot be calculated safely.');
  const unquantified = D(total).minus(known).gt(0) ? D(total).minus(known) : D(0);
  const liquidity = raw.liquidity?.usd;
  const liquidityUsd = liquidity == null || !D(liquidity).isFinite() || D(liquidity).lt(0) ? null : D(liquidity).toString();
  const restWithdrawable = provenance.restState?.withdrawableAssetsRaw;
  const withdrawableAssetsTokens = restWithdrawable == null ? null : D(restWithdrawable).div(D(10).pow(asset.decimals)).toString();
  return {
    version: 'MORPHO_V1', chainId: raw.chain.id, address: raw.address.toLowerCase(), name: raw.name || 'Unnamed Morpho vault',
    asset: { address: addr(asset.address), symbol: asset.symbol || 'Unknown', decimals: asset.decimals },
    totalUsd: D(total).toString(), liquidityUsd, withdrawableAssetsTokens,
    allocations, knownAllocatedUsd: known.toString(), unquantifiedVaultUsd: unquantified.toString(),
    warnings, provenance,
  };
}

export function normalizeMarket(raw, provenance) {
  if (!raw || ![1, 8453].includes(raw.chain?.id) || !/^0x[0-9a-fA-F]{64}$/.test(raw.marketId || '')) throw new DataError('Market chain or ID is invalid.');
  const loan = raw.loanAsset || {};
  if (!addr(loan.address) || !Number.isInteger(loan.decimals) || loan.decimals < 0 || loan.decimals > 36) throw new DataError('Market loan-token address or decimals are missing.');
  const total = raw.state?.supplyAssetsUsd;
  if (total == null || !D(total).isFinite() || D(total).lte(0)) throw new DataError('Market supply USD value is missing or invalid.');
  const liquidity = raw.state?.liquidityAssetsUsd;
  const collateral = raw.collateralAsset || {};
  const oracle = raw.oracle || {};
  const allocation = {
    marketId: raw.marketId.toLowerCase(), allocationUsd: D(total).toString(),
    collateral: { address: addr(collateral.address), symbol: collateral.symbol || 'Unknown', decimals: Number.isInteger(collateral.decimals) ? collateral.decimals : null },
    loan: { address: addr(loan.address), symbol: loan.symbol || 'Unknown', decimals: loan.decimals },
    oracleAddress: addr(oracle.address), oracleType: oracle.type || null,
    oracleData: oracle.data ? Object.fromEntries(Object.entries(oracle.data).map(([key, value]) => [key, addr(value?.address)]).filter(([, value]) => value)) : null,
    irmAddress: addr(raw.irmAddress),
    lltv: raw.lltv == null ? null : D(raw.lltv).div('1000000000000000000').toString(),
    utilization: raw.state?.utilization == null || !D(raw.state.utilization).isFinite() ? null : D(raw.state.utilization).toString(),
    marketSupplyUsd: D(total).toString(),
    marketBorrowUsd: raw.state?.borrowAssetsUsd == null ? null : D(raw.state.borrowAssetsUsd).toString(),
    marketLiquidityUsd: liquidity == null || !D(liquidity).isFinite() ? null : D(liquidity).toString(),
  };
  return {
    version: 'MORPHO_MARKET', chainId: raw.chain.id, address: allocation.marketId,
    name: `Morpho ${allocation.collateral.symbol}/${allocation.loan.symbol}`,
    asset: { address: allocation.loan.address, symbol: allocation.loan.symbol, decimals: loan.decimals },
    totalUsd: D(total).toString(), liquidityUsd: allocation.marketLiquidityUsd, withdrawableAssetsTokens: null,
    allocations: [allocation], knownAllocatedUsd: D(total).toString(), unquantifiedVaultUsd: '0', warnings: [], provenance,
  };
}

export function buildGraph(vault, { positionRole = 'SUPPLIER' } = {}) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();
  function node(id, type, label, address = null) {
    if (seenNodes.has(id)) return;
    seenNodes.add(id); nodes.push({ id, type, label, address });
  }
  function edge(from, to, type, status, field) {
    const id = `${from}|${type}|${to}`;
    if (seenEdges.has(id)) return;
    seenEdges.add(id); edges.push({ id, from, to, type, status, evidence: evidence(field) });
  }
  const chainId = `chain:${vault.chainId}`;
  const marketPosition = vault.version === 'MORPHO_MARKET';
  const vaultId = `vault:${vault.chainId}:${vault.address}`;
  const positionId = `position:assumed:${marketPosition ? `market:${vault.chainId}:${vault.address}` : vaultId}`;
  node(chainId, 'Blockchain', vault.chainId === 1 ? 'Ethereum' : 'Base');
  node(positionId, 'Position', 'Illustrative position');
  if (!marketPosition) {
    node(vaultId, 'Vault', vault.name, vault.address);
    edge(positionId, vaultId, 'HOLDS', 'ASSUMED', 'analyst-entered position');
    edge(vaultId, chainId, 'DEPLOYED_ON', 'OBSERVED', 'vault.chain.id');
    const depositId = `token:${vault.chainId}:${vault.asset.address}`;
    node(depositId, 'LoanToken', `${vault.asset.symbol} deposit asset`, vault.asset.address);
    edge(vaultId, depositId, 'HOLDS', 'OBSERVED', 'vault.asset');
  }
  for (const allocation of vault.allocations) {
    const marketId = `market:${vault.chainId}:${allocation.marketId}`;
    node(marketId, 'LendingMarket', `Morpho ${allocation.collateral.symbol}/${allocation.loan.symbol}`, allocation.marketId);
    if (marketPosition) edge(positionId, marketId, positionRole === 'BORROWER' ? 'BORROWS_FROM' : 'SUPPLIES_TO', 'ASSUMED', positionRole === 'BORROWER' ? 'analyst-entered simulated borrower position' : 'analyst-entered direct market holding');
    else edge(vaultId, marketId, 'ALLOCATES_TO', 'OBSERVED', `state.allocation[marketId=${allocation.marketId}].supplyAssetsUsd`);
    edge(marketId, chainId, 'DEPLOYED_ON', 'OBSERVED', marketPosition ? 'market.chain.id' : 'vault.chain.id + market in vault allocation');
    if (allocation.collateral.address) {
      const collateralId = `token:${vault.chainId}:${allocation.collateral.address}`;
      node(collateralId, 'CollateralToken', allocation.collateral.symbol, allocation.collateral.address);
      edge(marketId, collateralId, 'SECURED_BY', 'OBSERVED', 'market.collateralAsset.address');
    }
    if (allocation.loan.address) {
      const loanId = `token:${vault.chainId}:${allocation.loan.address}`;
      node(loanId, 'LoanToken', allocation.loan.symbol, allocation.loan.address);
      edge(marketId, loanId, 'SUPPLIES_TO', 'OBSERVED', 'market.loanAsset.address');
    }
    if (allocation.oracleAddress) {
      const oracleId = `oracle:${vault.chainId}:${allocation.oracleAddress}`;
      node(oracleId, 'Oracle', `${allocation.oracleType || 'Market oracle'} · ${shortAddress(allocation.oracleAddress)}`, allocation.oracleAddress);
      edge(marketId, oracleId, 'PRICED_BY', 'OBSERVED', 'market.oracle.address');
      for (const [role, address] of Object.entries(allocation.oracleData || {})) {
        const upstreamId = `${role.toLowerCase().includes('vault') ? 'oracle-vault' : 'feed'}:${vault.chainId}:${address}`;
        node(upstreamId, role.toLowerCase().includes('vault') ? 'OracleVault' : 'OracleFeed', `${role.replace(/([A-Z])/g, ' $1').trim()} · ${shortAddress(address)}`, address);
        edge(oracleId, upstreamId, 'USES_UPSTREAM', 'OBSERVED', `market.oracle.data.${role}.address`);
      }
    }
  }
  return { nodes, edges, coverage: marketPosition ? `${positionRole === 'BORROWER' ? 'Simulated collateral in a real Morpho market' : 'Direct Morpho market supply'} and verified market parameters; position balances and external protocol branches are analyst assumptions or NOT_ANALYZED.` : 'Funded Morpho V1 allocations only; issuer, backing, governance and external protocol branches are NOT_ANALYZED.' };
}

export function calculateExposure(vault, positionUsd, { positionRole = 'SUPPLIER' } = {}) {
  let principal;
  try { principal = D(positionUsd); } catch { throw new DataError('Enter a valid positive assumed position amount.'); }
  if (!principal.isFinite() || principal.lte(0) || (positionRole !== 'BORROWER' && principal.gt(vault.totalUsd))) throw new DataError('Assumed position must be positive and, for supply, no larger than the reported market or vault total.');
  const total = D(vault.totalUsd);
  const rows = vault.allocations.map((item) => ({
    marketId: item.marketId,
    share: ratio(D(item.allocationUsd).div(total)),
    capitalExposedUsd: money(principal.mul(item.allocationUsd).div(total)),
  }));
  const known = principal.mul(vault.knownAllocatedUsd).div(total);
  const unknown = principal.mul(vault.unquantifiedVaultUsd).div(total);
  return {
    assumedPrincipalUsd: money(principal),
    marketExposures: rows,
    verifiedKnownUsd: money(known),
    unquantifiedUsd: money(unknown),
    coverageRatio: ratio(D(vault.knownAllocatedUsd).div(total)),
  };
}

export function unionExposure(exposure, marketIds) {
  const ids = new Set(marketIds);
  const amount = unique(exposure.marketExposures.filter((row) => ids.has(row.marketId)))
    .reduce((sum, row) => sum.plus(row.capitalExposedUsd), D(0));
  return money(Decimal.min(amount, D(exposure.assumedPrincipalUsd)));
}

export function detectRisks(vault, exposure, options = {}) {
  const threshold = options.concentrationThreshold ?? '0.40';
  const findings = [];
  const requested = D(exposure.assumedPrincipalUsd);
  const liquidity = vault.liquidityUsd == null ? null : D(vault.liquidityUsd);
  const liquidityTriggered = liquidity != null && requested.gt(liquidity);
  const marketPosition = vault.version === 'MORPHO_MARKET';
  const borrower = marketPosition && options.positionRole === 'BORROWER';
  if (!borrower) findings.push({
    id: `liquidity:${vault.chainId}:${vault.address}`, detector: 'WITHDRAWAL_LIQUIDITY_CONSTRAINT',
    category: 'LIQUIDITY_CONSTRAINT', status: borrower || liquidity == null ? 'UNKNOWN' : liquidityTriggered ? 'TRIGGERED' : 'NOT_TRIGGERED',
    signalType: liquidityTriggered ? 'STRUCTURAL_WARNING' : 'CAPACITY_CHECK', severity: liquidityTriggered ? 'warning' : 'info',
    title: liquidityTriggered ? `Reported ${marketPosition ? 'market' : 'vault'} liquidity is below requested withdrawal` : `Reported ${marketPosition ? 'market' : 'vault'} liquidity check`,
    description: borrower ? 'Borrower collateral release depends on debt repayment, not market supply liquidity. No exit capacity is inferred.' : `Morpho reports global ${marketPosition ? 'market' : 'vault'} liquidity, not a wallet-specific redeemability or executable withdrawal quote.`,
    subjectId: marketPosition ? `market:${vault.chainId}:${vault.address}` : `vault:${vault.chainId}:${vault.address}`,
    affectedMarketIds: liquidityTriggered ? vault.allocations.map((a) => a.marketId) : [],
    capitalExposedUsd: liquidityTriggered ? exposure.assumedPrincipalUsd : '0.00',
    maxPrincipalAtRiskUsd: liquidityTriggered ? exposure.assumedPrincipalUsd : '0.00',
    evidence: [{ field: marketPosition ? 'market.state.liquidityAssetsUsd' : 'vault.liquidity.usd', observed: vault.liquidityUsd, comparator: '< requested withdrawal USD', threshold: exposure.assumedPrincipalUsd, source: 'https://api.morpho.org/graphql', sourceTimestamp: vault.provenance.sourceTimestamp }],
    missing: ['Wallet-specific maxWithdraw and adapter gating are not verified.', 'Global liquidity does not guarantee an exit.'],
  });
  const groups = new Map();
  for (const allocation of vault.allocations) {
    for (const kind of ['collateral', 'oracle']) {
      const address = kind === 'collateral' ? allocation.collateral.address : allocation.oracleAddress;
      if (!address) continue;
      const key = `${kind}:${address}`;
      if (!groups.has(key)) groups.set(key, { kind, address, symbol: kind === 'collateral' ? allocation.collateral.symbol : 'Oracle', rows: [] });
      groups.get(key).rows.push(allocation);
    }
  }
  const shared = [...groups.values()].filter((group) => group.rows.length > 1);
  if (shared.length === 0) {
    findings.push({ id: `concentration:${vault.chainId}:${vault.address}:none`, detector: 'SHARED_DEPENDENCY_CONCENTRATION', category: 'EXPOSURE_WARNING', status: 'NOT_TRIGGERED', signalType: 'STRUCTURAL_WARNING', severity: 'info', title: 'No repeated collateral or oracle dependency in funded markets', description: 'Only verified funded allocations were checked.', subjectId: `vault:${vault.chainId}:${vault.address}`, affectedMarketIds: [], capitalExposedUsd: '0.00', maxPrincipalAtRiskUsd: '0.00', evidence: [{ field: 'state.allocation', observed: `${vault.allocations.length} funded markets`, threshold: `${D(threshold).mul(100)}%`, source: 'https://api.morpho.org/graphql' }], missing: [] });
  }
  for (const group of shared) {
    const ids = group.rows.map((row) => row.marketId);
    const allocated = group.rows.reduce((sum, row) => sum.plus(row.allocationUsd), D(0));
    const share = allocated.div(vault.totalUsd);
    const triggered = share.gte(threshold);
    const exposed = unionExposure(exposure, ids);
    findings.push({
      id: `concentration:${vault.chainId}:${vault.address}:${group.kind}:${group.address}`,
      detector: 'SHARED_DEPENDENCY_CONCENTRATION', category: 'EXPOSURE_WARNING', status: triggered ? 'TRIGGERED' : 'NOT_TRIGGERED',
      signalType: 'STRUCTURAL_WARNING', severity: triggered ? 'warning' : 'info',
      title: `${group.symbol} shared across ${group.rows.length} funded markets`,
      description: 'A shared dependency concentrates exposure. This is not evidence of an active exploit or failure.',
      subjectId: `${group.kind === 'oracle' ? 'oracle' : 'token'}:${vault.chainId}:${group.address}`,
      affectedMarketIds: ids, capitalExposedUsd: exposed, maxPrincipalAtRiskUsd: exposed,
      evidence: [{ field: `state.allocation grouped by ${group.kind}.address`, observed: ratio(share), comparator: '>=', threshold: String(threshold), rawAllocatedUsd: money(allocated), marketIds: ids, source: 'https://api.morpho.org/graphql', sourceTimestamp: vault.provenance.sourceTimestamp }],
      missing: ['No incident has been detected for this dependency. The full-loss bound is conditional, not a forecast.'],
    });
  }
  findings.sort((a, b) => (b.status === 'TRIGGERED') - (a.status === 'TRIGGERED') || D(b.capitalExposedUsd).comparedTo(a.capitalExposedUsd));
  return findings;
}

export function analyze(raw, provenance, positionUsd = '1000000', options = {}) {
  const vault = normalizeVault(raw, provenance);
  const graph = buildGraph(vault);
  const exposure = calculateExposure(vault, positionUsd);
  const findings = detectRisks(vault, exposure, options);
  const affectedIds = findings.filter((item) => item.status === 'TRIGGERED').flatMap((item) => item.affectedMarketIds);
  const uniqueAffectedUsd = unionExposure(exposure, affectedIds);
  return { vault, graph, exposure, findings, summary: { triggeredCount: findings.filter((f) => f.status === 'TRIGGERED').length, uniqueAffectedUsd, maxPrincipalAtRiskUsd: uniqueAffectedUsd, meaning: 'Maximum conditional principal at risk if all affected allocations lose 100% of principal; not a loss prediction or probability.' } };
}

export function analyzeMarket(raw, provenance, positionUsd = '1000000', options = {}) {
  const market = normalizeMarket(raw, provenance);
  const graph = buildGraph(market, { positionRole: options.positionRole });
  const exposure = calculateExposure(market, positionUsd, { positionRole: options.positionRole });
  const findings = detectRisks(market, exposure, options);
  const affectedIds = findings.filter((item) => item.status === 'TRIGGERED').flatMap((item) => item.affectedMarketIds);
  const uniqueAffectedUsd = unionExposure(exposure, affectedIds);
  return { vault: market, graph, exposure, findings, summary: { triggeredCount: findings.filter((f) => f.status === 'TRIGGERED').length, uniqueAffectedUsd, maxPrincipalAtRiskUsd: uniqueAffectedUsd, meaning: 'Maximum conditional principal at risk if all affected allocations lose 100% of principal; not a loss prediction or probability.' } };
}
