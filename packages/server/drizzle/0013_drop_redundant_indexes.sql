-- Drops twenty indexes that no query can ever use, because a primary key or unique
-- constraint on the same table already indexes the same leading columns.
--
-- Postgres serves a lookup on `(a)` from an index on `(a, b)` just as happily as from
-- an index on `(a)` alone, so a single-column index whose column is the first column of
-- an existing primary key or unique index is dead weight. It is never chosen by the
-- planner, but every insert, update and delete still pays to maintain it.
--
-- Measured on staging, these twenty accounted for 626MB of the 2124MB of index data on
-- the database — roughly thirty percent — with `list_token_listtokenid_index` alone at
-- 401MB, an exact duplicate of `list_token_pkey`. Since list_token takes millions of
-- writes per collection run, that maintenance is the expensive part; the disk is
-- incidental. Re-measuring the ranked token query after dropping all twenty showed no
-- regression: the two prefix cases simply fall through to the wider index.
--
-- Every drop below is one of two provable shapes, never a judgement call:
--   exact duplicate  the redundant index has the identical column list
--   strict prefix    its columns are the leading columns of the covering index
--
-- redundant index                     covers as              covering index
-- ----------------------------------  ---------------------  ------------------------------
-- list_token_listtokenid_index        exact duplicate        list_token_pkey
-- link_uri_index                      exact duplicate        link_pkey
-- token_tokenid_index                 exact duplicate        token_pkey
-- image_imagehash_index               exact duplicate        image_pkey
-- list_listid_index                   exact duplicate        list_pkey
-- network_networkid_index             exact duplicate        network_pkey
-- provider_providerid_index           exact duplicate        provider_pkey
-- provider_key_index                  exact duplicate        provider_key_unique
-- bridge_bridgeid_index               exact duplicate        bridge_pkey
-- bridge_link_bridgelinkid_index      exact duplicate        bridge_link_pkey
-- metadata_metadataid_index           exact duplicate        metadata_pkey
-- list_order_listorderid_index        exact duplicate        list_order_pkey
-- cache_request_key_index             exact duplicate        cache_request_pkey
-- header_link_listtokenid_index       exact duplicate        header_link_pkey
-- list_submission_url_index           exact duplicate        list_submission_url_unique
-- list_token_tokenid_index            strict prefix          idx_list_token_token_list
-- token_networkid_index               strict prefix          idx_token_network_token
-- list_order_item_listorderid_index   strict prefix          list_order_item_pkey
-- list_submission_provider_key_index  strict prefix          list_submission_provider_key_list_key_unique
-- tag_providerid_index                strict prefix          tag_pkey
--
-- CONCURRENTLY is deliberately absent: it cannot run inside the transaction the
-- migration runner opens. A plain DROP INDEX takes a brief exclusive lock on the table,
-- which is acceptable during a deploy because the work is unlinking files rather than
-- rewriting data.
DROP INDEX IF EXISTS "list_token_listtokenid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_token_tokenid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "link_uri_index";--> statement-breakpoint
DROP INDEX IF EXISTS "token_tokenid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "token_networkid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "image_imagehash_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_listid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "network_networkid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "provider_providerid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "provider_key_index";--> statement-breakpoint
DROP INDEX IF EXISTS "bridge_bridgeid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "bridge_link_bridgelinkid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "metadata_metadataid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_order_listorderid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_order_item_listorderid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "cache_request_key_index";--> statement-breakpoint
DROP INDEX IF EXISTS "header_link_listtokenid_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_submission_url_index";--> statement-breakpoint
DROP INDEX IF EXISTS "list_submission_provider_key_index";--> statement-breakpoint
DROP INDEX IF EXISTS "tag_providerid_index";
