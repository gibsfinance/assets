import { type Collectable, collectables } from './collectables'

export const main = async (providers: Collectable[]) => {
  const c = collectables()
  await Promise.all(providers.map((provider) => c[provider]?.()))
}
