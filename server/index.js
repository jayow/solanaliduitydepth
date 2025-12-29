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
const JUPITER_ULTRA_API_URL = 'https://ultra-api.jup.ag/order';
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
  // Order: Most comprehensive first, then fallbacks
  // NOTE: Jupiter's token list endpoints only include tokens that meet liquidity requirements
  // (at least $500 liquidity, <30% price impact). Tokens like JUP, USX, eUSX may be routable
  // but not in the official list, so we manually add them via importantTokens.
  // API plan (free vs paid) does NOT affect token list availability - only rate limits.
  // Jupiter's official token list endpoints (prioritize these)
  // These are the current working endpoints as of 2024
  // NOTE: datapi.jup.ag/v1/assets/search is a search API (returns limited results), not a list-all API
  // We prioritize endpoints that return comprehensive token lists
  const tokenEndpoints = [
    'https://token.jup.ag/all',                    // Jupiter's comprehensive token list (ALL tokens - primary source)
    'https://token.jup.ag/strict',                // Jupiter's strict token list (verified tokens only)
    // Data API - used by Jupiter frontend for search, but limited results
    'https://datapi.jup.ag/v1/assets/search?query=', // Jupiter's Data API (search - returns limited results)
    // Legacy/deprecated endpoints (kept as fallbacks but may not work)
    'https://tokens.jup.ag/all',                  // Alternative Jupiter endpoint
    'https://tokens.jup.ag/tokens_with_markets',  // All tradable tokens with markets
    'https://tokens.jup.ag/tokens?tags=verified', // Verified tokens only
    // Fallback to Solana official token list only if Jupiter endpoints fail
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
        // Data API format: direct array (datapi.jup.ag/v1/assets/search returns array directly)
        if (Array.isArray(tokens)) {
          // Already an array - this is the format for datapi.jup.ag/v1/assets/search
          // Note: Data API search returns limited results (20 tokens), not comprehensive list
        }
        // Solana token list format: { tokens: [...] }
        else if (tokens.tokens && Array.isArray(tokens.tokens)) {
          tokens = tokens.tokens;
        }
        // Data API format: { assets: [...] }
        else if (tokens.assets && Array.isArray(tokens.assets)) {
          tokens = tokens.assets;
        }
        // Object with token addresses as keys (e.g., { "mint1": {...}, "mint2": {...} })
        else if (typeof tokens === 'object' && !Array.isArray(tokens)) {
          // Check if it's an object with token objects as values
          const firstValue = Object.values(tokens)[0];
          if (firstValue && (firstValue.address || firstValue.mintAddress || firstValue.mint || firstValue.id)) {
            tokens = Object.values(tokens);
          } else {
            // Might be a wrapper object, try common keys
            tokens = tokens.data || tokens.result || tokens.items || Object.values(tokens);
          }
        }
      }
      
      if (Array.isArray(tokens) && tokens.length > 0) {
        console.log(`✅ Loaded ${tokens.length} tokens from ${endpoint}`);
        
        // Add tokens to map (deduplicate by address)
        let addedCount = 0;
        for (const token of tokens) {
          // Handle different address field names across Jupiter endpoints
          // Data API uses 'id' field, other endpoints use 'address', 'mintAddress', or 'mint'
          const address = token.id || token.address || token.mintAddress || token.mint;
          if (address && typeof address === 'string' && address.length > 0 && address.length <= 44) {
            if (!tokenMap.has(address)) {
              // Normalize token structure - ensure 'address' field exists for consistency
              const normalizedToken = {
                ...token,
                address: address, // Always use 'address' as the primary field
                symbol: token.symbol || '',
                name: token.name || token.symbol || 'Unknown Token',
                decimals: token.decimals !== undefined ? token.decimals : (token.symbol === 'SOL' ? 9 : 6),
                logoURI: token.logoURI || token.logoUri || token.icon || token.image || null,
              };
              tokenMap.set(address, normalizedToken);
              addedCount++;
            }
          }
        }
        console.log(`   Added ${addedCount} new tokens (${tokenMap.size} total unique tokens)`);
        
        // Continue trying all endpoints to get maximum token coverage
        // Different endpoints may have different tokens, so combine them all
        // Don't stop early - Jupiter has multiple endpoints with different token sets
        // The 'all' endpoint might have different tokens than 'strict' or API endpoints
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
  // Create a standardized structure that works with all Jupiter endpoints
  tokens = tokens.map(token => {
    // Handle different address field names (Jupiter uses various formats)
    const address = token.address || token.mintAddress || token.mint || token.id;
    
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
    
    // Standardized token structure
    // Keep all original fields for reference, but ensure standard fields exist
    return {
      address,           // Standardized: always 'address'
      symbol,            // Standardized: always 'symbol'
      name,              // Standardized: always 'name'
      decimals,          // Standardized: always 'decimals'
      logoURI: token.logoURI || token.logoUri || token.image || token.icon || null,
      tags: token.tags || [],  // Jupiter tags (verified, LSTs, etc.)
      verified: token.verified || (token.tags && token.tags.includes('verified')) || false,
      // Keep original fields for backward compatibility
      ...token,
      // Override with standardized values
      address,
      symbol,
      name,
      decimals
    };
  }).filter(token => {
    // Filter out invalid tokens - be less strict to include more tokens
    // Only require address (mint address is essential for routing)
    // Symbol/name are nice-to-have but not required for routing
    // After normalization, address is always in the 'address' field
    const address = token.address;
    return address && 
           typeof address === 'string' &&
           address.length > 0 &&
           address.length <= 44; // Valid Solana address length (base58, max 44 chars)
    // Note: We don't require symbol/name as some tokens might not have them but are still routable
  });
  
  if (tokens.length === 0) {
    console.warn('No valid tokens after normalization, using fallback');
    return getFallbackTokens();
  }
  
  // Ensure important tokens from fallback are always included (even if Jupiter has different versions)
  const importantTokens = getFallbackTokens().filter(t => {
    // Always include these specific tokens by address
    // NOTE: USX is NOT in Jupiter's official token list - we force-add it for user convenience
    // This may result in limited liquidity/routing compared to officially listed tokens
    const importantAddresses = [
      '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG', // USX (NOT in Jupiter official list - force-added)
      '3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC', // eUSX (NOT in Jupiter official list - force-added)
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP (Jupiter token - ensure it's included)
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
// NOTE: Tokens added here (like USX, eUSX) are NOT in Jupiter's official token list.
// Jupiter can route them but may have limited liquidity/routing support.
function getFallbackTokens() {
  console.log('📋 Returning fallback token list (includes USX, eUSX - not in Jupiter official list)');
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
      address: '3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC',
      symbol: 'eUSX',
      name: 'Solstice eUSX',
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

// Get quote from Jupiter Ultra API (matches frontend) with retry logic
async function getQuote(inputMint, outputMint, amount, slippageBps = 50, retries = 3) {
  await waitForRateLimit();
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Use Ultra API to match Jupiter frontend calculation
      const response = await axiosInstance.get(JUPITER_ULTRA_API_URL, {
        params: {
          inputMint,
          outputMint,
          amount: amount.toString(),
          swapMode: 'ExactIn', // ExactIn = selling input token for output token
        },
        headers: {
          'Accept': 'application/json',
          ...(JUPITER_API_KEY && { 'x-api-key': JUPITER_API_KEY }),
        }
      });
      
      if (!response.data || !response.data.outAmount || !response.data.inAmount) {
        throw new Error('Invalid quote response');
      }
      
      // Ultra API returns priceImpact as percentage (e.g., -26.52) and priceImpactPct as decimal (e.g., -0.2652)
      // Convert to match standard API format for compatibility
      const ultraQuote = response.data;
      return {
        ...ultraQuote,
        // Ensure priceImpactPct is in decimal format (Ultra API already provides this)
        priceImpactPct: ultraQuote.priceImpactPct !== undefined ? ultraQuote.priceImpactPct : (ultraQuote.priceImpact !== undefined ? ultraQuote.priceImpact / 100 : undefined),
      };
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
  const errors = []; // Track errors for debugging
  const logs = []; // Track all logs for debugging
  
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
    // Log every iteration to track progress
    const logMsg1 = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    const logMsg2 = `📊 Processing ${formatUSD(usdAmount)} (${usdAmount.toLocaleString()} USD)`;
    const logMsg3 = `   Progress: ${depthPoints.length}/${usdTradeSizes.length} trade sizes completed`;
    console.log(logMsg1);
    console.log(logMsg2);
    console.log(logMsg3);
    logs.push(logMsg1, logMsg2, logMsg3);
    
    // Check if we're running out of time
    const elapsed = Date.now() - calculationStartTime;
    const elapsedSeconds = (elapsed / 1000).toFixed(1);
    const remainingSeconds = ((MAX_CALCULATION_TIME - elapsed) / 1000).toFixed(1);
    const timeLog = `   ⏱️ Time elapsed: ${elapsedSeconds}s, Remaining: ${remainingSeconds}s`;
    console.log(timeLog);
    logs.push(timeLog);
    
    if (elapsed > MAX_CALCULATION_TIME) {
      const timeoutMsg = `⏱️ Calculation timeout (${elapsedSeconds}s). Returning ${depthPoints.length} points collected so far.\n⚠️ MISSING TRADE SIZES: ${usdTradeSizes.slice(usdTradeSizes.indexOf(usdAmount)).map(s => formatUSD(s)).join(', ')}`;
      console.warn(timeoutMsg);
      logs.push(timeoutMsg);
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
      
      // Check for safe integer limits (JavaScript's MAX_SAFE_INTEGER)
      // For tokens with low prices and high decimals, large USD amounts can exceed MAX_SAFE_INTEGER
      // In this case, try progressively smaller amounts to find the maximum routable amount
      if (rawAmount > Number.MAX_SAFE_INTEGER) {
        const errorMsg = `Raw amount exceeds MAX_SAFE_INTEGER: ${rawAmount.toLocaleString()} > ${Number.MAX_SAFE_INTEGER.toLocaleString()}`;
        console.warn(`⚠️ ${errorMsg} for ${formatUSD(usdAmount)}`);
        console.warn(`   💡 This token has low price or high decimals. Trying smaller amounts to find maximum routable size...`);
        logs.push(`⚠️ ${errorMsg}`);
        logs.push(`   💡 Trying smaller amounts to find maximum routable size...`);
        
        // Try progressively smaller amounts to find maximum that doesn't exceed MAX_SAFE_INTEGER
        // Calculate the maximum safe USD amount based on token price and decimals
        // MAX_SAFE_INTEGER / (10^decimals) gives us max token amount
        // Then multiply by baselinePrice to get max USD amount
        let maxSafeUsdAmount = Number.MAX_SAFE_INTEGER / Math.pow(10, quoteInputDecimals);
        if (baselinePrice && baselinePrice > 0) {
          if (isBuy) {
            // Buying: maxSafeUsdAmount is already in USD (USDC)
            maxSafeUsdAmount = Math.min(maxSafeUsdAmount, Number.MAX_SAFE_INTEGER / Math.pow(10, quoteInputDecimals));
          } else {
            // Selling: convert token amount to USD
            maxSafeUsdAmount = maxSafeUsdAmount * baselinePrice;
          }
        }
        
        // Generate smaller amounts to try, starting from maxSafeUsdAmount down
        const smallerAmounts = [];
        let testAmount = Math.min(usdAmount, maxSafeUsdAmount * 0.9); // Start at 90% of max safe
        while (testAmount >= 500 && smallerAmounts.length < 20) {
          smallerAmounts.push(Math.floor(testAmount));
          testAmount = testAmount * 0.8; // Reduce by 20% each time
        }
        
        if (smallerAmounts.length > 0) {
          console.log(`   🔄 Trying ${smallerAmounts.length} smaller amounts: ${smallerAmounts.map(s => formatUSD(s)).join(', ')}`);
          logs.push(`   🔄 Trying ${smallerAmounts.length} smaller amounts...`);
          
          let foundWorkingAmount = false;
          for (const smallerAmount of smallerAmounts) {
            try {
              let smallerTokenAmount;
              if (isBuy) {
                smallerTokenAmount = smallerAmount;
              } else {
                smallerTokenAmount = baselinePrice && baselinePrice > 0 
                  ? smallerAmount / baselinePrice 
                  : smallerAmount / 100;
              }
              
              const smallerRawAmount = Math.floor(smallerTokenAmount * Math.pow(10, quoteInputDecimals));
              
              if (smallerRawAmount <= 0 || smallerRawAmount > Number.MAX_SAFE_INTEGER) {
                continue;
              }
              
              const tryMsg = `   🔄 Trying ${formatUSD(smallerAmount)} (raw: ${smallerRawAmount.toLocaleString()})...`;
              console.log(tryMsg);
              logs.push(tryMsg);
              
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Use appropriate slippage
              let smallerSlippageBps = 50;
              if (smallerAmount >= 50000000) {
                smallerSlippageBps = 10000;
              } else if (smallerAmount >= 10000000) {
                smallerSlippageBps = 5000;
              } else if (smallerAmount >= 1000000) {
                smallerSlippageBps = 500;
              } else if (smallerAmount >= 100000) {
                smallerSlippageBps = 200;
              } else {
                smallerSlippageBps = 100;
              }
              
              const smallerQuote = await getQuote(quoteInputMint, quoteOutputMint, smallerRawAmount, smallerSlippageBps, 3);
              
              if (smallerQuote?.outAmount && smallerQuote?.inAmount) {
                const inputAmountRaw = isBuy ? smallerQuote.outAmount : smallerQuote.inAmount;
                const outputAmountRaw = isBuy ? smallerQuote.inAmount : smallerQuote.outAmount;
                
                const inputAmountReadable = parseFloat(inputAmountRaw) / Math.pow(10, inputDecimals);
                const outputAmountReadable = parseFloat(outputAmountRaw) / Math.pow(10, outputDecimals);
                
                if (isFinite(inputAmountReadable) && inputAmountReadable > 0 && 
                    isFinite(outputAmountReadable) && outputAmountReadable > 0) {
                  const price = outputAmountReadable / inputAmountReadable;
                  
                  if (isFinite(price) && price > 0 && price < 1e10) {
                    if (!baselinePrice) {
                      baselinePrice = price;
                    }
                    
                    const priceImpact = Math.abs(((price - baselinePrice) / baselinePrice) * 100);
                    
                    // Check if we already have this trade size
                    const existingPoint = depthPoints.find(p => Math.abs(p.tradeUsdValue - smallerAmount) < 1000);
                    if (!existingPoint) {
                      depthPoints.push({
                        price,
                        amount: inputAmountReadable,
                        outputAmount: outputAmountReadable,
                        priceImpact,
                        slippage: priceImpact,
                        tradeUsdValue: smallerAmount,
                        rawInputAmount: inputAmountRaw,
                        rawOutputAmount: outputAmountRaw,
                      });
                      
                      const successMsg = `✅ ${formatUSD(smallerAmount)}: ${formatAmount(inputAmountReadable)} -> ${formatAmount(outputAmountReadable)}, price impact: ${priceImpact.toFixed(2)}%`;
                      console.log(successMsg);
                      logs.push(successMsg);
                      foundWorkingAmount = true;
                      break; // Found working amount, stop trying smaller
                    }
                  }
                }
              }
            } catch (smallerError) {
              continue;
            }
          }
          
          if (!foundWorkingAmount) {
            const noRouteMsg = `   ❌ Could not find any routable amount for ${formatUSD(usdAmount)} (exceeds MAX_SAFE_INTEGER)`;
            console.error(noRouteMsg);
            logs.push(noRouteMsg);
          }
        }
        
        errors.push({
          tradeSize: usdAmount,
          tradeSizeFormatted: formatUSD(usdAmount),
          error: errorMsg,
          statusCode: null,
          timestamp: new Date().toISOString()
        });
        continue;
      }
      
      if (rawAmount <= 0) {
        const errorMsg = `Calculated token amount too small: ${formatAmount(tokenAmount)}`;
        console.warn(`⚠️ Skipping ${formatUSD(usdAmount)} - ${errorMsg}`);
        logs.push(`⚠️ Skipping ${formatUSD(usdAmount)} - ${errorMsg}`);
        errors.push({
          tradeSize: usdAmount,
          tradeSizeFormatted: formatUSD(usdAmount),
          error: errorMsg,
          statusCode: null,
          timestamp: new Date().toISOString()
        });
        continue;
      }
      
      const convertMsg = `   💰 Converting: ${formatUSD(usdAmount)} = ${formatAmount(tokenAmount)} tokens (raw: ${rawAmount.toLocaleString()})`;
      console.log(convertMsg);
      logs.push(convertMsg);
      
      // Check timeout before proceeding (but allow a bit of buffer for the actual request)
      const elapsed = Date.now() - calculationStartTime;
      const elapsedSeconds = (elapsed / 1000).toFixed(1);
      // Only stop if we're way over timeout (give 5 seconds buffer for the request itself)
      if (elapsed > MAX_CALCULATION_TIME + 5000) {
        const timeoutMsg = `⏱️ Timeout exceeded (${elapsedSeconds}s), stopping at ${formatUSD(usdAmount)}\n⚠️ MISSING TRADE SIZES: ${usdTradeSizes.slice(usdTradeSizes.indexOf(usdAmount)).map(s => formatUSD(s)).join(', ')}`;
        console.warn(timeoutMsg);
        logs.push(timeoutMsg);
        break;
      }
      // If we're close to timeout but not over, still try (request might be fast)
      if (elapsed > MAX_CALCULATION_TIME) {
        const approachingTimeoutMsg = `⏱️ Approaching timeout (${elapsedSeconds}s), but attempting ${formatUSD(usdAmount)} anyway...`;
        console.warn(approachingTimeoutMsg);
        logs.push(approachingTimeoutMsg);
      }
      
      // Extra delay for large amounts to avoid rate limits (only if we have time)
      if (usdAmount >= 1000000 && (MAX_CALCULATION_TIME - elapsed) > LARGE_AMOUNT_DELAY) {
        await new Promise(resolve => setTimeout(resolve, LARGE_AMOUNT_DELAY));
      }
      
      // Use more retries for large amounts to handle transient errors
      // Increase retries significantly for $50M+ to ensure we get these critical data points
      const retryCount = usdAmount >= 50000000 ? 5 : (usdAmount >= 10000000 ? 4 : 2);
      const quoteLog1 = `   🔄 Requesting quote for ${formatUSD(usdAmount)} with ${retryCount} retries...`;
      const quoteLog2 = `   📡 Input: ${quoteInputMint?.slice(0, 8)}..., Output: ${quoteOutputMint?.slice(0, 8)}..., Amount: ${rawAmount.toLocaleString()}`;
      console.log(quoteLog1);
      console.log(quoteLog2);
      logs.push(quoteLog1, quoteLog2);
      const quoteStartTime = Date.now();
      // Use higher slippage for larger trades to allow high price impact
      // Jupiter's frontend allows up to 100% slippage for finding max liquidity
      // For $50M+ trades, use 10000 bps (100%) to find true liquidity limits
      // For $10M+ trades, use 5000 bps (50%) to allow high price impact
      // For smaller trades, use standard 50 bps (0.5%)
      let slippageBps = 50;
      if (usdAmount >= 50000000) {
        slippageBps = 10000; // 100% slippage for very large trades
      } else if (usdAmount >= 10000000) {
        slippageBps = 5000; // 50% slippage for large trades
      } else if (usdAmount >= 1000000) {
        slippageBps = 500; // 5% slippage for $1M+ trades
      }
      
      const quote = await getQuote(quoteInputMint, quoteOutputMint, rawAmount, slippageBps, retryCount);
      const quoteDuration = ((Date.now() - quoteStartTime) / 1000).toFixed(2);
      const quoteLog3 = `   ⏱️ Quote request completed in ${quoteDuration}s`;
      console.log(quoteLog3);
      logs.push(quoteLog3);

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
        
        // Use Jupiter Ultra API's priceImpactPct directly - it matches frontend calculation
        // Ultra API calculates this using their routing algorithm and matches what users see on Jupiter frontend
        let priceImpact = 0;
        
        if (quote.priceImpactPct !== undefined && quote.priceImpactPct !== null) {
          // Ultra API returns priceImpactPct as a decimal (e.g., -0.2652 = -26.52%)
          // It can be negative for sell orders (negative impact = getting less than expected)
          // Convert to percentage, preserving sign
          priceImpact = parseFloat(quote.priceImpactPct) * 100;
          // Use absolute value for display (we show it as positive percentage)
          const displayImpact = Math.abs(priceImpact);
          console.log(`📊 Using Jupiter Ultra API priceImpactPct: ${displayImpact.toFixed(2)}% (raw: ${priceImpact.toFixed(2)}%)`);
          priceImpact = displayImpact; // Store as positive for consistency
        } else if (baselinePrice && baselinePrice > 0) {
          // Fallback: Calculate price impact ourselves if Jupiter's priceImpactPct not available
          // Calculate expected output based on baseline (spot) price
          let expectedOutput;
          
          if (isBuy) {
            // Buying tokens with USDC
            // Input: USDC amount (inputAmountReadable)
            // Baseline price: tokens per USDC (e.g., 5 tokens per USDC)
            // Expected output: USDC amount * tokens_per_USDC = tokens we should get
            expectedOutput = inputAmountReadable * baselinePrice;
          } else {
            // Selling tokens to get USDC
            // Input: token amount (inputAmountReadable)
            // Baseline price: USDC per token (e.g., 0.2 USDC per token)
            // Expected output: token amount * USDC_per_token = USDC we should get
            expectedOutput = inputAmountReadable * baselinePrice;
          }
          
          // Actual output we're getting from the quote
          const actualOutput = outputAmountReadable;
          
          // Price impact = (expected - actual) / expected * 100
          if (expectedOutput > 0 && actualOutput > 0) {
            priceImpact = Math.abs((expectedOutput - actualOutput) / expectedOutput) * 100;
            console.log(`📊 Calculated price impact (fallback): ${priceImpact.toFixed(2)}% (expected: ${formatAmount(expectedOutput)}, actual: ${formatAmount(actualOutput)})`);
          } else {
            // Fallback to price-based calculation if amounts are invalid
            const executionPrice = outputAmountReadable / inputAmountReadable;
            priceImpact = Math.abs((executionPrice - baselinePrice) / baselinePrice) * 100;
            console.log(`📊 Price impact (fallback): ${priceImpact.toFixed(2)}%`);
          }
        } else {
          console.warn(`⚠️ Cannot calculate price impact: no baseline price and no priceImpactPct`);
          priceImpact = 0;
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
        
        const successMsg = `✅ ${formatUSD(usdAmount)}: ${formatAmount(inputAmountReadable)} -> ${formatAmount(outputAmountReadable)}, price impact: ${priceImpact.toFixed(2)}%`;
        console.log(successMsg);
        logs.push(successMsg);
      } else {
        const invalidMsg = `⚠️ Invalid quote response for ${formatUSD(usdAmount)}: ${quote ? 'Missing outAmount/inAmount' : 'No quote data'}`;
        console.warn(invalidMsg);
        logs.push(invalidMsg);
        errors.push({
          tradeSize: usdAmount,
          tradeSizeFormatted: formatUSD(usdAmount),
          error: quote ? 'Missing outAmount/inAmount in quote response' : 'No quote data returned',
          statusCode: null,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error';
      const errorCode = error.response?.data?.errorCode;
      const statusCode = error.response?.status;
      const fullErrorData = error.response?.data;
      
      // Check if this is a routing/liquidity error that might benefit from trying smaller amounts
      // Jupiter's frontend handles any routing error by trying progressively smaller amounts
      // This matches Jupiter's behavior: when trades fail, try smaller amounts
      // Apply to ALL trade sizes to ensure we test max trade sizes for all tokens
      const isRoutingError = 
        errorCode === 'ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT' ||
        errorMsg?.includes('does not consume all the amount') ||
        errorMsg?.toLowerCase().includes('no route') ||
        errorMsg?.toLowerCase().includes('cannot route') ||
        errorMsg?.toLowerCase().includes('insufficient liquidity') ||
        errorMsg?.toLowerCase().includes('liquidity') ||
        (statusCode === 400); // 400 status code often indicates routing/liquidity issues for any trade size
      
      // Handle routing errors by trying progressively smaller amounts
      // This matches how Jupiter's frontend handles tokens not in the official list
      // Apply to ALL trade sizes to ensure we test maximum routable amounts for all tokens
      if (isRoutingError) {
        const partialFillMsg = `⚠️ Jupiter cannot route ${formatUSD(usdAmount)} - ${errorMsg}`;
        console.warn(partialFillMsg);
        logs.push(partialFillMsg);
        
        // For ALL amounts, try progressively smaller amounts to find maximum routable amount
        // This matches Jupiter's frontend behavior: when routing fails, try smaller amounts
        // Tokens not in Jupiter's official list often fail at large amounts but work at smaller sizes
        // Apply this logic to ALL trade sizes to guarantee we test max trade sizes for all tokens
        const trySmallerMsg = `   💡 Attempting to find maximum routable amount by trying smaller sizes...`;
        console.log(trySmallerMsg);
        logs.push(trySmallerMsg);
        
        // Use binary search approach to find maximum routable amount
        // Start with larger steps, then narrow down to find exact maximum
        // This ensures we find the true liquidity limit, not just any working amount
        // Generate smaller amounts based on the target amount
        let smallerAmounts = [];
        
        if (usdAmount >= 50000000) {
          // For $50M+, try: 45M, 40M, 35M, 30M, 25M, 20M, 15M, 12M, 11M, 10.5M, 10M
          smallerAmounts = [45000000, 40000000, 35000000, 30000000, 25000000, 20000000, 15000000, 12000000, 11000000, 10500000, 10000000];
        } else if (usdAmount >= 10000000) {
          // For $10M+, try granular amounts to find exact maximum
          smallerAmounts = [9500000, 9000000, 8500000, 8000000, 7500000, 7000000, 6500000, 6000000, 5500000, 5000000, 4500000, 4000000, 3500000, 3000000, 2500000, 2000000];
        } else if (usdAmount >= 1000000) {
          // For $1M+, try: 950K, 900K, 850K, 800K, 750K, 700K, 650K, 600K, 550K, 500K, 450K, 400K, 350K, 300K, 250K, 200K
          smallerAmounts = [950000, 900000, 850000, 800000, 750000, 700000, 650000, 600000, 550000, 500000, 450000, 400000, 350000, 300000, 250000, 200000];
        } else if (usdAmount >= 100000) {
          // For $100K+, try: 95K, 90K, 85K, 80K, 75K, 70K, 65K, 60K, 55K, 50K, 45K, 40K, 35K, 30K, 25K, 20K
          smallerAmounts = [95000, 90000, 85000, 80000, 75000, 70000, 65000, 60000, 55000, 50000, 45000, 40000, 35000, 30000, 25000, 20000];
        } else if (usdAmount >= 10000) {
          // For $10K+, try: 9.5K, 9K, 8.5K, 8K, 7.5K, 7K, 6.5K, 6K, 5.5K, 5K, 4.5K, 4K, 3.5K, 3K, 2.5K, 2K
          smallerAmounts = [9500, 9000, 8500, 8000, 7500, 7000, 6500, 6000, 5500, 5000, 4500, 4000, 3500, 3000, 2500, 2000];
        } else if (usdAmount >= 1000) {
          // For $1K+, try: 950, 900, 850, 800, 750, 700, 650, 600, 550, 500
          smallerAmounts = [950, 900, 850, 800, 750, 700, 650, 600, 550, 500];
        } else if (usdAmount >= 500) {
          // For $500+, try: 450, 400, 350, 300, 250, 200, 150, 100
          smallerAmounts = [450, 400, 350, 300, 250, 200, 150, 100];
        }
          
          // Track the maximum working amount found so we can search upward from it
          let maxWorkingAmount = 0;
          let foundWorkingAmount = false;
          
          for (const smallerAmount of smallerAmounts) {
            // Don't break early - continue searching to find the maximum working amount
            // We want to test all amounts to find the true liquidity limit
            
            try {
              // Calculate token amount for the smaller USD amount
              let smallerTokenAmount;
              if (isBuy) {
                smallerTokenAmount = smallerAmount;
              } else {
                smallerTokenAmount = baselinePrice && baselinePrice > 0 
                  ? smallerAmount / baselinePrice 
                  : smallerAmount / 100;
              }
              
              const smallerRawAmount = Math.floor(smallerTokenAmount * Math.pow(10, quoteInputDecimals));
              
              if (smallerRawAmount <= 0) continue;
              
              const tryMsg = `   🔄 Trying ${formatUSD(smallerAmount)} instead...`;
              console.log(tryMsg);
              logs.push(tryMsg);
              
              // Small delay before retry
              await new Promise(resolve => setTimeout(resolve, 200));
              
              // Use high slippage for finding max liquidity (same as main trade)
              // This allows us to find trades with very high price impact
              const smallerSlippageBps = usdAmount >= 50000000 ? 10000 : (usdAmount >= 10000000 ? 5000 : 500);
              const smallerQuote = await getQuote(quoteInputMint, quoteOutputMint, smallerRawAmount, smallerSlippageBps, 3);
              
              if (smallerQuote?.outAmount && smallerQuote?.inAmount) {
                const successMsg = `   ✅ Found working amount: ${formatUSD(smallerAmount)}`;
                console.log(successMsg);
                logs.push(successMsg);
                
                // Process this smaller amount
                const inputAmountRaw = isBuy ? smallerQuote.outAmount : smallerQuote.inAmount;
                const outputAmountRaw = isBuy ? smallerQuote.inAmount : smallerQuote.outAmount;
                
                const inputAmountReadable = parseFloat(inputAmountRaw) / Math.pow(10, inputDecimals);
                const outputAmountReadable = parseFloat(outputAmountRaw) / Math.pow(10, outputDecimals);
                
                if (isFinite(inputAmountReadable) && inputAmountReadable > 0 && 
                    isFinite(outputAmountReadable) && outputAmountReadable > 0) {
                  const price = outputAmountReadable / inputAmountReadable;
                  
                  if (isFinite(price) && price > 0 && price < 1e10) {
                    const priceImpact = Math.abs(((price - baselinePrice) / baselinePrice) * 100);
                    
                    // Check if we already have this trade size to avoid duplicates
                    const existingPoint = depthPoints.find(p => Math.abs(p.tradeUsdValue - smallerAmount) < 1000);
                    if (!existingPoint) {
                      depthPoints.push({
                        price,
                        amount: inputAmountReadable,
                        outputAmount: outputAmountReadable,
                        priceImpact,
                        slippage: priceImpact,
                        tradeUsdValue: smallerAmount, // Use the smaller amount that actually worked
                        rawInputAmount: inputAmountRaw,
                        rawOutputAmount: outputAmountRaw,
                      });
                    } else {
                      const duplicateMsg = `   ⚠️ Skipping duplicate: ${formatUSD(smallerAmount)} already exists`;
                      console.log(duplicateMsg);
                      logs.push(duplicateMsg);
                    }
                    
                    const partialSuccessMsg = `✅ ${formatUSD(smallerAmount)} (partial fill of ${formatUSD(usdAmount)}): ${formatAmount(inputAmountReadable)} -> ${formatAmount(outputAmountReadable)}, price impact: ${priceImpact.toFixed(2)}%`;
                    console.log(partialSuccessMsg);
                    logs.push(partialSuccessMsg);
                    
                    // Track maximum working amount found
                    if (smallerAmount > maxWorkingAmount) {
                      maxWorkingAmount = smallerAmount;
                    }
                    foundWorkingAmount = true;
                    
                    // Don't break - continue trying larger amounts to find true maximum
                    // We want to find the highest amount that works, not just any working amount
                  }
                }
              }
            } catch (smallerError) {
              // Continue to next smaller amount
              continue;
            }
          }
          
          if (!foundWorkingAmount) {
            const noRouteMsg = `   ❌ Could not find any routable amount for ${formatUSD(usdAmount)}`;
            console.error(noRouteMsg);
            logs.push(noRouteMsg);
          } else if (maxWorkingAmount > 0) {
            // If we found a working amount, try to find the maximum by searching upward
            // Binary search between maxWorkingAmount and usdAmount to find exact maximum
            const maxFoundMsg = `   📊 Maximum routable amount found: ${formatUSD(maxWorkingAmount)}`;
            console.log(maxFoundMsg);
            logs.push(maxFoundMsg);
            
            // Try amounts between maxWorkingAmount and usdAmount to find exact maximum
            if (usdAmount > maxWorkingAmount) {
              const searchUpMsg = `   🔍 Searching upward from ${formatUSD(maxWorkingAmount)} to find exact maximum...`;
              console.log(searchUpMsg);
              logs.push(searchUpMsg);
              
              // Binary search to find exact maximum between maxWorkingAmount and usdAmount
              // This ensures we find the true liquidity limit for ALL tokens and trade sizes
              let low = maxWorkingAmount;
              let high = usdAmount;
              let bestAmount = maxWorkingAmount;
              
              // Determine step size dynamically based on trade size for efficient binary search
              // This ensures we can find max liquidity for all trade sizes, not just large ones
              let minStep;
              if (usdAmount >= 10000000) {
                minStep = 100000; // $100K steps for $10M+ trades
              } else if (usdAmount >= 1000000) {
                minStep = 10000; // $10K steps for $1M+ trades
              } else if (usdAmount >= 100000) {
                minStep = 1000; // $1K steps for $100K+ trades
              } else if (usdAmount >= 10000) {
                minStep = 100; // $100 steps for $10K+ trades
              } else if (usdAmount >= 1000) {
                minStep = 50; // $50 steps for $1K+ trades
              } else {
                minStep = 10; // $10 steps for smaller trades
              }
              
              // Try amounts in smaller increments, using binary search approach
              while (high - low > minStep) {
                const mid = Math.floor((low + high) / 2);
                
                // Skip if we've already tested this amount
                const alreadyTested = depthPoints.some(p => Math.abs(p.tradeUsdValue - mid) < 1000);
                if (alreadyTested) {
                  // If already tested and it worked, move low up
                  low = mid;
                  continue;
                }
                
                try {
                  let testTokenAmount;
                  if (isBuy) {
                    testTokenAmount = mid;
                  } else {
                    testTokenAmount = baselinePrice && baselinePrice > 0 
                      ? mid / baselinePrice 
                      : mid / 100;
                  }
                  
                  const testRawAmount = Math.floor(testTokenAmount * Math.pow(10, quoteInputDecimals));
                  if (testRawAmount <= 0) {
                    high = mid;
                    continue;
                  }
                  
                  const tryUpwardMsg = `   🔄 Binary search: Trying ${formatUSD(mid)} (range: ${formatUSD(low)} - ${formatUSD(high)})...`;
                  console.log(tryUpwardMsg);
                  logs.push(tryUpwardMsg);
                  
                  await new Promise(resolve => setTimeout(resolve, 200));
                  
                  // Use appropriate slippage based on trade size for binary search
                  // This ensures we can find max liquidity for all trade sizes
                  let testSlippageBps = 50;
                  if (usdAmount >= 50000000) {
                    testSlippageBps = 10000; // 100% slippage for very large trades
                  } else if (usdAmount >= 10000000) {
                    testSlippageBps = 5000; // 50% slippage for large trades
                  } else if (usdAmount >= 1000000) {
                    testSlippageBps = 500; // 5% slippage for $1M+ trades
                  } else if (usdAmount >= 100000) {
                    testSlippageBps = 200; // 2% slippage for $100K+ trades
                  } else {
                    testSlippageBps = 100; // 1% slippage for smaller trades
                  }
                  const testQuote = await getQuote(quoteInputMint, quoteOutputMint, testRawAmount, testSlippageBps, 2);
                  
                  if (testQuote?.outAmount && testQuote?.inAmount) {
                    const testInputRaw = isBuy ? testQuote.outAmount : testQuote.inAmount;
                    const testOutputRaw = isBuy ? testQuote.inAmount : testQuote.outAmount;
                    
                    const testInputReadable = parseFloat(testInputRaw) / Math.pow(10, inputDecimals);
                    const testOutputReadable = parseFloat(testOutputRaw) / Math.pow(10, outputDecimals);
                    
                    if (isFinite(testInputReadable) && testInputReadable > 0 && 
                        isFinite(testOutputReadable) && testOutputReadable > 0) {
                      const testPrice = testOutputReadable / testInputReadable;
                      
                      if (isFinite(testPrice) && testPrice > 0 && testPrice < 1e10) {
                        const testPriceImpact = Math.abs(((testPrice - baselinePrice) / baselinePrice) * 100);
                        
                        depthPoints.push({
                          price: testPrice,
                          amount: testInputReadable,
                          outputAmount: testOutputReadable,
                          priceImpact: testPriceImpact,
                          slippage: testPriceImpact,
                          tradeUsdValue: mid,
                          rawInputAmount: testInputRaw,
                          rawOutputAmount: testOutputRaw,
                        });
                        
                        const upwardSuccessMsg = `   ✅ Found working amount: ${formatUSD(mid)}, price impact: ${testPriceImpact.toFixed(2)}%`;
                        console.log(upwardSuccessMsg);
                        logs.push(upwardSuccessMsg);
                        
                        bestAmount = mid;
                        low = mid; // This amount works, try higher
                      } else {
                        high = mid; // Invalid price, try lower
                      }
                    } else {
                      high = mid; // Invalid amounts, try lower
                    }
                  } else {
                    high = mid; // Quote failed, try lower
                  }
                } catch (testError) {
                  // This amount doesn't work, try lower
                  high = mid;
                  const testFailMsg = `   ❌ ${formatUSD(mid)} failed, trying lower amounts...`;
                  console.log(testFailMsg);
                  logs.push(testFailMsg);
                }
              }
              
              if (bestAmount > maxWorkingAmount) {
                const finalMaxMsg = `   🎯 Final maximum liquidity: ${formatUSD(bestAmount)}`;
                console.log(finalMaxMsg);
                logs.push(finalMaxMsg);
              } else {
                const maxReachedMsg = `   🎯 Maximum liquidity reached at ${formatUSD(maxWorkingAmount)}`;
                console.log(maxReachedMsg);
                logs.push(maxReachedMsg);
              }
            }
          }
        }
        
        // Store error but don't treat it as fatal
        errors.push({
          tradeSize: usdAmount,
          tradeSizeFormatted: formatUSD(usdAmount),
          error: errorMsg,
          errorCode: errorCode,
          statusCode: statusCode,
          timestamp: new Date().toISOString()
        });
        
        // Continue to next amount
        const skipMsg = `⏭️ Skipping ${formatUSD(usdAmount)} due to routing limitation, continuing to next trade size...`;
        console.log(skipMsg);
        logs.push(skipMsg);
        continue; // Skip to next iteration
      }
      
      // Log detailed error info for other errors
      if (statusCode === 429) {
        const rateLimitMsg = `⚠️ Rate limited for ${formatUSD(usdAmount)} - exhausted all retries`;
        console.error(rateLimitMsg);
        logs.push(rateLimitMsg);
      } else if (statusCode >= 400) {
        const apiErrorMsg = `❌ API error ${statusCode} for ${formatUSD(usdAmount)}: ${errorMsg}`;
        console.error(apiErrorMsg);
        logs.push(apiErrorMsg);
        
        // For large amounts, log more details
        if (usdAmount >= 10000000) {
          const errorDetails = {
            statusCode,
            error: errorMsg,
            errorCode: errorCode,
            fullError: fullErrorData ? JSON.stringify(fullErrorData) : 'N/A',
            inputMint: quoteInputMint ? quoteInputMint.slice(0, 8) : inputMint?.slice(0, 8),
            outputMint: quoteOutputMint ? quoteOutputMint.slice(0, 8) : outputMint?.slice(0, 8),
            rawAmount: rawAmount ? rawAmount.toLocaleString() : 'N/A',
            tokenAmount: rawAmount ? (rawAmount / Math.pow(10, quoteInputDecimals)).toFixed(2) : 'N/A'
          };
          const criticalMsg = `   ⚠️ CRITICAL: Large trade size failed. Error details: ${JSON.stringify(errorDetails, null, 2)}`;
          console.error(criticalMsg);
          logs.push(criticalMsg);
          
          // Check if it's a liquidity/routing issue
          if (errorMsg?.toLowerCase().includes('route') || 
              errorMsg?.toLowerCase().includes('liquidity') ||
              errorMsg?.toLowerCase().includes('insufficient') ||
              statusCode === 400) {
            const liquidityMsg = `   💡 Likely cause: Insufficient liquidity on Jupiter for ${formatUSD(usdAmount)} trade size`;
            console.warn(liquidityMsg);
            logs.push(liquidityMsg);
          }
        }
      } else {
        const failMsg = `❌ Failed to get quote for ${formatUSD(usdAmount)}: ${errorMsg}`;
        console.error(failMsg);
        logs.push(failMsg);
      }
      // Continue to next amount - don't fail the entire request
      // Note: We skip this amount but will try the next one
      // Log which amount we're skipping for debugging
      const skipMsg = `⏭️ Skipping ${formatUSD(usdAmount)} due to error, continuing to next trade size...`;
      console.log(skipMsg);
      logs.push(skipMsg);
      
      // For very large amounts ($50M+), this is concerning - log prominently
      if (usdAmount >= 50000000) {
        const criticalMsg = `🚨 WARNING: Failed to get quote for ${formatUSD(usdAmount)} - this is a critical data point!`;
        console.error(criticalMsg);
        logs.push(criticalMsg);
      }
      
      // Store error for debugging
      errors.push({
        tradeSize: usdAmount,
        tradeSizeFormatted: formatUSD(usdAmount),
        error: errorMsg,
        statusCode: statusCode,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // Log final status with detailed breakdown
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 CALCULATION COMPLETE`);
  console.log(`   Total trade sizes tested: ${usdTradeSizes.length}`);
  console.log(`   Successful data points: ${depthPoints.length}`);
  console.log(`   Errors encountered: ${errors.length}`);
  console.log(`   Expected: ${usdTradeSizes.map(s => formatUSD(s)).join(', ')}`);
  
  const collectedSizes = depthPoints.map(p => p.tradeUsdValue).sort((a, b) => a - b);
  console.log(`   Collected: ${collectedSizes.map(s => formatUSD(s)).join(', ')}`);
  
  if (depthPoints.length < usdTradeSizes.length) {
    const missingSizes = usdTradeSizes.filter(size => 
      !depthPoints.some(point => point.tradeUsdValue === size)
    );
    if (missingSizes.length > 0) {
      console.warn(`\n⚠️ MISSING TRADE SIZES (${missingSizes.length}):`);
      missingSizes.forEach(size => {
        console.warn(`   ❌ ${formatUSD(size)} - NOT COLLECTED`);
        // Show error details if available
        const error = errors.find(e => e.tradeSize === size);
        if (error) {
          console.warn(`      Error: ${error.error} (Status: ${error.statusCode || 'N/A'})`);
        } else {
          console.warn(`      No error logged - may have been skipped silently`);
        }
      });
    }
  } else {
    console.log(`   ✅ All trade sizes collected successfully!`);
  }
  
  if (errors.length > 0) {
    console.log(`\n📋 ERROR SUMMARY:`);
    errors.forEach(err => {
      console.log(`   ${err.tradeSizeFormatted}: ${err.error} (${err.statusCode || 'N/A'})`);
    });
  }
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
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
  
  // Return both depth points and debug info
  return {
    depthPoints,
    logs,
    errors
  };
}

// Routes
// Search tokens using Jupiter's Data API (search-as-you-type)
app.get('/api/tokens/search', async (req, res) => {
  try {
    const query = req.query.q || req.query.query || '';
    
    if (!query || query.trim().length === 0) {
      // Return empty array for empty query
      return res.json([]);
    }

    console.log(`🔍 Searching tokens for query: "${query}"`);
    
    // Use Jupiter's Data API for search (same API their frontend uses)
    const searchUrl = `https://datapi.jup.ag/v1/assets/search?query=${encodeURIComponent(query)}`;
    
    try {
      const response = await axiosInstance.get(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Solana-Liquidity-Depth/1.0'
        },
        timeout: 10000
      });

      let tokens = response.data;
      
      // Data API returns array directly
      if (!Array.isArray(tokens)) {
        tokens = [];
      }

      // Normalize token structure
      const normalizedTokens = tokens.map(token => {
        const address = token.id || token.address || token.mintAddress || token.mint;
        return {
          address: address,
          symbol: token.symbol || '',
          name: token.name || token.symbol || 'Unknown Token',
          decimals: token.decimals !== undefined ? token.decimals : (token.symbol === 'SOL' ? 9 : 6),
          logoURI: token.logoURI || token.logoUri || token.icon || token.image || null,
          // Enrichment fields from Jupiter Data API
          icon: token.icon || token.logoURI || token.logoUri || token.image || null,
          organicScore: token.organicScore || null,
          organicScoreLabel: token.organicScoreLabel || null,
          isVerified: token.isVerified || false,
          tags: token.tags || [],
          ...token, // Keep original fields
          address, symbol: token.symbol || '', name: token.name || token.symbol || 'Unknown Token' // Override with normalized values
        };
      }).filter(token => {
        // Filter out invalid tokens
        return token.address && 
               typeof token.address === 'string' && 
               token.address.length > 0 && 
               token.address.length <= 44;
      });

      console.log(`✅ Found ${normalizedTokens.length} tokens for query "${query}"`);
      res.json(normalizedTokens);
    } catch (error) {
      console.error(`❌ Token search failed for query "${query}":`, error.message);
      // Return empty array on error (don't fail the request)
      res.json([]);
    }
  } catch (error) {
    console.error('Token search error:', error);
    res.status(500).json({ error: 'Token search failed', message: error.message });
  }
});

// Legacy endpoint - keep for backward compatibility but return empty array
// Frontend should use /api/tokens/search instead
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
    const result = await calculateLiquidityDepth(inputMint, outputMint, isBuyOrder);
    // Handle both old format (array) and new format (object with depthPoints, logs, errors)
    const depth = Array.isArray(result) ? result : (result.depthPoints || []);
    const debugLogs = result.logs || [];
    const debugErrors = result.errors || [];
    const duration = Date.now() - startTime;
    
    console.log(`=== Calculation complete ===`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Points collected: ${depth.length}`);
    console.log(`Logs captured: ${debugLogs.length}`);
    console.log(`Errors captured: ${debugErrors.length}`);
    console.log(`===========================\n`);
    
    if (depth.length === 0) {
      console.warn('⚠️ No depth points collected. This could be due to:');
      console.warn('  1. Rate limiting from Jupiter API');
      console.warn('  2. No liquidity available for this pair');
      console.warn('  3. Invalid token addresses');
      console.warn('  4. Network connectivity issues');
    }
    
    // Get baseline price from the first successful depth point (smallest trade)
    // This represents the spot price before any price impact
    const baselinePrice = depth.length > 0 ? depth[0].price : null;
    
    res.json({
      inputMint,
      outputMint,
      isBuy: isBuyOrder,
      depth,
      baselinePrice, // Add baseline price for frontend to always show spot price
      metadata: {
        pointsCount: depth.length,
        calculationTime: `${duration}ms`,
        timestamp: new Date().toISOString(),
        warning: depth.length === 0 ? 'No liquidity data collected. Check server logs for details.' : null
      },
      debug: {
        logs: debugLogs,
        errors: debugErrors
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

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀 Server running on http://127.0.0.1:${PORT}`);
  console.log(`📡 Jupiter API: ${JUPITER_QUOTE_URL} (with API key)`);
  console.log(`🔗 Test endpoint: http://127.0.0.1:${PORT}/api/jupiter-status`);
  console.log(`\n`);
});

