-- Custom SQL migration file, put your code below! --
-- #115: FOA's grievance officer answers privacy rights requests. Rule F2:
-- the value ships alone; nothing in this deploy's DDL or data names it.
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'grievance_officer';
