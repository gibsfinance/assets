import { exportImage } from '../args'
import * as paths from '../paths'
import * as path from 'path'
import * as fs from 'fs'
import { cleanup } from '../cleanup'
import { failureLog } from '@gibs/utils/log'
import { getDrizzle } from '../db/drizzle'
import { eq, and } from 'drizzle-orm'
import * as s from '../db/schema'

main()
  .then(cleanup)
  .catch((err) => {
    failureLog(err)
    return cleanup()
  })

async function main() {
  const { token, chainId } = exportImage()
  const imgExportDir = path.join(paths.root, 'image-export')
  await fs.promises.rm(imgExportDir, {
    force: true,
    recursive: true,
  })
  const drizzle = getDrizzle()
  if (!token) {
    const [match] = await drizzle
      .select()
      .from(s.network)
      .innerJoin(s.image, eq(s.image.imageHash, s.network.imageHash))
      .where(eq(s.network.chainId, String(chainId)))
      .limit(1)
    if (!match) {
      failureLog('no match found for chainId %o', chainId)
      return
    }
    await fs.promises.mkdir(imgExportDir, {
      recursive: true,
    })
    await fs.promises.writeFile(path.join(imgExportDir, `${chainId}${match.image.ext}`), match.image.content)
    return
  }
  console.log('%o@%o', chainId, token)
  const matches = await drizzle
    .select({
      networkId: s.network.networkId,
      chainId: s.network.chainId,
      type: s.network.type,
      tokenId: s.token.tokenId,
      providedId: s.token.providedId,
      name: s.token.name,
      symbol: s.token.symbol,
      decimals: s.token.decimals,
      imageHash: s.image.imageHash,
      content: s.image.content,
      ext: s.image.ext,
      mode: s.image.mode,
      uri: s.image.uri,
      listId: s.list.listId,
      listTokenId: s.listToken.listTokenId,
      providerId: s.provider.providerId,
      providerKey: s.provider.key,
      listKey: s.list.key,
    })
    .from(s.network)
    .innerJoin(s.token, eq(s.token.networkId, s.network.networkId))
    .innerJoin(s.listToken, eq(s.listToken.tokenId, s.token.tokenId))
    .innerJoin(s.list, eq(s.list.listId, s.listToken.listId))
    .innerJoin(s.provider, eq(s.provider.providerId, s.list.providerId))
    .innerJoin(s.image, eq(s.image.imageHash, s.listToken.imageHash))
    .where(and(eq(s.network.chainId, String(chainId)), eq(s.token.providedId, token)))
  await Promise.all(
    matches.map(async (res) => {
      const dirname = path.join(imgExportDir, res.providerKey, res.listKey)
      const filepath = path.join(dirname, `${res.imageHash}${res.ext}`)
      await fs.promises.mkdir(dirname, {
        recursive: true,
      })
      await fs.promises.writeFile(filepath, res.content)
    }),
  )
}
