#!/bin/bash
# RedTrack v2 — One-command setup script
# Usage: bash setup.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${RED}"
echo "  ██████╗ ███████╗██████╗ ████████╗██████╗  █████╗  ██████╗██╗  ██╗"
echo "  ██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝"
echo "  ██████╔╝█████╗  ██║  ██║   ██║   ██████╔╝███████║██║     █████╔╝ "
echo "  ██╔══██╗██╔══╝  ██║  ██║   ██║   ██╔══██╗██╔══██║██║     ██╔═██╗ "
echo "  ██║  ██║███████╗██████╔╝   ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗"
echo "  ╚═╝  ╚═╝╚══════╝╚═════╝    ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝"
echo -e "${NC}"
echo -e "${CYAN}  Pentest Management Platform v2${NC}"
echo ""

# Check dependencies
echo -e "${YELLOW}[*] Checking dependencies...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}[!] Docker not found. Install Docker first: https://docs.docker.com/engine/install/${NC}"
    exit 1
fi

if ! docker compose version &> /dev/null; then
    echo -e "${RED}[!] Docker Compose not found. Install Docker Compose plugin.${NC}"
    exit 1
fi

if ! command -v openssl &> /dev/null; then
    echo -e "${RED}[!] OpenSSL not found. Install with: apt install openssl${NC}"
    exit 1
fi

echo -e "${GREEN}[✓] Dependencies OK${NC}"
echo ""

# Generate SSL cert
echo -e "${YELLOW}[*] Generating SSL certificate...${NC}"
chmod +x nginx/generate-cert.sh
./nginx/generate-cert.sh
echo -e "${GREEN}[✓] SSL certificate generated${NC}"
echo ""

# Setup .env
if [ ! -f .env ]; then
    echo -e "${YELLOW}[*] Creating .env from template...${NC}"
    cp .env.example .env

    # Generate secret key
    SECRET=$(openssl rand -hex 32)
    sed -i "s/changeme_generate_with_openssl_rand_hex_32/$SECRET/" .env
    echo -e "${GREEN}[✓] Secret key generated automatically${NC}"
else
    echo -e "${GREEN}[✓] .env already exists, skipping${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  AI Configuration (optional but recommended)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Get a FREE Gemini API key at: https://aistudio.google.com"
echo ""
read -p "  Enter your Gemini API key (or press Enter to skip): " GEMINI_KEY
if [ -n "$GEMINI_KEY" ]; then
    sed -i "s/GEMINI_API_KEY=/GEMINI_API_KEY=$GEMINI_KEY/" .env
    sed -i "s/AI_PROVIDER=gemini/AI_PROVIDER=gemini/" .env
    echo -e "${GREEN}  [✓] Gemini API key saved${NC}"
else
    echo -e "${YELLOW}  [!] Skipped — AI features will be disabled until you add a key to .env${NC}"
fi

echo ""
echo -e "${YELLOW}[*] Building and starting RedTrack...${NC}"
echo -e "${YELLOW}    This may take 5-10 minutes on first run (downloading images + installing deps)${NC}"
echo ""

docker compose up --build -d

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  RedTrack is running!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo -e "  ${CYAN}URL:${NC}      https://$LOCAL_IP"
echo -e "  ${CYAN}Email:${NC}    admin@redtrack.com"
echo -e "  ${CYAN}Password:${NC} RedTrack2026!"
echo ""
echo -e "  ${YELLOW}⚠ Click through the SSL certificate warning on first visit${NC}"
echo -e "  ${YELLOW}⚠ Change your password immediately in Settings → My Profile${NC}"
echo ""
echo -e "  To stop:    docker compose down"
echo -e "  To restart: docker compose up -d"
echo -e "  Logs:       docker compose logs -f backend"
echo ""
