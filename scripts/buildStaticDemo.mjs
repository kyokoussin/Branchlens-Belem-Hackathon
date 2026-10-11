import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildPortfolio } from '../api/_portfolioEngine.mjs';

const snapshot = JSON.parse(await readFile(new URL('../data/demo-snapshot.json', import.meta.url), 'utf8'));
await writeFile(fileURLToPath(new URL('../public/demo-snapshot.json', import.meta.url)), JSON.stringify(snapshot));
for (const [name, scenario] of [['demo-baseline.json', false], ['demo-scenario.json', true]]) {
  const portfolio = await buildPortfolio({ source: 'snapshot', scenario, snapshot });
  await writeFile(fileURLToPath(new URL(`../public/${name}`, import.meta.url)), JSON.stringify(portfolio));
  console.log(`${name}: ${portfolio.mode}; ${portfolio.positions.length} positions`);
}
