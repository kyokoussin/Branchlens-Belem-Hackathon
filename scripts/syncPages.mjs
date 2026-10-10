import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const docs = fileURLToPath(new URL('../docs/', import.meta.url));
await mkdir(docs, { recursive: true });
await rm(new URL('../docs/assets/', import.meta.url), { recursive: true, force: true });
await cp(dist, docs, { recursive: true, force: true });
await writeFile(new URL('../docs/.nojekyll', import.meta.url), '');
console.log('Static historical-snapshot demo copied to docs/ for GitHub Pages.');
