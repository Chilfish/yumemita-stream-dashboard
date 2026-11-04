CREATE TABLE "scheduled_streams" (
	"dataset_id" text NOT NULL,
	"event_key" text NOT NULL,
	"video_id" text,
	"title" text NOT NULL,
	"url" text,
	"scheduled_at" timestamp with time zone,
	"expected_minutes" integer,
	"cancelled_at" timestamp with time zone,
	"availability" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"last_seen_at" timestamp with time zone,
	"last_live_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_streams_dataset_id_event_key_pk" PRIMARY KEY("dataset_id","event_key")
);
--> statement-breakpoint
ALTER TABLE "scheduled_streams" ADD CONSTRAINT "scheduled_streams_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_streams_video_unique" ON "scheduled_streams" USING btree ("dataset_id","video_id") WHERE "scheduled_streams"."video_id" is not null;--> statement-breakpoint
CREATE INDEX "scheduled_streams_at_idx" ON "scheduled_streams" USING btree ("scheduled_at");