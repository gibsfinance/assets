import { relations } from 'drizzle-orm/relations'
import {
  provider,
  listTag,
  list,
  metadata,
  network,
  token,
  image,
  link,
  listOrder,
  bridgeLink,
  bridge,
  listToken,
  headerLink,
  tag,
  listOrderItem,
  imageVariant,
} from './schema'

export const listTagRelations = relations(listTag, ({ one }) => ({
  provider: one(provider, {
    fields: [listTag.providerId],
    references: [provider.providerId],
  }),
  list: one(list, {
    fields: [listTag.listId],
    references: [list.listId],
  }),
}))

export const providerRelations = relations(provider, ({ many }) => ({
  listTags: many(listTag),
  metadata: many(metadata),
  listOrders: many(listOrder),
  lists: many(list),
  bridges: many(bridge),
  tags: many(tag),
  listOrderItems: many(listOrderItem),
}))

export const listRelations = relations(list, ({ one, many }) => ({
  listTags: many(listTag),
  metadata: many(metadata),
  provider: one(provider, {
    fields: [list.providerId],
    references: [provider.providerId],
  }),
  network: one(network, {
    fields: [list.networkId],
    references: [network.networkId],
  }),
  image: one(image, {
    fields: [list.imageHash],
    references: [image.imageHash],
  }),
  listTokens: many(listToken),
  listOrderItems: many(listOrderItem),
}))

export const metadataRelations = relations(metadata, ({ one }) => ({
  provider: one(provider, {
    fields: [metadata.providerId],
    references: [provider.providerId],
  }),
  network: one(network, {
    fields: [metadata.networkId],
    references: [network.networkId],
  }),
  list: one(list, {
    fields: [metadata.listId],
    references: [list.listId],
  }),
}))

export const networkRelations = relations(network, ({ one, many }) => ({
  metadata: many(metadata),
  tokens: many(token),
  image: one(image, {
    fields: [network.imageHash],
    references: [image.imageHash],
  }),
  lists: many(list),
  bridges_homeNetworkId: many(bridge, {
    relationName: 'bridge_homeNetworkId_network_networkId',
  }),
  bridges_foreignNetworkId: many(bridge, {
    relationName: 'bridge_foreignNetworkId_network_networkId',
  }),
}))

export const tokenRelations = relations(token, ({ one, many }) => ({
  network: one(network, {
    fields: [token.networkId],
    references: [network.networkId],
  }),
  bridgeLinks_nativeTokenId: many(bridgeLink, {
    relationName: 'bridgeLink_nativeTokenId_token_tokenId',
  }),
  bridgeLinks_bridgedTokenId: many(bridgeLink, {
    relationName: 'bridgeLink_bridgedTokenId_token_tokenId',
  }),
  listTokens: many(listToken),
}))

export const linkRelations = relations(link, ({ one }) => ({
  image: one(image, {
    fields: [link.imageHash],
    references: [image.imageHash],
  }),
}))

export const imageRelations = relations(image, ({ many }) => ({
  links: many(link),
  networks: many(network),
  lists: many(list),
  headerLinks: many(headerLink),
  listTokens: many(listToken),
  imageVariants: many(imageVariant),
}))

export const listOrderRelations = relations(listOrder, ({ one, many }) => ({
  provider: one(provider, {
    fields: [listOrder.providerId],
    references: [provider.providerId],
  }),
  listOrderItems: many(listOrderItem),
}))

export const bridgeLinkRelations = relations(bridgeLink, ({ one }) => ({
  token_nativeTokenId: one(token, {
    fields: [bridgeLink.nativeTokenId],
    references: [token.tokenId],
    relationName: 'bridgeLink_nativeTokenId_token_tokenId',
  }),
  token_bridgedTokenId: one(token, {
    fields: [bridgeLink.bridgedTokenId],
    references: [token.tokenId],
    relationName: 'bridgeLink_bridgedTokenId_token_tokenId',
  }),
  bridge: one(bridge, {
    fields: [bridgeLink.bridgeId],
    references: [bridge.bridgeId],
  }),
}))

export const bridgeRelations = relations(bridge, ({ one, many }) => ({
  bridgeLinks: many(bridgeLink),
  provider: one(provider, {
    fields: [bridge.providerId],
    references: [provider.providerId],
  }),
  network_homeNetworkId: one(network, {
    fields: [bridge.homeNetworkId],
    references: [network.networkId],
    relationName: 'bridge_homeNetworkId_network_networkId',
  }),
  network_foreignNetworkId: one(network, {
    fields: [bridge.foreignNetworkId],
    references: [network.networkId],
    relationName: 'bridge_foreignNetworkId_network_networkId',
  }),
}))

export const headerLinkRelations = relations(headerLink, ({ one }) => ({
  listToken: one(listToken, {
    fields: [headerLink.listTokenId],
    references: [listToken.listTokenId],
  }),
  image: one(image, {
    fields: [headerLink.imageHash],
    references: [image.imageHash],
  }),
}))

export const listTokenRelations = relations(listToken, ({ one, many }) => ({
  headerLinks: many(headerLink),
  token: one(token, {
    fields: [listToken.tokenId],
    references: [token.tokenId],
  }),
  list: one(list, {
    fields: [listToken.listId],
    references: [list.listId],
  }),
  image: one(image, {
    fields: [listToken.imageHash],
    references: [image.imageHash],
  }),
}))

export const tagRelations = relations(tag, ({ one }) => ({
  provider: one(provider, {
    fields: [tag.providerId],
    references: [provider.providerId],
  }),
}))

export const listOrderItemRelations = relations(listOrderItem, ({ one }) => ({
  listOrder: one(listOrder, {
    fields: [listOrderItem.listOrderId],
    references: [listOrder.listOrderId],
  }),
  provider: one(provider, {
    fields: [listOrderItem.providerId],
    references: [provider.providerId],
  }),
  list: one(list, {
    fields: [listOrderItem.listId],
    references: [list.listId],
  }),
}))

export const imageVariantRelations = relations(imageVariant, ({ one }) => ({
  image: one(image, {
    fields: [imageVariant.imageHash],
    references: [image.imageHash],
  }),
}))
