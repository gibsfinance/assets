---
title: Image storage
description: Choose where image bytes are kept with the IMAGE_STORE setting, and configure each kind of store.
sidebar:
  order: 6
---

Image bytes live in a content-addressed store. Each blob is named by the `sha256` of its bytes. You choose where the store is kept with one setting, `IMAGE_STORE`, and you can change it without changing code.

The server and the collector read the setting when they start. If it is missing or wrong, they stop with a message that names the setting. Both processes must use the same store.

To move existing images from one store to another, read [Moving between stores](/self-hosting/moving-between-stores/).

## Kinds of store

`IMAGE_STORE` is a kind name, or JSON. The default is `local`.

| Kind | Where blobs live |
|------|------------------|
| `local` | Files in a directory. |
| `s3` | Any S3-compatible bucket: AWS S3, Cloudflare R2, Hetzner Object Storage, Backblaze B2, Wasabi, DigitalOcean Spaces, MinIO, or any endpoint. |
| `gcs` | A Google Cloud Storage bucket. |
| `azure` | An Azure Blob Storage container. |
| `ipfs` | The InterPlanetary File System, written through a pinning service and read through gateways. |
| `tiered` | A bounded local cache in front of another store. |
| `mirrored` | Several stores that each hold every blob. |
| `fallback` | One store you write, and one you only read. |

### How to choose

- Start with `local` on one host. Put the directory on a volume that outlives the container. Set `IMAGE_STORE_DIR` to do that.
- Use `s3`, `gcs` or `azure` when several hosts must share one store, or when you want the provider to keep copies.
- Use `tiered` when the remote store is slow and you want recent images close by.
- Use `mirrored` when you want every blob in two places.
- Use `fallback` when a second installation, such as a test copy, should read another installation's images and never change them.
- Use `ipfs` when you want content identifiers that other nodes can read.

## Settings and secrets

A setting that is not a secret can be set in the environment or written in the JSON. The environment name is the setting's name in capitals with the prefix `IMAGE_STORE_<KIND>_`. For `local`, the prefix is just `IMAGE_STORE_`. A value in the JSON wins.

A secret (a key, a token, the text of a key file) is read from the environment only. The JSON form refuses it.

To use two stores of one kind, give the second a prefix of its own with `"envPrefix"`.

## `local`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_DIR` (`dir`) | `<repository root>/image-store` | Directory that holds the store. |

## `s3`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_S3_PRESET` (`preset`) | `aws` | `aws`, `r2`, `hetzner`, `b2`, `wasabi`, `spaces`, `minio` or `custom`. |
| `IMAGE_STORE_S3_BUCKET` (`bucket`) | required | Bucket name. |
| `IMAGE_STORE_S3_REGION` (`region`) | per preset | The region requests are signed for. |
| `IMAGE_STORE_S3_ENDPOINT` (`endpoint`) | per preset | Overrides the preset's endpoint. Required for `minio` and `custom`. |
| `IMAGE_STORE_S3_ACCOUNT_ID` (`accountId`) | none | `r2` only: your Cloudflare account id. |
| `IMAGE_STORE_S3_ADDRESSING` (`addressing`) | per preset | `path` or `virtual` (the bucket is in the host name). |
| `IMAGE_STORE_S3_PREFIX` (`prefix`) | none | Text before every key, for a bucket that holds other things. |
| `IMAGE_STORE_S3_ACCESS_KEY_ID` | required, secret | Access key id. |
| `IMAGE_STORE_S3_SECRET_ACCESS_KEY` | required, secret | Secret access key. |
| `IMAGE_STORE_S3_SESSION_TOKEN` | none, secret | For temporary credentials. |

Presets differ only in endpoint, default region and addressing:

| Preset | Endpoint | Default region | Addressing |
|--------|----------|----------------|------------|
| `aws` | `https://s3.<region>.amazonaws.com` | `us-east-1` | virtual |
| `r2` | `https://<account id>.r2.cloudflarestorage.com` | `auto` | path |
| `hetzner` | `https://<region>.your-objectstorage.com` | `fsn1` | path |
| `b2` | `https://s3.<region>.backblazeb2.com` | none: a region is required, for example `us-west-004` | path |
| `wasabi` | `https://s3.<region>.wasabisys.com` | `us-east-1` | path |
| `spaces` | `https://<region>.digitaloceanspaces.com` | `nyc3` | virtual |
| `minio`, `custom` | you set `endpoint` | `us-east-1` | path |

