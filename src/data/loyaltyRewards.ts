/**
 * Loyalty program tiers.
 *
 * PLACEHOLDER DATA: rebuilt because the original file was never committed.
 * Thresholds, multipliers and benefits are sample values.
 */

export interface LoyaltyTier {
  id: string;
  name: string;
  minPurchaseUsd: number;
  pointsMultiplier: number;
  referralBonusPercent: number;
  summary: string;
  benefits: string[];
  accentTextClass: string;
  barFillClass: string;
}

export const LOYALTY_TIERS: LoyaltyTier[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    minPurchaseUsd: 0,
    pointsMultiplier: 1,
    referralBonusPercent: 2,
    summary: 'Starting tier for every new member.',
    benefits: ['Earn 1 point per $1 spent', 'Standard support'],
    accentTextClass: 'text-amber-700 dark:text-amber-500',
    barFillClass: 'bg-amber-600',
  },
  {
    id: 'silver',
    name: 'Silver',
    minPurchaseUsd: 500,
    pointsMultiplier: 1.25,
    referralBonusPercent: 3,
    summary: 'Unlocked after $500 in purchases.',
    benefits: ['1.25x points', 'Priority support queue'],
    accentTextClass: 'text-slate-500 dark:text-slate-300',
    barFillClass: 'bg-slate-400',
  },
  {
    id: 'gold',
    name: 'Gold',
    minPurchaseUsd: 2000,
    pointsMultiplier: 1.5,
    referralBonusPercent: 5,
    summary: 'Unlocked after $2,000 in purchases.',
    benefits: ['1.5x points', 'Priority support queue', 'Early access to new providers'],
    accentTextClass: 'text-yellow-600 dark:text-yellow-400',
    barFillClass: 'bg-yellow-500',
  },
  {
    id: 'platinum',
    name: 'Platinum',
    minPurchaseUsd: 5000,
    pointsMultiplier: 2,
    referralBonusPercent: 8,
    summary: 'Unlocked after $5,000 in purchases.',
    benefits: ['2x points', 'Dedicated account manager', 'Early access to new providers'],
    accentTextClass: 'text-blue-600 dark:text-blue-400',
    barFillClass: 'bg-blue-600',
  },
];

export interface LoyaltyStatus {
  totalPurchases: number;
  currentTier: LoyaltyTier;
  nextTier: LoyaltyTier | null;
  amountToNextTier: number;
  progressPercent: number;
  pointsEarned: number;
}

export function evaluateLoyaltyStatus(totalPurchases: number): LoyaltyStatus {
  const total = Number.isFinite(totalPurchases) && totalPurchases > 0 ? totalPurchases : 0;
  let index = 0;
  for (let i = 0; i < LOYALTY_TIERS.length; i++) {
    if (total >= LOYALTY_TIERS[i].minPurchaseUsd) index = i;
  }
  const currentTier = LOYALTY_TIERS[index];
  const nextTier = LOYALTY_TIERS[index + 1] ?? null;
  const amountToNextTier = nextTier ? Math.max(0, nextTier.minPurchaseUsd - total) : 0;
  const progressPercent = nextTier
    ? Math.min(
        100,
        Math.round(
          ((total - currentTier.minPurchaseUsd) / (nextTier.minPurchaseUsd - currentTier.minPurchaseUsd)) * 100,
        ),
      )
    : 100;
  return {
    totalPurchases: total,
    currentTier,
    nextTier,
    amountToNextTier,
    progressPercent,
    pointsEarned: Math.floor(total * currentTier.pointsMultiplier),
  };
}
