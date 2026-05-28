#!/bin/bash
# RedTrack v2 — RHEL Enterprise Setup Script
# Handles SELinux, firewalld, and UBI image deployment

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
echo -e "${CYAN}  Pentest Management Platform v2 — RHEL Enterprise Edition${NC}"
echo ""

# Check running as appropriate user
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}[!] Running as root. Consider running as a non-root user with sudo access.${NC}"
fi

# Check RHEL/CentOS
if [ ! -f /etc/redhat-release ]; then
    echo -e "${YELLOW}[!] This script is designed for RHEL/CentOS. Proceeding anyway...${NC}"
fi

echo -e "${YELLOW}[*] Checking dependencies...${NC}"

# Login to Red Hat registry
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Red Hat Registry Authentication${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  RedTrack RHEL edition uses Red Hat Hardened Images."
echo "  You need to authenticate with registry.redhat.io"
echo ""
read -p "  Red Hat username: " RH_USER
read -s -p "  Red Hat password: " RH_PASS
echo ""
echo -e "${YELLOW}[*] Logging into registry.redhat.io...${NC}"
echo "$RH_PASS" | docker login registry.redhat.io -u "$RH_USER" --password-stdin
if [ $? -eq 0 ]; then
    echo -e "${GREEN}[✓] Authenticated with Red Hat registry${NC}"
else
    echo -e "${RED}[!] Authentication failed. Check your credentials.${NC}"
    exit 1
fi
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}[*] Docker not found. Installing...${NC}"
    sudo dnf install -y dnf-plugins-core
    sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl start docker
    sudo systemctl enable docker
    sudo usermod -aG docker $USER
    echo -e "${GREEN}[✓] Docker installed${NC}"
else
    echo -e "${GREEN}[✓] Docker found${NC}"
fi

# Check openssl
if ! command -v openssl &> /dev/null; then
    sudo dnf install -y openssl
fi

echo -e "${GREEN}[✓] Dependencies OK${NC}"
echo ""

# Configure firewalld
echo -e "${YELLOW}[*] Configuring firewall...${NC}"
if systemctl is-active --quiet firewalld; then
    sudo firewall-cmd --permanent --add-port=443/tcp 2>/dev/null || true
    sudo firewall-cmd --permanent --add-port=80/tcp 2>/dev/null || true
    sudo firewall-cmd --reload
    echo -e "${GREEN}[✓] Firewall rules added (ports 80, 443)${NC}"
else
    echo -e "${YELLOW}[!] firewalld not running — skipping firewall config${NC}"
fi

# Configure SELinux for Docker volumes
echo -e "${YELLOW}[*] Configuring SELinux...${NC}"
if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
    sudo setsebool -P container_manage_cgroup 1 2>/dev/null || true
    # Label the directory for container access
    sudo chcon -Rt svirt_sandbox_file_t . 2>/dev/null || true
    echo -e "${GREEN}[✓] SELinux configured${NC}"
else
    echo -e "${YELLOW}[!] SELinux not enforcing — skipping${NC}"
fi

# Generate SSL cert
echo ""
echo -e "${YELLOW}[*] Generating SSL certificate...${NC}"
chmod +x nginx/generate-cert.sh
./nginx/generate-cert.sh
echo -e "${GREEN}[✓] SSL certificate generated${NC}"

# Setup .env
echo ""
if [ ! -f .env ]; then
    echo -e "${YELLOW}[*] Creating .env...${NC}"
    cp .env.example .env
    SECRET=$(openssl rand -hex 32)
    sed -i "s/changeme_generate_with_openssl_rand_hex_32/$SECRET/" .env
    echo -e "${GREEN}[✓] Secret key generated${NC}"
else
    echo -e "${GREEN}[✓] .env already exists${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  AI Configuration (optional)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Get a FREE Gemini API key at: https://aistudio.google.com"
echo ""
read -p "  Enter your Gemini API key (or press Enter to skip): " GEMINI_KEY
if [ -n "$GEMINI_KEY" ]; then
    sed -i "s/GEMINI_API_KEY=/GEMINI_API_KEY=$GEMINI_KEY/" .env
    echo -e "${GREEN}  [✓] Gemini API key saved${NC}"
fi

echo ""
echo -e "${YELLOW}[*] Building RedTrack using RHEL UBI images...${NC}"
echo -e "${YELLOW}    First build may take 10-15 minutes (pulling UBI images + installing deps)${NC}"
echo ""

# Use RHEL-specific compose file
docker compose -f docker-compose.rhel.yml up --build -d

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  RedTrack is running! (RHEL Enterprise Edition)${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo -e "  ${CYAN}URL:${NC}      https://$LOCAL_IP"
echo -e "  ${CYAN}Email:${NC}    admin@redtrack.com"
echo -e "  ${CYAN}Password:${NC} RedTrack2026!"
echo ""
echo -e "  ${YELLOW}⚠ Click through the SSL certificate warning on first visit${NC}"
echo -e "  ${YELLOW}⚠ Change your password in Settings → My Profile${NC}"
echo ""
echo -e "  To stop:    docker compose -f docker-compose.rhel.yml down"
echo -e "  To restart: docker compose -f docker-compose.rhel.yml up -d"
echo -e "  Logs:       docker compose -f docker-compose.rhel.yml logs -f backend"
echo ""
