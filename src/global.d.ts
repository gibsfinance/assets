declare module 'knex/types/tables' {
  interface Timestamped {
    createdAt: Date;
    updatedAt: Date;
  }
  interface Provider extends Timestamped {
    providerId: string;
    name: string;
    description: string;
  }
  interface Network extends Timestamped {
    networkId: string;
    type: string;
    chainId: string;
  }
  interface Image {
    imageHash: string;
    content: Buffer;
    ext: string;
    createdAt: Date;
  }
  interface List extends Timestamped {
    providerId: string;
    chainId: string;
    name: string;
    description: string;
    version: string;
    listId: string;
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
  interface ListToken extends Timestamped {
    networkId: string;
    providedId: string;
    listId: string;
    imageHash: string;
  }
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
