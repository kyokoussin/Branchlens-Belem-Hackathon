# BranchLens calculations

All portfolio amounts are hypothetical analyst inputs. Market allocations, vault totals, token prices, LLTV, market IDs, and dependencies come from Morpho responses or a timestamped saved Morpho response. A graph relationship is exposure, not a probability of failure or a realized loss. USD amounts are rounded to cents at the points noted below; percentages in graph boxes are rounded to one decimal place, with positive shares under 0.1% shown as `<0.1%`.

## Market exposure and the percentage inside each box

For a simulated vault holding of **P** USD, a Morpho-reported vault total of **T** USD, and that vault's supply allocation to market **m** of **Aₘ** USD:

`position market exposure Eₘ = round_cents(P × Aₘ / T)`

The model rejects materially inconsistent allocation totals rather than normalizing them to 100%. Any unallocated or unquantified principal stays separate. A simulated direct-market supplier has `Eₘ = P`; a borrower's collateral is tracked separately from lender principal.

For an incoming relationship `parent → child`, the percentage **inside the child box** is:

`share = 100 × capital linked through this relationship / capital linked to the parent`

For a vault-to-market link, this is `100 × Aₘ / T`. For a market-to-its-collateral, market-to-oracle, or other complete structural link, it is 100% of **that market's linked capital**, not 100% of the entire portfolio. When several positions share a node, the numerator and denominator are summed across those positions; each incoming parent gets its own line inside the child box. These percentages must not be added across overlapping paths.

**Saved-snapshot example:** The illustrative Steakhouse position is $1,000,000, the saved Morpho vault total is $65,300,707.650424466, and its first cbBTC/USDC allocation is $27,948,780.37633852. That market's attributed principal is `round_cents(1,000,000 × 27,948,780.37633852 / 65,300,707.650424466) = $428,001.19`; the vault-to-market box reads **42.8%**. A fresh Morpho response can change this number.

## Reverse impact and double-counting

For each position, reverse traversal finds every path from the selected dependency to the position. It gathers distinct funded market IDs reached by any path. The position's affected principal is the sum of its distinct market exposures, capped at the position principal. A dependency linked directly to a vault or position reaches the entire assumed principal. **Unique affected capital** is the sum of these per-position amounts. Multiple graph paths to one market do not multiply capital.

This is the amount *linked* to a dependency, not the amount expected to be lost. The optional “conditional 100% principal-loss bound” simply equals unique affected capital under an explicitly extreme, hypothetical complete-loss assumption.

## What can and cannot be called a financial loss

### Default demo stress estimate

The default Impact View now **always selects a clearly simulated stress case**, so its two estimate cards have numbers. These are calculated from Morpho market data and fixed, visible analyst assumptions. They are not observed bad debt or a withdrawal quote.

For a collateral dependency such as cbBTC, use a hypothetical 30% collateral price fall. For each distinct affected market, let **E** be the position's attributed principal, **B** the Morpho market borrow USD, **S** its supply USD, **L** its LLTV, and **Q** its available market liquidity USD:

`gross shortfall fraction = max(0, 1 − 0.70 / L)`
`modeled lender-loss rate = min(1, (B / S) × 0.25 × gross shortfall fraction × 0.50)`
`modeled financial loss = sum_distinct_markets(E × modeled lender-loss rate)`
`modeled immediate exit gap = sum_distinct_markets(E × max(0, 1 − min(1, Q / S)))`

The **25%** assumes that share of borrowing sits at the liquidation threshold. The **50%** assumes half of the gross shortfall is recovered. The market liquidity gap assumes each affected allocation is withdrawn simultaneously from its own market, without vault reallocation. It is an immediate-liquidity proxy, not capital known to be frozen. When market totals are unavailable, the app uses Morpho's reported utilization; if that is also unavailable, it uses an explicit 80% utilization assumption. Missing LLTV uses an explicit 86% assumption. A vault-wide unallocated remainder uses 2% impairment and its reported vault liquidity ratio, or an explicit 50% liquid ratio if unavailable. Each position's loss and exit gap are capped at its uniquely affected principal.

**Simulated borrowers use a different model.** Their tracked amount is collateral, not supplier principal. Under the same 30% collateral shock, `borrower collateral value decline = affected collateral × 0.30`. This is a mark-to-market decline, not realized lender bad debt. The corresponding immediate-exit constraint is `min(affected collateral, assumed debt / (LLTV × 0.70))`: collateral needed to support that debt after the shock and therefore dependent on repayment before withdrawal. Missing LLTV uses the stated 86% assumption. The portfolio estimate can combine supplier modeled loss and borrower mark-to-market decline, but the individual rows label them separately. For other default dependency stresses, the analogous collateral shock is 2%; these are analyst assumptions, not Morpho observations.

