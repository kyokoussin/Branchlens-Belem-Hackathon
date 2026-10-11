import Decimal from 'decimal.js';
import { unionExposure } from './_riskEngine.mjs';
import { stableId } from './_stableId.mjs';

// Coinbase's published Ethereum cbBTC contract, not a market or exposure fixture.
export const CBBTC_ETHEREUM = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf';
export const CBBTC_SOURCE = 'https://www.coinbase.com/cbbtc';
const MORPHO_SOURCE = 'https://api.morpho.org/graphql';

export function evaluatePriceDeviation({ baseline, observed, threshold = '0.10', provenance }) {
  if (baseline == null || observed == null || !provenance) return { status: 'UNKNOWN', reason: 'No verified live cbBTC/BTC reference and observation pair is available.' };
  try {
    const base = new Decimal(String(baseline));
    const actual = new Decimal(String(observed));
    const limit = new Decimal(String(threshold));
    if (!base.isFinite() || base.lte(0) || !actual.isFinite() || actual.lt(0) || !limit.isFinite() || limit.lte(0)) return { status: 'UNKNOWN', reason: 'Price input was invalid.' };
    const deviation = actual.div(base).minus(1);
    return { status: deviation.abs().gte(limit) ? 'TRIGGERED' : 'NOT_TRIGGERED', baseline: base.toString(), observed: actual.toString(), deviationPercent: deviation.mul(100).toFixed(2), thresholdPercent: limit.mul(100).toString(), provenance };
  } catch {
    return { status: 'UNKNOWN', reason: 'Price input was invalid.' };
  }
}

// Public issuer claims are deliberately tagged DOCUMENTED, never OBSERVED on-chain.
export function addDocumentedCbbtcDependencies(analysis) {
  if (analysis.vault.chainId !== 1 || !analysis.vault.allocations.some((item) => item.collateral.address === CBBTC_ETHEREUM)) return analysis;
  const graph = { ...analysis.graph, nodes: [...analysis.graph.nodes], edges: [...analysis.graph.edges] };
  const tokenId = `token:${analysis.vault.chainId}:${CBBTC_ETHEREUM}`;
  const issuerId = 'organization:coinbase';
  const backingId = 'asset:btc';
  graph.nodes.push({ id: issuerId, type: 'IssuerCustodian', label: 'Coinbase · issuer/custodian', address: null });
  graph.nodes.push({ id: backingId, type: 'BackingAsset', label: 'BTC · documented backing asset', address: null });
  for (const [from, to, type, field] of [
    [tokenId, issuerId, 'ISSUED_BY', 'Coinbase cbBTC issuer statement'],
    [tokenId, backingId, 'BACKED_BY', 'Coinbase 1:1 backing statement'],
    [backingId, issuerId, 'CUSTODIED_BY', 'Coinbase custody statement'],
  ]) graph.edges.push({ id: `${from}|${type}|${to}`, from, to, type, status: 'DOCUMENTED', evidence: { source: CBBTC_SOURCE, field, retrievedAt: null, sourceTimestamp: null, provenance: 'VERIFIED_REFERENCE' } });
  graph.coverage = 'Funded Morpho V1 allocations observed; cbBTC issuer/backing/custody from Coinbase documentation only. Oracle upstream feeds, reserve attestation, governance and external protocols remain UNKNOWN.';
  return { ...analysis, graph };
}

