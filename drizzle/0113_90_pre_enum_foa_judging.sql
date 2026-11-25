-- Custom SQL migration file, put your code below! --
-- #90: the competition moves from school judging to FOA judging at the
-- shortlist deadline, once every school round is finished. The value ships
-- here on its own (rule F2); nothing in the same deploy uses it in DDL.
ALTER TYPE "public"."competition_status" ADD VALUE IF NOT EXISTS 'foa_judging' BEFORE 'cancelled';
