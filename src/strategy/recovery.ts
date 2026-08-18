import type { Direction } from '../core/digitMath.ts';

export interface LadderOption {
  direction: Direction;
  barrier: number;
  estWin: number;
  ask: number;
  payout: number;
}

export type StrategyMode = 'conservative' | 'martingale' | 'boosted_martingale';

export type RecoveryReason = 'base' | 'martingale' | 'boosted_martingale';

export interface RecoveryDecision {
  stake: number;
  direction: Direction;
  barrier: number;
  reason: RecoveryReason;
  estWin: number;
  holds: boolean;
  holdReason?: string;
}

export interface RecoveryContext {
  streak: number;
  lost: number;
  baseStake: number;
  maxStake: number;
  minRecoveryWinRate: number;
  martingaleSteps: number;
  maxConsecutiveLosses: number;
  strategy: StrategyMode;
  multiplier: number;
}

export function planRecovery(
  ladder: LadderOption[],
  ctx: RecoveryContext,
  preference: { direction: Direction; barrier: number },
): RecoveryDecision {
  const preferred =
    ladder.find((o) => o.direction === preference.direction && o.barrier === preference.barrier) ?? ladder[0];

  // Conservative: flat bet every round, never raise the stake and never change the barrier.
  if (ctx.strategy === 'conservative') {
    return {
      stake: ctx.baseStake,
      direction: preferred?.direction ?? 'over',
      barrier: preferred?.barrier ?? 1,
      reason: 'base',
      estWin: preferred?.estWin ?? 0.8,
      holds: false,
    };
  }

  if (ctx.streak === 0) {
    return {
      stake: ctx.baseStake,
      direction: preferred?.direction ?? 'over',
      barrier: preferred?.barrier ?? 1,
      reason: 'base',
      estWin: preferred?.estWin ?? 0.8,
      holds: false,
    };
  }

  if (ctx.streak + 1 > ctx.maxConsecutiveLosses) {
    return {
      stake: 0,
      direction: 'over',
      barrier: 1,
      reason: ctx.strategy === 'boosted_martingale' ? 'boosted_martingale' : 'martingale',
      estWin: 0,
      holds: true,
      holdReason: `consecutive loss cap (${ctx.maxConsecutiveLosses}) reached`,
    };
  }

  // Martingale family: redo the SAME barrier (over 0 stays over 0 - never escalate to over 2/3),
  // raising the stake so a win covers the streak.
  const boosted = ctx.strategy === 'boosted_martingale';
  const multiple = boosted ? Math.max(2, ctx.multiplier) : 2;
  const step = Math.min(ctx.streak, ctx.martingaleSteps);
  const stake = Math.min(ctx.baseStake * multiple ** step, ctx.maxStake);
  return {
    stake,
    direction: preferred?.direction ?? 'over',
    barrier: preferred?.barrier ?? 1,
    reason: boosted ? 'boosted_martingale' : 'martingale',
    estWin: preferred?.estWin ?? 0.8,
    holds: false,
  };
}