export function simulateCbbtcDepeg(analysis, simulatedAt = new Date().toISOString()) {
  const { vault, graph, exposure } = analysis;
  const affected = vault.chainId === 1 ? vault.allocations.filter((allocation) => allocation.collateral.address === CBBTC_ETHEREUM) : [];
  if (!affected.length) return {
    available: false,
    reason: 'The selected live vault has no funded Ethereum cbBTC collateral allocation.',
    cbBtcContract: CBBTC_ETHEREUM,
    source: CBBTC_SOURCE,
  };

  const marketIds = [...new Set(affected.map((allocation) => allocation.marketId))];
  const capitalExposedUsd = unionExposure(exposure, marketIds);
  const marketPosition = vault.version === 'MORPHO_MARKET';
  const positionId = graph.nodes.find((node) => node.type === 'Position')?.id;
  const vaultId = `vault:${vault.chainId}:${vault.address}`;
  const collateralId = `token:${vault.chainId}:${CBBTC_ETHEREUM}`;
  const dependencyPaths = marketIds.map((marketId) => marketPosition ? [positionId, `market:${vault.chainId}:${marketId}`, collateralId] : [positionId, vaultId, `market:${vault.chainId}:${marketId}`, collateralId]);
  const pathsVerified = dependencyPaths.every((path) => path.slice(0, -1).every((from, index) => graph.edges.some((edge) => edge.from === from && edge.to === path[index + 1])));
  if (!pathsVerified) throw new Error('cbBTC graph paths could not be verified against the current Morpho snapshot.');
  const dedupKey = `belem-demo:${vault.chainId}:${vault.address}:CBBTC_RELATIVE_DEPEG_30`;
  const id = `sim_${stableId(dedupKey)}`;
  const detectionRule = evaluatePriceDeviation({ baseline: '1', observed: '0.70', threshold: '0.10', provenance: 'SIMULATED_CBBTC_BTC_RELATIVE_PRICE' });
  if (detectionRule.status !== 'TRIGGERED') throw new Error('Hypothetical price-deviation rule did not trigger.');

  return {
    schemaVersion: '1.0', kind: 'SIMULATED_INCIDENT', id, dedupKey,
    available: true, status: 'SIMULATED_NOT_OBSERVED', severity: 'REVIEW_REQUIRED',
    title: 'Hypothetical cbBTC 30% depeg relative to BTC',
    whatHappened: 'Analyst-injected scenario: cbBTC falls 30% relative to its underlying BTC. No such event was detected by this application.',
    whyItMatters: marketPosition ? 'The selected Morpho market accepts cbBTC collateral. A collateral shock could affect borrower health and lender recoveries; actual bad debt is not calculated.' : 'The selected vault funds Morpho markets that accept cbBTC collateral. A collateral shock could affect borrower health and lender recoveries; actual bad debt is not calculated.',
    simulatedAt, liveSnapshotRetrievedAt: vault.provenance.retrievedAt,
    detectionRule,
    graphQlIndexedBlock: vault.provenance.indexedBlock,
    restStateIndexedBlock: vault.provenance.restState?.indexedBlock ?? null,
    shock: { asset: 'cbBTC', tokenContract: CBBTC_ETHEREUM, referenceAsset: 'BTC', hypotheticalRelativePriceChangePercent: '-30', observedPriceChangePercent: null },
    chainId: vault.chainId, vaultAddress: vault.address, vaultVersion: vault.version,
    affectedHoldings: [{ id: positionId, kind: 'ASSUMED_POSITION_NOT_BELEM_LIVE_HOLDING', principalUsd: exposure.assumedPrincipalUsd }],
    marketIds,
    affectedMarkets: affected.map((allocation) => ({
      marketId: allocation.marketId,
      collateralAddress: allocation.collateral.address,
      oracleAddress: allocation.oracleAddress,
      capitalExposedUsd: exposure.marketExposures.find((item) => item.marketId === allocation.marketId)?.capitalExposedUsd ?? null,
    })),
    dependencyPaths,
    capitalExposedUsd,
    maxPrincipalAtRiskUsd: capitalExposedUsd,
    maxRiskMeaning: 'Conditional upper bound if 100% of affected principal were lost; not the predicted loss from a 30% collateral depeg.',
    actualLossUsd: null,
    evidence: [
      { status: 'ASSUMED', field: 'cbBTC/BTC relative price change', value: '-30%', source: 'Analyst simulation input', timestamp: simulatedAt },
      { status: 'OBSERVED', field: 'vault.state.allocation.market.collateralAsset.address', value: CBBTC_ETHEREUM, source: MORPHO_SOURCE, timestamp: vault.provenance.retrievedAt },
      { status: 'DOCUMENTED', field: 'cbBTC Ethereum contract and BTC backing claim', value: CBBTC_ETHEREUM, source: CBBTC_SOURCE, timestamp: null },
    ],
    exit: {
      mechanism: marketPosition ? 'MARKET_WITHDRAW' : 'VAULT_REDEEM',
      requestedWithdrawalUsd: exposure.assumedPrincipalUsd,
      reportedVaultWideLiquidityUsd: vault.liquidityUsd,
      restVaultWideWithdrawableAssetsTokens: vault.withdrawableAssetsTokens,
      walletSpecificWithdrawableUsd: null,
      walletSpecificStatus: 'NOT_VERIFIED',
      swapSlippageStatus: 'NOT_APPLICABLE_FOR_PLAIN_REDEEM',
      executionQuoteStatus: 'NOT_QUOTED',
    },
    sourceLinks: [MORPHO_SOURCE, vault.provenance.restState?.endpoint, CBBTC_SOURCE].filter(Boolean),
    dataQualityWarnings: [
      'Hypothetical depeg, not a detected price event.',
      'No borrower-level liquidation or bad-debt model; exposed capital is not actual loss.',
      'Wallet-specific withdrawal capacity and execution costs are unverified.',
      'Coinbase BTC backing and custody are documented claims, not independently verified reserves in this prototype.',
      ...vault.warnings,
    ],
    executionEnabled: false,
  };
}
