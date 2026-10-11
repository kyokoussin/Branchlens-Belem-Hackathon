import { describe, expect, it } from 'vitest';
import { analyze, calculateExposure, normalizeVault } from '../api/_riskEngine.mjs';
import { formatIncidents } from '../api/_incidentFormatter.mjs';

const A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`;
const C = `0x${'c'.repeat(40)}`;
const V = `0x${'d'.repeat(40)}`;
const M1 = `0x${'1'.repeat(64)}`;
const M2 = `0x${'2'.repeat(64)}`;
const provenance = { endpoint: 'https://api.morpho.org/graphql', queryName: 'VaultRiskSnapshot', retrievedAt: '2026-10-10T00:00:00.000Z', sourceTimestamp: null, indexedBlock: null };

function row(marketId, amount, collateral = B, oracle = C) {
  return { supplyAssetsUsd: amount, market: { marketId, lltv: '860000000000000000', irmAddress: A, oracle: { address: oracle }, loanAsset: { address: A, symbol: 'USDC', decimals: 6 }, collateralAsset: { address: collateral, symbol: collateral === B ? 'cbBTC' : 'WBTC', decimals: 8 }, state: { utilization: 0.90, supplyAssetsUsd: 9000000, borrowAssetsUsd: 8100000 } } };
}
function fixture(rows = [row(M1, 6000000), row(M2, 4000000, C, B)], liquidity = 5000000) {
  return { address: V, name: 'Synthetic vault', chain: { id: 1 }, asset: { address: A, symbol: 'USDC', decimals: 6 }, state: { totalAssetsUsd: 10000000, allocation: rows }, liquidity: { usd: liquidity } };
}

describe('financial integrity', () => {
  it('allocates $1m across $6m/$4m of a $10m vault without inventing a loss', () => {
    const result = calculateExposure(normalizeVault(fixture(), provenance), '1000000');
    expect(result.marketExposures.map((x) => x.capitalExposedUsd)).toEqual(['600000.00', '400000.00']);
    expect(result.verifiedKnownUsd).toBe('1000000.00');
    expect(result.unquantifiedUsd).toBe('0.00');
  });
  it('keeps an unsupported allocation unquantified instead of counting it as zero coverage', () => {
    const bad = { supplyAssetsUsd: 4000000, market: null };
    const result = calculateExposure(normalizeVault(fixture([row(M1, 6000000), bad]), provenance), '1000000');
    expect(result.verifiedKnownUsd).toBe('600000.00');
    expect(result.unquantifiedUsd).toBe('400000.00');
  });
  it('deduplicates overlapping triggered alerts and caps total at assumed principal', () => {
    const sameCollateral = fixture([row(M1, 6000000), row(M2, 4000000)], 500000);
    const result = formatIncidents(analyze(sameCollateral, provenance, '1000000'));
    expect(result.summary.triggeredCount).toBeGreaterThanOrEqual(2);
    expect(result.summary.uniqueAffectedUsd).toBe('1000000.00');
    expect(result.summary.maxPrincipalAtRiskUsd).toBe('1000000.00');
    expect(result.incidents.every((item) => item.classification !== 'DETECTED_EXPLOIT')).toBe(true);
    expect(result.exitIntents.every((intent) => intent.executionEnabled === false && intent.executable === false)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/"expectedLoss"|"probability"|"expectedReturn"/i);
  });
  it('reports unknown global liquidity rather than claiming exit capacity', () => {
    const result = analyze(fixture([row(M1, 6000000)], null), provenance, '1000000');
    const liquidity = result.findings.find((item) => item.detector === 'WITHDRAWAL_LIQUIDITY_CONSTRAINT');
    expect(liquidity.status).toBe('UNKNOWN');
    expect(result.vault.liquidityUsd).toBeNull();
  });
  it('rejects inconsistent vault identity and duplicated market IDs', () => {
    expect(() => normalizeVault({ ...fixture(), chain: { id: 10 } }, provenance)).toThrow();
    const normalized = normalizeVault(fixture([row(M1, 6000000), row(M1, 4000000)]), provenance);
    expect(normalized.allocations).toHaveLength(1);
    expect(normalized.unquantifiedVaultUsd).toBe('4000000');
    expect(normalized.warnings.some((warning) => warning.includes('repeated market ID'))).toBe(true);
  });
  it('rejects allocation totals that materially exceed the vault total', () => {
    expect(() => normalizeVault(fixture([row(M1, 9000000), row(M2, 4000000)]), provenance)).toThrow('exceeds the reported vault total');
  });
  it('uses stable incident IDs and only source-backed paths', () => {
    const raw = fixture([row(M1, 6000000), row(M2, 4000000)], 5000000);
    const first = formatIncidents(analyze(raw, provenance, '1000000'));
    const second = formatIncidents(analyze(raw, provenance, '1000000'));
    expect(first.incidents[0].id).toBe(second.incidents[0].id);
    expect(first.incidents[0].dependencyPaths).toHaveLength(2);
    expect(first.graph.edges.every((edge) => ['OBSERVED', 'ASSUMED', 'DERIVED', 'UNKNOWN'].includes(edge.status))).toBe(true);
    expect(first.graph.edges.every((edge) => ['API', 'UNKNOWN'].includes(edge.evidence.provenance) && 'retrievedAt' in edge.evidence && edge.evidence.source)).toBe(true);
    expect(first.findings.every((finding) => finding.rule_id && finding.dependency_id && finding.timestamp === provenance.retrievedAt && finding.unique_exposure_usd === finding.capitalExposedUsd)).toBe(true);
  });
});
