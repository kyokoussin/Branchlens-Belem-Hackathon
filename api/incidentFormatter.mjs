import { createHash } from 'node:crypto';

function stableId(value) { return createHash('sha256').update(value).digest('hex').slice(0, 20); }

function pathsForFinding(analysis, finding) {
  const { vault, graph } = analysis;
  const position = `position:assumed:vault:1:${vault.address}`;
  const vaultId = `vault:1:${vault.address}`;
  if (finding.detector === 'WITHDRAWAL_LIQUIDITY_CONSTRAINT') return [[position, vaultId]];
  return finding.affectedMarketIds.map((marketId) => {
    const path = [position, vaultId, `market:1:${marketId}`];
    if (graph.edges.some((edge) => edge.from === path[2] && edge.to === finding.subjectId)) path.push(finding.subjectId);
    return path;
  });
}

export function incidentFor(analysis, finding) {
  if (finding.status !== 'TRIGGERED') return null;
  const key = `belem:${analysis.vault.chainId}:${analysis.vault.address}:${finding.detector}:${finding.subjectId}`;
  const id = `inc_${stableId(key)}`;
  return {
    schemaVersion: '1.0', id, dedupKey: key, detectionTime: analysis.vault.provenance.retrievedAt,
    classification: finding.signalType, detector: finding.detector, category: finding.category,
    severity: finding.severity, status: finding.status, title: finding.title, description: finding.description,
    chainId: analysis.vault.chainId, vaultVersion: analysis.vault.version, vaultAddress: analysis.vault.address,
    vaultAsset: analysis.vault.asset, subjectId: finding.subjectId, marketIds: finding.affectedMarketIds,
    affectedHoldings: [{ id: `position:assumed:vault:1:${analysis.vault.address}`, kind: 'ASSUMED_POSITION_NOT_BELEM_LIVE_HOLDING', principalUsd: analysis.exposure.assumedPrincipalUsd }],
    capitalExposedUsd: finding.capitalExposedUsd,
    maxPrincipalAtRiskUsd: finding.maxPrincipalAtRiskUsd,
    maxRiskMeaning: 'Conditional upper bound if all affected principal is lost; not a predicted loss.',
    dependencyPaths: pathsForFinding(analysis, finding),
    evidence: finding.evidence,
    data: analysis.vault.provenance,
    dataQualityWarnings: [...analysis.vault.warnings, ...finding.missing, analysis.graph.coverage],
    exit: {
      mechanism: 'VAULT_REDEEM',
      requestedWithdrawalUsd: analysis.exposure.assumedPrincipalUsd,
      reportedGlobalLiquidityUsd: analysis.vault.liquidityUsd,
      walletSpecificWithdrawableUsd: null,
      walletSpecificStatus: 'UNKNOWN',
      quoteStatus: 'UNKNOWN',
      swapSlippageStatus: 'NOT_APPLICABLE',
      note: 'Plain vault redemption does not imply a token swap. Gas and wallet-specific redeemability have not been quoted.',
    },
  };
}

export function exitIntentFor(analysis, incident) {
  return {
    schemaVersion: '1.0', kind: 'UNSIGNED_EXIT_INTENT_PREVIEW', id: `intent_${stableId(incident.id)}`,
    incidentId: incident.id, chainId: analysis.vault.chainId, vaultAddress: analysis.vault.address,
    marketIds: incident.marketIds, tokenContract: analysis.vault.asset.address,
    tokenSymbol: analysis.vault.asset.symbol, tokenDecimals: analysis.vault.asset.decimals,
    requestedAmountUsd: analysis.exposure.assumedPrincipalUsd,
    requestedAmountTokenUnits: null,
    amountUnitsStatus: 'UNKNOWN_NO_WALLET_SHARES_OR_TOKEN_PRICE_QUOTE',
    targetTokenContract: analysis.vault.asset.address,
    mechanism: 'VAULT_REDEEM',
    liquidityStatus: incident.exit.walletSpecificStatus,
    quoteStatus: 'UNKNOWN', quoteExpiresAt: null,
    analystApprovalState: 'NOT_APPROVED',
    executionEnabled: false, executable: false,
    validationErrors: ['No connected portfolio wallet or vault shares supplied.', 'Wallet-specific maxWithdraw is unverified.', 'Token-unit amount and transaction quote are unavailable.'],
  };
}

export function formatIncidents(analysis) {
  const incidents = analysis.findings.map((finding) => incidentFor(analysis, finding)).filter(Boolean);
  return { ...analysis, incidents, exitIntents: incidents.map((incident) => exitIntentFor(analysis, incident)) };
}
