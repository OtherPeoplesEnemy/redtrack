#!/bin/bash
# redtrack-cli installer for Kali Linux / Ubuntu
echo "[*] Installing redtrack-cli..."
pip install -r requirements.txt --break-system-packages 2>/dev/null || pip install -r requirements.txt
chmod +x redtrack-cli
sudo cp redtrack-cli /usr/local/bin/redtrack-cli
echo "[✓] Installed! Run: redtrack-cli config"
