import React, { useMemo } from 'react';
import './LiquidityDepthTable.css';

function LiquidityDepthTable({ buyDepth, sellDepth, inputToken, outputToken }) {
  // Standard trade sizes to sample (in USD value, matching DeFiLlama)
  // Extended range for stress testing slippage
  const standardTradeSizes = [
    500,        // $500
    1000,       // $1K
    10000,      // $10K
    100000,     // $100K
    1000000,    // $1M
    10000000,   // $10M
    100000000,  // $100M
    500000000,  // $500M
    1000000000, // $1B (for extreme stress testing)
  ];

  // Process data to sample at specific trade sizes
  const tableData = useMemo(() => {
    // Use sell depth (selling inputToken to get outputToken)
    const depthToUse = sellDepth && sellDepth.length > 0 ? sellDepth : buyDepth;
    
    if (!depthToUse || depthToUse.length === 0) {
      return [];
    }

    // Get the best price (smallest trade) - reference for slippage
    const bestPrice = depthToUse[0]?.price || 0;
    if (bestPrice === 0) return [];

    const results = [];

    standardTradeSizes.forEach((targetUsdValue) => {
      // Find the depth point that matches this USD trade value
      // The backend now returns tradeUsdValue for each point
      let closestPoint = null;
      let minDiff = Infinity;
      
      for (const point of depthToUse) {
        // Use tradeUsdValue if available (from new backend), otherwise calculate it
        const pointUsdValue = point.tradeUsdValue || (point.amount * bestPrice);
        const diff = Math.abs(pointUsdValue - targetUsdValue);
        
        // Find the closest match
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = point;
        }
      }

      if (!closestPoint) return;

      // Use slippage from backend if available, otherwise calculate it
      const slippage = closestPoint.slippage !== undefined 
        ? closestPoint.slippage 
        : (bestPrice > 0 ? Math.abs((bestPrice - closestPoint.price) / bestPrice) * 100 : 0);

      // Get actual USD value from backend or calculate it
      const actualTradeUsdValue = closestPoint.tradeUsdValue || (closestPoint.amount * bestPrice);
      
      // Only include if the actual trade amount is reasonably close to target (within 50% or at least as large)
      // This prevents showing misleading data where we wanted $1B but only tested $100k
      const isCloseEnough = actualTradeUsdValue >= targetUsdValue * 0.5 || actualTradeUsdValue >= targetUsdValue;
      
      if (!isCloseEnough) {
        // Skip this row - the actual data doesn't match the target size
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
        slippage,
      });
    });

    return results;
  }, [buyDepth, sellDepth]);

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

  if (!tableData.length) {
    return (
      <div className="no-data">
        <p>No liquidity data available for this pair</p>
        <p className="sub-text">Loading data from Jupiter API...</p>
      </div>
    );
  }

  // Get current price from best price
  const bestPrice = sellDepth?.[0]?.price || buyDepth?.[0]?.price || 0;

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
              <th>Trade</th>
              <th>Receive</th>
            </tr>
          </thead>
          <tbody>
            {tableData.map((row, index) => (
              <tr key={index}>
                <td className="trade-amount">
                  <span className="usd-value-primary">{formatCurrency(row.tradeUsdValue)}</span>
                  <span className="token-amount-secondary">({formatTokenAmount(row.tradeAmount)} {inputToken?.symbol})</span>
                </td>
                <td className="receive-amount">
                  <span className="token-amount">{formatTokenAmount(row.receiveAmount)} {outputToken?.symbol}</span>
                  <span className="via-label"> via Jupiter</span>
                  <span className="slippage-badge" style={{
                    color: row.slippage > 5 ? '#ef4444' : row.slippage > 1 ? '#f59e0b' : '#10b981',
                    marginLeft: '0.5rem',
                    fontSize: '0.85rem',
                    fontWeight: 600
                  }}>
                    {row.slippage.toFixed(2)}% slippage
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
