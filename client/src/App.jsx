import React, { useState, useEffect } from 'react';
import axios from 'axios';
import LiquidityDepthChart from './components/LiquidityDepthChart';
import LiquidityDepthTable from './components/LiquidityDepthTable';
import TokenSelector from './components/TokenSelector';
import './App.css';

const API_BASE = '/api';

function App() {
  // No longer store all tokens - search as user types instead
  const [inputToken, setInputToken] = useState(null);
  const [outputToken, setOutputToken] = useState(null);
  const [focusedPanel, setFocusedPanel] = useState(null); // 'input' or 'output'
  const [buyDepth, setBuyDepth] = useState([]);
  const [sellDepth, setSellDepth] = useState([]);
  const [baselinePrice, setBaselinePrice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingTokens, setLoadingTokens] = useState(false); // No longer loading tokens on startup
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null); // Warning message from API
  const [viewMode, setViewMode] = useState('chart'); // 'table' or 'chart'
  const [jupiterStatus, setJupiterStatus] = useState(null); // 'checking', 'connected', 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0); // Time elapsed in seconds
  const [abortController, setAbortController] = useState(null); // For canceling requests
  const [timerInterval, setTimerInterval] = useState(null); // Store timer interval reference

  useEffect(() => {
    // No longer fetch all tokens on load - search as user types instead
    checkJupiterStatus();
    
    // Set default tokens (SOL and USDC) without fetching full list
    // These are always available via search
    setInputToken({
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      isVerified: true
    });
    setOutputToken({
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
      isVerified: true
    });
  }, []);

  const checkJupiterStatus = async () => {
    setJupiterStatus('checking');
    setStatusMessage('Checking Jupiter API connection...');
    try {
      const response = await axios.get(`${API_BASE}/jupiter-status`);
      if (response.data.status === 'connected') {
        setJupiterStatus('connected');
        setStatusMessage(`Connected to Jupiter API (${response.data.responseTime})`);
      } else {
        setJupiterStatus('error');
        setStatusMessage(`Jupiter API error: ${response.data.message || 'Unknown error'}`);
      }
    } catch (err) {
      const statusCode = err.response?.status;
      const responseData = err.response?.data;
      
      if (err.code === 'ECONNREFUSED' || err.message?.includes('Network Error') || err.message?.includes('Failed to fetch')) {
        setJupiterStatus('error');
        setStatusMessage(`Cannot connect to backend server. Make sure the server is running on port 3001.`);
      } else if (statusCode === 429 || responseData?.status === 'rate_limited') {
        setJupiterStatus('rate_limited');
        const retryAfter = responseData?.retryAfter || 60;
        setStatusMessage(`⏳ Rate limited: Jupiter API is temporarily rate-limited. Please wait ${retryAfter} seconds and try again.`);
      } else {
        setJupiterStatus('error');
        const errorMsg = responseData?.message || responseData?.error || err.message || 'Unknown error';
        setStatusMessage(`Cannot connect to Jupiter API: ${errorMsg}`);
      }
      console.error('Jupiter API status check failed:', err);
    }
  };

  // Removed automatic calculation on token selection
  // User must manually click "Calculate" button to run liquidity depth calculation

  // Removed fetchTokens - tokens are now searched on-demand as user types
  
  const swapTokens = () => {
    const temp = inputToken;
    setInputToken(outputToken);
    setOutputToken(temp);
  };

  const cancelCalculation = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setLoading(false);
      setStatusMessage('Calculation cancelled by user.');
      setError('Calculation was cancelled.');
    }
    // Clear any running timers
    if (timerInterval) {
      clearInterval(timerInterval);
      setTimerInterval(null);
    }
  };

  const fetchLiquidityDepth = async () => {
    if (!inputToken || !outputToken) return;

    // Create new AbortController for this request
    const controller = new AbortController();
    setAbortController(controller);

    setLoading(true);
    setError(null);
    setWarning(null); // Clear previous warnings
    setElapsedTime(0);
    setStatusMessage('Connecting to Jupiter API...');
    
    // Start timer
    const startTime = Date.now();
    
    try {
      // Start timer interval
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
      setTimerInterval(interval);
      const inputMint = inputToken.address || inputToken.mintAddress || inputToken.mint;
      const outputMint = outputToken.address || outputToken.mintAddress || outputToken.mint;
      
      if (!inputMint || !outputMint) {
        setError('Invalid token addresses');
        setLoading(false);
        return;
      }

      setStatusMessage('Fetching buy depth from Jupiter API...');
      const buyResponse = await axios.get(`${API_BASE}/liquidity-depth`, {
        params: {
          inputMint,
          outputMint,
          isBuy: 'true',
        },
        signal: controller.signal
      });

      setStatusMessage('Fetching sell depth from Jupiter API...');
      const sellResponse = await axios.get(`${API_BASE}/liquidity-depth`, {
        params: {
          inputMint,
          outputMint,
          isBuy: 'false',
        },
        signal: controller.signal
      });

      const buyDepthData = buyResponse.data.depth || [];
      const sellDepthData = sellResponse.data.depth || [];
      
      // Check if token is unsupported by Jupiter
      const buyUnsupported = buyResponse.data.metadata?.tokenUnsupported || false;
      const sellUnsupported = sellResponse.data.metadata?.tokenUnsupported || false;
      const isUnsupported = buyUnsupported || sellUnsupported;
      
      // Extract warnings from API responses
      const buyWarning = buyResponse.data.warning;
      const sellWarning = sellResponse.data.warning;
      // Use the first warning found (they're usually the same)
      const apiWarning = buyWarning || sellWarning;
      console.log('🔍 Checking for warnings:', { buyWarning, sellWarning, apiWarning });
      if (apiWarning) {
        console.log('⚠️ Setting warning:', apiWarning);
        setWarning(apiWarning);
      } else {
        setWarning(null); // Clear warning if no warning in response
      }
      
      // Store baseline price if available (spot price before price impact)
      // Use sell baseline price (selling input token) as primary, fallback to buy
      const sellBaselinePrice = sellResponse.data.baselinePrice;
      const buyBaselinePrice = buyResponse.data.baselinePrice;
      const priceToUse = sellBaselinePrice || buyBaselinePrice || null;
      
      setBuyDepth(buyDepthData);
      setSellDepth(sellDepthData);
      setBaselinePrice(priceToUse);
      
      // Log final warning state for debugging (use apiWarning, not state)
      console.log('✅ API warning extracted:', apiWarning);
      
      if (buyDepthData.length === 0 && sellDepthData.length === 0) {
        if (isUnsupported) {
          const unsupportedToken = buyUnsupported ? outputToken?.symbol : inputToken?.symbol;
          setStatusMessage(`Token "${unsupportedToken}" is not supported by Jupiter API.`);
          setError(`The token "${unsupportedToken}" is not supported by Jupiter. Jupiter cannot route trades for this token.`);
        } else {
          setStatusMessage('No liquidity data returned. Check server logs for details.');
          setError('No liquidity data available. The API may be rate-limited or the pair may have no liquidity.');
        }
      } else {
        const totalPoints = buyDepthData.length + sellDepthData.length;
        setStatusMessage(`Loaded ${totalPoints} data points (${buyDepthData.length} buy, ${sellDepthData.length} sell)`);
      }
    } catch (err) {
      // Check if request was cancelled
      if (axios.isCancel(err) || err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        console.log('Request cancelled by user');
        setError('Calculation cancelled.');
        setStatusMessage('Calculation was cancelled.');
        return; // Don't set loading to false here, already handled in cancelCalculation
      }
      
      console.error('Error fetching liquidity depth:', err);
      let errorMsg = 'Unknown error';
      
      if (err.code === 'ECONNREFUSED' || err.message?.includes('Network Error') || err.message?.includes('Failed to fetch')) {
        errorMsg = 'Cannot connect to backend server. Make sure the server is running on port 3001.';
      } else if (err.response) {
        errorMsg = err.response.data?.error || err.response.data?.details || err.response.statusText || `HTTP ${err.response.status}`;
      } else {
        errorMsg = err.message || 'Unknown error';
      }
      
      setError(`Failed to fetch liquidity depth: ${errorMsg}`);
      setStatusMessage(`Error: ${errorMsg}`);
    } finally {
      setAbortController(null); // Clear abort controller
      setLoading(false);
      // Clear timer
      setTimerInterval(prev => {
        if (prev) {
          clearInterval(prev);
        }
        return null;
      });
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <h1>Solana Liquidity Depth</h1>
          <p>Visualize liquidity depth using Jupiter aggregator</p>
        </div>
        <div></div>
        <p className="app-credit">
          Made with love by{' '}
          <a 
            href="https://twitter.com/jayowtrades" 
            target="_blank" 
            rel="noopener noreferrer"
            className="credit-link"
          >
            @jayowtrades
          </a>
        </p>
      </header>

      <main className="app-main">
        {loadingTokens ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading tokens...</p>
          </div>
        ) : (
          <>
            {inputToken && outputToken ? (
              <div className="main-content-layout">
                <div className="sidebar-container">
                  <div className="swap-card">
                    <div className="token-selector-container">
                    <TokenSelector
                      label="Input Token"
                      selectedToken={inputToken}
                      onSelect={setInputToken}
                      isSelected={focusedPanel === 'input'}
                      onFocusChange={setFocusedPanel}
                    />
                    
                    <div className="swap-button-wrapper">
                      <button className="swap-button" onClick={swapTokens}>
                        <span className="swap-button-inner">⇄</span>
                      </button>
                    </div>

                    <TokenSelector
                      label="Output Token"
                      selectedToken={outputToken}
                      onSelect={setOutputToken}
                      isSelected={focusedPanel === 'output'}
                      onFocusChange={setFocusedPanel}
                    />
                    </div>
                  </div>
                  {inputToken && outputToken && !loading && (
                    <div className="calculate-button-container">
                      <button 
                        className="calculate-btn" 
                        onClick={fetchLiquidityDepth}
                        disabled={!inputToken || !outputToken}
                        title="Calculate liquidity depth for selected tokens"
                      >
                        Calculate Liquidity Depth
                      </button>
                    </div>
                  )}
                  {loading && (
                    <div className="loading">
                      <div className="spinner"></div>
                      <p>{statusMessage || 'Calculating liquidity depth...'}</p>
                      <p className="loading-subtext">
                        Time elapsed: <strong>{elapsedTime >= 60 ? `${Math.floor(elapsedTime / 60)}m ${elapsedTime % 60}s` : `${elapsedTime}s`}</strong> | This may take 10-30 seconds as we test multiple trade sizes...
                      </p>
                      <button 
                        className="cancel-btn" 
                        onClick={cancelCalculation}
                      >
                        Cancel Calculation
                      </button>
                    </div>
                  )}
                  {!loading && statusMessage && (
                    <div className={`status-message ${
                      jupiterStatus === 'connected' ? 'status-success' : 
                      jupiterStatus === 'rate_limited' ? 'status-error rate-limited' :
                      jupiterStatus === 'error' ? 'status-error' : 
                      'status-info'
                    }`}>
                      <span>{statusMessage}</span>
                      {(jupiterStatus === 'error' || jupiterStatus === 'rate_limited') && (
                        <button 
                          className="retry-button" 
                          onClick={checkJupiterStatus}
                          title="Retry connection to Jupiter API"
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                  {!loading && warning && (
                    <div className="warning-message" key="warning-display">
                      <strong>⚠️ Warning:</strong> {warning}
                    </div>
                  )}
                  {/* Debug: Show warning state */}
                  {process.env.NODE_ENV === 'development' && (
                    <div style={{ fontSize: '10px', color: '#666', padding: '4px' }}>
                      Debug: warning={warning ? 'SET' : 'NULL'}, loading={loading ? 'YES' : 'NO'}
                    </div>
                  )}
                  {!loading && error && (
                    <div className="error-message">
                      {error}
                    </div>
                  )}
                </div>

                {!loading && (
                  <div className="liquidity-view-container">
                  <div className="view-mode-selector">
                    <button 
                      className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
                      onClick={() => setViewMode('table')}
                    >
                      Table View
                    </button>
                    <button 
                      className={`view-mode-btn ${viewMode === 'chart' ? 'active' : ''}`}
                      onClick={() => setViewMode('chart')}
                    >
                      Chart View
                    </button>
                  </div>

                  {viewMode === 'table' ? (
                    <LiquidityDepthTable
                      buyDepth={buyDepth}
                      sellDepth={sellDepth}
                      inputToken={inputToken}
                      outputToken={outputToken}
                      baselinePrice={baselinePrice}
                    />
                  ) : (
                    <LiquidityDepthChart
                      buyDepth={buyDepth}
                      sellDepth={sellDepth}
                      inputToken={inputToken}
                      outputToken={outputToken}
                    />
                  )}
                  </div>
                )}
              </div>
            ) : (
              <div className="sidebar-container">
                <div className="swap-card">
                  <div className="token-selector-container">
                    <TokenSelector
                      label="Input Token"
                      selectedToken={inputToken}
                      onSelect={setInputToken}
                      isSelected={focusedPanel === 'input'}
                      onFocusChange={setFocusedPanel}
                    />
                    
                    <div className="swap-button-wrapper">
                      <button className="swap-button" onClick={swapTokens}>
                        <span className="swap-button-inner">⇄</span>
                      </button>
                    </div>

                    <TokenSelector
                      label="Output Token"
                      selectedToken={outputToken}
                      onSelect={setOutputToken}
                      isSelected={focusedPanel === 'output'}
                      onFocusChange={setFocusedPanel}
                    />
                  </div>
                </div>
                {loading && (
                  <div className="loading">
                    <div className="spinner"></div>
                    <p>{statusMessage || 'Calculating liquidity depth...'}</p>
                    <p className="loading-subtext">
                      ⏱️ Time elapsed: <strong>{elapsedTime >= 60 ? `${Math.floor(elapsedTime / 60)}m ${elapsedTime % 60}s` : `${elapsedTime}s`}</strong> | This may take 10-30 seconds as we test multiple trade sizes...
                    </p>
                    <button 
                      className="cancel-btn" 
                      onClick={cancelCalculation}
                    >
                      Cancel Calculation
                    </button>
                  </div>
                )}
                {!loading && statusMessage && (
                  <div className={`status-message ${
                    jupiterStatus === 'connected' ? 'status-success' : 
                    jupiterStatus === 'rate_limited' ? 'status-error rate-limited' :
                    jupiterStatus === 'error' ? 'status-error' : 
                    'status-info'
                  }`}>
                    <span>{statusMessage}</span>
                    {(jupiterStatus === 'error' || jupiterStatus === 'rate_limited') && (
                      <button 
                        className="retry-button" 
                        onClick={checkJupiterStatus}
                        title="Retry connection to Jupiter API"
                      >
                        🔄 Retry
                      </button>
                    )}
                  </div>
                )}
                {!loading && warning && (
                  <div className="warning-message">
                    {warning}
                  </div>
                )}
                {!loading && error && (
                  <div className="error-message">
                    {error}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
      
      <footer className="app-footer">
        <p className="donation-text">
          Donations: <span className="donation-address">AN8BWgZvXLrBzNf6Yrvd6A6KQcAxSkRMak5SQn6jkT9F</span>
        </p>
      </footer>
    </div>
  );
}

export default App;

