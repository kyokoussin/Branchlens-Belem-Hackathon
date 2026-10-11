import Decimal from 'decimal.js';

const money = (value) => new Decimal(value).toDecimalPlaces(2).toFixed(2);
const bounded = (value) => Decimal.max(0, Decimal.min(1, value));

function demoStressForPosition(item, position, selectedType) {
  const exposed = new Decimal(item.exposedPrincipalUsd);
  if (selectedType === 'Blockchain') return {
    loss: exposed.mul('0.05').div(365),
    inaccessible: exposed,
    explanation: '24-hour complete settlement halt: all linked capital is temporarily unavailable; the financial figure is one day of opportunity cost at an assumed 5% annual rate.',
  };
  if (position?.positionType === 'borrow') {
    const allocation = position.analysis.vault.allocations.find((entry) => item.marketIds.includes(entry.marketId));
    const lltv = allocation?.lltv && new Decimal(allocation.lltv).gt(0) ? new Decimal(allocation.lltv) : new Decimal('0.86');
    const debt = Decimal.max(0, new Decimal(position.borrowDebtUsd || 0));
    const shock = selectedType === 'CollateralToken' ? new Decimal('0.30') : new Decimal('0.02');
    return {
      loss: exposed.mul(shock),
      inaccessible: Decimal.min(exposed, debt.div(lltv.mul(new Decimal(1).minus(shock)))),
      explanation: `Simulated borrower: ${shock.mul(100).toString()}% collateral mark-to-market decline, not lender bad debt. Collateral required to support the assumed debt after the shock = debt ÷ (market LLTV × remaining collateral-price fraction), capped at the tracked collateral value; repayment may release it.`,
    };
  }
  const rows = new Map(position?.analysis?.exposure?.marketExposures?.map((row) => [row.marketId, row]) || []);
  let loss = new Decimal(0);
  let inaccessible = new Decimal(0);
  let attributed = new Decimal(0);
  for (const marketId of new Set(item.marketIds)) {
    const row = rows.get(marketId);
    if (!row) continue;
    const allocation = position.analysis.vault.allocations.find((entry) => entry.marketId === marketId);
    const capital = new Decimal(row.capitalExposedUsd);
    attributed = attributed.plus(capital);
    const supply = allocation?.marketSupplyUsd && new Decimal(allocation.marketSupplyUsd).gt(0) ? new Decimal(allocation.marketSupplyUsd) : null;
    const utilization = allocation?.utilization != null ? bounded(new Decimal(allocation.utilization)) : new Decimal('0.8');
    const borrowRatio = supply && allocation?.marketBorrowUsd != null ? bounded(new Decimal(allocation.marketBorrowUsd).div(supply)) : utilization;
    const liquidRatio = supply && allocation?.marketLiquidityUsd != null ? bounded(new Decimal(allocation.marketLiquidityUsd).div(supply)) : Decimal.max(0, new Decimal(1).minus(utilization));
    // Explicit stress assumptions: 30% collateral shock, 25% of borrow at
    // liquidation threshold, and half of the gross shortfall recovered.
    const lltv = allocation?.lltv && new Decimal(allocation.lltv).gt(0) ? new Decimal(allocation.lltv) : new Decimal('0.86');
    const shortfallFraction = Decimal.max(0, new Decimal(1).minus(new Decimal('0.70').div(lltv)));
    const lossRate = selectedType === 'CollateralToken'
      ? bounded(borrowRatio.mul('0.25').mul(shortfallFraction).mul('0.50'))
      : new Decimal('0.02');
    loss = loss.plus(capital.mul(lossRate));
    inaccessible = inaccessible.plus(capital.mul(new Decimal(1).minus(liquidRatio)));
  }
  // A vault-wide or position-level dependency can also reach unallocated
  // principal. Apply the same explicit 2% stress and the vault liquidity ratio.
  const remainder = Decimal.max(0, exposed.minus(attributed));
  if (remainder.gt(0)) {
    const vault = position?.analysis?.vault;
    const vaultLiquidRatio = vault?.liquidityUsd != null && new Decimal(vault.totalUsd).gt(0)
      ? bounded(new Decimal(vault.liquidityUsd).div(vault.totalUsd)) : new Decimal('0.5');
    loss = loss.plus(remainder.mul('0.02'));
    inaccessible = inaccessible.plus(remainder.mul(new Decimal(1).minus(vaultLiquidRatio)));
  }
  return {
    loss: Decimal.min(exposed, loss),
    inaccessible: Decimal.min(exposed, inaccessible),
    explanation: selectedType === 'CollateralToken'
      ? 'Stress estimate: real Morpho borrow/supply, LLTV and market liquidity with an assumed 30% collateral shock, 25% of borrowers at LLTV, and 50% shortfall recovery.'
      : 'Stress estimate: assumed 2% market impairment on linked principal; immediate exit gap uses Morpho market liquidity divided by market supply.',
  };
}

