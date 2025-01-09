import { tableNames } from './db/tables'

declare module 'knex/types/tables.js' {
  interface Timestamped {
    createdAt: Date
    updatedAt: Date
  }
  type TimestampKeys = keyof Timestamped
  interface Provider extends Timestamped {
    providerId: string
    name: string
    key: string
    description: string
  }
  interface InsertableProvider extends Omit<Provider, TimestampKeys | 'providerId'> {
    description?: string
    name?: string
  }
  interface Network extends Timestamped {
    networkId: string
    type: string
    chainId: string
  }
  interface InsertableNetwork extends Omit<Network, TimestampKeys | 'networkId'> {}
  interface Image {
    imageHash: string
    content: Buffer
    ext: string
    createdAt: Date
  }
  interface List extends Timestamped {
    providerId: string
    networkId: string | null
    name: string
    description: string
    default: boolean
    key: string
    patch: number
    minor: number
    major: number
    listId: string
    imageHash: string | null
  }
  interface InsertableList extends Omit<List, TimestampKeys | 'listId'> {
    networkId?: T
    patch?: T
    minor?: T
    major?: T
    imageHash?: T
    name?: T
    description?: T
    key?: string
    default?: boolean
  }
  interface Tag extends Timestamped {
    providerId: string
    key: string
    name: string
    description: string
  }
  interface ListTag extends Timestamped {
    providerId: string
    listId: string
  }
  interface Metadata extends Timestamped {
    networkId: string
    listId: string
    providerId: string
    providedId: string
    metadataId: string
    value: string
  }
  interface Token extends Timestamped {
    networkId: string
    providedId: string
    tokenId: string
    name: string
    symbol: string
    decimals: number
    type: string
  }
  interface InsertableToken extends Omit<Token, TimestampKeys | 'tokenId'> {
    type?: string
  }
  interface ListToken extends Timestamped {
    tokenId: string
    listId: string
    imageHash: string
    listTokenId: string
  }
  interface InsertableListToken extends Omit<ListToken, TimestampKeys | 'listTokenId'> {
    imageHash?: string
  }
  interface Link extends Timestamped {
    uri: string
    imageHash: string
  }
  interface InsertableLink extends Omit<Link, TimestampKeys> {}
  interface ListOrder extends Timestamped {
    providerId: string
    key: string
    type: string
    name: string | null
    description: string | null
    listOrderId: string
  }
  interface InsertableListOrder extends Omit<ListOrder, TimestampKeys | 'listOrderId'> {
    name?: string | null
    description?: string | null
  }
  interface ListOrderItem extends Timestamped {
    providerId: string
    listKey: string
    ranking: number
    listOrderId: string
    listId: string | null
  }
  interface InsertableListOrderItem extends Omit<ListOrderItem, TimestampKeys> {
    listId?: string
  }
  interface BackfillableInsertableListOrderItem extends Omit<InsertableListOrderItem, 'listOrderId'> {}
  interface Bridge extends Timestamped {
    bridgeId: string
    foreignAddress: string
    foreignNetworkId: string
    homeAddress: string
    homeNetworkId: string
    type: string
    providerId: string
    currentForeignBlockNumber: string
    currentHomeBlockNumber: string
  }
  interface InsertableBridge extends Omit<Bridge, TimestampKeys | 'bridgeId'> {
    currentHomeBlockNumber?: string
    currentForeignBlockNumber?: string
  }
  interface BridgeLink {
    bridgeLinkId: string
    nativeTokenId: string
    bridgedTokenId: string
    bridgeId: string
    transactionHash: string
  }
  interface InsertableBridgeLink extends Omit<BridgeLink, 'bridgeLinkId'> {}
  interface Tables {
    [tableNames.provider]: Provider
    [tableNames.network]: Network
    [tableNames.image]: Image
    [tableNames.list]: List
    [tableNames.tag]: Tag
    [tableNames.listTag]: ListTag
    [tableNames.metadata]: Metadata
    [tableNames.token]: Token
    [tableNames.listToken]: ListToken
    [tableNames.bridge]: Bridge
    [tableNames.bridgeLink]: BridgeLink
  }
}
