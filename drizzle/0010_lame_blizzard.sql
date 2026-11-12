ALTER TABLE "scheduled_streams" ADD COLUMN "participants" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "streams" ADD COLUMN "participants" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "streams_participants_idx" ON "streams" USING gin ("participants");