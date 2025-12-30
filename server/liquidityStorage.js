import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory for storing liquidity snapshots
const DATA_DIR = path.join(__dirname, 'data');
const LIQUIDITY_FILE = path.join(DATA_DIR, 'liquidity-snapshots.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize file if it doesn't exist
if (!fs.existsSync(LIQUIDITY_FILE)) {
  fs.writeFileSync(LIQUIDITY_FILE, JSON.stringify({ snapshots: [] }, null, 2));
}

/**
 * Get all stored liquidity snapshots
 */
export function getSnapshots() {
  try {
    const data = fs.readFileSync(LIQUIDITY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading snapshots:', error);
    return { snapshots: [] };
  }
}

/**
 * Get latest snapshot for each token
 */
export function getLatestSnapshots() {
  const { snapshots } = getSnapshots();
  
  if (snapshots.length === 0) {
    return [];
  }
  
  // Group by token symbol and get the latest for each
  const tokenMap = new Map();
  
  snapshots.forEach(snapshot => {
    snapshot.tokens.forEach(token => {
      const existing = tokenMap.get(token.symbol);
      if (!existing || new Date(snapshot.timestamp) > new Date(existing.timestamp)) {
        tokenMap.set(token.symbol, {
          ...token,
          timestamp: snapshot.timestamp
        });
      }
    });
  });
  
  return Array.from(tokenMap.values());
}

/**
 * Get historical data for a specific token
 */
export function getTokenHistory(symbol, hours = 24) {
  const { snapshots } = getSnapshots();
  const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  return snapshots
    .filter(snapshot => new Date(snapshot.timestamp) > cutoffTime)
    .map(snapshot => {
      const tokenData = snapshot.tokens.find(t => t.symbol === symbol);
      return {
        timestamp: snapshot.timestamp,
        ...tokenData
      };
    })
    .filter(item => item.symbol); // Only include snapshots that have this token
}

/**
 * Save a new liquidity snapshot
 */
export function saveSnapshot(tokens) {
  try {
    const data = getSnapshots();
    
    const newSnapshot = {
      timestamp: new Date().toISOString(),
      tokens: tokens,
      calculatedAt: new Date().toISOString()
    };
    
    data.snapshots.push(newSnapshot);
    
    // Keep only last 7 days of data (168 hours)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    data.snapshots = data.snapshots.filter(
      snapshot => new Date(snapshot.timestamp) > sevenDaysAgo
    );
    
    fs.writeFileSync(LIQUIDITY_FILE, JSON.stringify(data, null, 2));
    
    console.log(`✅ Saved snapshot with ${tokens.length} tokens. Total snapshots: ${data.snapshots.length}`);
    return newSnapshot;
  } catch (error) {
    console.error('Error saving snapshot:', error);
    throw error;
  }
}

/**
 * Get statistics for all tokens
 */
export function getStatistics() {
  const { snapshots } = getSnapshots();
  
  if (snapshots.length === 0) {
    return {
      totalSnapshots: 0,
      oldestSnapshot: null,
      newestSnapshot: null,
      tokensTracked: 0
    };
  }
  
  const timestamps = snapshots.map(s => new Date(s.timestamp));
  const allTokenSymbols = new Set();
  
  snapshots.forEach(snapshot => {
    snapshot.tokens.forEach(token => allTokenSymbols.add(token.symbol));
  });
  
  return {
    totalSnapshots: snapshots.length,
    oldestSnapshot: new Date(Math.min(...timestamps)).toISOString(),
    newestSnapshot: new Date(Math.max(...timestamps)).toISOString(),
    tokensTracked: allTokenSymbols.size,
    dataSize: fs.statSync(LIQUIDITY_FILE).size
  };
}

/**
 * Clear all snapshots (for testing)
 */
export function clearSnapshots() {
  fs.writeFileSync(LIQUIDITY_FILE, JSON.stringify({ snapshots: [] }, null, 2));
  console.log('✅ Cleared all snapshots');
}

