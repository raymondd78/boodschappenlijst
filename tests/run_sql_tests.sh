#!/usr/bin/env bash
# Test supabase/setup.sql in een lokale Postgres (16+) met nagebootste Supabase-onderdelen.
# Gebruik: PGHOST=/tmp/pg PGPORT=5544 PGUSER=postgres tests/run_sql_tests.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=boodschappen_test
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/supabase_mock.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/setup.sql
# Tweede keer uitvoeren moet ook goed gaan (script is herhaalbaar)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/setup.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/test_schema.sql
