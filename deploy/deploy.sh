#!/bin/bash
# ─── Auto-deploy script for chatBot on Ubuntu VPS ───
# Usage: scp deploy/deploy.sh root@VPS_IP:/root/
#        ssh root@VPS_IP && chmod +x deploy.sh && ./deploy.sh

set -e

PROJECT_DIR="/opt/chatbot"
APP_PORT=3000

echo "========================================="
echo "  chatBot VPS Deploy Script"
echo "========================================="

# ─── Step 1: Install Docker ───
if ! command -v docker &>/dev/null; then
    echo "[1/6] Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
else
    echo "[1/6] Docker already installed ✓"
fi

# ─── Step 2: Install Docker Compose (v2) ───
if ! docker compose version &>/dev/null; then
    echo "[2/6] Installing Docker Compose plugin..."
    apt install -y docker-compose-plugin
else
    echo "[2/6] Docker Compose already available ✓"
fi

# ─── Step 3: Copy project files ───
if [ -d "$PROJECT_DIR" ]; then
    echo "[3/6] Project directory exists at $PROJECT_DIR ✓"
else
    echo "[3/6] ❌ Project files not found at $PROJECT_DIR"
    echo "    First, upload your project:"
    echo "    scp -r /local/path/to/chatBot root@YOUR_VPS_IP:$PROJECT_DIR"
    exit 1
fi

# ─── Step 4: Setup .env ───
if [ ! -f "$PROJECT_DIR/backend/.env" ]; then
    echo "[4/6] Creating .env from template..."
    cp "$PROJECT_DIR/deploy/.env.production" "$PROJECT_DIR/backend/.env"
    echo "    ⚠️  Please edit $PROJECT_DIR/backend/.env with your values"
    read -p "    Press Enter after editing .env, or Ctrl+C to cancel..."
else
    echo "[4/6] .env file exists ✓"
fi

# ─── Step 5: Build and start ───
echo "[5/6] Building and starting containers..."
cd "$PROJECT_DIR"
docker compose up -d --build

# ─── Step 6: Wait and check health ───
echo "[6/6] Waiting for app to start..."
sleep 10

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$APP_PORT/healthz 2>/dev/null || echo "000")

if [ "$HEALTH" = "200" ]; then
    echo ""
    echo "========================================="
    echo "  ✅ Deploy successful!"
    echo "  App running on http://$(curl -s ifconfig.me):$APP_PORT"
    echo "  Health check: http://$(curl -s ifconfig.me):$APP_PORT/healthz"
    echo "========================================="
else
    echo ""
    echo "========================================="
    echo "  ⚠️  Health check returned HTTP $HEALTH"
    echo "  Check logs: docker compose logs -f"
    echo "========================================="
fi
