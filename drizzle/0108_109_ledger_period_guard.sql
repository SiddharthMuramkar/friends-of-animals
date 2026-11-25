-- Custom SQL migration file, put your code below! --
-- #109: nothing posts into a closed period. Locked months form a prefix of
-- the ledger's months; the latest locked month is the lock line, and a
-- posting dated on or before it is refused here as well as in the app
-- (src/server/modules/ledger/periods.ts), so a bug or a hand-written
-- INSERT can't change a published month.
CREATE FUNCTION ledger_refuse_closed_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lock_line text;
BEGIN
  SELECT max(month COLLATE "C") INTO lock_line
    FROM public.ledger_period WHERE status = 'locked';
  IF lock_line IS NOT NULL AND NEW.period_month COLLATE "C" <= lock_line THEN
    RAISE EXCEPTION 'period_locked: ledger period % is closed; the lock line is %',
      NEW.period_month, lock_line
      USING ERRCODE = '23514', CONSTRAINT = 'ledger_posting_period_open';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_posting_period_open
BEFORE INSERT ON ledger_posting
FOR EACH ROW EXECUTE FUNCTION ledger_refuse_closed_period();
--> statement-breakpoint
-- A period row is never deleted and never renamed: deleting a locked month
-- would move the lock line back. Approvals keep their history the same way.
CREATE FUNCTION ledger_period_reject_removal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.month IS DISTINCT FROM OLD.month THEN
      RAISE EXCEPTION 'ledger_period.month never changes' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_period_no_delete_or_rename
BEFORE UPDATE OR DELETE ON ledger_period
FOR EACH ROW EXECUTE FUNCTION ledger_period_reject_removal();
--> statement-breakpoint
CREATE TRIGGER ledger_period_no_truncate
BEFORE TRUNCATE ON ledger_period
FOR EACH STATEMENT EXECUTE FUNCTION ledger_period_reject_removal();
--> statement-breakpoint
CREATE TRIGGER finance_approval_no_delete
BEFORE DELETE ON finance_approval
FOR EACH ROW EXECUTE FUNCTION ledger_period_reject_removal();
--> statement-breakpoint
CREATE TRIGGER finance_approval_no_truncate
BEFORE TRUNCATE ON finance_approval
FOR EACH STATEMENT EXECUTE FUNCTION ledger_period_reject_removal();
--> statement-breakpoint
-- Every month that already has postings is an open period, so the first
-- lock can't skip one.
INSERT INTO ledger_period (month, created_at)
SELECT period_month, min(created_at) FROM ledger_posting GROUP BY period_month
ON CONFLICT (month) DO NOTHING;
