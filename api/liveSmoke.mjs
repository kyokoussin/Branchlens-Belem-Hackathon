import { DEFAULT_VAULT, fetchMorphoVault } from './morphoClient.mjs';
import { analyze } from './riskEngine.mjs';
import { formatIncidents } from './incidentFormatter.mjs';

const { raw, provenance } = await fetchMorphoVault(process.argv[2] || DEFAULT_VAULT);
const result = formatIncidents(analyze(raw, provenance, '1000000'));
if (!result.vault.allocations.length || !result.graph.nodes.some((node) => node.type === 'Oracle') || !result.findings.length) throw new Error('Live traversal did not reach a funded market and oracle.');
console.log(JSON.stringify({ retrievedAt: provenance.retrievedAt, chainId: result.vault.chainId, vault: result.vault.address, version: result.vault.version, restStateIndexedBlock: provenance.restState?.indexedBlock ?? null, restWithdrawableAssetsTokens: result.vault.withdrawableAssetsTokens, markets: result.vault.allocations.length, firstMarket: result.vault.allocations[0].marketId, firstCollateral: result.vault.allocations[0].collateral, firstOracle: result.vault.allocations[0].oracleAddress, detectorStatuses: result.findings.map((finding) => ({ detector: finding.detector, status: finding.status, title: finding.title })), uniqueAffectedUsd: result.summary.uniqueAffectedUsd, executionEnabled: result.exitIntents.some((intent) => intent.executionEnabled) }, null, 2));