For a blockchain dependency, the default scenario is a **simulated 24-hour complete settlement halt**: temporarily inaccessible capital equals unique affected principal, while the modeled economic cost is `affected principal × assumed 5% annual carry / 365`. This is an opportunity cost, not principal impairment. For other dependency types, the default financial stress is an explicitly assumed 2% impairment of attributed principal; the exit gap still uses Morpho market liquidity. Changing the advanced scenario can intentionally remove these assumptions and return an unquantified result.

**Saved-snapshot check:** The cbBTC dependency reaches $773,729.78 of unique simulated principal across five supplied positions. The formula produces $16,219.18 modeled financial loss and a $697,424.89 market-only immediate exit gap. Ethereum's 24-hour outage case reaches $2,650,000, with $363.02 modeled opportunity cost and $2,650,000 temporarily inaccessible. Fresh Morpho data changes these figures.

- A collateral price shock alone gives **no observed supplier-loss number**. The default stress estimate above supplies an explicit scenario with borrower and recovery assumptions. Actual lender loss still requires realized bad debt, liquidation proceeds, recoveries, and the vault's accounting version.
- In the separate hypothetical **realized market bad-debt** model, the analyst enters a lender-loss rate **r** for one verified market. For a direct-market supplier or a vault verified as V1.0, `conditional position loss = round_cents(min(affected principal, Eₘ × r / 100))`. The portfolio total is the sum of quantifiable position losses. It stays unavailable if any affected vault is V1.1 or its accounting version is unverified. V1.1 does not immediately realize the same depositor share-price loss as V1.0.
- A simulated **complete chain outage** gives `temporarily inaccessible capital = unique affected capital` *while the halt lasts*. It is not permanent financial loss. For a collateral shock, oracle fault, or liquidity concern, the blocked amount stays `null`, displayed as **Not measured**, until chain status or wallet-specific withdrawal evidence is available. Market-wide liquidity is not a wallet withdrawal quote.

## Borrower scenario and stay-or-exit signal

For an analyst-entered borrower with collateral tokens **q**, debt tokens **d**, Morpho-sourced USD prices **Pc** and **Pd**, market LLTV **L**, and a hypothetical collateral shock **s** as a fraction:

`collateral value C = q × Pc`  
`debt value D = d × Pd`  
`shocked collateral C′ = C × (1 − s)`  
`equity = C − D`; `shocked equity = C′ − D`  
`LTV = D / C`; `health factor = C × L / D` (undefined when D = 0)  
`liquidation eligible in scenario ⇔ C′ × L ≤ D`  
`conditional gross lender shortfall = max(0, D − C′)`

The shortfall is a gross scenario bound before liquidation execution, costs, or recoveries; it is **not** an observed supplier loss. The saved borrower snapshot's default 1 cbBTC, 60,000 USDC debt, 30% shock and 86% LLTV yield collateral $82,862.55 → $58,003.78, debt $59,981.26, health factor 1.18806749 → 0.83164724, and conditional gross shortfall $1,977.48. Live prices will produce different figures.

For the decision worksheet, the analyst supplies incident probability **p**, incremental loss if it occurs **X**, requested exit fraction **f**, and estimated gas, slippage, fees, and unwind costs:

`expected hold loss = p × X`  
`expected loss avoided by exit = p × X × f`  
`expected residual loss = p × X × (1 − f)`  
`exit cost = gas + slippage + fees + unwind`  
`required repayment = D × f`  
`remaining collateral exposure = C × (1 − f)`  
`break-even incident probability = exit cost / (X × f)` when `X × f > 0`

Exit is blocked in the worksheet if the assumed repayment funds are below `D × f`. Otherwise it favors the requested partial or full exit only when expected loss avoided **exceeds** estimated exit cost. This is a comparison of **analyst assumptions**, not a trading recommendation or executable quote. Default inputs at 40% exit give $3,000 expected hold loss, $1,200 avoided, $1,800 residual, $150 estimated exit cost, and a 3.75% break-even probability. The simulated bot never sends a transaction.

Source for V1.0/V1.1 accounting behavior: [Morpho's bad-debt guide](https://docs.morpho.org/curate/tutorials-v1/bad-debt/).
