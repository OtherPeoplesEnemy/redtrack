#!/bin/bash
# RedTrack v2 — Update script
# Pulls latest from git and rebuilds

set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}[*] Pulling latest changes...${NC}"
git pull

echo -e "${YELLOW}[*] Rebuilding containers...${NC}"
docker compose up --build -d

echo -e "${GREEN}[✓] RedTrack updated successfully${NC}"
