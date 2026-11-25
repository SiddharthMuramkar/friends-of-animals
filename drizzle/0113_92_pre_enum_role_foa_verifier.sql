-- Custom SQL migration file, put your code below! --
-- #92: FOA's verifiers check the entries that reach FOA. Rule F2: the value
-- ships alone; nothing in this deploy's DDL or data names it.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'foa_verifier';
