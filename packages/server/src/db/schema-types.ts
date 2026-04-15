import type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
import * as s from './schema'

// ---------------------------------------------------------------------------
// Select types (row types)
// ---------------------------------------------------------------------------

export type Provider = InferSelectModel<typeof s.provider>
export type Network = InferSelectModel<typeof s.network>
export type Image = InferSelectModel<typeof s.image>
export type Token = InferSelectModel<typeof s.token>
export type List = InferSelectModel<typeof s.list>
export type ListToken = InferSelectModel<typeof s.listToken>
export type Link = InferSelectModel<typeof s.link>
export type Tag = InferSelectModel<typeof s.tag>
export type ListTag = InferSelectModel<typeof s.listTag>
export type Metadata = InferSelectModel<typeof s.metadata>
export type ListOrder = InferSelectModel<typeof s.listOrder>
export type ListOrderItem = InferSelectModel<typeof s.listOrderItem>
export type Bridge = InferSelectModel<typeof s.bridge>
export type BridgeLink = InferSelectModel<typeof s.bridgeLink>
export type HeaderLink = InferSelectModel<typeof s.headerLink>
export type CacheRequest = InferSelectModel<typeof s.cacheRequest>
export type ImageVariant = InferSelectModel<typeof s.imageVariant>
export type ListSubmission = InferSelectModel<typeof s.listSubmission>

// ---------------------------------------------------------------------------
// Insert types
// ---------------------------------------------------------------------------
// DB triggers generate the primary key columns (providerId, networkId, etc.)
// from other columns on INSERT. We omit them from insert types so callers
// don't need to provide them. The db/index.ts functions add dsql`''` placeholders.

/** Make specified keys optional */
type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

type _InsertProvider = InferInsertModel<typeof s.provider>
export type InsertableProvider = OptionalKeys<_InsertProvider, 'providerId'>

type _InsertNetwork = InferInsertModel<typeof s.network>
export type InsertableNetwork = OptionalKeys<_InsertNetwork, 'networkId'>

export type InsertableImage = InferInsertModel<typeof s.image>

type _InsertToken = InferInsertModel<typeof s.token>
export type InsertableToken = OptionalKeys<_InsertToken, 'tokenId'>

type _InsertList = InferInsertModel<typeof s.list>
export type InsertableList = OptionalKeys<_InsertList, 'listId'>

type _InsertListToken = InferInsertModel<typeof s.listToken>
export type InsertableListToken = OptionalKeys<_InsertListToken, 'listTokenId'>

export type InsertableLink = InferInsertModel<typeof s.link>

type _InsertListOrder = InferInsertModel<typeof s.listOrder>
export type InsertableListOrder = OptionalKeys<_InsertListOrder, 'listOrderId'>

export type InsertableListOrderItem = InferInsertModel<typeof s.listOrderItem>

type _InsertBridge = InferInsertModel<typeof s.bridge>
export type InsertableBridge = OptionalKeys<_InsertBridge, 'bridgeId'>

type _InsertBridgeLink = InferInsertModel<typeof s.bridgeLink>
export type InsertableBridgeLink = OptionalKeys<_InsertBridgeLink, 'bridgeLinkId'>

export type InsertableHeaderLink = InferInsertModel<typeof s.headerLink>
export type InsertableCacheRequest = InferInsertModel<typeof s.cacheRequest>
export type InsertableImageVariant = InferInsertModel<typeof s.imageVariant>
export type InsertableListSubmission = InferInsertModel<typeof s.listSubmission>

// ---------------------------------------------------------------------------
// Composite / utility types (migrated from global.d.ts)
// ---------------------------------------------------------------------------

export type BackfillableInsertableListOrderItem = Omit<InsertableListOrderItem, 'listOrderId'>
