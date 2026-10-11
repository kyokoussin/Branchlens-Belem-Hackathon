# BranchLens — Institutional DeFi Risk Intelligence

**See beyond the position.** BranchLens is an independent, read-only DeFi risk prototype built for the Belem Capital DeFi Risk Challenge. Six starter **illustrative investments** in **real Ethereum Morpho V1 vaults** support dependency and reverse impact investigations. Analysts can add their own hypothetical vault or direct market holdings on Ethereum and Base. The supplied logo is at `public/branchlens-logo.png`. The product is neither a wallet nor an execution system.

## Public demo

The GitHub Pages URL serves the earlier static graph/replay. The new borrower risk, HOLD/EXIT, approval, bot and report workflow requires the local Node API or a Vercel deployment with `DATABASE_URL`; it is **not** functional on GitHub Pages.

[Open the hosted judge demo](https://kyokoussin.github.io/Branchlens-Belem-Hackathon/). The six starter positions use the **saved historical Morpho API snapshot** captured on 10 October 2026 at 23:49 UTC until the analyst chooses to refresh live data or manages positions. New vault and market IDs are verified through Morpho's public API; user-configured holdings and portfolios stay in browser localStorage, separate from cached Morpho responses. The app does not monitor current incidents. Every position shows whether its data is live or historical. The hosted bundle is in `docs/`. After changing code or the verified snapshot, run `pnpm pages:build`, commit, and push `docs/` with the source changes to update the site.

## Launch on this Mac

Double-click **Start BranchLens.command** and leave its Terminal window open, then visit [http://127.0.0.1:8780](http://127.0.0.1:8780). The app fetches live public Morpho data when available; if it cannot, it labels and uses the bundled historical API snapshot. The **Use historical snapshot** control is beside the investment cards for offline rehearsal. Closing Terminal stops the local app.

For a manual start with Node and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

## Judge walkthrough: complete local/API demo

1. Start the app with **Start BranchLens.command** or `pnpm start`, then open http://127.0.0.1:8780. Confirm the portfolio is labeled illustrative and inspect **Portfolio Graph** or a position's Dependency View. Shared market, token and oracle IDs come from Morpho, with source evidence on the graph.
2. Choose **Run Simulated Incident**. The workflow selects a real Ethereum Morpho Blue cbBTC/USDC market. Set **Data source** to historical snapshot for a deterministic rehearsal, or leave **Live API, verified fallback** for a fresh retrieval. The UI displays the actual source mode and capture time.
3. Run the default hypothetical position of 1 cbBTC collateral and 60,000 USDC debt with a 30% collateral shock. Check reverse paths to all connected tracked positions. The exposed principal is unique illustrative capital; it is **not** a loss estimate for the supplier positions.
4. Inspect the borrower's before/after collateral value, debt, equity, LTV and health factor. HF at or below 1 means liquidation eligibility, not an observed liquidation.
5. Change incident probability from 30% to 1% and click **Recalculate HOLD / EXIT**. The recommendation changes from EXIT FAVORED to HOLD FAVORED with the provided demo cost assumptions. Restore 30% to demonstrate EXIT FAVORED.
6. Approve EXIT with a justification, send the versioned instruction to the **simulated bot**, and open/download the persisted audit report. The acknowledgement is **simulation only**; no trade is executed.

For a longer walkthrough, open **Portfolio Graph** from navigation to inspect the merged graph across all portfolios. Select a shared market or collateral node to see its complete paths and unique exposed principal. Use **Manage Positions** to create a portfolio and add a real Morpho V1 vault address (42 characters) or a Morpho market ID (66 characters) with a hypothetical USD amount. The dashboard and explorer share search and combined portfolio, protocol, asset, market, oracle, and risk filters. Edit, move, or remove the position to see the graph and impact update immediately. Browser refresh restores configured holdings.

## Technical MVP and deployment

The local API persists portfolio configuration, market snapshots, scenario runs, approvals, simulated bot handoffs and reports in `./.branchlens.sqlite` (ignored by Git). The database schema is in `migrations/001_mvp.sql`. Set `BRANCHLENS_DB_PATH` to move the local database. A Vercel deployment instead requires a PostgreSQL `DATABASE_URL` configured as a server-side environment variable. Never prefix it with `VITE_` or commit it. Vercel also needs the existing Git repository imported as a Vite project; `vercel.json` builds `dist` and packages the Node API. An authenticated Vercel account and database are required to publish the full workflow. The local SQLite fallback is intentionally disabled on Vercel because its filesystem is not durable. The hosted GitHub Pages demo remains a static graph/replay.

The workflow is on-demand. Active market requests share a 60-second cache; there is no background worker and no claim of continuous monitoring. Token prices older than 12 hours reject live calculations; a matching timestamped Morpho snapshot is used only as a visibly labeled historical fallback. Re-capture a verified borrower snapshot deliberately with `pnpm capture:borrower` while the public Morpho API is reachable. The included snapshot matches market `0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64` on Ethereum.

The borrower model uses verified market LLTV and Morpho token USD prices with analyst-entered balances. Collateral value = collateral tokens × collateral USD price; debt value = debt tokens × loan USD price; LTV = debt / collateral; health factor = collateral × LLTV / debt. A price shock recomputes these values using decimal-safe arithmetic. Conditional lender shortfall = max(0, debt − shocked collateral value), an upper-bound scenario quantity rather than realized loss. Supplier positions only receive graph exposure; borrower health is never applied to them. Unsupported oracle-stale, oracle-deviation and protocol-unavailable economics return an explicit unsupported result.

The HOLD/EXIT calculation uses analyst-entered probability × incremental loss, compared with estimated gas, swap slippage, fees and unwind costs. Loan repayment is a funding requirement, not a transaction cost. Zero slippage in the demo assumes the analyst already has the USDC loan asset; otherwise a swap quote and cost are required. The app does not fetch executable quotes, estimate exploit probabilities, know the user's actual wallet balances, or guarantee that an exit fully removes risk. The handoff schema is validated and idempotent; its receiver never signs or submits an on-chain transaction. This is a shared demonstration workspace, not a private authenticated service.

## Data and financial meaning

- **Live by default:** `api/_morphoClient.mjs` requests current Morpho GraphQL vault and market records and the V1 vault-state REST record. All six addresses in `api/_portfolioConfig.mjs` were checked against the API. The app uses vault allocations, market IDs, loan/collateral assets, oracle addresses and available upstream feed/vault addresses, market liquidity, utilization, LLTV, indexed block when supplied, and retrieval time. The query and normalization are shared across all three screens.
- **Verified fallback:** `data/demo-snapshot.json` is a timestamped saved response from the same public API, captured by `scripts/captureSnapshot.mjs`. Each position is labeled **LIVE MORPHO DATA** or **SAVED HISTORICAL SNAPSHOT**. A mixed mode is possible if only some live requests fail. The saved file must never be described as current market state. Re-capture deliberately with `node scripts/captureSnapshot.mjs` when a fresh verified backup is needed.
- **Assumed capital:** $1,000,000 Steakhouse USDC, $500,000 Gauntlet USDC Core, $250,000 Gauntlet WETH Prime, $400,000 Gauntlet USDC Prime, $300,000 Smokehouse USDC, and $200,000 Yearn USDC. These are scenario inputs, not real portfolio holdings. Market-attributed principal = assumed position amount × reported market allocation USD ÷ reported vault total assets USD. `api/_riskEngine.mjs` rejects materially inconsistent totals; uncovered capital is retained as unattributed. Shared dependencies resolve to the union of underlying funded markets, so the same market allocation is counted once per position.
- **Bidirectional graph:** Dependency View follows outgoing relationships from one investment. Impact View uses the same nodes and edges in reverse, finds every path to tracked positions without a depth limit, and lists all intermediate components. The portfolio result distinguishes distinct market IDs from funded allocations across positions. Exposure is summed once per position after its affected market IDs are deduplicated; a vault-wide dependency reaches the full assumed principal, including unattributed capital.
- **Dependency evidence:** Vault, market, collateral, loan asset, oracle and available oracle upstream links come from Morpho records and are tagged **OBSERVED**. Coinbase issuer, custody and BTC backing links for the documented cbBTC Ethereum contract are tagged **DOCUMENTED**, reflecting Coinbase's published claims rather than an independent reserve verification. Missing oracle internals and other unsupported links stay unknown. The graph reuses shared node IDs.
- **Risk signals:** Structural concentration checks for shared collateral/oracles are observations, not emergencies. The cbBTC price rule can evaluate a supplied verified baseline/observation pair, but this demo has no trusted live pair; its live status is **UNKNOWN**. The replay supplies an explicitly **SIMULATED** pair and triggers one deduplicated portfolio incident. Refreshes compare vault totals, allocations and structural findings during the local server session.
- **Impact, not realized loss:** The incident identifies actual funded cbBTC markets and reports unique assumed principal attributed to them. The “conditional full-loss bound” assumes a complete loss of that exposed principal. A 30% collateral price move is *not* a 30% lender loss, bad debt estimate, probability, or expected loss. Actual lender loss is unknown without borrower/liquidation data. Global vault and market liquidity are context, not wallet-specific withdrawal capacity. No valid execution quote or gas estimate is provided; a plain vault redeem has no swap slippage.
- **Scope:** The starter vaults are Ethereum Morpho **V1**. Managed positions can reference V1 vault addresses or Morpho market IDs on Ethereum or Base. A direct market holding uses reported market supply for its 100% market allocation and links the assumed position directly to that verified market; no intermediary vault is invented. V2 adapter semantics are different and are not modeled. This prototype has no connected portfolio wallet, persistent monitoring service, real live depeg feed, signing, external alert delivery, or trading execution.

Sources: [Morpho API documentation](https://docs.morpho.org/developers/api/morpho-vaults/), [Morpho market API documentation](https://docs.morpho.org/developers/api/morpho/), [Morpho GraphQL endpoint](https://api.morpho.org/graphql), and [Coinbase cbBTC documentation](https://www.coinbase.com/cbbtc).

## Verify

```sh
pnpm test
pnpm build
pnpm smoke:live
```

The tests cover graph/exposure behavior, borrower health and token precision, HOLD/EXIT economics, missing assumptions, persisted approval/report, intent validation, simulated receiver expiry and duplicate handoff. `smoke:live` needs internet access. The local server serves `/api/portfolio` (`source=auto` or `source=snapshot`, optional `scenario=CBBTC_DEPEG_30`), `/api/analyze` for a single Ethereum V1 vault, and `/api/health`. Managed holdings are analyzed in the browser using the same portfolio engine and Morpho GraphQL data model.
