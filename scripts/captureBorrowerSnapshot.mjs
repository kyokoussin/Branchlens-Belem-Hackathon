import { writeFile } from 'node:fs/promises';
import { getBorrowMarketSnapshot } from '../api/_marketData.mjs';

const marketId = process.argv[2] || '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64';
const chainId = Number(process.argv[3] || 1);
const snapshot = await getBorrowMarketSnapshot({ chainId, marketId, source: 'auto' });
if (snapshot.mode !== 'LIVE_MORPHO_API') throw new Error('Refusing to recapture from a historical fallback.');
const saved = {
  kind: 'VERIFIED_HISTORICAL_MORPHO_BORROWER_SNAPSHOT',
  chainId: snapshot.chainId, marketId: snapshot.marketId, capturedAt: snapshot.capturedAt,
  raw: snapshot.raw, provenance: snapshot.market.provenance,
  prices: snapshot.prices, oracle: snapshot.oracle, freshness: snapshot.freshness,
};
await writeFile(new URL('../data/borrower-demo-snapshot.json', import.meta.url), `${JSON.stringify(saved, null, 2)}\n`);
console.log(`Captured Morpho market ${marketId} on chain ${chainId} at ${saved.capturedAt}.`);
