/**
 * What a sprite sheet costs the server, and the budgets and gate that keep sheet drawing bounded.
 *
 * A sheet is drawn cell by cell in one process, so its cost grows with its cell count. Its address
 * carries size, columns, gap, scale and every plate option, so an anonymous caller can make a new
 * address on every request and so force a fresh draw each time. The edge cache cannot stop that: it
 * holds only addresses it has already seen. The answer is the same as for single plated images:
 * a budget that is spent only when a sheet is drawn, and a gate that limits drawing at one moment.
 *
 * A sheet is charged in cells: one unit for each cell drawn without a plate, and `SPRITE_PLATED_WEIGHT`
 * units for each cell drawn with one. Measured on the development machine, a warm 500-cell sheet
 * costs about the same with or without a contrast plate (1.1 s against 1.2 s), but a cold one costs
 * about half as much again (1.9 s), because each logo is measured once. The weight of 2 is a round
 * figure above that cold cost, and it also covers the plate layer. A 500-cell plated sheet therefore
 * costs 1000 units; a 2000-cell unplated sheet costs 2000.
 */
import config from '../../../config'
import { createRateLimiter, DEFAULT_WINDOW_MS, type RateLimiter } from './rate-limit'
import { createConcurrencyGate, type ConcurrencyGate } from './concurrency-gate'
import type { Refusal } from './refusal'

/** Units a plated cell costs, against one for an unplated cell. */
export const SPRITE_PLATED_WEIGHT = 2

/**
 * Units one caller may spend in one window. 3000 is six unplated 500-cell sheets, or three plated ones, a
 * minute. A page with a few lists fits; a loop asking for new addresses does not.
 */
export const SPRITE_CLIENT_BUDGET = 3000

/**
 * Units all callers together may spend in one window. About 20,000 cells a minute is roughly what one
 * drawing slot can render, so the global budget stops a spread of callers from keeping the slot busy
 * with drawing the server cannot finish.
 */
export const SPRITE_GLOBAL_BUDGET = 20_000

/** Sheets that may be drawn at once for one caller (running plus waiting). */
export const SPRITE_PLACES_PER_CLIENT = 2

/** Seconds a caller is told to wait when the sheet line is full. */
export const SPRITE_BUSY_RETRY_SECONDS = 2

/** What a caller is told when the sheet budget is spent. Retrying after one window is when the budget renews. */
export const SPRITE_OVER_BUDGET: Refusal = {
  status: 429,
  retryAfterSeconds: DEFAULT_WINDOW_MS / 1000,
  message: 'too many sprite sheets requested, for this list or from this address; try again later',
}

/** What a caller is told when the sheet line is full. */
export const SPRITE_BUSY: Refusal = {
  status: 503,
  retryAfterSeconds: SPRITE_BUSY_RETRY_SECONDS,
  message: 'too many sprite sheets are being drawn; try again shortly',
}

/**
 * The cost of drawing a sheet, in units. A sheet with no cells draws nothing and costs nothing.
 *
 * @param input.cells Cells the sheet draws.
 * @param input.plated Whether a plate is painted on each cell.
 * @returns Units to spend from the budgets.
 */
export function sheetCost({ cells, plated }: { cells: number; plated: boolean }): number {
  return plated ? cells * SPRITE_PLATED_WEIGHT : cells
}

/** What a sheet request spends from: the caller, when they can be told apart, and the units. */
export interface SheetSpend {
  clientAddress: string | null
  cost: number
}

/** Budgets for sheet drawing, per caller and across all callers. */
export interface SpriteBudget {
  /** Whether the sheet fits both budgets right now. Spends nothing. */
  canSpend: (spend: SheetSpend) => boolean
  /** Spend the sheet from both budgets, or nothing when either would be passed. */
  spend: (spend: SheetSpend) => boolean
}

/** The one key the global budget counts under. */
const ALL_SHEETS = 'all-sheets'

/**
 * Build the sheet budgets. Each is a rate limiter, so each renews by window like the image budgets do.
 *
 * @param options.clientBudget Units one caller may spend in a window.
 * @param options.globalBudget Units all callers may spend in a window.
 * @param options.now The clock. Defaults to the wall clock.
 */
export function createSpriteBudget({
  clientBudget = SPRITE_CLIENT_BUDGET,
  globalBudget = SPRITE_GLOBAL_BUDGET,
  now,
}: { clientBudget?: number; globalBudget?: number; now?: () => number } = {}): SpriteBudget {
  const globalLimiter: RateLimiter = createRateLimiter({ perImageLimit: globalBudget, globalLimit: globalBudget, now })
  const clientLimiter: RateLimiter = createRateLimiter({ perImageLimit: clientBudget, globalLimit: Infinity, now })

  const canSpend = ({ clientAddress, cost }: SheetSpend): boolean => {
    if (!globalLimiter.canSpend(ALL_SHEETS, cost)) return false
    return clientAddress === null || clientLimiter.canSpend(clientAddress, cost)
  }

  return {
    canSpend,
    spend(spend) {
      if (!canSpend(spend)) return false
      if (spend.clientAddress !== null) clientLimiter.check(spend.clientAddress, spend.cost)
      globalLimiter.check(ALL_SHEETS, spend.cost)
      return true
    },
  }
}

/**
 * Build the gate that limits how many sheets are drawn at once. A sheet is a long draw of many cells, so it
 * has its own gate rather than sharing the plate gate: a sheet held in the plate line would stall every
 * single plated logo for seconds, and a line of single plates would stall every sheet the same way.
 *
 * @param options.limit Sheets drawn at once. Defaults to the configured sheet concurrency.
 * @param options.maxQueue Sheets allowed to wait. Defaults to the gate's own line.
 */
export function createSpriteGate({
  limit = config.spriteRenders?.concurrency,
  maxQueue,
}: { limit?: number; maxQueue?: number } = {}): ConcurrencyGate {
  return createConcurrencyGate({ limit, maxQueue, maxPerKey: SPRITE_PLACES_PER_CLIENT })
}

/** The budgets the sheet route spends from in production. */
export const sharedSpriteBudget: SpriteBudget = createSpriteBudget()

/** The gate the sheet route draws through in production. */
export const sharedSpriteGate: ConcurrencyGate = createSpriteGate()
