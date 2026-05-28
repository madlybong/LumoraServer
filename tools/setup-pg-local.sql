-- tools/setup-pg-local.sql
-- Run once as postgres superuser:
-- psql -U postgres -f tools/setup-pg-local.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'lumora_test') THEN
    CREATE USER lumora_test WITH PASSWORD 'lumora_test';
  END IF;
END
$$;

SELECT 'User lumora_test ensured.' AS status;

-- Note: In PostgreSQL, you cannot run CREATE DATABASE inside a DO block or transaction block.
-- Wait, actually CREATE DATABASE cannot be inside a transaction block. 
-- We'll just run it directly. If the database exists, it will error, which is fine for a one-time script, 
-- but better to avoid the error if possible. PostgreSQL \gexec can be used, but let's keep it simple.

-- Try to create the database (will fail if it already exists, ignore the error)
CREATE DATABASE lumora_test OWNER lumora_test;

\c lumora_test

GRANT ALL PRIVILEGES ON DATABASE lumora_test TO lumora_test;

CREATE SCHEMA IF NOT EXISTS lumora_test_schema AUTHORIZATION lumora_test;

GRANT ALL ON SCHEMA lumora_test_schema TO lumora_test;
GRANT ALL ON SCHEMA public TO lumora_test;

SELECT 'Local test database ready.' AS status;
