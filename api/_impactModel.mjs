import Decimal from 'decimal.js';

const money = (value) => new Decimal(value).toDecimalPlaces(2).toFixed(2);

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
    if (type === 'CHAIN_OUTAGE' && impact.selectedType === 'Blockchain') {
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
