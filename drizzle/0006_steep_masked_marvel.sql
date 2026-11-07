ALTER TABLE "scheduled_streams" ADD COLUMN "date" date;--> statement-breakpoint
ALTER TABLE "scheduled_streams" ADD COLUMN "slot" text;--> statement-breakpoint
CREATE INDEX "scheduled_streams_dataset_date_idx" ON "scheduled_streams" USING btree ("dataset_id","date");--> statement-breakpoint
UPDATE "scheduled_streams"
SET "date" = ("scheduled_at" AT TIME ZONE 'Asia/Tokyo')::date
WHERE "date" IS NULL AND "scheduled_at" IS NOT NULL;--> statement-breakpoint
UPDATE "scheduled_streams"
SET "slot" = CASE
  WHEN EXTRACT(HOUR FROM "scheduled_at" AT TIME ZONE 'Asia/Tokyo') BETWEEN 5 AND 11 THEN 'early'
  WHEN EXTRACT(HOUR FROM "scheduled_at" AT TIME ZONE 'Asia/Tokyo') BETWEEN 12 AND 17 THEN 'mid'
  ELSE 'late'
END
WHERE "slot" IS NULL AND "scheduled_at" IS NOT NULL;
