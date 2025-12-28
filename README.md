# Solana Liquidity Depth

A DeFiLlama-style liquidity depth visualization for Solana using Jupiter's aggregation API.

## Features

- 📊 Interactive liquidity depth charts showing buy and sell orders
- 🔄 Real-time data from Jupiter aggregator
- 🎨 Modern, responsive UI
- 🔍 Token search and selection
- 📈 Visual representation of market depth

## Setup

### Prerequisites

- Node.js 18+ and npm

### Installation

1. Install all dependencies:
```bash
npm run install-all
```

2. Set up environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env and add your Jupiter API key
# Get your API key from: https://station.jup.ag/docs/apis/api-keys
```

3. Start the development server:
```bash
npm run dev
```

This will start:
- Backend server on `http://localhost:3001`
- Frontend dev server on `http://localhost:3000`

**Note**: The Jupiter API key is required for higher rate limits. Without it, the API will use the free tier with stricter rate limits.

## Project Structure

```
solana-liquidity-depth/
├── server/          # Express backend API
│   ├── index.js    # Main server file
│   └── package.json
├── client/         # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── LiquidityDepthChart.jsx
│   │   │   └── TokenSelector.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
└── package.json    # Root package.json
```

## How It Works

1. **Token Selection**: Users select input and output tokens from Jupiter's token list
2. **Quote Fetching**: The backend queries Jupiter's API with different swap amounts
3. **Depth Calculation**: By testing various amounts, we calculate the available liquidity at different price levels
4. **Visualization**: The frontend displays this data as a depth chart showing buy (green) and sell (red) liquidity

## API Endpoints

- `GET /api/tokens` - Get list of all tokens
- `GET /api/quote` - Get a single quote for a token pair
- `GET /api/liquidity-depth` - Calculate liquidity depth for a token pair

## Technologies Used

- **Backend**: Node.js, Express
- **Frontend**: React, Vite
- **Charts**: Recharts
- **API**: Jupiter Aggregator API

## Notes

- The liquidity depth is calculated by querying Jupiter with different swap amounts
- Results are cached for performance
- The visualization shows cumulative liquidity at different price levels

