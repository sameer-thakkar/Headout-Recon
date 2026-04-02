#!/bin/bash
set -e
npm install
echo "y" | npm run db:push 2>&1 || true
