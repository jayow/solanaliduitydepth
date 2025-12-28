import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'http://localhost:3001';

// Token addresses
const USX_MINT = '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG';
const EUSX_MINT = '3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

async function testToken(tokenMint, tokenSymbol, direction = 'sell') {
  console.log(`\n🧪 Testing ${tokenSymbol} liquidity depth...\n`);
  console.log(`Token: ${tokenSymbol} (${tokenMint.slice(0, 8)}...)`);
  console.log(`Pair: ${tokenSymbol} <-> USDC\n`);
  
  let buyDepth = [];
  let sellDepth = [];
  let buyDebug = {};
  let sellDebug = {};
  
  try {
    // Test BUY (buying token with USDC)
    if (direction === 'both' || direction === 'buy') {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📊 Testing BUY direction (USDC → ${tokenSymbol})...`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      const buyStartTime = Date.now();
      console.log('   ⏳ Waiting for response (this may take up to 2 minutes)...\n');
      const buyResponse = await axios.get(`${API_BASE}/api/liquidity-depth`, {
        params: {
          inputMint: USDC_MINT,
          outputMint: tokenMint,
          isBuy: 'true'
        },
        timeout: 150000 // 150 seconds timeout
      });
      
      const buyDuration = ((Date.now() - buyStartTime) / 1000).toFixed(2);
      buyDepth = buyResponse.data.depth || [];
      buyDebug = buyResponse.data.debug || {};
      
      console.log(`✅ BUY completed in ${buyDuration}s`);
      console.log(`   Collected ${buyDepth.length} data points\n`);
      
      // Check if server is running new code
      if (!buyResponse.data.debug) {
        console.log('   ⚠️ Server is running OLD CODE - debug object missing!');
        console.log('   Server needs to be restarted to load new code.\n');
      }
      
      // Show server logs if available
      if (buyDebug.logs && buyDebug.logs.length > 0) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 SERVER LOGS FOR BUY:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        buyDebug.logs.forEach(log => console.log(log));
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
    }
    
    // Test SELL (selling token to get USDC)
    if (direction === 'both' || direction === 'sell') {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📊 Testing SELL direction (${tokenSymbol} → USDC)...`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      const sellStartTime = Date.now();
      console.log('   ⏳ Waiting for response (this may take up to 2 minutes)...\n');
      const sellResponse = await axios.get(`${API_BASE}/api/liquidity-depth`, {
        params: {
          inputMint: tokenMint,
          outputMint: USDC_MINT,
          isBuy: 'false'
        },
        timeout: 150000 // 150 seconds timeout
      });
      
      const sellDuration = ((Date.now() - sellStartTime) / 1000).toFixed(2);
      sellDepth = sellResponse.data.depth || [];
      sellDebug = sellResponse.data.debug || {};
      
      console.log(`✅ SELL completed in ${sellDuration}s`);
      console.log(`   Collected ${sellDepth.length} data points\n`);
      
      // Check if server is running new code
      if (!sellResponse.data.debug) {
        console.log('   ⚠️ Server is running OLD CODE - debug object missing!');
        console.log('   Server needs to be restarted to load new code.\n');
      }
      
      // Show server logs if available
      if (sellDebug.logs && sellDebug.logs.length > 0) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 SERVER LOGS FOR SELL:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        sellDebug.logs.forEach(log => console.log(log));
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
    }
    
    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const buyMax = buyDepth.length > 0 ? formatUSD(Math.max(...buyDepth.map(p => p.tradeUsdValue))) : 'N/A';
    const sellMax = sellDepth.length > 0 ? formatUSD(Math.max(...sellDepth.map(p => p.tradeUsdValue))) : 'N/A';
    console.log(`BUY:  ${buyDepth.length} points, max: ${buyMax}`);
    console.log(`SELL: ${sellDepth.length} points, max: ${sellMax}`);
    
    return { buyDepth, sellDepth, buyDebug, sellDebug };
    
  } catch (error) {
    console.error(`\n❌ Error testing ${tokenSymbol}:`);
    if (error.code === 'ECONNREFUSED') {
      console.error('   Cannot connect to backend. Make sure server is running on port 3001.');
    } else if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Error: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`   ${error.message}`);
    }
    throw error;
  }
}

function formatUSD(amount) {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

// Test both USX and USDT to compare
async function runTests() {
  try {
    console.log('='.repeat(70));
    console.log('TEST 1: USX');
    console.log('='.repeat(70));
    const usxResult = await testToken(USX_MINT, 'USX', 'sell');
    
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('TEST 2: eUSX');
    console.log('='.repeat(70));
    const eusxResult = await testToken(EUSX_MINT, 'eUSX', 'sell');
    
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('TEST 3: USDT (reference - should work up to $100M)');
    console.log('='.repeat(70));
    const usdtResult = await testToken(USDT_MINT, 'USDT', 'sell');
    
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('COMPARISON SUMMARY');
    console.log('='.repeat(70));
    
    const usxSellMax = usxResult.sellDepth.length > 0 
      ? Math.max(...usxResult.sellDepth.map(p => p.tradeUsdValue))
      : 0;
    const eusxSellMax = eusxResult.sellDepth.length > 0
      ? Math.max(...eusxResult.sellDepth.map(p => p.tradeUsdValue))
      : 0;
    const usdtSellMax = usdtResult.sellDepth.length > 0
      ? Math.max(...usdtResult.sellDepth.map(p => p.tradeUsdValue))
      : 0;
    
    console.log(`USX SELL:  ${formatUSD(usxSellMax)} (${usxResult.sellDepth.length} points)`);
    console.log(`eUSX SELL: ${formatUSD(eusxSellMax)} (${eusxResult.sellDepth.length} points)`);
    console.log(`USDT SELL: ${formatUSD(usdtSellMax)} (${usdtResult.sellDepth.length} points)`);
    
    console.log('\n📊 Analysis:');
    if (usxSellMax < 100000000 && eusxSellMax < 100000000 && usdtSellMax >= 100000000) {
      console.log('✅ USDT works up to $100M, but both USX and eUSX have liquidity limitations.');
      console.log('   This suggests Jupiter API cannot find enough liquidity for USX/eUSX at large sizes.');
    } else if (usxSellMax >= 100000000 && eusxSellMax >= 100000000) {
      console.log('✅ Both USX and eUSX work up to $100M - excellent liquidity!');
    } else if (eusxSellMax > usxSellMax) {
      console.log(`✅ eUSX has better liquidity than USX (${formatUSD(eusxSellMax)} vs ${formatUSD(usxSellMax)})`);
    } else if (usxSellMax > eusxSellMax) {
      console.log(`✅ USX has better liquidity than eUSX (${formatUSD(usxSellMax)} vs ${formatUSD(eusxSellMax)})`);
    } else {
      console.log(`⚠️ Both USX and eUSX have similar liquidity limitations (max: ${formatUSD(Math.max(usxSellMax, eusxSellMax))})`);
    }
    
  } catch (error) {
    console.error('\n❌ Test suite failed:', error.message);
    process.exit(1);
  }
}

runTests();
