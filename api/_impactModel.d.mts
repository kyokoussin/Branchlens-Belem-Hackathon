import type { Impact, ImpactPosition, Position } from '../src/model';

export type ImpactScenarioRow = ImpactPosition & {
  estimatedFinancialLossUsd: string | null;
  temporarilyInaccessibleCapitalUsd: string | null;
  explanation: string;
};

export function evaluateImpactScenario(
  impact: Impact,
  positions: Position[],
  options?: { type?: string; marketLossPercent?: string },
): {
  type: string;
  affectedCapitalUsd: string;
  conditionalMaxPrincipalLossUsd: string;
  conditionalMaxAssumption: string;
  estimatedFinancialLossUsd: string | null;
  temporarilyInaccessibleCapitalUsd: string | null;
  lossDisplay: string;
  inaccessibleDisplay: string;
  note: string;
  affectedPositions: ImpactScenarioRow[];
};
