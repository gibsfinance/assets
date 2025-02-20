/**
 * @title PulseChain Provider Setup
 * @notice Sets up the base PulseChain provider for token lists
 */

import * as db from '@/db'
import type { StatusProps } from '../components/Status'
import { updateStatus } from '../utils/status'

export const collect = async () => {
  updateStatus({
    provider: 'pulsechain',
    message: 'Setting up PulseChain provider...',
    phase: 'setup',
  } satisfies StatusProps)

  await db.insertProvider({
    key: 'pulsechain',
    name: 'PulseChain',
    description: 'a grass roots list curated by pulsechain devs',
  })

  updateStatus({
    provider: 'pulsechain',
    message: 'Provider setup complete',
    phase: 'complete',
  } satisfies StatusProps)
}
