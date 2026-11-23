import { describe, expect, it } from 'vitest'
import { PipelineStateError } from '../../src/pipeline/errors'
import {
  assertItemTransition,
  assertStageTransition,
  resumeItemStatus,
  resumeStageStatus,
} from '../../src/pipeline/state'

describe('stage transitions', () => {
  it.each([
    ['idle', 'running'],
    ['idle', 'skipped'],
    ['idle', 'cancelled'],
    ['running', 'succeeded'],
    ['running', 'failed'],
    ['running', 'partial'],
    ['running', 'cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertStageTransition(from, to)).not.toThrow()
  })

  it.each([
    ['idle', 'succeeded'],
    ['running', 'skipped'],
    ['succeeded', 'running'],
    ['failed', 'running'],
    ['cancelled', 'running'],
    ['skipped', 'running'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertStageTransition(from, to)).toThrow(PipelineStateError)
  })

  it('reports both states and the kind in the error', () => {
    try {
      assertStageTransition('succeeded', 'running')
      expect.unreachable('transition should have been rejected')
    }
    catch (error) {
      expect(error).toBeInstanceOf(PipelineStateError)
      const stateError = error as PipelineStateError
      expect(stateError.code).toBe('INVALID_TRANSITION')
      expect(stateError.message).toContain('succeeded -> running')
      expect(stateError.context).toMatchObject({ kind: 'stage', from: 'succeeded', to: 'running' })
    }
  })

  it('rejects unknown states', () => {
    expect(() => assertStageTransition('nope' as never, 'running')).toThrow(/Unknown stage state/)
  })
})

describe('item transitions', () => {
  it.each([
    ['pending', 'running'],
    ['pending', 'skipped'],
    ['pending', 'cancelled'],
    ['running', 'succeeded'],
    ['running', 'failed'],
    ['running', 'cancelled'],
    ['running', 'pending'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertItemTransition(from, to)).not.toThrow()
  })

  it.each([
    ['pending', 'succeeded'],
    ['succeeded', 'running'],
    ['failed', 'running'],
    ['cancelled', 'pending'],
    ['skipped', 'running'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertItemTransition(from, to)).toThrow(PipelineStateError)
  })
})

describe('resume mapping', () => {
  it.each([
    ['succeeded', 'skipped'],
    ['skipped', 'skipped'],
    ['failed', 'idle'],
    ['partial', 'idle'],
    ['cancelled', 'idle'],
    ['running', 'idle'],
    ['idle', 'idle'],
  ] as const)('maps stage %s to %s', (from, to) => {
    expect(resumeStageStatus(from)).toBe(to)
  })

  it.each([
    ['succeeded', 'skipped'],
    ['skipped', 'skipped'],
    ['failed', 'pending'],
    ['cancelled', 'pending'],
    ['running', 'pending'],
    ['pending', 'pending'],
  ] as const)('maps item %s to %s', (from, to) => {
    expect(resumeItemStatus(from)).toBe(to)
  })
})
