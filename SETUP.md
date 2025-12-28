# Setup Instructions

## Prerequisites
- Node.js 18+ installed
- npm installed

## Installation Steps

1. **Install root dependencies:**
```bash
npm install
```

2. **Install server dependencies:**
```bash
cd server
npm install
cd ..
```

3. **Install client dependencies:**
```bash
cd client
npm install
cd ..
```

Or use the convenience script:
```bash
npm run install-all
```

## Running the Application

### Option 1: Run both servers together
```bash
npm run dev
```

### Option 2: Run servers separately

**Terminal 1 - Backend:**
```bash
cd server
npm start
```

**Terminal 2 - Frontend:**
```bash
cd client
npm run dev
```

## Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Troubleshooting

### "vite: command not found"
- Make sure you've installed client dependencies: `cd client && npm install`

### "Cannot connect to API"
- Make sure the backend server is running on port 3001
- Check that CORS is enabled (it should be by default)

### "Failed to fetch tokens"
- Check your internet connection
- Verify Jupiter API is accessible: https://token.jup.ag/all

