CREATE TABLE "school_round_declaration" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"round_id" uuid NOT NULL,
	"declarations" text[] NOT NULL,
	"statement_version" text NOT NULL,
	"declared_by_user_id" uuid,
	"declared_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_round_family_notice" RENAME COLUMN "entry_id" TO "registration_id";--> statement-breakpoint
ALTER TABLE "school_round_family_notice" DROP CONSTRAINT "school_round_family_notice_entry_id_entry_id_fk";
--> statement-breakpoint
ALTER TABLE "school_round_declaration" ADD CONSTRAINT "school_round_declaration_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_declaration" ADD CONSTRAINT "school_round_declaration_round_id_school_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."school_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_declaration" ADD CONSTRAINT "school_round_declaration_declared_by_user_id_user_id_fk" FOREIGN KEY ("declared_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_round_declaration_round_id_idx" ON "school_round_declaration" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "school_round_declaration_declared_by_user_id_idx" ON "school_round_declaration" USING btree ("declared_by_user_id");--> statement-breakpoint
-- Translate notice keys before validating the new registration foreign key.
UPDATE "school_round_family_notice" AS notice
SET "registration_id" = entry."registration_id"
FROM "entry" AS entry
WHERE notice."registration_id" = entry."id";
--> statement-breakpoint
ALTER TABLE "school_round_family_notice" ADD CONSTRAINT "school_round_family_notice_registration_id_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registration"("id") ON DELETE cascade ON UPDATE no action;