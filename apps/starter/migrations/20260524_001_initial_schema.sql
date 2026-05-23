-- Migration: 20260524_001_initial_schema
-- Initial schema for the lumora-starter reference app.
--
-- Lumora's ensureResource() also creates tables on first boot,
-- but migrations take ownership of schema evolution from this point forward.
-- Add future structural changes (new columns, indexes, etc.) in new numbered files:
--   20260524_002_add_company_country.sql
--   20260601_001_add_product_table.sql

CREATE TABLE IF NOT EXISTS `company` (
  `id`         VARCHAR(191) PRIMARY KEY,
  `name`       TEXT        NOT NULL,
  `domain`     TEXT,
  `active`     INTEGER     NOT NULL DEFAULT 1,
  `created_at` TEXT        NOT NULL,
  `updated_at` TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_company_name`   ON `company` (`name`);
CREATE INDEX IF NOT EXISTS `idx_company_active` ON `company` (`active`);
