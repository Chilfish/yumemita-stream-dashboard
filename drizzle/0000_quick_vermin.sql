CREATE TABLE "authors" (
	"author_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stream_id" bigint NOT NULL,
	"author" text,
	"author_id" text,
	"likes" integer DEFAULT 0 NOT NULL,
	"at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"by_uploader" boolean DEFAULT false NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_insights" (
	"dataset_id" text PRIMARY KEY NOT NULL,
	"totals" jsonb NOT NULL,
	"aggregation" jsonb,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color" text,
	"avatar_key" text,
	"channel_id" text,
	"subject" text,
	"scope" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"datasets" jsonb,
	"new_ids" text[],
	"force_ids" text[],
	"failures" integer DEFAULT 0 NOT NULL,
	"structural" boolean DEFAULT false NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "paid_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stream_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone,
	"author" text,
	"author_id" text,
	"amount_text" text,
	"currency" text,
	"amount" numeric,
	"message" text,
	"emojis" jsonb
);
--> statement-breakpoint
CREATE TABLE "stream_authors" (
	"stream_id" bigint NOT NULL,
	"author_id" text NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"superchats" integer DEFAULT 0 NOT NULL,
	"stickers" integer DEFAULT 0 NOT NULL,
	"memberships" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stream_authors_stream_id_author_id_pk" PRIMARY KEY("stream_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "stream_details" (
	"stream_id" bigint PRIMARY KEY NOT NULL,
	"density" jsonb,
	"coverage_pct" numeric,
	"time_range" jsonb,
	"badges" jsonb,
	"hashtags" jsonb,
	"emoji_kinds" jsonb,
	"owner_chats" jsonb,
	"emojis" jsonb,
	"video_extra" jsonb,
	"raw_detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "stream_words" (
	"stream_id" bigint NOT NULL,
	"word" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "stream_words_stream_id_word_pk" PRIMARY KEY("stream_id","word")
);
--> statement-breakpoint
CREATE TABLE "streams" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"dataset_id" text NOT NULL,
	"video_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"date" date,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"duration_hms" text,
	"availability" text,
	"avg_concurrent" numeric,
	"max_concurrent" integer,
	"max_concurrent_at" text,
	"watch_time_hours" numeric,
	"vstats_views" integer,
	"vstats_likes" integer,
	"snapshot_views" integer,
	"snapshot_likes" integer,
	"snapshot_comments" integer,
	"chat_total" integer DEFAULT 0 NOT NULL,
	"chat_by_kind" jsonb,
	"pure_emoji_only" integer DEFAULT 0 NOT NULL,
	"unique_authors" integer DEFAULT 0 NOT NULL,
	"superchats" integer DEFAULT 0 NOT NULL,
	"stickers" integer DEFAULT 0 NOT NULL,
	"memberships" integer DEFAULT 0 NOT NULL,
	"gifts" integer DEFAULT 0 NOT NULL,
	"gifted_memberships" integer DEFAULT 0 NOT NULL,
	"sc_totals_by_currency" jsonb,
	"comments_captured" integer,
	"chat_per_1000_avg_viewers" numeric,
	"likes_per_1000_views" numeric,
	"sc_per_hour" numeric,
	"thumbnail_key" text,
	"source_generated_at" timestamp with time zone,
	"source_schema" text,
	"content_hash" text,
	"ingest_batch_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"dataset_id" text NOT NULL,
	"video_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"title" text,
	"date" date,
	"summary" text,
	"tags" text[],
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text,
	CONSTRAINT "transcripts_dataset_id_video_id_pk" PRIMARY KEY("dataset_id","video_id")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_insights" ADD CONSTRAINT "dataset_insights_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paid_events" ADD CONSTRAINT "paid_events_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_authors" ADD CONSTRAINT "stream_authors_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_details" ADD CONSTRAINT "stream_details_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stream_words" ADD CONSTRAINT "stream_words_stream_id_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streams" ADD CONSTRAINT "streams_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_stream_likes_idx" ON "comments" USING btree ("stream_id","likes" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "paid_events_stream_kind_idx" ON "paid_events" USING btree ("stream_id","kind");--> statement-breakpoint
CREATE INDEX "paid_events_stream_at_idx" ON "paid_events" USING btree ("stream_id","at");--> statement-breakpoint
CREATE INDEX "stream_authors_author_idx" ON "stream_authors" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "stream_authors_stream_messages_idx" ON "stream_authors" USING btree ("stream_id","messages" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stream_words_word_idx" ON "stream_words" USING btree ("word");--> statement-breakpoint
CREATE UNIQUE INDEX "streams_dataset_video_unique" ON "streams" USING btree ("dataset_id","video_id");--> statement-breakpoint
CREATE INDEX "streams_dataset_started_idx" ON "streams" USING btree ("dataset_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "streams_dataset_date_idx" ON "streams" USING btree ("dataset_id","date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "streams_dataset_availability_idx" ON "streams" USING btree ("dataset_id","availability");