import * as db from '@/db'

export const collect = async () => {
  // updateStatus({
  //   provider: 'pulsechain',
  //   message: 'Setting up PulseChain provider...',
  //   phase: 'setup',
  // } satisfies StatusProps)

  await db.insertProvider({
    key: 'pulsechain',
    name: 'PulseChain',
    description: 'a grass roots list curated by pulsechain devs',
  })

  // updateStatus({
  //   provider: 'pulsechain',
  //   message: 'Provider setup complete',
  //   phase: 'complete',
  // } satisfies StatusProps)
}
