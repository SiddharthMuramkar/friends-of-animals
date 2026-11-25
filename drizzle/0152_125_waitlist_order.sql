ALTER TABLE "event_registration" DROP CONSTRAINT "event_registration_waitlist_stamped";--> statement-breakpoint
DROP INDEX "event_registration_queue_idx";--> statement-breakpoint
ALTER TABLE "event_registration" ADD COLUMN "waitlist_order" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "event_registration_waitlist_order" ON "event_registration" USING btree ("event_id","waitlist_order");--> statement-breakpoint
CREATE INDEX "event_registration_queue_idx" ON "event_registration" USING btree ("event_id","status","waitlist_order");--> statement-breakpoint
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_waitlist_stamped" CHECK (("event_registration"."waitlisted_at" IS NULL) = ("event_registration"."waitlist_order" IS NULL) AND ("event_registration"."status" <> 'waitlisted' OR "event_registration"."waitlist_order" > 0));