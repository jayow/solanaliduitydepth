# Jupiter Token List Explanation

## Why Some Tokens Are Missing

**The API plan (free vs paid) does NOT affect which tokens are available in Jupiter's token list.** The free tier only affects rate limits, not token availability.

### How Jupiter Lists Tokens

Jupiter automatically lists tokens that meet these criteria:

1. **Deployed on Solana** - Token must exist on the Solana blockchain
2. **Sufficient Liquidity** - At least $500 liquidity on both buy and sell sides
3. **Price Impact** - Less than 30% price impact on $500 transactions
4. **Supported AMMs** - Must have liquidity pools on AMMs that Jupiter supports

### Why JUP, USX, eUSX Are Missing

These tokens are **routable by Jupiter** (you can trade them), but they may not appear in Jupiter's official token list endpoints (`/all`, `/strict`) because:

- They don't meet the liquidity requirements for official listing
- They're new tokens still in the 21-day grace period
- They have liquidity but not on Jupiter's supported AMMs
- They're community tokens with limited liquidity

### The Solution

**Jupiter CAN route tokens that aren't in their token list.** This is why:
- USX works (we can get quotes) but isn't in the token list
- eUSX works (we can get quotes) but isn't in the token list  
- JUP works (we can get quotes) but wasn't in the token list

### Current Implementation

We handle this by:

1. **Fetching from multiple endpoints** - Try `/all`, `/strict`, `/v1/all`, etc.
2. **Manually adding important tokens** - Force-add JUP, USX, eUSX to ensure they're available
3. **Fallback token list** - Include popular tokens that might be missing

### Better Solutions (Future Improvements)

1. **Token Discovery via Quote API** - Try to get quotes for known token addresses to discover routable tokens (expensive/complex)
2. **Community Token Lists** - Integrate with community-maintained token lists
3. **User-Submitted Tokens** - Allow users to add custom token addresses
4. **Jupiter's Strict Endpoint** - Use `/strict` for verified tokens, but supplement with manual additions

### Endpoint Differences

- **`/all`** - Comprehensive list (all tokens Jupiter can route, including unverified)
- **`/strict`** - Verified tokens only (meets liquidity requirements)
- **`/v1/all`** - API v1 format (may have different token set)

### Conclusion

**The missing tokens are NOT due to your API plan.** They're missing because Jupiter's token list endpoints only include tokens that meet their liquidity/verification criteria. However, Jupiter can still route these tokens, so we manually add them to ensure users can find and trade them.

