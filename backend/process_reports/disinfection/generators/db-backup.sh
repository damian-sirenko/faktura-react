#!/bin/bash

BACKUP_DIR="/home/zebrasfk/db_backups"
DB_NAME="zebrasfk_steryl_crm"
DB_USER="zebrasfk_app_user"
DB_PASS="Cs$6751516747"
DB_HOST="localhost"

mkdir -p "$BACKUP_DIR"

/usr/bin/mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --default-character-set=utf8mb4 \
  -h "$DB_HOST" \
  -u "$DB_USER" \
  -p"$DB_PASS" \
  "$DB_NAME" > "$BACKUP_DIR/tmp.sql"

if [ -s "$BACKUP_DIR/tmp.sql" ]; then
  mv "$BACKUP_DIR/tmp.sql" "$BACKUP_DIR/${DB_NAME}_$(date +%F_%H%M).sql"
else
  rm -f "$BACKUP_DIR/tmp.sql"
fi
