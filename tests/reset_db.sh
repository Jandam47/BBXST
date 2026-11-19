#!/bin/bash
# znovu vytvoří testovací databázi: stub Supabase + schéma
cd "$(dirname "$0")/.."
P="psql -h /tmp/pg -p 5499 -U postgres"
$P -qc "drop database if exists bbx" -c "create database bbx" 2>/dev/null
$P -d bbx -q -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql -f supabase/schema.sql -f supabase/02-parts.sql -f supabase/03-live-score.sql -f supabase/04-security-hardening.sql -f supabase/05-judge-handover.sql -f supabase/06-formats-stats.sql -f supabase/07-parts-update.sql -f supabase/08-judge-per-match.sql -f supabase/09-pause.sql -f supabase/10-fashion.sql 2>&1 | grep -v -i "notice\|wal_level\|HINT" || true
