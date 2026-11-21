CREATE TYPE "public"."role" AS ENUM('member', 'participant', 'guardian', 'institution_admin', 'institution_coordinator', 'judge', 'volunteer', 'organisation_representative', 'staff_admin', 'super_admin', 'competition_manager', 'content_manager', 'community_manager', 'finance', 'auction_manager', 'adoption_coordinator');--> statement-breakpoint
CREATE TYPE "public"."role_scope_type" AS ENUM('global', 'institution', 'competition', 'organisation');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_kind" AS ENUM('visitor', 'user', 'system');--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"scope_type" "role_scope_type" NOT NULL,
	"scope_id" uuid,
	"granted_by_user_id" uuid,
	"granted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_role_grant_unique" UNIQUE NULLS NOT DISTINCT("user_id","role","scope_type","scope_id"),
	CONSTRAINT "user_role_scope_id_matches_type" CHECK (("user_role"."scope_type" = 'global') = ("user_role"."scope_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"actor_process" text,
	"actor_role" "role",
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "audit_log_actor_user_matches_kind" CHECK (("audit_log"."actor_kind" = 'user') = ("audit_log"."actor_user_id" IS NOT NULL)),
	CONSTRAINT "audit_log_actor_process_matches_kind" CHECK (("audit_log"."actor_kind" = 'system') = ("audit_log"."actor_process" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_role_role_idx" ON "user_role" USING btree ("role");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" USING btree ("actor_user_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","id" DESC NULLS LAST);