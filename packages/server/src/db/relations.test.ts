import { describe, expect, it } from 'vitest'
import { createTableRelationsHelpers, Many, One, type Relations } from 'drizzle-orm/relations'
import * as schema from './schema'
import * as rel from './relations'

/**
 * `relations()` stores its builder callback (the `({ one, many }) => ({...})`
 * object literal) but never invokes it — drizzle only calls it lazily when a
 * relational query actually needs the config. Importing relations.ts therefore
 * exercises none of that wiring by itself. Resolving it here, with drizzle's
 * own helpers, runs the real callback bodies and lets the assertions below
 * catch a relation pointed at the wrong table or column.
 */
const resolve = (relations: Relations) => relations.config(createTableRelationsHelpers(relations.table))

describe('one() relations reference the correct table and columns', () => {
  it('listTag -> provider, list', () => {
    const config = resolve(rel.listTagRelations)
    expect(config.provider).toBeInstanceOf(One)
    expect((config.provider as One).referencedTable).toBe(schema.provider)
    expect((config.provider as One).config?.fields).toEqual([schema.listTag.providerId])
    expect((config.provider as One).config?.references).toEqual([schema.provider.providerId])

    expect(config.list).toBeInstanceOf(One)
    expect((config.list as One).referencedTable).toBe(schema.list)
    expect((config.list as One).config?.fields).toEqual([schema.listTag.listId])
    expect((config.list as One).config?.references).toEqual([schema.list.listId])
  })

  it('list -> provider, network, image', () => {
    const config = resolve(rel.listRelations)
    expect((config.provider as One).referencedTable).toBe(schema.provider)
    expect((config.provider as One).config?.fields).toEqual([schema.list.providerId])
    expect((config.provider as One).config?.references).toEqual([schema.provider.providerId])

    expect((config.network as One).referencedTable).toBe(schema.network)
    expect((config.network as One).config?.fields).toEqual([schema.list.networkId])
    expect((config.network as One).config?.references).toEqual([schema.network.networkId])

    expect((config.image as One).referencedTable).toBe(schema.image)
    expect((config.image as One).config?.fields).toEqual([schema.list.imageHash])
    expect((config.image as One).config?.references).toEqual([schema.image.imageHash])
  })

  it('metadata -> provider, network, list', () => {
    const config = resolve(rel.metadataRelations)
    expect((config.provider as One).config?.fields).toEqual([schema.metadata.providerId])
    expect((config.provider as One).config?.references).toEqual([schema.provider.providerId])
    expect((config.network as One).config?.fields).toEqual([schema.metadata.networkId])
    expect((config.network as One).config?.references).toEqual([schema.network.networkId])
    expect((config.list as One).config?.fields).toEqual([schema.metadata.listId])
    expect((config.list as One).config?.references).toEqual([schema.list.listId])
  })

  it('network -> image', () => {
    const config = resolve(rel.networkRelations)
    expect((config.image as One).referencedTable).toBe(schema.image)
    expect((config.image as One).config?.fields).toEqual([schema.network.imageHash])
    expect((config.image as One).config?.references).toEqual([schema.image.imageHash])
  })

  it('token -> network', () => {
    const config = resolve(rel.tokenRelations)
    expect((config.network as One).referencedTable).toBe(schema.network)
    expect((config.network as One).config?.fields).toEqual([schema.token.networkId])
    expect((config.network as One).config?.references).toEqual([schema.network.networkId])
  })

  it('link -> image', () => {
    const config = resolve(rel.linkRelations)
    expect((config.image as One).config?.fields).toEqual([schema.link.imageHash])
    expect((config.image as One).config?.references).toEqual([schema.image.imageHash])
  })

  it('listOrder -> provider', () => {
    const config = resolve(rel.listOrderRelations)
    expect((config.provider as One).config?.fields).toEqual([schema.listOrder.providerId])
    expect((config.provider as One).config?.references).toEqual([schema.provider.providerId])
  })

  it('bridgeLink -> two distinct token relations plus bridge, disambiguated by relationName', () => {
    const config = resolve(rel.bridgeLinkRelations)
    const native = config.token_nativeTokenId as One
    const bridged = config.token_bridgedTokenId as One

    expect(native.referencedTable).toBe(schema.token)
    expect(native.config?.fields).toEqual([schema.bridgeLink.nativeTokenId])
    expect(native.config?.references).toEqual([schema.token.tokenId])
    expect(native.config?.relationName).toBe('bridgeLink_nativeTokenId_token_tokenId')

    expect(bridged.referencedTable).toBe(schema.token)
    expect(bridged.config?.fields).toEqual([schema.bridgeLink.bridgedTokenId])
    expect(bridged.config?.references).toEqual([schema.token.tokenId])
    expect(bridged.config?.relationName).toBe('bridgeLink_bridgedTokenId_token_tokenId')

    // Same referenced table, different relation names — if the names ever
    // collided, drizzle could not tell the native and bridged sides apart.
    expect(native.config?.relationName).not.toBe(bridged.config?.relationName)

    expect((config.bridge as One).config?.fields).toEqual([schema.bridgeLink.bridgeId])
    expect((config.bridge as One).config?.references).toEqual([schema.bridge.bridgeId])
  })

  it('bridge -> provider plus two distinct network relations, disambiguated by relationName', () => {
    const config = resolve(rel.bridgeRelations)
    const home = config.network_homeNetworkId as One
    const foreign = config.network_foreignNetworkId as One

    expect((config.provider as One).config?.fields).toEqual([schema.bridge.providerId])
    expect((config.provider as One).config?.references).toEqual([schema.provider.providerId])

    expect(home.referencedTable).toBe(schema.network)
    expect(home.config?.fields).toEqual([schema.bridge.homeNetworkId])
    expect(home.config?.references).toEqual([schema.network.networkId])
    expect(home.config?.relationName).toBe('bridge_homeNetworkId_network_networkId')

    expect(foreign.referencedTable).toBe(schema.network)
    expect(foreign.config?.fields).toEqual([schema.bridge.foreignNetworkId])
    expect(foreign.config?.references).toEqual([schema.network.networkId])
    expect(foreign.config?.relationName).toBe('bridge_foreignNetworkId_network_networkId')

    expect(home.config?.relationName).not.toBe(foreign.config?.relationName)
  })

  it('headerLink -> listToken, image', () => {
    const config = resolve(rel.headerLinkRelations)
    expect((config.listToken as One).config?.fields).toEqual([schema.headerLink.listTokenId])
    expect((config.listToken as One).config?.references).toEqual([schema.listToken.listTokenId])
    expect((config.image as One).config?.fields).toEqual([schema.headerLink.imageHash])
    expect((config.image as One).config?.references).toEqual([schema.image.imageHash])
  })

  it('listToken -> token, list, image', () => {
    const config = resolve(rel.listTokenRelations)
    expect((config.token as One).config?.fields).toEqual([schema.listToken.tokenId])
    expect((config.token as One).config?.references).toEqual([schema.token.tokenId])
    expect((config.list as One).config?.fields).toEqual([schema.listToken.listId])
    expect((config.list as One).config?.references).toEqual([schema.list.listId])
    expect((config.image as One).config?.fields).toEqual([schema.listToken.imageHash])
    expect((config.image as One).config?.references).toEqual([schema.image.imageHash])
  })

  it('tag -> provider', () => {
    const config = resolve(rel.tagRelations)
    expect((config.provider as One).config?.fields).toEqual([schema.tag.providerId])
    expect((config.provider as One).config?.references).toEqual([schema.provider.providerId])
  })

  it('listOrderItem -> listOrder, provider, list', () => {
    const config = resolve(rel.listOrderItemRelations)
    expect((config.listOrder as One).config?.fields).toEqual([schema.listOrderItem.listOrderId])
    expect((config.listOrder as One).config?.references).toEqual([schema.listOrder.listOrderId])
    expect((config.provider as One).config?.fields).toEqual([schema.listOrderItem.providerId])
    expect((config.provider as One).config?.references).toEqual([schema.provider.providerId])
    expect((config.list as One).config?.fields).toEqual([schema.listOrderItem.listId])
    expect((config.list as One).config?.references).toEqual([schema.list.listId])
  })

  it('imageVariant -> image', () => {
    const config = resolve(rel.imageVariantRelations)
    expect((config.image as One).config?.fields).toEqual([schema.imageVariant.imageHash])
    expect((config.image as One).config?.references).toEqual([schema.image.imageHash])
  })
})

