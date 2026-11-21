CREATE TABLE "worker_heartbeat" (
	"worker" text PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"version" text NOT NULL,
	CONSTRAINT "worker_heartbeat_environment_known" CHECK ("worker_heartbeat"."environment" IN ('local', 'preview', 'staging', 'production'))
);
