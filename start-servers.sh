#!/bin/bash

# Start servers for Solana Liquidity Depth

echo "🚀 Starting Solana Liquidity Depth servers..."
echo ""

# Kill any existing processes on ports 3000 and 3001
echo "Cleaning up existing processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
sleep 2

# Start backend server
echo "Starting backend server on port 3001..."
cd server
NODE_TLS_REJECT_UNAUTHORIZED=0 node index.js > ../server.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 3

# Check if backend started successfully
if kill -0 $BACKEND_PID 2>/dev/null; then
    echo "✅ Backend server started (PID: $BACKEND_PID)"
else
    echo "❌ Backend server failed to start. Check server.log for errors."
    exit 1
fi

# Start frontend server
echo "Starting frontend server on port 3000..."
cd client
npm run dev > ../client.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait for frontend to start
sleep 5

# Check if frontend started successfully
if kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "✅ Frontend server started (PID: $FRONTEND_PID)"
else
    echo "❌ Frontend server failed to start. Check client.log for errors."
    exit 1
fi

echo ""
echo "✅ Both servers are running!"
echo "📱 Frontend: http://localhost:3000"
echo "🔌 Backend: http://localhost:3001"
echo ""
echo "Logs:"
echo "  - Backend: server.log"
echo "  - Frontend: client.log"
echo ""
echo "To stop servers, run: ./stop-servers.sh"
echo "Or manually: kill $BACKEND_PID $FRONTEND_PID"

