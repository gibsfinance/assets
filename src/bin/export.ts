import { exportImage } from "@/args"
import * as utils from '@/utils'
import * as path from 'path'
import * as fs from 'fs'
import * as db from '@/db'
import { cleanup } from "@/cleanup"
import { tableNames } from "@/db/tables"
import { Image, List, ListToken, Network, Provider, Token } from "knex/types/tables"

main().then(cleanup).catch((err) => {
  console.log(err)
  return cleanup()
})

async function main() {
  const { token, chainId } = exportImage()
  const imgExportDir = path.join(utils.root, 'image-export')
  await fs.promises.rm(imgExportDir, {
    force: true,
    recursive: true,
  })
  if (!token) {
    const match = await db.getDB().select('*')
      .from(tableNames.network)
      .join(tableNames.image, {
        [`${tableNames.image}.imageHash`]: `${tableNames.network}.imageHash`,
      })
      .where({
        chainId,
      })
      .first()
    await fs.promises.mkdir(imgExportDir, {
      recursive: true,
    })
    await fs.promises.writeFile(path.join(imgExportDir, `${chainId}${match.ext}`), match.content)
    return
  }
  console.log('%o@%o', chainId, token)
  const matches = await db.getDB().from(tableNames.network)
    .select<(Network & Token & List & Provider & Image & ListToken & {
      providerKey: string;
      listKey: string;
    })[]>([
      '*',
      db.getDB().raw(`${tableNames.provider}.key as provider_key`),
      db.getDB().raw(`${tableNames.list}.key as list_key`),
    ])
    .where(`${tableNames.network}.chainId`, chainId)
    .join(tableNames.listToken, {
      [`${tableNames.listToken}.networkId`]: `${tableNames.network}.networkId`,
    })
    .join(tableNames.token, {
      [`${tableNames.token}.networkId`]: `${tableNames.network}.networkId`,
      [`${tableNames.token}.providedId`]: `${tableNames.listToken}.providedId`,
    })
    .join(tableNames.list, {
      [`${tableNames.list}.listId`]: `${tableNames.listToken}.listId`,
    })
    .join(tableNames.provider, {
      [`${tableNames.provider}.providerId`]: `${tableNames.list}.providerId`,
    })
    .where({
      [`${tableNames.token}.providedId`]: token,
    })
    .join(tableNames.image, {
      [`${tableNames.image}.imageHash`]: `${tableNames.listToken}.imageHash`,
    })
  await Promise.all(matches.map(async (res) => {
    const dirname = path.join(imgExportDir, res.providerKey, res.listKey)
    const filepath = path.join(dirname, `${res.imageHash}${res.ext}`)
    await fs.promises.mkdir(dirname, {
      recursive: true,
    })
    await fs.promises.writeFile(filepath, res.content)
  }))
}
