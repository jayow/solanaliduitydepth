import { useState, useEffect } from 'react';
import './LiquidityMonitor.css';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function LiquidityMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [nextUpdate, setNextUpdate] = useState(null);

  const fetchLiquidityData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('📊 Fetching stored liquidity data...');
      const response = await axios.get(`${API_BASE_URL}/api/liquidity-snapshots/latest`, {
        timeout: 10000 // 10 second timeout (fast since it's just reading data)
      });
      
      if (response.data.tokens && response.data.tokens.length > 0) {
        // Get the most recent timestamp from the data
        const timestamps = response.data.tokens
          .map(t => new Date(t.timestamp))
          .filter(d => !isNaN(d));
        
        const mostRecent = timestamps.length > 0 
          ? new Date(Math.max(...timestamps))
          : new Date();
        
        setData({ 
          tokens: response.data.tokens,
          statistics: response.data.statistics
        });
        setLastUpdate(mostRecent);
        setNextUpdate(new Date(mostRecent.getTime() + 3600000)); // 1 hour after last update
      } else {
        setData({ tokens: [], statistics: response.data.statistics });
        setError('No liquidity data available yet. Waiting for first hourly calculation...');
      }
      
      setLoading(false);
      
      console.log('✅ Liquidity data fetched successfully');
    } catch (err) {
      console.error('❌ Error fetching liquidity data:', err);
      setError(err.response?.data?.error || err.message || 'Failed to fetch liquidity data');
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch data immediately on mount
    fetchLiquidityData();

    // Set up hourly refresh
    const interval = setInterval(() => {
      console.log('⏰ Hourly refresh triggered');
      fetchLiquidityData();
    }, 3600000); // 1 hour = 3600000ms

    return () => clearInterval(interval);
  }, []);

  const formatUSD = (value) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(2)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  const formatTime = (date) => {
    if (!date) return 'N/A';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusColor = (priceImpact) => {
    if (priceImpact >= 10) return '#E63E3E'; // Red
    if (priceImpact >= 5) return '#FFB020'; // Orange
    return '#3EE6B7'; // Green
  };

  return (
    <div className="liquidity-monitor">
      <div className="monitor-header">
        <div className="header-content">
          <h1>💧 Liquidity Monitor</h1>
          <p className="subtitle">
            Real-time liquidity depth at 5% and 15% price impact
          </p>
        </div>
        
        <div className="update-info">
          {lastUpdate && (
            <div className="update-time">
              <span className="label">Last Update:</span>
              <span className="time">{formatTime(lastUpdate)}</span>
            </div>
          )}
          {nextUpdate && (
            <div className="next-update">
              <span className="label">Next Update:</span>
              <span className="time">{formatTime(nextUpdate)}</span>
            </div>
          )}
          <button 
            className="refresh-btn" 
            onClick={fetchLiquidityData}
            disabled={loading}
          >
            {loading ? '⏳ Loading...' : '🔄 Refresh Now'}
          </button>
        </div>
      </div>

      {loading && !data && (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading stored liquidity data...</p>
          <p className="note">Reading from hourly snapshots</p>
        </div>
      )}

      {error && (
        <div className="error-state">
          <h3>⚠️ Error</h3>
          <p>{error}</p>
          <button className="retry-btn" onClick={fetchLiquidityData}>
            Try Again
          </button>
        </div>
      )}

      {data && data.tokens && (
        <div className="monitor-content">
          {data.statistics && (
            <div className="statistics-bar">
              <div className="stat-item">
                <span className="stat-label">Total Snapshots:</span>
                <span className="stat-value">{data.statistics.totalSnapshots}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Tokens Tracked:</span>
                <span className="stat-value">{data.statistics.tokensTracked}</span>
              </div>
              {data.statistics.oldestSnapshot && (
                <div className="stat-item">
                  <span className="stat-label">History:</span>
                  <span className="stat-value">
                    {Math.round((new Date() - new Date(data.statistics.oldestSnapshot)) / (1000 * 60 * 60))}h
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="tokens-table-container">
            <table className="tokens-table">
              <thead>
                <tr>
                  <th className="token-col">Token</th>
                  <th className="impact-col">
                    <div className="impact-header">
                      <span>5% Impact</span>
                      <span className="impact-label">Trade Size</span>
                    </div>
                  </th>
                  <th className="impact-col">
                    <div className="impact-header">
                      <span>15% Impact</span>
                      <span className="impact-label">Trade Size</span>
                    </div>
                  </th>
                  <th className="ratio-col">Ratio</th>
                </tr>
              </thead>
              <tbody>
                {data.tokens.map((token, index) => {
                  const impact5 = token.impact5Percent || {};
                  const impact15 = token.impact15Percent || {};
                  const ratio = impact15.tradeSize && impact5.tradeSize
                    ? (impact15.tradeSize / impact5.tradeSize).toFixed(2)
                    : 'N/A';

                  if (token.error) {
                    return (
                      <tr key={index} className="token-row error-row">
                        <td className="token-info">
                          <div className="token-symbol">{token.symbol}</div>
                          <div className="token-name">{token.name}</div>
                        </td>
                        <td colSpan="3" className="error-cell">
                          ⚠️ {token.error}
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={index} className="token-row">
                      <td className="token-info">
                        <div className="token-symbol">{token.symbol}</div>
                        <div className="token-name">{token.name}</div>
                      </td>
                      <td className="impact-cell">
                        <div className="trade-size">
                          {formatUSD(impact5.tradeSize || 0)}
                        </div>
                        <div 
                          className="actual-impact"
                          style={{ color: getStatusColor(impact5.priceImpact) }}
                        >
                          {impact5.priceImpact?.toFixed(2) || '0.00'}% impact
                        </div>
                      </td>
                      <td className="impact-cell">
                        <div className="trade-size">
                          {formatUSD(impact15.tradeSize || 0)}
                        </div>
                        <div 
                          className="actual-impact"
                          style={{ color: getStatusColor(impact15.priceImpact) }}
                        >
                          {impact15.priceImpact?.toFixed(2) || '0.00'}% impact
                        </div>
                      </td>
                      <td className="ratio-cell">
                        <div className="ratio-value">{ratio}x</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="monitor-footer">
            <p className="info-text">
              💡 This dashboard monitors how much USDC can be traded for each token at 5% and 15% price impact.
            </p>
            <p className="info-text">
              🔄 Data updates automatically every hour. All trades are priced in USDC.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default LiquidityMonitor;

