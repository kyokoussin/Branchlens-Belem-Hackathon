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

- A collateral price shock alone gives **no defensible supplier-loss number**. Actual lender loss requires realized bad debt, liquidation proceeds, recoveries, and the vault's accounting version. It remains `null`, displayed as **Not established**, rather than being set to zero or to the collateral price-change percentage.
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
