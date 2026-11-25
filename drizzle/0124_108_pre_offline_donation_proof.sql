-- Custom SQL migration file, put your code below! --
ALTER TYPE "public"."file_asset_purpose" ADD VALUE IF NOT EXISTS 'offline_donation_proof';
