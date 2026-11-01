#!/usr/bin/env bash
# Per-boot: throwaway local MySQL + .env + prisma migrate. Idempotent.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Fake local-only values from AGENTS.md — never staging/prod.
export DATABASE_URL='mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien'
export TEST_DATABASE_URL='mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien_test'

cat > .env <<'EOF'
DATABASE_URL="mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien"
TEST_DATABASE_URL="mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien_test"
SESSION_SECRET="local-only-cloud-agent-session-secret"
APP_URL="http://localhost:3000"
SMTP_HOST=""
EOF

# Ensure Node preload exists even on non-Dockerfile boots (default image + this start).
# Vitest reads process.env at config load; .env alone is not enough without this hook.
sudo mkdir -p /opt/hacien
sudo cp "$ROOT/.cursor/load-env.cjs" /opt/hacien/load-env.cjs
if ! grep -q 'load-env.cjs' /etc/environment 2>/dev/null; then
  echo 'NODE_OPTIONS=--require=/opt/hacien/load-env.cjs' | sudo tee -a /etc/environment >/dev/null
fi
case "${NODE_OPTIONS:-}" in
  *load-env.cjs*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require=/opt/hacien/load-env.cjs" ;;
esac

sudo tee /etc/profile.d/hacien-local-db.sh >/dev/null <<'EOF'
export DATABASE_URL='mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien'
export TEST_DATABASE_URL='mysql://hacien:local_only_dummy@127.0.0.1:3306/hacien_test'
export SESSION_SECRET='local-only-cloud-agent-session-secret'
export APP_URL='http://localhost:3000'
EOF

if ! pgrep -x mysqld >/dev/null 2>&1; then
  sudo mkdir -p /var/run/mysqld
  sudo chown mysql:mysql /var/run/mysqld
  sudo rm -f /var/run/mysqld/mysqld.pid /var/run/mysqld/mysqld.sock
  sudo mysqld --daemonize --pid-file=/var/run/mysqld/mysqld.pid --user=mysql
fi

for _ in $(seq 1 60); do
  if sudo mysqladmin ping -h127.0.0.1 --silent 2>/dev/null; then
    break
  fi
  sleep 1
done
sudo mysqladmin ping -h127.0.0.1 --silent

sudo mysql <<'SQL'
CREATE DATABASE IF NOT EXISTS hacien;
CREATE DATABASE IF NOT EXISTS hacien_test;
CREATE USER IF NOT EXISTS 'hacien'@'127.0.0.1' IDENTIFIED BY 'local_only_dummy';
CREATE USER IF NOT EXISTS 'hacien'@'localhost' IDENTIFIED BY 'local_only_dummy';
ALTER USER 'hacien'@'127.0.0.1' IDENTIFIED BY 'local_only_dummy';
ALTER USER 'hacien'@'localhost' IDENTIFIED BY 'local_only_dummy';
GRANT ALL PRIVILEGES ON hacien.* TO 'hacien'@'127.0.0.1';
GRANT ALL PRIVILEGES ON hacien.* TO 'hacien'@'localhost';
GRANT ALL PRIVILEGES ON hacien_test.* TO 'hacien'@'127.0.0.1';
GRANT ALL PRIVILEGES ON hacien_test.* TO 'hacien'@'localhost';
FLUSH PRIVILEGES;
SQL

# App DB then test DB (TEST_DATABASE_URL name must contain "test").
npx prisma migrate deploy
DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
