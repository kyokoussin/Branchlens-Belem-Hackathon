import Decimal from 'decimal.js';

const D = (value) => new Decimal(String(value));
const usd = (value) => D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const ratio = (value) => D(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toString();

function nonnegative(value, label) {
  try {
    const number = D(value);
    if (number.isFinite() && number.gte(0)) return number;
  } catch { /* Invalid analyst input. */ }
  throw new Error(`${label} must be a finite non-negative number.`);
}

function positive(value, label) {
  const number = nonnegative(value, label);
  if (number.isZero()) throw new Error(`${label} must be greater than zero.`);
  return number;
}

export function evaluateBorrowerScenario({ market, collateralPriceUsd, loanPriceUsd, collateralTokens, debtTokens, scenarioType = 'COLLATERAL_PRICE_SHOCK', shockPercent }) {
  if (scenarioType !== 'COLLATERAL_PRICE_SHOCK') return {
    status: 'UNSUPPORTED_FINANCIAL_MODEL', scenarioType,
    reason: scenarioType === 'ORACLE_STALE' ? 'A stale oracle can block or distort protocol actions, but it does not itself establish a collateral-price loss.' : 'The available market data does not support a defensible loss calculation for this incident type.',
  };
  const lltv = positive(market.allocations?.[0]?.lltv, 'Verified market LLTV');
  if (lltv.gt(1)) throw new Error('Verified market LLTV exceeds 100%.');
  const collateralPrice = positive(collateralPriceUsd, 'Collateral price');
  const loanPrice = positive(loanPriceUsd, 'Loan price');
  const collateral = positive(collateralTokens, 'Collateral token amount');
  const debt = nonnegative(debtTokens, 'Debt token amount');
  const row = market.allocations[0];
  if (collateral.decimalPlaces() > row.collateral.decimals || debt.decimalPlaces() > row.loan.decimals) throw new Error('Token amount has more decimal places than the verified token supports.');
  const shock = nonnegative(shockPercent, 'Price shock percent').div(100);
  if (shock.gt(1)) throw new Error('Price shock must be between 0% and 100%.');
  const collateralValue = collateral.mul(collateralPrice);
  const debtValue = debt.mul(loanPrice);
  const shockedCollateralValue = collateralValue.mul(D(1).minus(shock));
  const health = (value) => debtValue.isZero() ? null : ratio(value.mul(lltv).div(debtValue));
  const ltv = (value) => value.isZero() ? null : ratio(debtValue.div(value));
  const eligible = (value) => !debtValue.isZero() && value.mul(lltv).lte(debtValue);
  const shortfall = Decimal.max(0, debtValue.minus(shockedCollateralValue));
  return {
    status: 'CALCULATED_SCENARIO', scenarioType,
    source: 'REAL_MORPHO_MARKET_AND_TOKEN_PRICES_WITH_SIMULATED_POSITION_AND_SHOCK',
    assumptions: { collateralTokens: collateral.toString(), debtTokens: debt.toString(), shockPercent: D(shockPercent).toString() },
    inputs: { lltv: lltv.toString(), collateralPriceUsd: collateralPrice.toString(), loanPriceUsd: loanPrice.toString() },
    before: { collateralValueUsd: usd(collateralValue), debtValueUsd: usd(debtValue), equityUsd: usd(collateralValue.minus(debtValue)), ltv: ltv(collateralValue), healthFactor: health(collateralValue), liquidationEligible: eligible(collateralValue) },
    after: { collateralValueUsd: usd(shockedCollateralValue), debtValueUsd: usd(debtValue), equityUsd: usd(shockedCollateralValue.minus(debtValue)), ltv: ltv(shockedCollateralValue), healthFactor: health(shockedCollateralValue), liquidationEligible: eligible(shockedCollateralValue) },
    conditionalLenderShortfallUsd: usd(shortfall),
    limitations: [
      'Liquidation eligibility is not evidence of an executed liquidation or realized loss.',
      'The conditional shortfall is debt minus shocked collateral value when positive; it is not a forecast of lender loss.',
      'No borrower liquidation penalty or executable exit quote is inferred from a price shock.',
    ],
  };
}

export function compareHoldExit(input) {
  const { probabilityPercent, incrementalLossUsd, gasUsd, slippageUsd, feesUsd, unwindUsd, repaymentCapacityUsd, debtValueUsd, exitRemovesRisk = true } = input;
  const missing = ['probabilityPercent', 'incrementalLossUsd', 'gasUsd', 'slippageUsd', 'feesUsd', 'unwindUsd', 'repaymentCapacityUsd'].filter((key) => input[key] == null || input[key] === '');
  if (missing.length || !exitRemovesRisk) return { recommendation: 'INSUFFICIENT_DATA', missing: !exitRemovesRisk ? [...missing, 'residual risk after exit'] : missing, reason: 'Analyst assumptions or a verified exit route are required before comparing HOLD and EXIT.' };
  const probability = nonnegative(probabilityPercent, 'Incident probability').div(100);
  if (probability.gt(1)) throw new Error('Incident probability must be between 0% and 100%.');
  const loss = nonnegative(incrementalLossUsd, 'Conditional incremental loss');
  const gas = nonnegative(gasUsd, 'Gas cost');
  const slippage = nonnegative(slippageUsd, 'Swap slippage');
  const fees = nonnegative(feesUsd, 'Fees');
  const unwind = nonnegative(unwindUsd, 'Other unwind cost');
  const repayCapacity = nonnegative(repaymentCapacityUsd, 'Available repayment funds');
  const debt = nonnegative(debtValueUsd, 'Debt value');
  const exitCost = gas.plus(slippage).plus(fees).plus(unwind);
  const expectedHoldLoss = probability.mul(loss);
  const result = {
    expectedHoldLossUsd: usd(expectedHoldLoss), exitCostUsd: usd(exitCost),
    breakEvenProbabilityPercent: loss.isZero() ? null : ratio(exitCost.div(loss).mul(100)),
    requiredRepaymentUsd: usd(debt), availableRepaymentUsd: usd(repayCapacity),
    inputs: { probabilityPercent: D(probabilityPercent).toString(), incrementalLossUsd: loss.toString(), gasUsd: gas.toString(), slippageUsd: slippage.toString(), feesUsd: fees.toString(), unwindUsd: unwind.toString(), exitRemovesRisk },
    caveat: 'Debt repayment returns borrowed principal; it is a funding requirement, not an exit cost. All economic inputs are analyst estimates, not live quotes.',
  };
  if (repayCapacity.lt(debt)) return { ...result, recommendation: 'EXIT_BLOCKED', reason: 'Available repayment funds are below the debt amount needed to release collateral.' };
  return { ...result, recommendation: expectedHoldLoss.gt(exitCost) ? 'EXIT_FAVORED' : 'HOLD_FAVORED', reason: expectedHoldLoss.gt(exitCost) ? 'Assumed expected incremental hold loss exceeds estimated exit cost.' : 'Estimated exit cost is at least as high as assumed expected incremental hold loss.' };
}
