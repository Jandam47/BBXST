#!/bin/bash
# znovu vytvoří testovací databázi: stub Supabase + schéma
cd "$(dirname "$0")/.."
P="psql -h /tmp/pg -p 5499 -U postgres"
$P -qc "drop database if exists bbx" -c "create database bbx" 2>/dev/null
$P -d bbx -q -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql -f supabase/schema.sql -f supabase/02-parts.sql 2>&1 | grep -v -i "notice\|wal_level\|HINT" || true
