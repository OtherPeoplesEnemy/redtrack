#!/bin/bash
# Generates a self-signed SSL certificate for RedTrack
# Run this once before docker compose up --build
# To swap to Let's Encrypt later, replace the files in nginx/certs/
# with your Let's Encrypt cert and key and restart nginx.

CERT_DIR="$(dirname "$0")/certs"
mkdir -p "$CERT_DIR"

echo "[*] Generating self-signed SSL certificate..."

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$CERT_DIR/redtrack.key" \
  -out "$CERT_DIR/redtrack.crt" \
  -subj "/C=US/ST=State/L=City/O=RedTrack/CN=redtrack.local" \
  -addext "subjectAltName=IP:$(hostname -I | awk '{print $1}'),DNS:redtrack.local,DNS:localhost"

chmod 600 "$CERT_DIR/redtrack.key"
chmod 644 "$CERT_DIR/redtrack.crt"

echo "[✓] Certificate generated at $CERT_DIR"
echo "[✓] Valid for 365 days"
echo ""
echo "To swap to Let's Encrypt later:"
echo "  1. Get your cert from certbot"
echo "  2. Replace nginx/certs/redtrack.crt and redtrack.key"
echo "  3. docker compose restart nginx"
