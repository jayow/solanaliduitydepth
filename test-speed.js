import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

// Test with USX which has limited liquidity (known to max out around $2-3M)
const USX_MINT = '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function testSpeed() {
  console.log('🧪 Testing liquidity depth calculation speed...\n');
  console.log('Token: USX (known to have limited liquidity ~$2-3M)');
  console.log('Pair: USX → USDC (SELL)\n');
  
  const startTime = Date.now();
  
  try {
    const response = await axios.get(`${API_BASE}/liquidity-depth`, {
      params: {
        inputMint: USX_MINT,
        outputMint: USDC_MINT,
        isBuy: 'false'
      },
      timeout: 180000 // 3 minutes timeout
    });
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    const data = response.data;
    const sellDepth = data.sellDepth || [];
    const logs = data.logs || [];
    
    console.log(`\n✅ Calculation completed in ${duration} seconds\n`);
    console.log(`📊 Results:`);
    console.log(`   - Data points collected: ${sellDepth.length}`);
    console.log(`   - Max trade size: $${Math.max(...sellDepth.map(p => p.tradeUsdValue || 0), 0).toLocaleString()}`);
    
    // Check for skip messages in logs
    const skipMessages = logs.filter(log => log.includes('⏭️ Skipping'));
    if (skipMessages.length > 0) {
      console.log(`\n✅ Optimization working! Skipped ${skipMessages.length} trade sizes:`);
      skipMessages.forEach(msg => console.log(`   ${msg}`));
    } else {
      console.log(`\n⚠️ No skip messages found - optimization may not be working`);
    }
    
    // Show trade sizes that were tested
    const testedSizes = sellDepth.map(p => p.tradeUsdValue).sort((a, b) => a - b);
    console.log(`\n📈 Trade sizes tested: ${testedSizes.map(s => `$${(s/1000000).toFixed(1)}M`).join(', ')}`);
    
  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    console.error(`\n❌ Error after ${duration} seconds:`, error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

// Check if server is running first
axios.get(`${API_BASE}/jupiter-status`)
  .then(() => {
    console.log('✅ Server is running\n');
    testSpeed();
  })
  .catch(() => {
    console.error('❌ Server is not running. Please start it first:');
    console.error('   cd server && NODE_TLS_REJECT_UNAUTHORIZED=0 node index.js');
  });

