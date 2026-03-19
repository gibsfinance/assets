/**
 * Manifest returned by discover() — describes what providers/lists were registered.
 * Used by syncDefaultOrder() to assign rankings.
 */
export type DiscoveryManifest = {
  providerKey: string
  lists: Array<{ listKey: string; listId?: string }>
}[]

/**
 * Abstract base class that all collectors must extend.
 * Enforces the two-phase collection contract:
 *   1. discover() — create provider + list rows (Phase 1)
 *   2. collect() — process tokens + images (Phase 2)
 */
export abstract class BaseCollector {
  /** The key in collectables — used for ranking derivation */
  abstract readonly key: string

  /**
   * Phase 1: Create provider + list rows in the DB.
   * Return a manifest describing what was registered.
   * Must NOT process tokens or fetch images.
   */
  abstract discover(signal: AbortSignal): Promise<DiscoveryManifest>

  /**
   * Phase 2: Process tokens and images.
   * Provider/list rows already exist from discover().
   * Order sync has already run between phases.
   */
  abstract collect(signal: AbortSignal): Promise<void>
}
