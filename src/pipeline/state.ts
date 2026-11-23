/**
 * Stage and item state machines.
 *
 * All transitions are validated here, so a retry, a resume and a cancellation
 * cannot leave an impossible state behind. Terminal states never transition
 * again inside a run; resume builds a fresh attempt through
 * `resumeStageStatus` / `resumeItemStatus` instead of re-transitioning them.
 */
import { PipelineStateError } from './errors'

export type PipelineStatus = 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled'
export type StageStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled' | 'skipped'
export type ItemStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped'

export type StateKind = 'stage' | 'item'

const STAGE_TRANSITIONS: Record<StageStatus, readonly StageStatus[]> = {
  // A run cancelled before a stage starts goes straight to `cancelled`.
  idle: ['running', 'skipped', 'cancelled'],
  running: [
    'succeeded',
    'failed',
    'partial',
    'cancelled',
  ],
  succeeded: [],
  failed: [],
  partial: [],
  cancelled: [],
  skipped: [],
}

const ITEM_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  pending: ['running', 'skipped', 'cancelled'],
  running: [
    'succeeded',
    'failed',
    'cancelled',
    'pending',
  ],
  succeeded: [],
  failed: [],
  cancelled: [],
  skipped: [],
}

function transitionsFor(kind: StateKind): Record<string, readonly string[]> {
  return kind === 'stage'
    ? STAGE_TRANSITIONS
    : ITEM_TRANSITIONS
}

/** Throw `PipelineStateError` when `from → to` is not declared by the machine. */
export function assertTransition(kind: StateKind, from: string, to: string): void {
  const allowed = transitionsFor(kind)[from]
  if (!allowed) {
    throw new PipelineStateError(`Unknown ${kind} state: ${from}`, {
      context: { kind, from, to },
    })
  }
  if (!allowed.includes(to)) {
    throw new PipelineStateError(`Illegal ${kind} transition: ${from} -> ${to}`, {
      context: { kind, from, to },
    })
  }
}

export function assertStageTransition(from: StageStatus, to: StageStatus): void {
  assertTransition('stage', from, to)
}

export function assertItemTransition(from: ItemStatus, to: ItemStatus): void {
  assertTransition('item', from, to)
}

/** Resume mapping: a finished stage stays done, anything else starts over. */
export function resumeStageStatus(status: StageStatus): 'idle' | 'skipped' {
  return status === 'succeeded' || status === 'skipped'
    ? 'skipped'
    : 'idle'
}

/** Resume mapping: a finished item stays done, anything else is re-run. */
export function resumeItemStatus(status: ItemStatus): 'pending' | 'skipped' {
  return status === 'succeeded' || status === 'skipped'
    ? 'skipped'
    : 'pending'
}
