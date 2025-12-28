// Set Node.js TLS to not reject unauthorized certificates (MUST be before any imports)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

// Log SSL configuration on startup
console.log('🔒 SSL Configuration:', {
  NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
  note: 'SSL verification disabled for development'
});

// Configure HTTPS agent to handle SSL certificates (for development)
// WARNING: This disables SSL verification - only use in development!
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Create axios instance with HTTPS agent configured
const axiosInstance = axios.create({
  httpsAgent: httpsAgent,
  timeout: 15000,
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Jupiter API configuration
// Using paid API with API key for higher rate limits
// API key must be set via JUPITER_API_KEY environment variable
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;

if (!JUPITER_API_KEY) {
  console.warn('⚠️ WARNING: JUPITER_API_KEY environment variable not set. API requests may be rate limited.');
  console.warn('   Set JUPITER_API_KEY in your .env file or environment variables.');
}
const JUPITER_QUOTE_URL = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_TOKEN_URL = 'https://api.jup.ag/tokens/v1/all';

// Rate limit handling (reduced delays for paid API)
let lastQuoteTime = 0;
const MIN_QUOTE_INTERVAL = 100; // Reduced to 100ms for paid API (was 300ms for free)
const LARGE_AMOUNT_DELAY = 100; // Reduced delay for large amounts (was 300ms)
const RATE_LIMIT_RETRY_DELAY = 1000; // Reduced retry delay (was 2000ms)

// Cache for token list
let tokenListCache = null;
let tokenListCacheTime = null;
const TOKEN_LIST_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Fetch token list from Jupiter
async function getTokenList() {
  const now = Date.now();
  if (tokenListCache && tokenListCacheTime && (now - tokenListCacheTime) < TOKEN_LIST_CACHE_DURATION) {
    return tokenListCache;
  }

  // Try multiple Jupiter token endpoints to get all available tokens
  // Order: Most reliable first
  const tokenEndpoints = [
    'https://token.jup.ag/all',                    // Jupiter's comprehensive token list (primary)
    'https://token.jup.ag/strict',                // Jupiter's strict token list (verified tokens)
    'https://tokens.jup.ag/all',                  // Alternative Jupiter endpoint
    'https://api.jup.ag/tokens/v1/all',           // Jupiter API v1 endpoint
    JUPITER_TOKEN_URL,                            // Lite API endpoint
    'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json', // Solana official token list (fallback)
    'https://cdn.jsdelivr.net/gh/solana-labs/token-list@main/src/tokens/solana.tokenlist.json', // CDN version (fallback)
  ];

  let allTokens = [];
  const tokenMap = new Map(); // Use Map to deduplicate by address
  
  // Try all endpoints and combine results
  for (const endpoint of tokenEndpoints) {
    try {
      console.log(`🔍 Trying token endpoint: ${endpoint}`);
      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'Solana-Liquidity-Depth/1.0'
      };
      
      // Add API key for Jupiter endpoints (if available)
      if ((endpoint.includes('jup.ag') || endpoint.includes('api.jup.ag')) && JUPITER_API_KEY) {
        headers['x-api-key'] = JUPITER_API_KEY;
      }
      
      const response = await axiosInstance.get(endpoint, {
        headers,
        timeout: 15000
      });
      
      let tokens = response.data;
      
      // Handle different response formats
      if (tokens && typeof tokens === 'object') {
        // Solana token list format: { tokens: [...] }
        if (tokens.tokens && Array.isArray(tokens.tokens)) {
          tokens = tokens.tokens;
        }
        // Jupiter format: might be array or object with tokens
        else if (Array.isArray(tokens)) {
          // Already an array
        }
        // Object with token addresses as keys
        else if (typeof tokens === 'object' && !Array.isArray(tokens)) {
          tokens = Object.values(tokens);
        }
      }
      
      if (Array.isArray(tokens) && tokens.length > 0) {
        console.log(`✅ Loaded ${tokens.length} tokens from ${endpoint}`);
        
        // Add tokens to map (deduplicate by address)
        let addedCount = 0;
        for (const token of tokens) {
          const address = token.address || token.mintAddress || token.mint;
          if (address && !tokenMap.has(address)) {
            tokenMap.set(address, token);
            addedCount++;
          }
        }
        console.log(`   Added ${addedCount} new tokens (${tokenMap.size} total unique tokens)`);
        
        // If we got a good result from Jupiter (first 4 endpoints), we can stop trying others
        // Only continue if we got very few tokens (< 50) or it's a fallback endpoint
        const isJupiterEndpoint = endpoint.includes('jup.ag') || endpoint.includes('api.jup.ag');
        if (isJupiterEndpoint && tokens.length >= 50) {
          console.log(`✅ Got good token list from Jupiter, stopping search`);
          break; // Stop trying other endpoints
        }
      } else {
        console.warn(`⚠️ Endpoint ${endpoint} returned empty or invalid data`);
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      const errorCode = error.code;
      const statusCode = error.response?.status;
      console.warn(`❌ Token endpoint ${endpoint} failed:`, {
        code: errorCode,
        status: statusCode,
        message: errorMsg,
        details: error.response?.data ? JSON.stringify(error.response.data).substring(0, 200) : 'No response data'
      });
      continue;
    }
  }
  
  // Convert map back to array
  let tokens = Array.from(tokenMap.values());

  if (!tokens || tokens.length === 0) {
    console.warn('⚠️ No tokens loaded from any endpoint, using fallback tokens');
    return getFallbackTokens();
  }
  
  console.log(`📊 Combined ${tokens.length} unique tokens from all sources`);
    
  // Normalize token structure - handle various token list formats
  tokens = tokens.map(token => {
    // Handle different address field names
    const address = token.address || token.mintAddress || token.mint;
    
    // Handle different symbol formats
    const symbol = token.symbol || '';
    
    // Handle different name formats
    const name = token.name || token.symbol || 'Unknown Token';
    
    // Get decimals (default to 6 for USDC-like tokens, 9 for SOL-like)
    let decimals = token.decimals;
    if (decimals === undefined || decimals === null) {
      // Try to infer from common tokens
      if (symbol === 'SOL' || address === 'So11111111111111111111111111111111111111112') {
        decimals = 9;
      } else {
        decimals = 6; // Default for most tokens
      }
    }
    
    return {
      address,
      symbol,
      name,
      decimals,
      logoURI: token.logoURI || token.logoUri || token.image || null,
      ...token // Keep all original fields
    };
  }).filter(token => {
    // Filter out invalid tokens
    return token.address && 
           token.symbol && 
           token.address.length > 0 && 
           token.symbol.length > 0;
  });
  
  if (tokens.length === 0) {
    console.warn('No valid tokens after normalization, using fallback');
    return getFallbackTokens();
  }
  
  // Ensure important tokens from fallback are always included (even if Jupiter has different versions)
  const importantTokens = getFallbackTokens().filter(t => {
    // Always include these specific tokens by address
    const importantAddresses = [
      '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG', // USX (specific version user wants)
      'So11111111111111111111111111111111111111112', // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    ];
    return importantAddresses.includes(t.address);
  });
  
  // Add important tokens if they're not already in the list
  for (const importantToken of importantTokens) {
    const exists = tokens.some(t => 
      (t.address || t.mintAddress || t.mint) === importantToken.address
    );
    if (!exists) {
      tokens.push(importantToken);
      console.log(`➕ Added important token: ${importantToken.symbol} (${importantToken.address.slice(0, 8)}...)`);
    } else {
      // Replace with fallback version if address matches (to ensure correct version)
      const index = tokens.findIndex(t => 
        (t.address || t.mintAddress || t.mint) === importantToken.address
      );
      if (index >= 0) {
        tokens[index] = importantToken;
        console.log(`🔄 Replaced token with fallback version: ${importantToken.symbol}`);
      }
    }
  }
  
  tokenListCache = tokens;
  tokenListCacheTime = now;
  console.log(`Cached ${tokens.length} tokens (including ${importantTokens.length} important fallback tokens)`);
  return tokenListCache;
}

// Fallback token list with popular Solana tokens
function getFallbackTokens() {
  console.log('📋 Returning fallback token list (includes USX)');
  return [
    {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
    },
    {
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png'
    },
    {
      address: '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG',
      symbol: 'USX',
      name: 'USX',
      decimals: 6,
    },
    {
      address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png'
    },
    {
      address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
      symbol: 'mSOL',
      name: 'Marinade SOL',
      decimals: 9,
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png'
    },
    {
      address: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
      symbol: 'ETH',
      name: 'Ethereum (Wormhole)',
      decimals: 8,
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png'
    },
    {
      address: 'A9mUU4qviSctJVPJdBJWkb28deg915LYJKrzQ19ji3FM',
      symbol: 'USDCet',
      name: 'USD Coin (Wormhole from Ethereum)',
      decimals: 6,
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/A9mUU4qviSctJVPJdBJWkb28deg915LYJKrzQ19ji3FM/logo.png'
    },
    {
      address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      symbol: 'BONK',
      name: 'Bonk',
      decimals: 5,
    },
    {
      address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
      symbol: 'WIF',
      name: 'dogwifhat',
      decimals: 6,
    },
    {
      address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
      symbol: 'RAY',
      name: 'Raydium',
      decimals: 6,
    },
    {
      address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
      symbol: 'JUP',
      name: 'Jupiter',
      decimals: 6,
    },
    {
      address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      symbol: 'SAMO',
      name: 'Samoyedcoin',
      decimals: 9,
    },
    {
      address: 'SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt',
      symbol: 'SRM',
      name: 'Serum',
      decimals: 6,
    },
    {
      address: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
      symbol: 'BTC',
      name: 'Bitcoin (Wormhole)',
      decimals: 8,
    },
    {
      address: '2FPyTwcZLUg1MDrwsyoP4D6s1tM7hAkHYRjkNb5w6Pxk',
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 6,
    },
    {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'WSOL',
      name: 'Wrapped SOL',
      decimals: 9,
    }
  ];
}

// Wait to respect rate limits
async function waitForRateLimit() {
  const now = Date.now();
  const timeSinceLastQuote = now - lastQuoteTime;
  if (timeSinceLastQuote < MIN_QUOTE_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_QUOTE_INTERVAL - timeSinceLastQuote));
  }
  lastQuoteTime = Date.now();
}

// Get quote from Jupiter with retry logic
async function getQuote(inputMint, outputMint, amount, slippageBps = 50, retries = 3) {
  await waitForRateLimit();
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axiosInstance.get(JUPITER_QUOTE_URL, {
        params: {
          inputMint,
          outputMint,
          amount: amount.toString(),
          slippageBps: slippageBps.toString(),
        },
        headers: {
          'Accept': 'application/json',
          ...(JUPITER_API_KEY && { 'x-api-key': JUPITER_API_KEY }),
        }
      });
      
      if (!response.data || !response.data.outAmount || !response.data.inAmount) {
        throw new Error('Invalid quote response');
      }
      
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      const errorMsg = error.response?.data?.error || error.message;
      const errorCode = error.code;
      
      // Log detailed error for debugging
      if (errorCode === 'UNABLE_TO_GET_ISSUER_CERT' || errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || errorMsg?.includes('certificate')) {
        console.error('SSL Certificate Error:', errorCode, errorMsg);
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          stack: error.stack?.split('\n')[0]
        });
      }
      
      // If rate limited (429), wait longer and retry with exponential backoff
      if (status === 429 && attempt < retries) {
        const waitTime = RATE_LIMIT_RETRY_DELAY * Math.pow(2, attempt - 1); // Exponential backoff: 2s, 4s, 8s
        console.warn(`⚠️ Rate limited (429), waiting ${(waitTime / 1000).toFixed(1)}s before retry ${attempt + 1}/${retries}`);
        console.warn(`💡 Jupiter API rate limit reached. Please wait or reduce request frequency.`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Log error on last attempt
      if (attempt === retries) {
        console.error(`Quote failed after ${retries} attempts:`, errorMsg);
        throw error;
      }
    }
  }
}

