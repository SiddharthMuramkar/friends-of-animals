ALTER TABLE "school_round_family_notice" DROP CONSTRAINT "school_round_family_notice_entry_id_entry_id_fk";
--> statement-breakpoint
ALTER TABLE "school_round_pick" DROP CONSTRAINT "school_round_pick_entry_id_entry_id_fk";
--> statement-breakpoint
ALTER TABLE "school_round_family_notice" ADD CONSTRAINT "school_round_family_notice_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_round_pick" ADD CONSTRAINT "school_round_pick_entry_id_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."entry"("id") ON DELETE cascade ON UPDATE no action;