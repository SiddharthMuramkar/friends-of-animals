-- Custom SQL migration file, put your code below! --
ALTER TYPE "file_asset_purpose" ADD VALUE IF NOT EXISTS 'artwork_condition_photo';