// Format number with K/M suffixes for readability
function formatAmount(amount) {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}

// Format USD with K/M suffixes
function formatUSD(amount) {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

// Get token decimals from token list
async function getTokenDecimals(mintAddress) {
  try {
    const tokens = await getTokenList();
    const token = tokens.find(t => 
      t.address === mintAddress || 
      t.mintAddress === mintAddress || 
      t.mint === mintAddress
    );
    return token?.decimals || 6; // Default to 6 decimals if not found
  } catch (error) {
    console.warn(`Could not fetch decimals for ${mintAddress}, defaulting to 6`);
    return 6;
  }
}

// Calculate liquidity depth by getting quotes at fixed USD amounts
async function calculateLiquidityDepth(inputMint, outputMint, isBuy) {
  const depthPoints = [];
  
  // Get token decimals
  const inputDecimals = await getTokenDecimals(inputMint);
  const outputDecimals = await getTokenDecimals(outputMint);
  
  // For buy: selling outputToken (e.g., USDC) to buy inputToken (e.g., SOL)
  // For sell: selling inputToken (e.g., SOL) to get outputToken (e.g., USDC)
  const quoteInputDecimals = isBuy ? outputDecimals : inputDecimals;
  
  // Fixed USD trade sizes to test (matching DeFiLlama format)
  const usdTradeSizes = [
    500,        // $500
    1000,       // $1K
    10000,      // $10K
    100000,     // $100K
    1000000,    // $1M
    10000000,   // $10M
    50000000,   // $50M
    100000000,  // $100M
  ];
  
  // Set a maximum calculation time (120 seconds - increased to allow for $50M and $100M trades)
  const MAX_CALCULATION_TIME = 120000;
  const calculationStartTime = Date.now();

  console.log(`\nCalculating ${isBuy ? 'BUY' : 'SELL'} depth for ${inputMint.slice(0, 8)}... -> ${outputMint.slice(0, 8)}...`);
  console.log(`Testing ${usdTradeSizes.length} fixed USD trade sizes:`, usdTradeSizes.map(s => formatUSD(s)).join(', '));

  // First, get a baseline price from a very small trade to calculate price impact and convert USD to token amounts
  let baselinePrice = null;
  const baselineAmounts = [100, 50, 10]; // Try progressively smaller amounts if rate limited
  
  // For sell orders, try to get a reverse quote first to estimate price
  if (!isBuy) {
    try {
      console.log(`Getting initial price estimate for sell order (reverse quote)...`);
      // Try buying a small amount in reverse direction to get price estimate
      // This helps us estimate how much token we need to sell for $100
      const reverseInputMint = outputMint; // USDC
      const reverseOutputMint = inputMint; // SOL
      const smallReverseAmount = Math.floor(100 * Math.pow(10, outputDecimals)); // $100 in USDC
      
      const reverseQuote = await getQuote(reverseInputMint, reverseOutputMint, smallReverseAmount, 50, 1);
      
      if (reverseQuote?.outAmount && reverseQuote?.inAmount) {
        const reverseInputReadable = parseFloat(reverseQuote.inAmount) / Math.pow(10, outputDecimals);
        const reverseOutputReadable = parseFloat(reverseQuote.outAmount) / Math.pow(10, inputDecimals);
        
        // Price = USDC per token (e.g., 123 USDC per SOL)
        const estimatedPrice = reverseInputReadable / reverseOutputReadable;
        
        if (estimatedPrice > 0 && isFinite(estimatedPrice) && estimatedPrice < 1e10) {
          console.log(`✅ Got price estimate from reverse quote: ${estimatedPrice.toFixed(6)}`);
          // Use this estimate for baseline calculation
          baselinePrice = estimatedPrice;
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not get reverse quote for price estimate, will try direct method...`);
    }
  }
  
  // Get baseline price from small trades (if not already obtained from reverse quote)
  if (!baselinePrice) {
    for (const smallUsdAmount of baselineAmounts) {
      try {
        console.log(`Getting baseline price from small $${smallUsdAmount} trade...`);
        
        // For baseline, we always use the "selling" token side
        // If buying: we're selling USDC to buy SOL, so use USDC amount directly
        // If selling: we're selling SOL to get USDC, so we need to estimate SOL amount
        let smallTokenAmount;
        if (isBuy) {
          // Buying: spending USDC, so USD = USDC amount
          smallTokenAmount = smallUsdAmount;
        } else {
          // Selling: use estimated price from reverse quote if available, otherwise use conservative estimate
          if (baselinePrice && baselinePrice > 0) {
            // Use the estimated price from reverse quote
            smallTokenAmount = smallUsdAmount / baselinePrice;
            console.log(`Using reverse quote price estimate (${baselinePrice.toFixed(6)}) to calculate token amount: ${formatAmount(smallTokenAmount)}`);
          } else {
            // Fallback: try a few reasonable token amounts and use the first successful one
            // This is more efficient than trying multiple price assumptions
            const testTokenAmounts = [
              smallUsdAmount / 100,   // $100/token (high value tokens)
              smallUsdAmount / 10,    // $10/token (mid value)
              smallUsdAmount / 1,     // $1/token (low value)
              smallUsdAmount / 0.1,   // $0.1/token (very low value)
            ];
            
            let foundValidAmount = false;
            for (const testAmount of testTokenAmounts) {
              const testRawAmount = Math.floor(testAmount * Math.pow(10, quoteInputDecimals));
              if (testRawAmount > 0) {
                smallTokenAmount = testAmount;
                foundValidAmount = true;
                console.log(`Trying token amount estimate: ${formatAmount(testAmount)} (${formatUSD(smallUsdAmount / testAmount)}/token assumption)`);
                break;
              }
            }
            
            if (!foundValidAmount) {
              // Last resort: use $100/token assumption
              smallTokenAmount = smallUsdAmount / 100;
              console.log(`Using fallback estimate: $100/token`);
            }
          }
        }
        
        // Convert to raw amount
        const smallRawAmount = Math.floor(smallTokenAmount * Math.pow(10, quoteInputDecimals));
        if (smallRawAmount <= 0) continue;
        
        const quoteInputMint = isBuy ? outputMint : inputMint;
        const quoteOutputMint = isBuy ? inputMint : outputMint;
        
        const baselineQuote = await getQuote(quoteInputMint, quoteOutputMint, smallRawAmount, 50, 2); // Only 2 retries for baseline
        
        if (baselineQuote?.outAmount && baselineQuote?.inAmount) {
          const baselineInputRaw = isBuy ? baselineQuote.outAmount : baselineQuote.inAmount;
          const baselineOutputRaw = isBuy ? baselineQuote.inAmount : baselineQuote.outAmount;
          
          const baselineInputReadable = parseFloat(baselineInputRaw) / Math.pow(10, inputDecimals);
          const baselineOutputReadable = parseFloat(baselineOutputRaw) / Math.pow(10, outputDecimals);
          
          // Price = output per input (e.g., USDC per SOL)
          const calculatedPrice = baselineOutputReadable / baselineInputReadable;
          
          // Validate price before using
          if (calculatedPrice > 0 && isFinite(calculatedPrice) && calculatedPrice < 1e10) {
            baselinePrice = calculatedPrice;
            console.log(`✅ Baseline price: ${baselinePrice.toFixed(6)} ${outputToken?.symbol || 'output'}/${inputToken?.symbol || 'input'}`);
            break; // Success, exit loop
          } else {
            console.warn(`⚠️ Invalid baseline price calculated: ${calculatedPrice}, trying next amount...`);
            continue;
          }
        }
      } catch (error) {
        const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
        const statusCode = error.response?.status;
        
        if (statusCode === 429) {
          console.warn(`⚠️ Rate limited getting baseline ($${smallUsdAmount}), trying smaller amount...`);
          // Continue to next smaller amount
          continue;
        } else {
          console.warn(`⚠️ Failed to get baseline price for $${smallUsdAmount}:`, errorMsg);
          // Try next amount
          continue;
        }
      }
    }
  }
  
  // If we still don't have a baseline price, we'll use the first successful quote as baseline
  if (!baselinePrice) {
    console.warn('⚠️ Could not get baseline price. Will use first successful quote as baseline.');
  }

  // Now test each USD trade size
  // Convert each fixed USD amount to the exact token amount needed
  for (const usdAmount of usdTradeSizes) {
    // Check if we're running out of time
    const elapsed = Date.now() - calculationStartTime;
    if (elapsed > MAX_CALCULATION_TIME) {
      console.warn(`⏱️ Calculation timeout (${(elapsed / 1000).toFixed(1)}s). Returning ${depthPoints.length} points collected so far.`);
      break; // Stop and return what we have
    }
    
    // Define these outside try block so they're available in error handler
    const quoteInputMint = isBuy ? outputMint : inputMint;
    const quoteOutputMint = isBuy ? inputMint : outputMint;
    let rawAmount = null; // Will be set inside try block
    
    try {
      // Convert fixed USD trade size to exact token amount needed
      // This ensures we test the exact USD value, not arbitrary token amounts
      let tokenAmount;
      if (isBuy) {
        // Buying: Spending USDC to buy SOL
        // Fixed USD amount = USDC amount to spend (1 USDC = $1)
        // Example: $1000 = 1000 USDC tokens
        tokenAmount = usdAmount;
      } else {
        // Selling: Selling SOL to get USDC
        // Fixed USD amount = value of SOL we want to sell
        // baselinePrice = USDC per SOL (e.g., 123 USDC per SOL)
        // So: SOL amount = USD amount / baselinePrice
        // Example: $1000 / 123 = ~8.13 SOL
        if (baselinePrice && baselinePrice > 0) {
          tokenAmount = usdAmount / baselinePrice;
        } else {
          // If no baseline price, use a conservative estimate
          // Most tokens are between $0.01 and $1000, so use $100 as default
          console.warn(`⚠️ No baseline price available, using $100/token estimate for $${usdAmount.toLocaleString()}`);
          tokenAmount = usdAmount / 100;
        }
      }
      
      // Convert to raw amount (smallest unit)
      rawAmount = Math.floor(tokenAmount * Math.pow(10, quoteInputDecimals));
      if (rawAmount <= 0) {
        console.warn(`⚠️ Skipping ${formatUSD(usdAmount)} - calculated token amount too small: ${formatAmount(tokenAmount)}`);
        continue;
      }
      
      console.log(`Testing ${formatUSD(usdAmount)} = ${formatAmount(tokenAmount)} tokens (raw: ${rawAmount.toLocaleString()})`);
      
      // Check timeout before proceeding (but allow a bit of buffer for the actual request)
      const elapsed = Date.now() - calculationStartTime;
      // Only stop if we're way over timeout (give 5 seconds buffer for the request itself)
      if (elapsed > MAX_CALCULATION_TIME + 5000) {
        console.warn(`⏱️ Timeout exceeded, stopping at ${formatUSD(usdAmount)}`);
        break;
      }
      // If we're close to timeout but not over, still try (request might be fast)
      if (elapsed > MAX_CALCULATION_TIME) {
        console.warn(`⏱️ Approaching timeout (${(elapsed / 1000).toFixed(1)}s), but attempting ${formatUSD(usdAmount)} anyway...`);
      }
      
      // Extra delay for large amounts to avoid rate limits (only if we have time)
      if (usdAmount >= 1000000 && (MAX_CALCULATION_TIME - elapsed) > LARGE_AMOUNT_DELAY) {
        await new Promise(resolve => setTimeout(resolve, LARGE_AMOUNT_DELAY));
      }
      
      // Use more retries for large amounts to handle transient errors
      const retryCount = usdAmount >= 10000000 ? 3 : 2; // 3 retries for $10M+, 2 for smaller
      const quote = await getQuote(quoteInputMint, quoteOutputMint, rawAmount, 50, retryCount);

      if (quote?.outAmount && quote?.inAmount) {
        // Calculate readable amounts
        const inputAmountRaw = isBuy ? quote.outAmount : quote.inAmount;
        const outputAmountRaw = isBuy ? quote.inAmount : quote.outAmount;
        
        const inputAmountReadable = parseFloat(inputAmountRaw) / Math.pow(10, inputDecimals);
        const outputAmountReadable = parseFloat(outputAmountRaw) / Math.pow(10, outputDecimals);
        
        // Validate amounts before calculating price
        if (!isFinite(inputAmountReadable) || inputAmountReadable <= 0) {
          console.warn(`⚠️ Invalid input amount for ${formatUSD(usdAmount)}: ${inputAmountReadable}`);
          continue;
        }
        
        if (!isFinite(outputAmountReadable) || outputAmountReadable <= 0) {
          console.warn(`⚠️ Invalid output amount for ${formatUSD(usdAmount)}: ${outputAmountReadable}`);
          continue;
        }
        
        // Price = output per input
        const price = outputAmountReadable / inputAmountReadable;
        
        // Comprehensive price validation
        if (!isFinite(price) || price <= 0 || price > 1e10) {
          console.warn(`⚠️ Invalid price for ${formatUSD(usdAmount)}: ${price}`);
          continue;
        }
        
        // If we don't have a baseline price yet, use this first successful quote as baseline
        if (!baselinePrice) {
          baselinePrice = price;
          console.log(`✅ Using first successful quote as baseline price: ${baselinePrice.toFixed(6)}`);
        }
        
        // Use Jupiter's priceImpactPct from the quote response if available (more accurate)
        // Jupiter calculates this using their routing algorithm and includes all liquidity sources
        // If not available, fall back to our calculation
        let priceImpact = 0;
        if (quote.priceImpactPct !== undefined && quote.priceImpactPct !== null) {
          // Jupiter returns priceImpactPct as a decimal (e.g., 0.9999 = 99.99%)
          // Convert to percentage
          priceImpact = Math.abs(parseFloat(quote.priceImpactPct)) * 100;
          console.log(`📊 Using Jupiter's priceImpactPct: ${priceImpact.toFixed(2)}%`);
        } else {
          // Fallback: Calculate price impact ourselves
          // Use baseline price for price impact calculation
          const referencePrice = baselinePrice;
          
          // Calculate price impact (how much price changes from baseline due to trade size)
          // This is technically "price impact" not "slippage", but we keep both terms for compatibility
          // Price Impact = |(execution_price - baseline_price) / baseline_price| * 100
          priceImpact = referencePrice > 0 
            ? Math.abs((price - referencePrice) / referencePrice) * 100 
            : 0;
          console.log(`📊 Calculated price impact: ${priceImpact.toFixed(2)}% (Jupiter's priceImpactPct not available)`);
        }
        
        // Slippage is the same as price impact in this context (no market movement during execution)
        // In real trading, slippage can include price impact + market movement + MEV
        const slippage = priceImpact;
        
        // Validate price impact is reasonable (warn if extreme, but don't skip)
        if (priceImpact > 1000) {
          console.warn(`⚠️ Extreme price impact detected: ${priceImpact.toFixed(2)}% for ${formatUSD(usdAmount)}`);
        }
        
        // Validate that amounts are monotonically increasing (for cumulative calculation)
        if (depthPoints.length > 0) {
          const lastPoint = depthPoints[depthPoints.length - 1];
          if (inputAmountReadable < lastPoint.amount * 0.9) {
            console.warn(`⚠️ Trade amount decreased: ${formatAmount(inputAmountReadable)} < ${formatAmount(lastPoint.amount)} for ${formatUSD(usdAmount)}`);
          }
        }

        // Store the fixed USD trade size we tested
        // This is the target USD value we wanted to test (e.g., $1000)
        // The actual token amounts were calculated from this USD value
        const tradeUsdValue = usdAmount;

        depthPoints.push({
          price,
          amount: inputAmountReadable, // Token amount we actually traded (calculated from USD)
          // cumulativeLiquidity will be calculated after all points are collected
          outputAmount: outputAmountReadable, // Token amount we received
          priceImpact, // Price impact: how much price changes from baseline due to trade size
          slippage, // Slippage: same as price impact in this context (no market movement)
          tradeUsdValue, // Fixed USD trade size we tested (this is the key value)
          rawInputAmount: inputAmountRaw,
          rawOutputAmount: outputAmountRaw,
        });
        
        console.log(`✅ ${formatUSD(usdAmount)}: ${formatAmount(inputAmountReadable)} -> ${formatAmount(outputAmountReadable)}, price impact: ${priceImpact.toFixed(2)}%`);
      } else {
        console.warn(`⚠️ Invalid quote response for ${formatUSD(usdAmount)}:`, quote ? 'Missing outAmount/inAmount' : 'No quote data');
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error';
      const statusCode = error.response?.status;
      
      // Log detailed error info
      if (statusCode === 429) {
        console.error(`⚠️ Rate limited for ${formatUSD(usdAmount)} - will retry with backoff`);
      } else if (statusCode >= 400) {
        console.error(`❌ API error ${statusCode} for ${formatUSD(usdAmount)}: ${errorMsg}`);
        // For large amounts, log more details
        if (usdAmount >= 10000000) {
          console.error(`   This is a large trade size. Error details:`, {
            statusCode,
            error: errorMsg,
            inputMint: quoteInputMint ? quoteInputMint.slice(0, 8) : inputMint?.slice(0, 8),
            outputMint: quoteOutputMint ? quoteOutputMint.slice(0, 8) : outputMint?.slice(0, 8),
            rawAmount: rawAmount ? rawAmount.toLocaleString() : 'N/A'
          });
        }
      } else {
        console.error(`❌ Failed to get quote for ${formatUSD(usdAmount)}: ${errorMsg}`);
      }
      // Continue to next amount - don't fail the entire request
      // Note: We skip this amount but will try the next one
      // Log which amount we're skipping for debugging
      console.log(`⏭️ Skipping ${formatUSD(usdAmount)} due to error, continuing to next trade size...`);
    }
  }
  
  // Log final status
  console.log(`\n📊 Calculation complete. Processed ${depthPoints.length} of ${usdTradeSizes.length} trade sizes.`);
  if (depthPoints.length < usdTradeSizes.length) {
    const missingSizes = usdTradeSizes.filter(size => 
      !depthPoints.some(point => point.tradeUsdValue === size)
    );
    if (missingSizes.length > 0) {
      console.warn(`⚠️ Missing trade sizes: ${missingSizes.map(s => formatUSD(s)).join(', ')}`);
    }
  }
  
  const endTime = Date.now();
  const totalTime = (endTime - calculationStartTime) / 1000;
  
  // Calculate cumulative liquidity (sum of all previous trades + current)
  // Sort by trade size to ensure proper cumulative calculation
  depthPoints.sort((a, b) => a.tradeUsdValue - b.tradeUsdValue);
  
  let cumulativeAmount = 0;
  let cumulativeOutputAmount = 0;
  
  depthPoints.forEach((point, index) => {
    // Validate data before adding to cumulative
    if (point.amount > 0 && point.price > 0 && isFinite(point.price) && isFinite(point.amount)) {
      cumulativeAmount += point.amount;
      cumulativeOutputAmount += point.outputAmount;
      
      point.cumulativeLiquidity = cumulativeAmount;
      point.cumulativeOutputLiquidity = cumulativeOutputAmount;
    } else {
      // If invalid, use previous cumulative value
      point.cumulativeLiquidity = index > 0 ? depthPoints[index - 1].cumulativeLiquidity : 0;
      point.cumulativeOutputLiquidity = index > 0 ? depthPoints[index - 1].cumulativeOutputLiquidity : 0;
      console.warn(`⚠️ Invalid data point at index ${index}, using previous cumulative value`);
    }
    
    // Additional validation: check for extreme values
    const priceImpact = point.priceImpact !== undefined ? point.priceImpact : point.slippage;
    if (priceImpact > 1000) {
      console.warn(`⚠️ Extreme price impact detected: ${priceImpact.toFixed(2)}% for ${formatUSD(point.tradeUsdValue)}`);
    }
    
    if (point.price <= 0 || !isFinite(point.price) || point.price > 1e10) {
      console.warn(`⚠️ Invalid price detected: ${point.price} for ${formatUSD(point.tradeUsdValue)}`);
    }
  });
  
  if (totalTime >= MAX_CALCULATION_TIME / 1000) {
    console.warn(`⏱️ Calculation reached time limit (${(MAX_CALCULATION_TIME / 1000).toFixed(0)}s). Returning ${depthPoints.length} points collected.`);
  } else {
    console.log(`\n✅ Liquidity depth calculation finished in ${totalTime.toFixed(2)} seconds. Collected ${depthPoints.length} points.`);
    if (depthPoints.length > 0) {
      const maxCumulative = depthPoints[depthPoints.length - 1].cumulativeLiquidity;
      console.log(`📊 Maximum cumulative liquidity: ${formatAmount(maxCumulative)} tokens`);
    }
  }
  
  return depthPoints;
}

// Routes
app.get('/api/tokens', async (req, res) => {
  try {
    const refresh = req.query.refresh === 'true';
    
    if (refresh) {
      // Clear cache to force refresh
      tokenListCache = null;
      tokenListCacheTime = null;
      console.log('🔄 Token cache cleared, forcing refresh...');
    }
    
    console.log('📋 Fetching token list...');
    const tokens = await getTokenList();
    
    // Ensure we always return an array, even if empty
    if (Array.isArray(tokens) && tokens.length > 0) {
      console.log(`✅ Returning ${tokens.length} tokens`);
      res.json(tokens);
    } else {
      // If somehow we get empty tokens, return fallback
      console.warn('⚠️ Empty token list, returning fallback tokens');
      const fallback = getFallbackTokens();
      console.log(`✅ Returning ${fallback.length} fallback tokens`);
      res.json(fallback);
    }
  } catch (error) {
    console.error('❌ Token fetch error:', error.message || error);
    // Return fallback tokens instead of error
    console.log('✅ Returning fallback tokens due to error');
    const fallback = getFallbackTokens();
    res.json(fallback);
  }
});

app.get('/api/quote', async (req, res) => {
  try {
    const { inputMint, outputMint, amount, slippageBps } = req.query;
    
    if (!inputMint || !outputMint || !amount) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const quote = await getQuote(inputMint, outputMint, amount, slippageBps);
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch quote' });
  }
});

app.get('/api/liquidity-depth', async (req, res) => {
  try {
    const { inputMint, outputMint, isBuy } = req.query;
    
    if (!inputMint || !outputMint) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const isBuyOrder = isBuy === 'true';
    console.log(`\n=== Starting liquidity depth calculation ===`);
    console.log(`Direction: ${isBuyOrder ? 'BUY' : 'SELL'}`);
    console.log(`Input: ${inputMint.slice(0, 8)}...`);
    console.log(`Output: ${outputMint.slice(0, 8)}...`);
    console.log(`Connecting to Jupiter API...`);
    
    const startTime = Date.now();
    const depth = await calculateLiquidityDepth(inputMint, outputMint, isBuyOrder);
    const duration = Date.now() - startTime;
    
    console.log(`=== Calculation complete ===`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Points collected: ${depth.length}`);
    console.log(`===========================\n`);
    
    if (depth.length === 0) {
      console.warn('⚠️ No depth points collected. This could be due to:');
      console.warn('  1. Rate limiting from Jupiter API');
      console.warn('  2. No liquidity available for this pair');
      console.warn('  3. Invalid token addresses');
      console.warn('  4. Network connectivity issues');
    }
    
    res.json({
      inputMint,
      outputMint,
      isBuy: isBuyOrder,
      depth,
      metadata: {
        pointsCount: depth.length,
        calculationTime: `${duration}ms`,
        timestamp: new Date().toISOString(),
        warning: depth.length === 0 ? 'No liquidity data collected. Check server logs for details.' : null
      }
    });
  } catch (error) {
    console.error('Error fetching liquidity depth:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to calculate liquidity depth',
      details: error.code || 'Unknown error'
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Test token fetching endpoint
app.get('/api/test-tokens', async (req, res) => {
  try {
    console.log('Testing token fetching from Jupiter...');
    const endpoints = [
      'https://token.jup.ag/all',
      'https://token.jup.ag/strict',
      'https://api.jup.ag/tokens/v1/all',
    ];
    
    const results = [];
    for (const endpoint of endpoints) {
      try {
        const startTime = Date.now();
        const response = await axiosInstance.get(endpoint, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Solana-Liquidity-Depth/1.0'
          },
          timeout: 10000
        });
        const responseTime = Date.now() - startTime;
        
        let tokens = response.data;
        if (tokens && typeof tokens === 'object' && !Array.isArray(tokens)) {
          if (tokens.tokens) tokens = tokens.tokens;
          else tokens = Object.values(tokens);
        }
        
        results.push({
          endpoint,
          status: 'success',
          responseTime: `${responseTime}ms`,
          tokenCount: Array.isArray(tokens) ? tokens.length : 0,
          sample: Array.isArray(tokens) && tokens.length > 0 ? tokens[0] : null
        });
      } catch (error) {
        results.push({
          endpoint,
          status: 'error',
          error: error.message,
          code: error.code,
          statusCode: error.response?.status
        });
      }
    }
    
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Jupiter API connectivity test endpoint
app.get('/api/jupiter-status', async (req, res) => {
  try {
    const testInputMint = 'So11111111111111111111111111111111111111112'; // SOL
    const testOutputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
    const testAmount = '1000000000'; // 1 SOL
    
    console.log('Testing Jupiter API connectivity...');
    const startTime = Date.now();
    
    try {
      const quote = await getQuote(testInputMint, testOutputMint, testAmount);
      const responseTime = Date.now() - startTime;
      
      res.json({
        status: 'connected',
        jupiterApi: JUPITER_QUOTE_URL,
        apiKey: JUPITER_API_KEY ? 'configured' : 'not configured',
        responseTime: `${responseTime}ms`,
        testQuote: {
          inputMint: testInputMint,
          outputMint: testOutputMint,
          inAmount: quote.inAmount,
          outAmount: quote.outAmount,
        },
        message: 'Successfully connected to Jupiter API'
      });
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const statusCode = error.response?.status;
      const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
      const errorCode = error.code;
      
      // Handle rate limiting specifically
      if (statusCode === 429) {
        const retryAfter = error.response?.headers?.['retry-after'] || '60';
        return res.status(429).json({
          status: 'rate_limited',
          jupiterApi: JUPITER_QUOTE_URL,
          apiKey: JUPITER_API_KEY ? 'configured' : 'not configured',
          responseTime: `${responseTime}ms`,
          error: 'Rate limit exceeded',
          errorCode: 429,
          message: `Jupiter API rate limit reached. Please wait ${retryAfter} seconds before trying again.`,
          retryAfter: parseInt(retryAfter),
          suggestion: 'The API is temporarily rate-limited. Please wait a moment and try again, or reduce the number of requests.'
        });
      }
      
      res.status(statusCode || 500).json({
        status: 'error',
        jupiterApi: JUPITER_QUOTE_URL,
        apiKey: JUPITER_API_KEY ? 'configured' : 'not configured',
        responseTime: `${responseTime}ms`,
        error: errorMsg,
        errorCode: errorCode,
        statusCode: statusCode,
        message: `Failed to connect to Jupiter API: ${errorMsg}`
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message || 'Unknown error',
      message: 'Failed to test Jupiter API connectivity'
    });
  }
});

// Test endpoint to verify quote API is working
app.get('/api/test-quote', async (req, res) => {
  try {
    const { inputMint, outputMint, amount } = req.query;
    
    if (!inputMint || !outputMint || !amount) {
      return res.status(400).json({ 
        error: 'Missing parameters',
        example: '/api/test-quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000'
      });
    }

    const quote = await getQuote(inputMint, outputMint, amount);
    res.json({ 
      success: true, 
      quote,
      inputMint,
      outputMint,
      amount
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message || 'Failed to fetch quote',
      details: error.response?.data || 'No additional details'
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Jupiter API: ${JUPITER_QUOTE_URL} (with API key)`);
  console.log(`🔗 Test endpoint: http://localhost:${PORT}/api/jupiter-status`);
  console.log(`\n`);
});

