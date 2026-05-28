CREATE TABLE IF NOT EXISTS `todos` (
  `id` VARCHAR(191) PRIMARY KEY,
  `title` TEXT NOT NULL,
  `description` TEXT,
  `done` INTEGER DEFAULT 0,
  `priority` REAL,
  `due_at` TEXT,
  `metadata` TEXT,
  `attachment` TEXT,
  `tag_id` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `tags` (
  `id` VARCHAR(191) PRIMARY KEY,
  `name` TEXT NOT NULL UNIQUE,
  `color` TEXT,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS `todo_tags` (
  `id` VARCHAR(191) PRIMARY KEY,
  `todo_id` TEXT NOT NULL,
  `tag_id` TEXT NOT NULL,
  `created_at` TEXT NOT NULL,
  `updated_at` TEXT NOT NULL
);
