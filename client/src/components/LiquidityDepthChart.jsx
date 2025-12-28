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
  const [capInputValue, setCapInputValue] = useState('15'); // Local state for input field
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
        const interpolatedPriceImpact = point1.priceImpact + (point2.priceImpact - point1.priceImpact) * ratio;
        const interpolated = {
          tradeUsdValue,
          tradeAmount: point1.tradeAmount + (point2.tradeAmount - point1.tradeAmount) * ratio,
          receiveAmount: point1.receiveAmount + (point2.receiveAmount - point1.receiveAmount) * ratio,
          priceImpact: Math.round(interpolatedPriceImpact), // Round to whole number for cleaner display
          slippage: Math.round(point1.slippage + (point2.slippage - point1.slippage) * ratio), // Keep for compatibility, also rounded
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

    // Get the best price (smallest trade) - reference for price impact
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
    }).filter(point => point.tradeUsdValue > 0 && point.priceImpact >= 0);
    
    // Densify the data to allow hovering at any point
    // Increased to 100 points for much smoother curves
    return densifyData(baseData, 100);
  }, [buyDepth, sellDepth, inputToken, outputToken]);

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
    const interpolatedPriceImpact = lowerPoint.priceImpact + (upperPoint.priceImpact - lowerPoint.priceImpact) * ratio;
    return {
      tradeUsdValue: xValue,
      tradeAmount: lowerPoint.tradeAmount + (upperPoint.tradeAmount - lowerPoint.tradeAmount) * ratio,
      receiveAmount: lowerPoint.receiveAmount + (upperPoint.receiveAmount - lowerPoint.receiveAmount) * ratio,
      priceImpact: Math.round(interpolatedPriceImpact), // Round to whole number for cleaner display
      slippage: Math.round(lowerPoint.slippage + (upperPoint.slippage - lowerPoint.slippage) * ratio), // Keep for compatibility, also rounded
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

  if (!chartData.length) {
    return (
      <div className="no-data">
        <p>No liquidity data available for this pair</p>
      </div>
    );
  }

  // Find the maximum trade size that fits within the cap
  const pointsWithinCap = chartData.filter(d => (d.priceImpact || d.slippage || 0) <= maxDisplayCap);
  const maxTradeValueWithinCap = pointsWithinCap.length > 0
    ? Math.max(...pointsWithinCap.map(d => d.tradeUsdValue || 0))
    : 0;

  const maxPriceImpact = Math.max(...chartData.map(d => d.priceImpact || d.slippage || 0));
  const maxTradeValue = Math.max(...chartData.map(d => d.tradeUsdValue || 0));
  const minTradeValue = Math.min(...chartData.map(d => d.tradeUsdValue || 0));

  // Check if data exceeds the cap
  const hasDataAboveCap = maxPriceImpact > maxDisplayCap;

  return (
    <div className="liquidity-chart-container">
      <div className="chart-header">
        <div className="header-left-cluster">
          {maxTradeValueWithinCap > 0 ? (
            <span className="chart-meta">
              Max trade within cap: <strong>{formatCurrency(maxTradeValueWithinCap)}</strong>
            </span>
          ) : (
            <span className="chart-meta" style={{ color: '#ef4444' }}>
              No trades fit within {maxDisplayCap}% cap
            </span>
          )}
          {hasDataAboveCap && (
            <span className="chart-meta" style={{ color: '#ef4444' }}>
              ⚠️ Some data exceeds cap (max: {maxPriceImpact.toFixed(1)}%)
            </span>
          )}
        </div>
        <div className="header-right-cluster">
          <div className="cap-control">
            <label htmlFor="impact-cap">Display Cap:</label>
            <input
              id="impact-cap"
              type="number"
              min="1"
              max="1000"
              step="1"
              value={capInputValue}
              onChange={(e) => {
                const inputValue = e.target.value;
                setCapInputValue(inputValue);
                const value = parseInt(inputValue, 10);
                if (!isNaN(value) && value > 0 && value <= 1000) {
                  setMaxDisplayCap(value);
                }
              }}
              onBlur={(e) => {
                const value = parseInt(e.target.value, 10);
                if (isNaN(value) || value <= 0) {
                  setCapInputValue(maxDisplayCap.toString());
                } else if (value > 1000) {
                  setCapInputValue('1000');
                  setMaxDisplayCap(1000);
                } else {
                  setCapInputValue(value.toString());
                  setMaxDisplayCap(value);
                }
              }}
              onFocus={(e) => e.target.select()}
            />
            <span>%</span>
          </div>
        </div>
      </div>

      <div className="chart-area">
        <ResponsiveContainer width="100%" height={400}>
          <LineChart
            data={chartData}
            margin={{ top: 6, right: 12, bottom: 30, left: 44 }}
          >
            <CartesianGrid 
              strokeDasharray="3 6" 
              stroke="rgba(255,255,255,0.06)" 
              vertical={false}
            />
            <XAxis
              dataKey="tradeUsdValue"
              type="number"
              scale="log"
              domain={[minTradeValue, maxTradeValue]}
              tickFormatter={(value) => {
                if (value >= 100_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
                if (value >= 10_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
                if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
                if (value >= 10_000) return `$${(value / 1_000).toFixed(0)}K`;
                if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
                return `$${value.toFixed(0)}`;
              }}
              label={{ value: 'Trade Size (USD)', position: 'insideBottom', offset: 14 }}
              stroke="rgba(255,255,255,0.08)"
              tick={{ fill: '#7F8A9A', fontSize: 11 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              minTickGap={18}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, maxDisplayCap]}
              type="number"
              allowDataOverflow={true}
              padding={{ top: 0, bottom: 0 }}
              label={{ value: 'Price Impact (%)', angle: -90, position: 'insideLeft', offset: 12 }}
              stroke="rgba(255,255,255,0.08)"
              tick={{ fill: '#7F8A9A', fontSize: 11 }}
              tickLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              tickCount={4}
              tickFormatter={(value) => {
                if (value > maxDisplayCap) return '';
                return `${value}%`;
              }}
            />
            <Tooltip 
              content={<CustomTooltip />}
              cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
              allowEscapeViewBox={{ x: false, y: false }}
              shared={false}
              trigger="hover"
              animationDuration={0}
            />
            <Line
              type="monotone"
              dataKey="priceImpact"
              stroke="#3EE6B7"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={false}
              isAnimationActive={true}
              animationDuration={400}
              animationEasing="ease-out"
              connectNulls={false}
              name="Price Impact"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default LiquidityDepthChart;
