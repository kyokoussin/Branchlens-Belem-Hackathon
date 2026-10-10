# Belem Capital BranchLens — Portfolio Risk Intelligence

A read-only hackathon prototype. It turns three **hypothetical investments** in **real Ethereum Morpho V1 vaults** into a dependency graph and a controlled cbBTC incident investigation. It keeps the original Belem logo at `public/belem-logo.svg` and uses the Belem-inspired design system. It is not an official Belem product, a wallet, or an execution system.

## Public demo

[Open the hosted judge demo](https://kyokoussin.github.io/Branchlens-Belem-Hackathon/). GitHub Pages runs the same portfolio, graph, and incident journey using the **saved historical Morpho API snapshot** captured on 10 October 2026. It does not fetch live data or monitor current incidents; the source label and timestamp remain visible. The hosted bundle is in `docs/`. After changing code or the verified snapshot, run `pnpm pages:build`, commit, and push `docs/` with the source changes to update the site.

## Launch on this Mac

Double-click **Start Belem Risk Desk.command** and leave its Terminal window open, then visit [http://127.0.0.1:8780](http://127.0.0.1:8780). The app fetches live public Morpho data when available; if it cannot, it labels and uses the bundled historical API snapshot. Use **Use saved demo snapshot** on the homepage to rehearse without the live API. Closing Terminal stops the local app.

For a manual start with Node and pnpm:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

## 60-second judge walkthrough

1. **0–10 sec:** Show the portfolio homepage: three real vault references, $1.75m in clearly assumed capital, the distinct-dependency count, and zero live incident alerts.
2. **10–25 sec:** Open **Steakhouse USDC** in Dependency View. Click **Focus cbBTC**, then **View Portfolio Impact**. The same graph now traces backward to all tracked investments. Click either affected investment to highlight every complete route through its vault and markets.
3. **25–40 sec:** Return to **Dependency View** and click **Simulate Incident**. A hypothetical cbBTC/BTC observation of 0.70 versus a 1.00 baseline breaches the explicit 10% rule. The alert is clearly simulated.
4. **40–55 sec:** Click the alert's **View Portfolio Impact**. It opens directly on cbBTC, with two affected positions, two distinct market IDs (three funded allocations across those positions), unique attributed principal, the *conditional* full-loss bound, provenance, and the remaining exit questions. The WETH position is outside this incident.
5. **55–60 sec:** Click **Open incident report** to copy or download structured JSON. No alert, trade, or bot command is sent. **Reset Scenario** removes the hypothetical incident.

## Data and financial meaning

- **Live by default:** `api/morphoClient.mjs` requests current Morpho GraphQL vault and market records and the V1 vault-state REST record. All three addresses in `api/portfolioConfig.mjs` were checked against the API. The app uses vault allocations, market IDs, loan/collateral assets, oracle addresses and available upstream feed/vault addresses, market liquidity, utilization, LLTV, indexed block when supplied, and retrieval time. The query and normalization are shared across all three screens.
- **Verified fallback:** `data/demo-snapshot.json` is a timestamped saved response from the same public API, captured by `scripts/captureSnapshot.mjs`. Each position is labeled **LIVE MORPHO DATA** or **SAVED HISTORICAL SNAPSHOT**. A mixed mode is possible if only some live requests fail. The saved file must never be described as current market state. Re-capture deliberately with `node scripts/captureSnapshot.mjs` when a fresh verified backup is needed.
- **Assumed capital:** $1,000,000 Steakhouse USDC, $500,000 Gauntlet USDC Core, and $250,000 Gauntlet WETH Prime. These are scenario inputs, not Belem holdings. Market-attributed principal = assumed position amount × reported market allocation USD ÷ reported vault total assets USD. `api/riskEngine.mjs` rejects materially inconsistent totals; uncovered capital is retained as unattributed. Shared dependencies resolve to the union of underlying funded markets, so the same market allocation is counted once per position.
- **Bidirectional graph:** Dependency View follows outgoing relationships from one investment. Impact View uses the same nodes and edges in reverse, finds every path to tracked positions without a depth limit, and lists all intermediate components. The portfolio result distinguishes distinct market IDs from funded allocations across positions. Exposure is summed once per position after its affected market IDs are deduplicated; a vault-wide dependency reaches the full assumed principal, including unattributed capital.
- **Dependency evidence:** Vault, market, collateral, loan asset, oracle and available oracle upstream links come from Morpho records and are tagged **OBSERVED**. Coinbase issuer, custody and BTC backing links for the documented cbBTC Ethereum contract are tagged **DOCUMENTED**, reflecting Coinbase's published claims rather than an independent reserve verification. Missing oracle internals and other unsupported links stay unknown. The graph reuses shared node IDs.
- **Risk signals:** Structural concentration checks for shared collateral/oracles are observations, not emergencies. The cbBTC price rule can evaluate a supplied verified baseline/observation pair, but this demo has no trusted live pair; its live status is **UNKNOWN**. The replay supplies an explicitly **SIMULATED** pair and triggers one deduplicated portfolio incident. Refreshes compare vault totals, allocations and structural findings during the local server session.
- **Impact, not realized loss:** The incident identifies actual funded cbBTC markets and reports unique assumed principal attributed to them. The “conditional full-loss bound” assumes a complete loss of that exposed principal. A 30% collateral price move is *not* a 30% lender loss, bad debt estimate, probability, or expected loss. Actual lender loss is unknown without borrower/liquidation data. Global vault and market liquidity are context, not wallet-specific withdrawal capacity. No valid execution quote or gas estimate is provided; a plain vault redeem has no swap slippage.
- **Scope:** The configured vaults are Ethereum Morpho **V1**. V2 adapter semantics are different and are not modeled. This prototype has no Belem wallet integration, persistent monitoring service, real live depeg feed, signing, external alert delivery, or trading execution.

Sources: [Morpho API documentation](https://docs.morpho.org/developers/api/morpho-vaults/), [Morpho market API documentation](https://docs.morpho.org/developers/api/morpho/), [Morpho GraphQL endpoint](https://api.morpho.org/graphql), and [Coinbase cbBTC documentation](https://www.coinbase.com/cbbtc).

## Verify

```sh
pnpm test
pnpm build
pnpm smoke:live
```

The unit tests cover pro-rata and union exposure, scenario detection, historical fallback, reverse traversal through new layers, duplicate paths, and portfolio impact. `smoke:live` needs internet access. The local server serves `/api/portfolio` (`source=auto` or `source=snapshot`, optional `scenario=CBBTC_DEPEG_30`), `/api/analyze` for a single Ethereum V1 vault, and `/api/health`.
