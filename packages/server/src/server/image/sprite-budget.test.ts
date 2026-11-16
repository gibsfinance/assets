import { describe, it, expect } from 'vitest'
import {
  SPRITE_BUSY_RETRY_SECONDS,
  SPRITE_CLIENT_BUDGET,
  SPRITE_GLOBAL_BUDGET,
  SPRITE_OVER_BUDGET,
  SPRITE_BUSY,
  SPRITE_PLATED_WEIGHT,
  createSpriteBudget,
  createSpriteGate,
  sheetCost,
} from './sprite-budget'
import { DEFAULT_WINDOW_MS } from './rate-limit'
import { GATE_FULL } from './concurrency-gate'

/** A clock the test moves by hand. */
function clock(start = 0) {
  let at = start
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

describe('sheetCost', () => {
  it('charges one unit for each cell of an unplated sheet', () => {
    expect(sheetCost({ cells: 500, plated: false })).toBe(500)
  })

  it('charges a plated sheet its plated weight for each cell', () => {
    expect(SPRITE_PLATED_WEIGHT).toBe(2)
    expect(sheetCost({ cells: 500, plated: true })).toBe(1000)
  })

  it('charges nothing for a sheet with no cells, because none is drawn', () => {
    expect(sheetCost({ cells: 0, plated: true })).toBe(0)
  })
})

describe('createSpriteBudget', () => {
  it('lets a caller spend up to its own budget, then refuses that caller alone', () => {
    const budget = createSpriteBudget({ clientBudget: 10, globalBudget: 100, now: clock().now })
    expect(budget.spend({ clientAddress: 'a', cost: 10 })).toBe(true)
    expect(budget.canSpend({ clientAddress: 'a', cost: 1 })).toBe(false)
    expect(budget.canSpend({ clientAddress: 'b', cost: 10 })).toBe(true)
  })

  it('refuses every caller once the global budget is spent, whoever is asking', () => {
    const budget = createSpriteBudget({ clientBudget: 100, globalBudget: 12, now: clock().now })
    expect(budget.spend({ clientAddress: 'a', cost: 8 })).toBe(true)
    expect(budget.canSpend({ clientAddress: 'b', cost: 5 })).toBe(false)
    expect(budget.canSpend({ clientAddress: 'b', cost: 4 })).toBe(true)
  })

  it('applies only the global budget when callers cannot be told apart', () => {
    const budget = createSpriteBudget({ clientBudget: 1, globalBudget: 5, now: clock().now })
    expect(budget.spend({ clientAddress: null, cost: 5 })).toBe(true)
    expect(budget.canSpend({ clientAddress: null, cost: 1 })).toBe(false)
  })

  it('answers whether a sheet fits without spending anything', () => {
    const budget = createSpriteBudget({ clientBudget: 10, globalBudget: 100, now: clock().now })
    expect(budget.canSpend({ clientAddress: 'a', cost: 10 })).toBe(true)
    expect(budget.canSpend({ clientAddress: 'a', cost: 10 })).toBe(true)
  })

  it('spends nothing from either budget when one of them refuses', () => {
    const budget = createSpriteBudget({ clientBudget: 3, globalBudget: 100, now: clock().now })
    expect(budget.spend({ clientAddress: 'a', cost: 4 })).toBe(false)
    expect(budget.canSpend({ clientAddress: 'a', cost: 3 })).toBe(true)
  })

  it('renews every budget when the window passes', () => {
    const time = clock()
    const budget = createSpriteBudget({ clientBudget: 5, globalBudget: 5, now: time.now })
    expect(budget.spend({ clientAddress: 'a', cost: 5 })).toBe(true)
    expect(budget.canSpend({ clientAddress: 'a', cost: 1 })).toBe(false)
    time.advance(DEFAULT_WINDOW_MS + 1)
    expect(budget.spend({ clientAddress: 'a', cost: 5 })).toBe(true)
  })

  it('ships with budgets that a single plated 500-cell sheet fits in, but a flood does not', () => {
    const budget = createSpriteBudget({ now: clock().now })
    const plated500 = sheetCost({ cells: 500, plated: true })
    expect(plated500).toBeLessThanOrEqual(SPRITE_CLIENT_BUDGET)
    expect(SPRITE_GLOBAL_BUDGET).toBeGreaterThan(SPRITE_CLIENT_BUDGET)
    let served = 0
    while (budget.spend({ clientAddress: 'flood', cost: plated500 })) served += 1
    expect(served).toBe(Math.floor(SPRITE_CLIENT_BUDGET / plated500))
  })
})

describe('refusal constants', () => {
  it('asks a caller turned away for load to wait a window, and a busy line to wait seconds', () => {
    expect(SPRITE_OVER_BUDGET).toMatchObject({ status: 429, retryAfterSeconds: DEFAULT_WINDOW_MS / 1000 })
    expect(SPRITE_BUSY).toMatchObject({ status: 503, retryAfterSeconds: SPRITE_BUSY_RETRY_SECONDS })
  })
})

describe('createSpriteGate', () => {
  it('turns a sheet away, without running it, when its slot and its line are both taken', async () => {
    const gate = createSpriteGate({ limit: 1, maxQueue: 0 })
    let release: () => void = () => {}
    const holding = gate.run(() => new Promise<void>((resolve) => (release = resolve)))
    let ran = false
    const turnedAway = await gate.run(async () => {
      ran = true
    })
    expect(turnedAway).toBe(GATE_FULL)
    expect(ran).toBe(false)
    release()
    await holding
  })

  it('draws a sheet when a slot is free', async () => {
    const gate = createSpriteGate({ limit: 1, maxQueue: 0 })
    expect(await gate.run(async () => 'drawn')).toBe('drawn')
  })
})
