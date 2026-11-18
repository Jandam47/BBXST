#!/bin/bash
# čistá DB + testovací data + PostgREST + testovací server na :8080
cd "$(dirname "$0")/.."
pkill -f "postgrest /tmp/pgrst.conf"; pkill -f "node ui-server.mjs"; sleep 0.5
su nobody -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg/data -o '-p 5499 -k /tmp/pg' -l /tmp/pg/log status >/dev/null || /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg/data -o '-p 5499 -k /tmp/pg' -l /tmp/pg/log start >/dev/null"; sleep 1
tests/reset_db.sh
psql -h /tmp/pg -p 5499 -U postgres -qc "do \$\$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if; end \$\$; grant anon, authenticated to authenticator;" 2>/dev/null
node tests/db.test.mjs | tail -1
node tests/seed-ui.mjs
(/tmp/postgrest /tmp/pgrst.conf > /tmp/pgrst.log 2>&1 &)
(cd tests && node ui-server.mjs > /tmp/ui.log 2>&1 &)
sleep 2
