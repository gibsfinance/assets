declare module 'knex/types/tables' {
  interface Timestamped {
    createdAt: Date;
    updatedAt: Date;
  }
  type TimestampKeys = keyof Timestamped
  interface Provider extends Timestamped {
    providerId: string;
    name: string;
    key: string;
    description: string;
  }
  interface InsertableProvider extends Omit<Provider, TimestampKeys | 'providerId'> {
    description?: string;
    name?: string;
  }
  interface Network extends Timestamped {
    networkId: string;
    type: string;
    chainId: string;
  }
  interface InsertableNetwork extends Omit<Network, TimestampKeys | 'networkId'> { }
  interface Image {
    imageHash: string;
    content: Buffer;
    ext: string;
    createdAt: Date;
  }
  interface List extends Timestamped {
    providerId: string;
    networkId: string | null;
    name: string;
    description: string;
    default: boolean;
    key: string;
    patch: number;
    minor: number;
    major: number;
    listId: string;
    imageHash: string | null;
  }
  interface InsertableList extends Omit<List, TimestampKeys | 'listId'> {
    networkId?: T;
    patch?: T;
    minor?: T;
    major?: T;
    imageHash?: T;
    name?: T;
    description?: T;
    key?: string;
    default?: boolean;
  }
  interface Tag extends Timestamped {
    providerId: string;
    key: string;
    name: string;
    description: string;
  }
  interface ListTag extends Timestamped {
    providerId: string;
    listId: string;
  }
  interface Metadata extends Timestamped {
    networkId: string;
    listId: string;
    providerId: string;
    providedId: string;
    metadataId: string;
    value: string;
  }
  interface Token extends Timestamped {
    networkId: string;
    providedId: string;
    name: string;
    symbol: string;
    decimals: number;
    type: string;
  }
  interface InsertableToken extends Omit<Token, TimestampKeys> {
    type?: string;
  }
  interface ListToken extends Timestamped {
    networkId: string;
    providedId: string;
    listId: string;
    imageHash: string;
    listTokenId: string;
  }
  interface InsertableListToken extends Omit<ListToken, TimestampKeys | 'listTokenId'> { }
  interface Link extends Timestamped {
    uri: string;
    imageHash: string;
  }
  interface InsertableLink extends Omit<Link, TimestampKeys> { }
  interface ListOrder extends Timestamped {
    providerId: string;
    key: string;
    type: string;
    name: string | null;
    description: string | null;
    listOrderId: string;
  }
  interface InsertableListOrder extends Omit<ListOrder, TimestampKeys | 'listOrderId'> {
    name?: string | null;
    description?: string | null;
  }
  interface ListOrderItem extends Timestamped {
    providerId: string;
    listKey: string;
    ranking: number;
    listOrderId: string;
    listId: string | null;
  }
  interface InsertableListOrderItem extends Omit<ListOrderItem, TimestampKeys> {
    listId?: string;
  }
  interface BackfillableInsertableListOrderItem extends Omit<InsertableListOrderItem, 'listOrderId'> { }
  interface Tables {
    provider: Provider;
    network: Network;
    image: Image;
    list: List;
    tag: Tag;
    listTag: ListTag;
    metadata: Metadata;
    token: Token;
    listToken: ListToken;
  }
}
