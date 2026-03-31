CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS plpython3u;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bridge" (
	"type" text NOT NULL,
	"provider_id" text NOT NULL,
	"home_network_id" text NOT NULL,
	"home_address" "citext" NOT NULL,
	"foreign_network_id" text NOT NULL,
	"foreign_address" "citext" NOT NULL,
	"bridge_id" text PRIMARY KEY NOT NULL,
	"current_foreign_block_number" bigint DEFAULT '0' NOT NULL,
	"current_home_block_number" bigint DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"bridge_link_order_id" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bridge_link" (
	"bridge_link_id" text PRIMARY KEY NOT NULL,
	"native_token_id" text NOT NULL,
	"bridged_token_id" text NOT NULL,
	"bridge_id" text NOT NULL,
	"transaction_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cache_request" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "header_link" (
	"list_token_id" text PRIMARY KEY NOT NULL,
	"image_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image" (
	"image_hash" text PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL,
	"uri" text NOT NULL,
	"ext" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image_variant" (
	"image_hash" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"format" text NOT NULL,
	"content" "bytea" NOT NULL,
	"access_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP,
	"last_accessed_at" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "image_variant_pkey" PRIMARY KEY("image_hash","width","height","format")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "link" (
	"uri" text PRIMARY KEY NOT NULL,
	"image_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list" (
	"provider_id" text NOT NULL,
	"network_id" text,
	"key" text DEFAULT 'default' NOT NULL,
	"name" text,
	"description" text,
	"patch" smallint DEFAULT '0' NOT NULL,
	"minor" smallint DEFAULT '0' NOT NULL,
	"major" smallint DEFAULT '0' NOT NULL,
	"image_hash" text,
	"list_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list_order" (
	"provider_id" text NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"description" text,
	"list_order_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list_order_item" (
	"list_order_id" text NOT NULL,
	"list_key" text NOT NULL,
	"provider_id" text NOT NULL,
	"list_id" text,
	"ranking" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "list_order_item_pkey" PRIMARY KEY("list_order_id","ranking")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"submitted_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_key" text NOT NULL,
	"list_key" text NOT NULL,
	"image_mode" text DEFAULT 'auto' NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	"subscriber_count" integer DEFAULT 0 NOT NULL,
	"last_content_hash" text,
	"last_fetched_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "list_submission_url_unique" UNIQUE("url"),
	CONSTRAINT "list_submission_provider_key_list_key_unique" UNIQUE("provider_key","list_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list_tag" (
	"provider_id" text NOT NULL,
	"list_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "list_token" (
	"token_id" text NOT NULL,
	"list_id" text NOT NULL,
	"image_hash" text,
	"list_token_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"list_token_order_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metadata" (
	"provider_id" text NOT NULL,
	"network_id" text,
	"list_id" text,
	"provided_id" "citext",
	"metadata_id" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "network" (
	"network_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"chain_id" numeric(78, 0) NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"image_hash" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider" (
	"provider_id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text DEFAULT '',
	"description" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "provider_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tag" (
	"provider_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "tag_pkey" PRIMARY KEY("provider_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "token" (
	"network_id" text NOT NULL,
	"provided_id" "citext" NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" smallint DEFAULT '0' NOT NULL,
	"type" text DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP,
	"token_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "bridge" ADD CONSTRAINT "bridge_providerid_foreign" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("provider_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "bridge" ADD CONSTRAINT "bridge_homenetworkid_foreign" FOREIGN KEY ("home_network_id") REFERENCES "public"."network"("network_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "bridge" ADD CONSTRAINT "bridge_foreignnetworkid_foreign" FOREIGN KEY ("foreign_network_id") REFERENCES "public"."network"("network_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "bridge_link" ADD CONSTRAINT "bridge_link_nativetokenid_foreign" FOREIGN KEY ("native_token_id") REFERENCES "public"."token"("token_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "bridge_link" ADD CONSTRAINT "bridge_link_bridgedtokenid_foreign" FOREIGN KEY ("bridged_token_id") REFERENCES "public"."token"("token_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "bridge_link" ADD CONSTRAINT "bridge_link_bridgeid_foreign" FOREIGN KEY ("bridge_id") REFERENCES "public"."bridge"("bridge_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "header_link" ADD CONSTRAINT "header_link_listtokenid_foreign" FOREIGN KEY ("list_token_id") REFERENCES "public"."list_token"("list_token_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "header_link" ADD CONSTRAINT "header_link_imagehash_foreign" FOREIGN KEY ("image_hash") REFERENCES "public"."image"("image_hash") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "image_variant" ADD CONSTRAINT "image_variant_imagehash_foreign" FOREIGN KEY ("image_hash") REFERENCES "public"."image"("image_hash") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "link" ADD CONSTRAINT "link_imagehash_foreign" FOREIGN KEY ("image_hash") REFERENCES "public"."image"("image_hash") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list" ADD CONSTRAINT "list_providerid_foreign" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("provider_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list" ADD CONSTRAINT "list_networkid_foreign" FOREIGN KEY ("network_id") REFERENCES "public"."network"("network_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list" ADD CONSTRAINT "list_imagehash_foreign" FOREIGN KEY ("image_hash") REFERENCES "public"."image"("image_hash") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_order" ADD CONSTRAINT "list_order_providerid_foreign" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("provider_id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_order_item" ADD CONSTRAINT "list_order_item_listorderid_foreign" FOREIGN KEY ("list_order_id") REFERENCES "public"."list_order"("list_order_id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_order_item" ADD CONSTRAINT "list_order_item_providerid_foreign" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("provider_id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_order_item" ADD CONSTRAINT "list_order_item_listid_foreign" FOREIGN KEY ("list_id") REFERENCES "public"."list"("list_id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_tag" ADD CONSTRAINT "list_tag_providerid_foreign" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("provider_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_tag" ADD CONSTRAINT "list_tag_listid_foreign" FOREIGN KEY ("list_id") REFERENCES "public"."list"("list_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_token" ADD CONSTRAINT "list_token_tokenid_foreign" FOREIGN KEY ("token_id") REFERENCES "public"."token"("token_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_token" ADD CONSTRAINT "list_token_listid_foreign" FOREIGN KEY ("list_id") REFERENCES "public"."list"("list_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "list_token" ADD CONSTRAINT "list_token_imagehash_foreign" FOREIGN KEY ("image_hash") REFERENCES "public"."image"("image_hash") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "metadata" ADD CONSTRAINT "metadata_providerid_foreign" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("provider_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "metadata" ADD CONSTRAINT "metadata_networkid_foreign" FOREIGN KEY ("network_id") REFERENCES "public"."network"("network_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "metadata" ADD CONSTRAINT "metadata_listid_foreign" FOREIGN KEY ("list_id") REFERENCES "public"."list"("list_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "network" ADD CONSTRAINT "network_imagehash_foreign" FOREIGN KEY ("image_hash") REFERENCES "public"."image"("image_hash") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tag" ADD CONSTRAINT "tag_providerid_foreign" FOREIGN KEY ("provider_id") REFERENCES "public"."provider"("provider_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "token" ADD CONSTRAINT "token_networkid_foreign" FOREIGN KEY ("network_id") REFERENCES "public"."network"("network_id") ON DELETE cascade ON UPDATE cascade; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_bridgeid_index" ON "bridge" USING btree ("bridge_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_currentforeignblocknumber_index" ON "bridge" USING btree ("current_foreign_block_number" int8_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_currenthomeblocknumber_index" ON "bridge" USING btree ("current_home_block_number" int8_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_foreignaddress_index" ON "bridge" USING btree ("foreign_address" citext_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_foreignnetworkid_index" ON "bridge" USING btree ("foreign_network_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_homeaddress_index" ON "bridge" USING btree ("home_address" citext_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_homenetworkid_index" ON "bridge" USING btree ("home_network_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_providerid_index" ON "bridge" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_type_index" ON "bridge" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_link_bridgedtokenid_index" ON "bridge_link" USING btree ("bridged_token_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_link_bridgeid_index" ON "bridge_link" USING btree ("bridge_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_link_bridgelinkid_index" ON "bridge_link" USING btree ("bridge_link_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_link_nativetokenid_index" ON "bridge_link" USING btree ("native_token_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bridge_link_transactionhash_index" ON "bridge_link" USING btree ("transaction_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cache_request_key_index" ON "cache_request" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "header_link_imagehash_index" ON "header_link" USING btree ("image_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "header_link_listtokenid_index" ON "header_link" USING btree ("list_token_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_ext_index" ON "image" USING btree ("ext" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_imagehash_index" ON "image" USING btree ("image_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_mode_index" ON "image" USING btree ("mode" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_uri_index" ON "image" USING btree ("uri" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_image_variant_prune" ON "image_variant" USING btree ("access_count" int4_ops,"last_accessed_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "link_imagehash_index" ON "link" USING btree ("image_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "link_uri_index" ON "link" USING btree ("uri" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_imagehash_index" ON "list" USING btree ("image_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_key_index" ON "list" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_listid_index" ON "list" USING btree ("list_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_networkid_index" ON "list" USING btree ("network_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_providerid_index" ON "list" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_key_index" ON "list_order" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_listorderid_index" ON "list_order" USING btree ("list_order_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_providerid_index" ON "list_order" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_type_index" ON "list_order" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_item_listid_index" ON "list_order_item" USING btree ("list_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_item_listkey_index" ON "list_order_item" USING btree ("list_key" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_item_listorderid_index" ON "list_order_item" USING btree ("list_order_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_item_providerid_index" ON "list_order_item" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_order_item_ranking_index" ON "list_order_item" USING btree ("ranking" int8_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_submission_provider_key_index" ON "list_submission" USING btree ("provider_key" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_submission_status_index" ON "list_submission" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_submission_submitted_by_index" ON "list_submission" USING btree ("submitted_by" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_submission_url_index" ON "list_submission" USING btree ("url" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_tag_listid_index" ON "list_tag" USING btree ("list_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_tag_providerid_index" ON "list_tag" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_token_imagehash_index" ON "list_token" USING btree ("image_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_token_listid_index" ON "list_token" USING btree ("list_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_token_listtokenid_index" ON "list_token" USING btree ("list_token_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "list_token_tokenid_index" ON "list_token" USING btree ("token_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metadata_listid_index" ON "metadata" USING btree ("list_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metadata_metadataid_index" ON "metadata" USING btree ("metadata_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metadata_networkid_index" ON "metadata" USING btree ("network_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metadata_providedid_index" ON "metadata" USING btree ("provided_id" citext_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metadata_providerid_index" ON "metadata" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_chainid_index" ON "network" USING btree ("chain_id" numeric_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_imagehash_index" ON "network" USING btree ("image_hash" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_networkid_index" ON "network" USING btree ("network_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "network_type_index" ON "network" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_key_index" ON "provider" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_providerid_index" ON "provider" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tag_description_index" ON "tag" USING btree ("description" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tag_key_index" ON "tag" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tag_name_index" ON "tag" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tag_providerid_index" ON "tag" USING btree ("provider_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_decimals_index" ON "token" USING btree ("decimals" int2_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_name_index" ON "token" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_networkid_index" ON "token" USING btree ("network_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_providedid_index" ON "token" USING btree ("provided_id" citext_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_symbol_index" ON "token" USING btree ("symbol" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_tokenid_index" ON "token" USING btree ("token_id" text_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_type_index" ON "token" USING btree ("type" text_ops);