Create the bucket first. The credentials need read, write, delete and list rights. A 403 answer is treated as an error, not as a missing blob.

## `gcs`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_GCS_BUCKET` (`bucket`) | required | Bucket name. |
| `IMAGE_STORE_GCS_CREDENTIALS_JSON` | secret | The text of a service-account key file. |
| `IMAGE_STORE_GCS_CREDENTIALS_FILE` (`credentialsFile`) | none | Path to a service-account key file. Use this or the JSON, not both. |
| `IMAGE_STORE_GCS_ENDPOINT` (`endpoint`) | `https://storage.googleapis.com` | Aim at an emulator. With it, no credentials are needed. |
| `IMAGE_STORE_GCS_PREFIX` (`prefix`) | none | Text before every key. |

You need one of the JSON text or the key file, unless you set an endpoint. The service account needs the Storage Object Admin role on the bucket, or the equivalent object rights.

## `azure`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_AZURE_ACCOUNT` (`account`) | required | Storage account name. |
| `IMAGE_STORE_AZURE_CONTAINER` (`container`) | required | Container name. Create it first. |
| `IMAGE_STORE_AZURE_ACCOUNT_KEY` | secret | Account key (Shared Key). |
| `IMAGE_STORE_AZURE_SAS_TOKEN` | secret | A shared access signature token with read, add, create, write, delete and list rights. Use exactly one of this and the account key. |
| `IMAGE_STORE_AZURE_ENDPOINT` (`endpoint`) | `https://<account>.blob.core.windows.net` | For an emulator. Include the account in the path. |
| `IMAGE_STORE_AZURE_PREFIX` (`prefix`) | none | Text before every key. |

## `ipfs`

| Setting | Default | Meaning |
|---------|---------|---------|
| `IMAGE_STORE_IPFS_PROVIDER` (`provider`) | required | `kubo` (any node that speaks the Kubo remote procedure call interface), `filebase` or `pinata`. |
| `IMAGE_STORE_IPFS_API_URL` (`apiUrl`) | provider's | Pinning API address. Required for `kubo`. |
| `IMAGE_STORE_IPFS_GATEWAYS` (`gateways`) | provider's | Comma-separated gateway addresses that end in `/ipfs/`, tried in order. Required for `kubo`. |
| `IMAGE_STORE_IPFS_API_TOKEN` | required for `filebase` and `pinata`, secret | Bearer token. |

A `sha256` hash is not an InterPlanetary File System content identifier. The table `image_store_cid` (migration 0023) maps one to the other, and records each blob's length and last-write time. Bytes from a gateway are hashed and must match. A gateway that serves other bytes is skipped. Deleting a blob unpins it. Other nodes that already hold a copy keep it.

## Combining stores

These examples set `IMAGE_STORE` to JSON.

```sh
# a 5 GiB local cache in front of S3
IMAGE_STORE='{"type":"tiered","maxBytes":"5GiB","cache":{"type":"local","dir":"/var/cache/images"},"backing":"s3"}'

# every blob in two places; the second store reads its own settings from its own prefix
IMAGE_STORE='{"type":"mirrored","stores":["s3",{"type":"gcs","envPrefix":"IMAGE_STORE_BACKUP_GCS_"}]}'

# staging reads another installation's store without ever writing to it, listing it, or deleting from it
IMAGE_STORE='{"type":"fallback","primary":"local","fallback":{"type":"s3","envPrefix":"IMAGE_STORE_SHARED_S3_"}}'
```

- **`tiered`** takes `maxBytes` (a number, or text such as `500MiB` or `5GiB`), `cache` and `backing`. The cache evicts the least recently used blobs when it holds more than `maxBytes`. A blob larger than the limit is never cached.
- **`mirrored`** takes `stores` (a list) and `minimumWrites` (default: all of them). A write needs that many stores to accept it. A mirror does not copy blobs that a new member lacks. Run `images copy` for that. See [Moving between stores](/self-hosting/moving-between-stores/).
- **`fallback`** takes `primary` and `fallback`. Give the fallback credentials that cannot write.

Composites are built only from other stores, so they nest.
