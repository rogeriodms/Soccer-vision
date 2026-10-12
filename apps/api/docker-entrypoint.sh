#!/bin/sh
set -eu
npx prisma migrate deploy --schema prisma/schema.prisma
exec node apps/api/dist/server.js