describe('many() relations point at the correct table', () => {
  it('provider fans out to every table that carries a providerId', () => {
    const config = resolve(rel.providerRelations)
    const expected: [string, unknown][] = [
      ['listTags', schema.listTag],
      ['metadata', schema.metadata],
      ['listOrders', schema.listOrder],
      ['lists', schema.list],
      ['bridges', schema.bridge],
      ['tags', schema.tag],
      ['listOrderItems', schema.listOrderItem],
    ]
    for (const [key, table] of expected) {
      expect(config[key], `provider.${key}`).toBeInstanceOf(Many)
      expect((config[key] as Many<any>).referencedTable).toBe(table)
    }
  })

  it('network fans out to metadata, tokens, lists, and the two bridge sides by relationName', () => {
    const config = resolve(rel.networkRelations)
    expect((config.metadata as Many<any>).referencedTable).toBe(schema.metadata)
    expect((config.tokens as Many<any>).referencedTable).toBe(schema.token)
    expect((config.lists as Many<any>).referencedTable).toBe(schema.list)

    const home = config.bridges_homeNetworkId as Many<any>
    const foreign = config.bridges_foreignNetworkId as Many<any>
    expect(home.referencedTable).toBe(schema.bridge)
    expect(home.relationName).toBe('bridge_homeNetworkId_network_networkId')
    expect(foreign.referencedTable).toBe(schema.bridge)
    expect(foreign.relationName).toBe('bridge_foreignNetworkId_network_networkId')
    // These must line up exactly with the relationNames bridgeRelations declared
    // above, or drizzle cannot pair the two sides of the same relation.
    expect(home.relationName).toBe((resolve(rel.bridgeRelations).network_homeNetworkId as One).config?.relationName)
    expect(foreign.relationName).toBe(
      (resolve(rel.bridgeRelations).network_foreignNetworkId as One).config?.relationName,
    )
  })

  it('token fans out to listTokens and the two bridgeLink sides by relationName', () => {
    const config = resolve(rel.tokenRelations)
    expect((config.listTokens as Many<any>).referencedTable).toBe(schema.listToken)

    const native = config.bridgeLinks_nativeTokenId as Many<any>
    const bridged = config.bridgeLinks_bridgedTokenId as Many<any>
    expect(native.referencedTable).toBe(schema.bridgeLink)
    expect(bridged.referencedTable).toBe(schema.bridgeLink)
    expect(native.relationName).toBe((resolve(rel.bridgeLinkRelations).token_nativeTokenId as One).config?.relationName)
    expect(bridged.relationName).toBe(
      (resolve(rel.bridgeLinkRelations).token_bridgedTokenId as One).config?.relationName,
    )
  })

  it('image fans out to every table that stores an imageHash', () => {
    const config = resolve(rel.imageRelations)
    const expected: [string, unknown][] = [
      ['links', schema.link],
      ['networks', schema.network],
      ['lists', schema.list],
      ['headerLinks', schema.headerLink],
      ['listTokens', schema.listToken],
      ['imageVariants', schema.imageVariant],
    ]
    for (const [key, table] of expected) {
      expect(config[key], `image.${key}`).toBeInstanceOf(Many)
      expect((config[key] as Many<any>).referencedTable).toBe(table)
    }
  })

  it('list fans out to listTags, metadata, listTokens, listOrderItems', () => {
    const config = resolve(rel.listRelations)
    expect((config.listTags as Many<any>).referencedTable).toBe(schema.listTag)
    expect((config.metadata as Many<any>).referencedTable).toBe(schema.metadata)
    expect((config.listTokens as Many<any>).referencedTable).toBe(schema.listToken)
    expect((config.listOrderItems as Many<any>).referencedTable).toBe(schema.listOrderItem)
  })

  it('listOrder fans out to listOrderItems', () => {
    const config = resolve(rel.listOrderRelations)
    expect((config.listOrderItems as Many<any>).referencedTable).toBe(schema.listOrderItem)
  })

  it('bridge fans out to bridgeLinks', () => {
    const config = resolve(rel.bridgeRelations)
    expect((config.bridgeLinks as Many<any>).referencedTable).toBe(schema.bridgeLink)
  })

  it('listToken fans out to headerLinks', () => {
    const config = resolve(rel.listTokenRelations)
    expect((config.headerLinks as Many<any>).referencedTable).toBe(schema.headerLink)
  })
})
