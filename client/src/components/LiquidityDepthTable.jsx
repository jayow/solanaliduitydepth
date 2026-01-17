import React, { useMemo } from 'react';
import './LiquidityDepthTable.css';

function LiquidityDepthTable({ buyDepth, sellDepth, inputToken, outputToken, baselinePrice }) {
  // Standard trade sizes to sample (in USD value, matching backend)
  // Matches backend trade sizes: $500, $1K, $10K, $100K, $1M, $2M, $3M, $5M, $7M, $8M, $10M, $15M, $20M, $30M, $50M, $100M
  const standardTradeSizes = [
    500,        // $500
    1000,       // $1K
    10000,      // $10K
    100000,     // $100K
    1000000,    // $1M
    2000000,    // $2M (added to fill gap between $1M-$10M)
    3000000,    // $3M (added to fill gap between $1M-$10M)
    5000000,    // $5M (added to fill gap between $1M-$10M)
    7000000,    // $7M (added to fill gap between $1M-$10M - captures liquidity cliffs)
    8000000,    // $8M (added to fill gap between $1M-$10M)
    10000000,   // $10M
    15000000,   // $15M
    20000000,   // $20M
    30000000,   // $30M
    50000000,   // $50M
    100000000,  // $100M
  ];

  // Process data to sample at specific trade sizes
  const tableData = useMemo(() => {
    // Use sell depth (selling inputToken to get outputToken)
    const depthToUse = sellDepth && sellDepth.length > 0 ? sellDepth : buyDepth;
    
    // Debug: Log standard trade sizes to verify new sizes are loaded
    console.log('📊 LiquidityDepthTable: standardTradeSizes =', standardTradeSizes.map(s => s >= 1e6 ? `$${s/1e6}M` : `$${s/1e3}K`));
    
    if (!depthToUse || depthToUse.length === 0) {
      return [];
    }
    
    console.log('📊 LiquidityDepthTable: Received', depthToUse.length, 'depth points from backend');

    // Get the best price (smallest trade) - reference for price impact
    const bestPrice = depthToUse[0]?.price || 0;
    if (bestPrice === 0) return [];

    const results = [];

    standardTradeSizes.forEach((targetUsdValue) => {
      // Find the depth point that matches this USD trade value
      // The backend now returns tradeUsdValue for each point
      let closestPoint = null;
      let minDiff = Infinity;
      
      // First, try to find an exact match (within 1% tolerance for floating point)
      for (const point of depthToUse) {
        // Use tradeUsdValue if available (from new backend), otherwise calculate it
        const pointUsdValue = point.tradeUsdValue || (point.amount * bestPrice);
        const diff = Math.abs(pointUsdValue - targetUsdValue);
        
        // Check for exact match first (within 1% tolerance)
        if (diff / targetUsdValue < 0.01) {
          closestPoint = point;
          minDiff = diff;
          break; // Found exact match, no need to search further
        }
        
        // Find the closest match
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = point;
        }
      }

      if (!closestPoint) return;

      // Use priceImpact from backend if available, fallback to slippage for backward compatibility
      const priceImpact = closestPoint.priceImpact !== undefined 
        ? closestPoint.priceImpact 
        : (closestPoint.slippage !== undefined 
          ? closestPoint.slippage 
          : (bestPrice > 0 ? Math.abs((bestPrice - closestPoint.price) / bestPrice) * 100 : 0));

      // Get actual USD value from backend or calculate it
      const actualTradeUsdValue = closestPoint.tradeUsdValue || (closestPoint.amount * bestPrice);
      
      // Only include if the actual trade amount is reasonably close to target
      // For exact matches (within 10%), always include
      // For close matches (within 50% of target), include if actual is at least 50% of target
      // This prevents showing misleading data where we wanted $1B but only tested $100k
      const diffPercent = Math.abs(actualTradeUsdValue - targetUsdValue) / targetUsdValue;
      const isExactMatch = diffPercent <= 0.1; // Within 10% of target
      const isCloseEnough = isExactMatch || (actualTradeUsdValue >= targetUsdValue * 0.5 && diffPercent <= 0.5);
      
      if (!isCloseEnough) {
        // Skip this row - the actual data doesn't match the target size closely enough
        return;
      }

      // Calculate USD value of receive amount
      // If outputToken is USDC/USDT (stablecoin), receiveAmount is already in USD
      // Otherwise, convert using execution price
      const isStablecoin = outputToken?.symbol === 'USDC' || outputToken?.symbol === 'USDT';
      const receiveUsdValue = isStablecoin 
        ? closestPoint.outputAmount 
        : closestPoint.outputAmount * closestPoint.price;

      results.push({
        tradeUsdValue: actualTradeUsdValue, // Use actual USD value from backend
        targetUsdValue: targetUsdValue, // Keep target for reference
        tradeAmount: closestPoint.amount,
        receiveAmount: closestPoint.outputAmount,
        receiveUsdValue,
        price: closestPoint.price,
        priceImpact, // Primary: Price Impact
        slippage: closestPoint.slippage || priceImpact, // Keep for backward compatibility
      });
    });

    console.log(`📊 LiquidityDepthTable: Processed ${results.length} rows from ${standardTradeSizes.length} targets`);
    if (results.length < standardTradeSizes.length) {
      const foundSizes = results.map(r => r.tradeUsdValue);
      const missingSizes = standardTradeSizes.filter(s => !foundSizes.some(f => Math.abs(f - s) < 1000));
      console.warn(`⚠️ LiquidityDepthTable: Missing ${standardTradeSizes.length - results.length} sizes:`, missingSizes.map(s => s >= 1e6 ? `$${s/1e6}M` : `$${s/1e3}K`));
    }
    console.log('📊 LiquidityDepthTable: Results include sizes:', results.map(r => r.tradeUsdValue >= 1e6 ? `$${r.tradeUsdValue/1e6}M` : `$${r.tradeUsdValue/1e3}K`).join(', '));
    
    return results;
  }, [buyDepth, sellDepth, inputToken, outputToken]);

  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'N/A';
    if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
    return `$${amount.toFixed(2)}`;
  };

  const formatTokenAmount = (amount) => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'N/A';
    if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
    if (amount < 0.01) return amount.toFixed(4);
    return amount.toFixed(2);
  };

  // Debug: Log what will be rendered
  console.log(`📊 LiquidityDepthTable RENDER: tableData.length = ${tableData.length}`);
  if (tableData.length > 0) {
    console.log('📊 LiquidityDepthTable RENDER: First 3 rows:', tableData.slice(0, 3).map(r => `$${r.tradeUsdValue >= 1e6 ? r.tradeUsdValue/1e6 + 'M' : r.tradeUsdValue/1e3 + 'K'}`));
    console.log('📊 LiquidityDepthTable RENDER: All sizes being rendered:', tableData.map(r => r.tradeUsdValue >= 1e6 ? `$${r.tradeUsdValue/1e6}M` : `$${r.tradeUsdValue/1e3}K`).join(', '));
  }
  
  if (!tableData.length) {
    return (
      <div className="no-data">
        <p>No liquidity data available for this pair</p>
        <p className="sub-text">Loading data from Jupiter API...</p>
      </div>
    );
  }

  // Get current price from best price
  // Use baseline price if available (spot price), otherwise fall back to first depth point
  const bestPrice = baselinePrice || sellDepth?.[0]?.price || buyDepth?.[0]?.price || 0;

  return (
    <div className="liquidity-table-container">
      <div className="table-header">
        <h2>
          {inputToken?.symbol} ↔ {outputToken?.symbol}
        </h2>
        {bestPrice > 0 && (
          <div className="price-info">
            <span>Price: <strong>{bestPrice.toFixed(4)}</strong> {outputToken?.symbol}/{inputToken?.symbol}</span>
          </div>
        )}
      </div>

      <div className="liquidity-table-wrapper">
        <table className="liquidity-table">
          <thead>
            <tr>
              <th>Trade Size (USD)</th>
              <th>Trade Amount</th>
              <th>Token</th>
              <th>Receive Amount</th>
              <th>Token</th>
              <th>Receive (USD)</th>
              <th>Price</th>
              <th>Price Impact</th>
            </tr>
          </thead>
          <tbody>
            {tableData.map((row, index) => (
              <tr key={index}>
                <td className="trade-usd">
                  <span className="usd-value-primary">{formatCurrency(row.tradeUsdValue)}</span>
                </td>
                <td className="trade-amount">
                  <span className="token-amount">{formatTokenAmount(row.tradeAmount)}</span>
                </td>
                <td className="trade-token">
                  <span className="token-symbol">{inputToken?.symbol}</span>
                </td>
                <td className="receive-amount">
                  <span className="token-amount">{formatTokenAmount(row.receiveAmount)}</span>
                </td>
                <td className="receive-token">
                  <span className="token-symbol">{outputToken?.symbol}</span>
                </td>
                <td className="receive-usd">
                  <span className="usd-value">{formatCurrency(row.receiveUsdValue)}</span>
                </td>
                <td className="price-cell">
                  <span className="price-value">{row.price.toFixed(6)}</span>
                </td>
                <td className="price-impact-cell">
                  <span className="slippage-badge" style={{
                    color: row.priceImpact > 5 ? '#ef4444' : row.priceImpact > 1 ? '#f59e0b' : '#10b981',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    display: 'inline-block'
                  }}>
                    {row.priceImpact.toFixed(2)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default LiquidityDepthTable;
