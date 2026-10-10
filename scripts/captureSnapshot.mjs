import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEMO_POSITIONS } from '../api/portfolioConfig.mjs';
import { fetchMorphoVault } from '../api/morphoClient.mjs';
import { analyze } from '../api/riskEngine.mjs';

const positions = [];
for (const position of DEMO_POSITIONS) {
  let entry;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      entry = await fetchMorphoVault(position.address);
      analyze(entry.raw, entry.provenance, position.amountUsd);
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  positions.push({ id: position.id, address: position.address, raw: entry.raw, provenance: entry.provenance });
}
const path = resolve('data/demo-snapshot.json');
await mkdir(resolve('data'), { recursive: true });
await writeFile(path, JSON.stringify({ kind: 'VERIFIED_HISTORICAL_MORPHO_API_SNAPSHOT', capturedAt: new Date().toISOString(), source: 'https://api.morpho.org/graphql', positions }, null, 2) + '\n');
console.log(JSON.stringify({ path, capturedAt: new Date().toISOString(), positions: positions.map(({ id, raw }) => ({ id, name: raw.name, allocations: raw.state.allocation.length })) }, null, 2));