export function evaluateImpactScenario(impact, positions, { type = 'DEPENDENCY_ONLY', marketLossPercent = '' } = {}) {
  const byId = new Map(positions.map((position) => [position.id, position]));
  const marketId = impact.selectedType === 'LendingMarket' ? impact.selectedNodeId.split(':').at(-1) : null;
  const rate = /^\d+(?:\.\d{1,4})?$/.test(String(marketLossPercent)) ? new Decimal(marketLossPercent) : null;
  const usableRate = rate?.gt(0) && rate.lte(100);
  const rows = impact.affectedPositions.map((item) => {
    const position = byId.get(item.id);
    let estimatedFinancialLossUsd = null;
    let temporarilyInaccessibleCapitalUsd = null;
    let explanation = item.reason;
    if (type === 'DEMO_STRESS') {
      const stress = demoStressForPosition(item, position, impact.selectedType);
      estimatedFinancialLossUsd = money(stress.loss);
      temporarilyInaccessibleCapitalUsd = money(stress.inaccessible);
      explanation += ` ${stress.explanation} The exit gap is a liquidity proxy, not a wallet quote or proven freeze.`;
    } else if (type === 'CHAIN_OUTAGE' && impact.selectedType === 'Blockchain') {
      temporarilyInaccessibleCapitalUsd = item.exposedPrincipalUsd;
      explanation += ' Under the assumed complete chain halt, this capital cannot be transacted until settlement resumes; no permanent loss is inferred.';
    } else if (type === 'ORACLE_FAILURE') {
      explanation += ' An oracle fault can disrupt valuation or liquidations, but bad debt and withdrawal effects require separate evidence.';
    } else if (type === 'LIQUIDITY_STRESS') {
      explanation += ' Market-wide liquidity is not a wallet-specific withdrawal quote; the blocked amount and any loss are unknown.';
    } else if (type === 'COLLATERAL_SHOCK') {
      explanation += ' Collateral repricing alone cannot quantify lender loss without borrower debt, liquidations, and recoveries.';
    } else if (type === 'MARKET_BAD_DEBT') {
      if (!marketId || !usableRate) {
        explanation += ' Select a lending market and enter a hypothetical realized lender-loss percentage to model loss.';
      } else if (!position || position.positionType === 'borrow') {
        explanation += ' Supplier bad-debt loss cannot be applied to a simulated borrower position.';
      } else if (position.analysis.vault.version !== 'MORPHO_MARKET' && position.analysis.vault.accountingVersion !== '1.0') {
        explanation += position.analysis.vault.accountingVersion === '1.1'
          ? ' Morpho Vault V1.1 does not automatically realize bad debt in share price; eventual depositor loss depends on recovery and withdrawal order.'
          : ' Vault V1.0 versus V1.1 accounting has not been verified, so depositor loss cannot be calculated.';
      } else {
        const allocation = position.analysis.exposure.marketExposures.find((row) => row.marketId === marketId);
        if (allocation) {
          estimatedFinancialLossUsd = money(Decimal.min(new Decimal(item.exposedPrincipalUsd), new Decimal(allocation.capitalExposedUsd).mul(rate).div(100)));
          explanation += ` Conditional supplier loss uses ${money(allocation.capitalExposedUsd)} invested in this market × the analyst's ${rate.toString()}% realized market-loss assumption.`;
        } else explanation += ' The market allocation is missing, so a loss cannot be calculated.';
      }
    }
    return { ...item, estimatedFinancialLossUsd, temporarilyInaccessibleCapitalUsd, explanation };
  });
  const total = (field) => rows.length && rows.every((row) => row[field] !== null)
    ? money(rows.reduce((sum, row) => sum.plus(row[field]), new Decimal(0))) : null;
  const notes = {
    DEMO_STRESS: impact.selectedType === 'Blockchain'
      ? 'SIMULATED 24-hour chain halt. Financial figure = linked capital × assumed 5% annual carry ÷ 365. Temporarily inaccessible = linked capital. Neither is an observed incident.'
      : impact.selectedType === 'CollateralToken'
      ? 'SIMULATED 30% collateral shock. Suppliers: market loss rate = borrow ÷ supply × 25% near LLTV × max(0, 1 − 0.70 ÷ LLTV) × 50% unrecovered; immediate exit gap uses exposure × (1 − market liquidity ÷ supply). Borrowers: collateral value decline = tracked collateral × 30%; repayment-dependent collateral = min(tracked collateral, assumed debt ÷ (LLTV × 0.70)). Vault withdrawals may differ.'
        : 'SIMULATED market stress. Estimated loss = distinct affected market exposure × assumed 2% impairment. Immediate exit gap = exposure × (1 − Morpho market liquidity ÷ supply). Vault withdrawals may differ.',
    DEPENDENCY_ONLY: 'No incident has been specified. A graph path measures capital linked to a component, not money lost or blocked.',
    CHAIN_OUTAGE: impact.selectedType === 'Blockchain' ? 'Assumes the selected chain is completely unable to settle transactions. Capital is temporarily inaccessible while the halt lasts; permanent financial loss is not estimated.' : 'Select a blockchain node to model a complete chain outage.',
    ORACLE_FAILURE: 'Oracle failure can alter valuations or liquidations. Its financial or withdrawal impact needs market-specific incident and recovery evidence.',
    LIQUIDITY_STRESS: 'Liquidity stress is not automatically permanent loss. Market-wide liquidity cannot determine a particular investor’s withdrawable amount.',
    COLLATERAL_SHOCK: 'Collateral repricing is not itself realized lender bad debt. Borrower health, liquidation proceeds, and recoveries are missing.',
    MARKET_BAD_DEBT: !marketId ? 'Select a specific lending market; a chain or shared token does not identify a single realized bad-debt event.' : !usableRate ? 'Enter a hypothetical realized lender-loss percentage above 0 and at most 100. Morpho has not reported this incident.' : 'Conditional scenario only: applies the entered market lender-loss rate once to each position’s verified allocation. V1.1 or unverified vault accounting remains unquantified.',
  };
  return {
    type,
    affectedCapitalUsd: impact.uniqueCapitalExposedUsd,
    conditionalMaxPrincipalLossUsd: impact.uniqueCapitalExposedUsd,
    conditionalMaxAssumption: 'Hypothetical 100% permanent loss of every uniquely attributed dollar; not a prediction, probability, or observed loss.',
    estimatedFinancialLossUsd: total('estimatedFinancialLossUsd'),
    temporarilyInaccessibleCapitalUsd: total('temporarilyInaccessibleCapitalUsd'),
    lossDisplay: total('estimatedFinancialLossUsd') ?? 'Not established',
    inaccessibleDisplay: total('temporarilyInaccessibleCapitalUsd') ?? 'Not measured',
    note: notes[type] || notes.DEPENDENCY_ONLY,
    affectedPositions: rows,
  };
}
