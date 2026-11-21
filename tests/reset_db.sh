#!/bin/bash
# znovu vytvoří testovací databázi: stub Supabase + schéma
cd "$(dirname "$0")/.."
P="psql -h /tmp/pg -p 5499 -U postgres"
$P -qc "drop database if exists bbx" -c "create database bbx" 2>/dev/null
$P -d bbx -q -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql -f supabase/schema.sql -f supabase/02-parts.sql -f supabase/03-live-score.sql -f supabase/04-security-hardening.sql -f supabase/05-judge-handover.sql -f supabase/06-formats-stats.sql -f supabase/07-parts-update.sql -f supabase/08-judge-per-match.sql -f supabase/09-pause.sql -f supabase/10-fashion.sql -f supabase/11-finishes.sql -f supabase/12-rated.sql -f supabase/13-communities.sql -f supabase/14-training-extras.sql -f supabase/15-training-bots.sql -f supabase/16-training-reset.sql -f supabase/17-chat-bazar.sql -f supabase/18-chat-tournament-state.sql -f supabase/19-account-reports.sql -f supabase/20-push.sql -f supabase/21-checkin-errors-backup.sql -f supabase/21-checkin-errors-backup.sql 2>&1 | grep -v -i "notice\|wal_level\|HINT" || true
