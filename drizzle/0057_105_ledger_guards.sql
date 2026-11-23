CREATE FUNCTION ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ledger_posting_no_update_or_delete
BEFORE UPDATE OR DELETE ON ledger_posting
FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_posting_no_truncate
BEFORE TRUNCATE ON ledger_posting
FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_line_no_update_or_delete
BEFORE UPDATE OR DELETE ON ledger_line
FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_line_no_truncate
BEFORE TRUNCATE ON ledger_line
FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_mutation();
--> statement-breakpoint
CREATE FUNCTION ledger_check_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry_id uuid;
  line_count bigint;
  debit_total numeric;
  credit_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'ledger_posting' THEN
    entry_id := NEW.id;
  ELSE
    entry_id := NEW.posting_id;
  END IF;

  SELECT count(*), sum(debit_minor), sum(credit_minor)
    INTO line_count, debit_total, credit_total
    FROM public.ledger_line WHERE posting_id = entry_id;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'Ledger posting % needs at least 2 lines', entry_id
      USING ERRCODE = '23514';
  END IF;
  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'Ledger posting % is unbalanced', entry_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_posting_balance
AFTER INSERT ON ledger_posting
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_check_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_line_balance
AFTER INSERT ON ledger_line
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_check_balance();
--> statement-breakpoint
-- Keep this chart in sync with SEEDED_ACCOUNTS in the ledger domain.
INSERT INTO ledger_account (id, code, name, kind, is_system, public_group, created_at, updated_at)
SELECT id::uuid, code, name, kind::ledger_account_kind, is_system, public_group,
       '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'
FROM (VALUES
  ('01938a00-0000-7000-8000-000000105001', '1000', 'Bank account', 'asset', true, NULL),
  ('01938a00-0000-7000-8000-000000105002', '1010', 'Cash in hand', 'asset', true, NULL),
  ('01938a00-0000-7000-8000-000000105003', '1100', 'Payment gateway clearing', 'asset', true, NULL),
  ('01938a00-0000-7000-8000-000000105004', '3000', 'Accumulated fund', 'equity', true, NULL),
  ('01938a00-0000-7000-8000-000000105005', '4100', 'Registration fees', 'income', true, 'income'),
  ('01938a00-0000-7000-8000-000000105006', '4900', 'Other income', 'income', false, 'income'),
  ('01938a00-0000-7000-8000-000000105007', '5100', 'Prizes and awards', 'expense', false, 'programs'),
  ('01938a00-0000-7000-8000-000000105008', '5200', 'Certificates and printing', 'expense', false, 'programs'),
  ('01938a00-0000-7000-8000-000000105009', '5300', 'Logistics', 'expense', false, 'programs'),
  ('01938a00-0000-7000-8000-000000105010', '5400', 'Platform and technology', 'expense', false, 'administration'),
  ('01938a00-0000-7000-8000-000000105011', '5500', 'Payment gateway fees', 'expense', false, 'administration'),
  ('01938a00-0000-7000-8000-000000105012', '5600', 'Events and outreach', 'expense', false, 'programs'),
  ('01938a00-0000-7000-8000-000000105013', '5900', 'Other expenses', 'expense', false, 'administration')
) AS chart(id, code, name, kind, is_system, public_group);
