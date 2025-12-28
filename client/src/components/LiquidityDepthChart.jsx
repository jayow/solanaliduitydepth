import React, { useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import './LiquidityDepthChart.css';

function LiquidityDepthChart({ buyDepth, sellDepth, inputToken, outputToken }) {
  const [maxDisplayCap, setMaxDisplayCap] = useState(15); // Default 15% cap
  // Format currency with K/M/B suffixes
  const formatCurrency = (amount) => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'N/A';
    if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
    return `$${amount.toFixed(2)}`;
  };

  // Format token amount with K/M/B suffixes
  const formatTokenAmount = (amount) => {
    if (amount === undefined || amount === null || isNaN(amount)) return 'N/A';
    if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
    if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
    if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
    if (amount < 0.01) return amount.toFixed(4);
    return amount.toFixed(2);
  };

  // Densify data by adding interpolated points between actual data points
  // This allows hovering at any position on the chart
  const densifyData = (data, pointsPerSegment = 10) => {
    if (!data || data.length < 2) return data;
    
    const densified = [];
    
    for (let i = 0; i < data.length - 1; i++) {
      const point1 = data[i];
      const point2 = data[i + 1];
      
      // Always include the first point
      densified.push(point1);
      
      // Add interpolated points between point1 and point2
      for (let j = 1; j < pointsPerSegment; j++) {
        const ratio = j / pointsPerSegment;
        
        // Log-scale aware interpolation for tradeUsdValue
        const logX1 = Math.log10(point1.tradeUsdValue);
        const logX2 = Math.log10(point2.tradeUsdValue);
        const logX = logX1 + (logX2 - logX1) * ratio;
        const tradeUsdValue = Math.pow(10, logX);
        
        // Linear interpolation for other values
        const interpolated = {
          tradeUsdValue,
          tradeAmount: point1.tradeAmount + (point2.tradeAmount - point1.tradeAmount) * ratio,
          receiveAmount: point1.receiveAmount + (point2.receiveAmount - point1.receiveAmount) * ratio,
          priceImpact: point1.priceImpact + (point2.priceImpact - point1.priceImpact) * ratio,
          slippage: point1.slippage + (point2.slippage - point1.slippage) * ratio, // Keep for compatibility
          price: point1.price + (point2.price - point1.price) * ratio,
        };
        
        densified.push(interpolated);
      }
    }
    
    // Always include the last point
    densified.push(data[data.length - 1]);
    
    return densified;
  };

  const chartData = useMemo(() => {
    // Use sell depth (selling inputToken to get outputToken)
    const depthToUse = sellDepth && sellDepth.length > 0 ? sellDepth : buyDepth;
    
    if (!depthToUse || depthToUse.length === 0) {
      return [];
    }

    // Get the best price (smallest trade) - reference for slippage
    const bestPrice = depthToUse[0]?.price || 0;
    if (bestPrice === 0) return [];

    // Calculate price impact for each point and use tradeUsdValue from backend if available
    const baseData = depthToUse.map(point => {
      // Use priceImpact from backend if available, fallback to slippage for backward compatibility
      const priceImpact = point.priceImpact !== undefined 
        ? point.priceImpact 
        : (point.slippage !== undefined 
          ? point.slippage 
          : (bestPrice > 0 ? Math.abs((bestPrice - point.price) / bestPrice) * 100 : 0));
      
      // Use tradeUsdValue from backend if available, otherwise calculate it
      const tradeUsdValue = point.tradeUsdValue || (point.amount * bestPrice);

      return {
        tradeAmount: point.amount,
        tradeUsdValue,
        priceImpact, // Primary: Price Impact
        slippage: point.slippage || priceImpact, // Keep for backward compatibility
        receiveAmount: point.outputAmount,
        price: point.price,
      };
    }).filter(point => 
      point.tradeUsdValue > 0 && 
      point.priceImpact >= 0 && 
      point.priceImpact <= maxDisplayCap // Only show points within the cap
    );
    
    // Densify the data to allow hovering at any point
    const densified = densifyData(baseData, 15); // 15 interpolated points between each pair
    
    // Filter to ensure all points (including interpolated) are within the cap
    return densified.filter(point => point.priceImpact <= maxDisplayCap);
  }, [buyDepth, sellDepth, maxDisplayCap]);

  // Interpolate values between data points based on X position (tradeUsdValue)
  // Uses log-scale aware interpolation for better accuracy
  const interpolateValue = (xValue, data) => {
    if (!data || data.length === 0) return null;
    
    // Handle edge cases
    if (xValue <= data[0].tradeUsdValue) return data[0];
    if (xValue >= data[data.length - 1].tradeUsdValue) return data[data.length - 1];
    
    // Find the two closest points
    let lowerPoint = null;
    let upperPoint = null;
    let lowerIndex = -1;
    
    for (let i = 0; i < data.length - 1; i++) {
      if (data[i].tradeUsdValue <= xValue && data[i + 1].tradeUsdValue >= xValue) {
        lowerPoint = data[i];
        upperPoint = data[i + 1];
        lowerIndex = i;
        break;
      }
    }
    
    // If exact match found
    if (lowerPoint && lowerPoint.tradeUsdValue === xValue) {
      return lowerPoint;
    }
    if (upperPoint && upperPoint.tradeUsdValue === xValue) {
      return upperPoint;
    }
    
    // If no bounding points found, find closest
    if (!lowerPoint || !upperPoint) {
      let closest = data[0];
      let minDiff = Math.abs(Math.log10(data[0].tradeUsdValue) - Math.log10(xValue));
      for (const point of data) {
        const diff = Math.abs(Math.log10(point.tradeUsdValue) - Math.log10(xValue));
        if (diff < minDiff) {
          minDiff = diff;
          closest = point;
        }
      }
      return closest;
    }
    
    // Log-scale aware interpolation (better for log scale charts)
    const logX1 = Math.log10(lowerPoint.tradeUsdValue);
    const logX2 = Math.log10(upperPoint.tradeUsdValue);
    const logX = Math.log10(xValue);
    const ratio = (logX - logX1) / (logX2 - logX1);
    
    // Interpolate all values
    return {
      tradeUsdValue: xValue,
      tradeAmount: lowerPoint.tradeAmount + (upperPoint.tradeAmount - lowerPoint.tradeAmount) * ratio,
      receiveAmount: lowerPoint.receiveAmount + (upperPoint.receiveAmount - lowerPoint.receiveAmount) * ratio,
      priceImpact: lowerPoint.priceImpact + (upperPoint.priceImpact - lowerPoint.priceImpact) * ratio,
      slippage: lowerPoint.slippage + (upperPoint.slippage - lowerPoint.slippage) * ratio, // Keep for compatibility
      price: lowerPoint.price + (upperPoint.price - lowerPoint.price) * ratio,
    };
  };

  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length > 0) {
      const data = payload[0].payload;
      
      if (!data) return null;
      
      const priceImpact = data.priceImpact !== undefined ? data.priceImpact : data.slippage;
      const priceImpactColor = priceImpact > 5 ? '#ef4444' : priceImpact > 1 ? '#f59e0b' : '#10b981';
      
      return (
        <div className="custom-tooltip">
          <div className="tooltip-header">
            <span className="tooltip-title">Trade Details</span>
            <span className="tooltip-usd-value">{formatCurrency(data.tradeUsdValue)}</span>
          </div>
          <div className="tooltip-content">
            <div className="tooltip-row">
              <span className="tooltip-label">Trade Amount:</span>
              <span className="tooltip-value">
                {formatTokenAmount(data.tradeAmount)} {inputToken?.symbol}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Receive Amount:</span>
              <span className="tooltip-value">
                {formatTokenAmount(data.receiveAmount)} {outputToken?.symbol}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Price:</span>
              <span className="tooltip-value">
                {data.price?.toFixed(6) || 'N/A'} {outputToken?.symbol}/{inputToken?.symbol}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Price Impact:</span>
              <span className="tooltip-value" style={{ color: priceImpactColor, fontWeight: 'bold' }}>
                {priceImpact?.toFixed(2) || '0.00'}%
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Check if we have data but it's all filtered out due to cap
  const depthToUseForCheck = sellDepth && sellDepth.length > 0 ? sellDepth : buyDepth;
  const hasDataButFiltered = depthToUseForCheck && depthToUseForCheck.length > 0 && chartData.length === 0;
  
  if (!chartData.length) {
    return (
      <div className="no-data">
        {hasDataButFiltered ? (
          <>
            <p>No data points within the {maxDisplayCap}% cap</p>
            <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
              Try increasing the display cap to see data points with higher price impact
            </p>
          </>
        ) : (
          <p>No liquidity data available for this pair</p>
        )}
      </div>
    );
  }

  // Calculate max from displayed data (within cap)
  const maxPriceImpactDisplayed = chartData.length > 0 
    ? Math.max(...chartData.map(d => d.priceImpact || d.slippage || 0))
    : 0;
  
  // Calculate actual max from all data (before filtering)
  const depthToUse = sellDepth && sellDepth.length > 0 ? sellDepth : buyDepth;
  const bestPrice = depthToUse?.[0]?.price || 0;
  const actualMaxPriceImpact = depthToUse && bestPrice > 0
    ? Math.max(...depthToUse.map(point => {
        const priceImpact = point.priceImpact !== undefined 
          ? point.priceImpact 
          : (point.slippage !== undefined 
            ? point.slippage 
            : (bestPrice > 0 ? Math.abs((bestPrice - point.price) / bestPrice) * 100 : 0));
        return priceImpact;
      }))
    : maxPriceImpactDisplayed;

  const maxTradeValue = Math.max(...chartData.map(d => d.tradeUsdValue || 0));
  const minTradeValue = Math.min(...chartData.map(d => d.tradeUsdValue || 0));

  // Calculate Y-axis domain using the user-defined cap
  // Cap the display at maxDisplayCap, but still show actual values in tooltips
  const yAxisMax = Math.min(maxPriceImpactDisplayed * 1.1, maxDisplayCap);
  const hasExceededCap = actualMaxPriceImpact > maxDisplayCap;

  return (
    <div className="liquidity-chart-container">
      <div className="chart-header">
        <h2>Price Impact</h2>
        <div className="slippage-range">
          <span>Min <strong>0%</strong></span>
          <span>
            Max <strong>{maxPriceImpactDisplayed.toFixed(1)}%</strong>
            {hasExceededCap && (
              <span style={{ color: '#ef4444', fontSize: '0.85rem', marginLeft: '0.25rem' }}>
                (actual: {actualMaxPriceImpact.toFixed(1)}%)
              </span>
            )}
          </span>
          {hasExceededCap && (
            <span style={{ color: '#ef4444', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
              ⚠️ Data exceeds cap
            </span>
          )}
        </div>
        <div className="cap-control">
          <label htmlFor="impact-cap" style={{ fontSize: '0.85rem', marginRight: '0.5rem' }}>
            Display Cap:
          </label>
          <input
            id="impact-cap"
            type="number"
            min="1"
            max="1000"
            step="1"
            value={maxDisplayCap}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              if (!isNaN(value) && value > 0 && value <= 1000) {
                setMaxDisplayCap(value);
              }
            }}
            style={{
              width: '60px',
              padding: '0.25rem 0.5rem',
              border: '1px solid #ddd',
              borderRadius: '4px',
              fontSize: '0.85rem',
              textAlign: 'center'
            }}
          />
          <span style={{ fontSize: '0.85rem', marginLeft: '0.25rem' }}>%</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 60, bottom: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
          <XAxis
            dataKey="tradeUsdValue"
            type="number"
            scale="log"
            domain={[minTradeValue, maxTradeValue]}
            tickFormatter={(value) => {
              if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(0)}B`;
              if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
              if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
              return `$${value.toFixed(0)}`;
            }}
            label={{ value: 'Trade Size (USD)', position: 'insideBottom', offset: -5 }}
            stroke="#666"
          />
          <YAxis
            domain={[0, yAxisMax]}
            label={{ value: 'Price Impact', angle: -90, position: 'insideLeft' }}
            stroke="#666"
            tickFormatter={(value) => `${value}%`}
          />
          <Tooltip 
            content={<CustomTooltip />}
            cursor={{ stroke: '#10b981', strokeWidth: 2, strokeDasharray: '5 5' }}
            allowEscapeViewBox={{ x: false, y: false }}
            shared={false}
            trigger="hover"
            animationDuration={0}
          />
          <Line
            type="monotone"
            dataKey="priceImpact"
            stroke="#10b981"
            strokeWidth={3}
            dot={false}
            activeDot={{ 
              r: 6, 
              fill: '#10b981',
              stroke: '#fff',
              strokeWidth: 2,
              style: { filter: 'drop-shadow(0 0 4px rgba(16, 185, 129, 0.6))' }
            }}
            isAnimationActive={true}
            animationDuration={300}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default LiquidityDepthChart;
