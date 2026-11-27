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

# Migratie van versie 1.1 naar 1.2 (lijstjes) op een bestaande database
DB2=boodschappen_migratie
dropdb --if-exists "$DB2"
createdb "$DB2"
psql -q -v ON_ERROR_STOP=1 -d "$DB2" -f tests/supabase_mock.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB2" -f tests/setup_v1.1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB2" -f tests/test_migratie.sql

# Migratie naar de 10 categorieën (versie 1.3)
DB3=boodschappen_migratie_cat
dropdb --if-exists "$DB3"
createdb "$DB3"
psql -q -v ON_ERROR_STOP=1 -d "$DB3" -f tests/supabase_mock.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB3" -f tests/setup_v1.1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB3" -f tests/test_migratie_categorieen.sql
