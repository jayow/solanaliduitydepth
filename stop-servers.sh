#!/bin/bash

# Stop servers for Solana Liquidity Depth

echo "🛑 Stopping Solana Liquidity Depth servers..."

# Kill processes on ports 3000 and 3001
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "✅ Stopped frontend (port 3000)" || echo "⚠️  No process on port 3000"
lsof -ti:3001 | xargs kill -9 2>/dev/null && echo "✅ Stopped backend (port 3001)" || echo "⚠️  No process on port 3001"

# Also kill any node processes related to the project
pkill -f "node.*index.js" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true

echo "✅ All servers stopped"

