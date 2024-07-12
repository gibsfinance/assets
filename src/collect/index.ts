import { type Collectable, collectables } from './collectables'

export const main = async (providers: Collectable[]) => {
  await Promise.all(providers.map((provider) => collectables[provider]()))
}
