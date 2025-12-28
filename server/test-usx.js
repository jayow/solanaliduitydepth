import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'http://localhost:3001';

// USX address: 6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG
// USDC address: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

const USX_MINT = '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

async function testUSX() {
  console.log('🧪 Testing USX liquidity depth...\n');
  console.log(`Input: USX (${USX_MINT.slice(0, 8)}...)`);
  console.log(`Output: USDC (${USDC_MINT.slice(0, 8)}...)\n`);
  
  try {
    // Test BUY (buying USX with USDC)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Testing BUY direction (USDC → USX)...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const buyStartTime = Date.now();
    console.log('   ⏳ Waiting for response (this may take up to 2 minutes)...\n');
    const buyResponse = await axios.get(`${API_BASE}/api/liquidity-depth`, {
      params: {
        inputMint: USDC_MINT,
        outputMint: USX_MINT,
        isBuy: 'true'
      },
      timeout: 150000 // 150 seconds timeout
    });
    const buyDuration = ((Date.now() - buyStartTime) / 1000).toFixed(2);
    
    const buyDepth = buyResponse.data.depth || [];
    const buyDebug = buyResponse.data.debug || {};
    console.log(`✅ BUY completed in ${buyDuration}s`);
    console.log(`   Collected ${buyDepth.length} data points\n`);
    
    // Show server logs if available
    if (buyDebug.logs && buyDebug.logs.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📋 SERVER LOGS FOR BUY:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      buyDebug.logs.forEach(log => console.log(log));
      console.log('');
    } else {
      console.log('⚠️ No server logs available in response');
      console.log('   Debug object:', JSON.stringify(buyDebug, null, 2));
      console.log('');
    }
    
    // Show errors if available
    if (buyDebug.errors && buyDebug.errors.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ ERRORS FOR BUY:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      buyDebug.errors.forEach(err => {
        console.log(`   ${err.tradeSizeFormatted}: ${err.error} (Status: ${err.statusCode || 'N/A'})`);
      });
      console.log('');
    }
    
    if (buyDepth.length > 0) {
      const tradeSizes = buyDepth.map(p => p.tradeUsdValue).sort((a, b) => a - b);
      console.log('   Trade sizes collected:');
      tradeSizes.forEach(size => {
        const point = buyDepth.find(p => p.tradeUsdValue === size);
        const priceImpact = point?.priceImpact || point?.slippage || 0;
        console.log(`   - ${formatUSD(size)}: Price Impact ${priceImpact.toFixed(2)}%`);
      });
      
      const maxSize = Math.max(...tradeSizes);
      console.log(`\n   📈 Maximum trade size: ${formatUSD(maxSize)}`);
      
      if (maxSize < 100000000) {
        console.log(`   ⚠️ WARNING: Maximum is only ${formatUSD(maxSize)}, expected $100M!`);
      }
    } else {
      console.log('   ❌ No data points collected!');
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Testing SELL direction (USX → USDC)...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const sellStartTime = Date.now();
    console.log('   ⏳ Waiting for response (this may take up to 2 minutes)...\n');
    const sellResponse = await axios.get(`${API_BASE}/api/liquidity-depth`, {
      params: {
        inputMint: USX_MINT,
        outputMint: USDC_MINT,
        isBuy: 'false'
      },
      timeout: 150000 // 150 seconds timeout
    });
    const sellDuration = ((Date.now() - sellStartTime) / 1000).toFixed(2);
    
    const sellDepth = sellResponse.data.depth || [];
    const sellDebug = sellResponse.data.debug || {};
    console.log(`✅ SELL completed in ${sellDuration}s`);
    console.log(`   Collected ${sellDepth.length} data points\n`);
    
    // Show server logs if available
    if (sellDebug.logs && sellDebug.logs.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📋 SERVER LOGS FOR SELL:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      sellDebug.logs.forEach(log => console.log(log));
      console.log('');
    } else {
      console.log('⚠️ No server logs available in response');
      console.log('   Debug object:', JSON.stringify(sellDebug, null, 2));
      console.log('');
    }
    
    // Show errors if available
    if (sellDebug.errors && sellDebug.errors.length > 0) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('❌ ERRORS FOR SELL:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      sellDebug.errors.forEach(err => {
        console.log(`   ${err.tradeSizeFormatted}: ${err.error} (Status: ${err.statusCode || 'N/A'})`);
      });
      console.log('');
    }
    
    if (sellDepth.length > 0) {
      const tradeSizes = sellDepth.map(p => p.tradeUsdValue).sort((a, b) => a - b);
      console.log('   Trade sizes collected:');
      tradeSizes.forEach(size => {
        const point = sellDepth.find(p => p.tradeUsdValue === size);
        const priceImpact = point?.priceImpact || point?.slippage || 0;
        console.log(`   - ${formatUSD(size)}: Price Impact ${priceImpact.toFixed(2)}%`);
      });
      
      const maxSize = Math.max(...tradeSizes);
      console.log(`\n   📈 Maximum trade size: ${formatUSD(maxSize)}`);
      
      if (maxSize < 100000000) {
        console.log(`   ⚠️ WARNING: Maximum is only ${formatUSD(maxSize)}, expected $100M!`);
      }
    } else {
      console.log('   ❌ No data points collected!');
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`BUY:  ${buyDepth.length} points, max: ${buyDepth.length > 0 ? formatUSD(Math.max(...buyDepth.map(p => p.tradeUsdValue))) : 'N/A'}`);
    console.log(`SELL: ${sellDepth.length} points, max: ${sellDepth.length > 0 ? formatUSD(Math.max(...sellDepth.map(p => p.tradeUsdValue))) : 'N/A'}`);
    
  } catch (error) {
    console.error('\n❌ Error testing USX:');
    if (error.code === 'ECONNREFUSED') {
      console.error('   Cannot connect to backend. Make sure server is running on port 3001.');
    } else if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`   ${error.message}`);
    }
    process.exit(1);
  }
}

function formatUSD(amount) {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

testUSX();

