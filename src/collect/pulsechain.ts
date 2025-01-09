import * as db from '@/db'

export const collect = async () => {
  await db.insertProvider({
    key: 'pulsechain',
    name: 'PulseChain',
    description: 'a grass roots list curated by pulsechain devs',
  })
}
