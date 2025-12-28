import React, { useState, useEffect } from 'react';
import axios from 'axios';
import LiquidityDepthChart from './components/LiquidityDepthChart';
import LiquidityDepthTable from './components/LiquidityDepthTable';
import TokenSelector from './components/TokenSelector';
import './App.css';

const API_BASE = '/api';

function App() {
  const [tokens, setTokens] = useState([]);
  const [inputToken, setInputToken] = useState(null);
  const [outputToken, setOutputToken] = useState(null);
  const [focusedPanel, setFocusedPanel] = useState(null); // 'input' or 'output'
  const [buyDepth, setBuyDepth] = useState([]);
  const [sellDepth, setSellDepth] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('chart'); // 'table' or 'chart'
  const [jupiterStatus, setJupiterStatus] = useState(null); // 'checking', 'connected', 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0); // Time elapsed in seconds

  useEffect(() => {
    fetchTokens();
    checkJupiterStatus();
  }, []);

  const checkJupiterStatus = async () => {
    setJupiterStatus('checking');
    setStatusMessage('Checking Jupiter API connection...');
    try {
      const response = await axios.get(`${API_BASE}/jupiter-status`);
      if (response.data.status === 'connected') {
        setJupiterStatus('connected');
        setStatusMessage(`✅ Connected to Jupiter API (${response.data.responseTime})`);
      } else {
        setJupiterStatus('error');
        setStatusMessage(`❌ Jupiter API error: ${response.data.message || 'Unknown error'}`);
      }
    } catch (err) {
      const statusCode = err.response?.status;
      const responseData = err.response?.data;
      
      if (err.code === 'ECONNREFUSED' || err.message?.includes('Network Error') || err.message?.includes('Failed to fetch')) {
        setJupiterStatus('error');
        setStatusMessage(`❌ Cannot connect to backend server. Make sure the server is running on port 3001.`);
      } else if (statusCode === 429 || responseData?.status === 'rate_limited') {
        setJupiterStatus('rate_limited');
        const retryAfter = responseData?.retryAfter || 60;
        setStatusMessage(`⏳ Rate limited: Jupiter API is temporarily rate-limited. Please wait ${retryAfter} seconds and try again.`);
      } else {
        setJupiterStatus('error');
        const errorMsg = responseData?.message || responseData?.error || err.message || 'Unknown error';
        setStatusMessage(`❌ Cannot connect to Jupiter API: ${errorMsg}`);
      }
      console.error('Jupiter API status check failed:', err);
    }
  };

  useEffect(() => {
    if (inputToken && outputToken) {
      fetchLiquidityDepth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputToken, outputToken]);

  const fetchTokens = async (refresh = false) => {
    setLoadingTokens(true);
    setError(null);
    setStatusMessage(refresh ? 'Refreshing tokens from Jupiter API...' : 'Loading tokens from Jupiter API...');
    try {
      const url = refresh ? `${API_BASE}/tokens?refresh=true` : `${API_BASE}/tokens`;
      console.log('Fetching tokens from:', url);
      const response = await axios.get(url);
      console.log('Token response:', response.data);
      const tokenList = Array.isArray(response.data) ? response.data : [];
      console.log(`Received ${tokenList.length} tokens`);
      setTokens(tokenList);
      
      // Set default tokens (SOL and USDC)
      // SOL mint address: So11111111111111111111111111111111111111112
      // USDC mint address: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
      const sol = tokenList.find(t => 
        t.symbol === 'SOL' || 
        t.address === 'So11111111111111111111111111111111111111112'
      );
      const usdc = tokenList.find(t => 
        t.symbol === 'USDC' || 
        t.address === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      );
      
      if (sol) {
        console.log('Setting SOL as input token:', sol);
        setInputToken(sol);
      }
      if (usdc) {
        console.log('Setting USDC as output token:', usdc);
        setOutputToken(usdc);
      }
      
      if (tokenList.length === 0) {
        setError('No tokens found. Please check your connection.');
        setStatusMessage('⚠️ No tokens received from API');
      } else {
        setStatusMessage(`✅ Loaded ${tokenList.length} tokens${tokenList.length <= 10 ? ' (using fallback list)' : ''}`);
      }
    } catch (err) {
      console.error('Error fetching tokens:', err);
      let errorMsg = 'Unknown error';
      
      if (err.code === 'ECONNREFUSED' || err.message?.includes('Network Error') || err.message?.includes('Failed to fetch')) {
        errorMsg = 'Cannot connect to backend server. Make sure the server is running on port 3001.';
      } else if (err.response) {
        errorMsg = err.response.data?.error || err.response.statusText || `HTTP ${err.response.status}`;
      } else {
        errorMsg = err.message || 'Unknown error';
      }
      
      setError(`Failed to load tokens: ${errorMsg}`);
      setStatusMessage(`❌ Failed to load tokens: ${errorMsg}`);
    } finally {
      setLoadingTokens(false);
    }
  };

  const fetchLiquidityDepth = async () => {
    if (!inputToken || !outputToken) return;

    setLoading(true);
    setError(null);
    setElapsedTime(0);
    setStatusMessage('Connecting to Jupiter API...');
    
    // Start timer
    const startTime = Date.now();
    let timerInterval = null;
    
    try {
      // Start timer interval
      timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
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
      });

      setStatusMessage('Fetching sell depth from Jupiter API...');
      const sellResponse = await axios.get(`${API_BASE}/liquidity-depth`, {
        params: {
          inputMint,
          outputMint,
          isBuy: 'false',
        },
      });

      const buyDepthData = buyResponse.data.depth || [];
      const sellDepthData = sellResponse.data.depth || [];
      
      setBuyDepth(buyDepthData);
      setSellDepth(sellDepthData);
      
      if (buyDepthData.length === 0 && sellDepthData.length === 0) {
        setStatusMessage('⚠️ No liquidity data returned. Check server logs for details.');
        setError('No liquidity data available. The API may be rate-limited or the pair may have no liquidity.');
      } else {
        const totalPoints = buyDepthData.length + sellDepthData.length;
        setStatusMessage(`✅ Loaded ${totalPoints} data points (${buyDepthData.length} buy, ${sellDepthData.length} sell)`);
      }
    } catch (err) {
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
      setStatusMessage(`❌ Error: ${errorMsg}`);
    } finally {
      // Clear timer
      if (timerInterval) {
        clearInterval(timerInterval);
      }
      setLoading(false);
    }
  };

  const swapTokens = () => {
    const temp = inputToken;
    setInputToken(outputToken);
    setOutputToken(temp);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Solana Liquidity Depth</h1>
        <p>Visualize liquidity depth using Jupiter aggregator</p>
        <p className="app-credit">
          Made with ❤️ by{' '}
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
                      tokens={tokens}
                      selectedToken={inputToken}
                      onSelect={setInputToken}
                      isSelected={focusedPanel === 'input'}
                      onFocusChange={setFocusedPanel}
                    />
                    
                    <div className="swap-button-wrapper">
                      <button className="swap-button" onClick={swapTokens}>
                        <span className="swap-button-inner">⇅</span>
                      </button>
                    </div>

                    <TokenSelector
                      label="Output Token"
                      tokens={tokens}
                      selectedToken={outputToken}
                      onSelect={setOutputToken}
                      isSelected={focusedPanel === 'output'}
                      onFocusChange={setFocusedPanel}
                    />
                    </div>
                  </div>
                  {tokens.length > 0 && (
                    <div className="token-count-info">
                      <span>{tokens.length} token{tokens.length !== 1 ? 's' : ''} available</span>
                      <button 
                        className="refresh-tokens-btn" 
                        onClick={() => fetchTokens(true)}
                        title="Refresh token list from Jupiter"
                      >
                        🔄 Refresh
                      </button>
                    </div>
                  )}
                  {loading && (
                    <div className="loading">
                      <div className="spinner"></div>
                      <p>{statusMessage || 'Calculating liquidity depth...'}</p>
                      <p className="loading-subtext">
                        ⏱️ Time elapsed: <strong>{elapsedTime >= 60 ? `${Math.floor(elapsedTime / 60)}m ${elapsedTime % 60}s` : `${elapsedTime}s`}</strong> | This may take 10-30 seconds as we test multiple trade sizes...
                      </p>
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
                      📊 Table View
                    </button>
                    <button 
                      className={`view-mode-btn ${viewMode === 'chart' ? 'active' : ''}`}
                      onClick={() => setViewMode('chart')}
                    >
                      📈 Chart View
                    </button>
                  </div>

                  {viewMode === 'table' ? (
                    <LiquidityDepthTable
                      buyDepth={buyDepth}
                      sellDepth={sellDepth}
                      inputToken={inputToken}
                      outputToken={outputToken}
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
                      tokens={tokens}
                      selectedToken={inputToken}
                      onSelect={setInputToken}
                      isSelected={focusedPanel === 'input'}
                      onFocusChange={setFocusedPanel}
                    />
                    
                    <div className="swap-button-wrapper">
                      <button className="swap-button" onClick={swapTokens}>
                        <span className="swap-button-inner">⇅</span>
                      </button>
                    </div>

                    <TokenSelector
                      label="Output Token"
                      tokens={tokens}
                      selectedToken={outputToken}
                      onSelect={setOutputToken}
                      isSelected={focusedPanel === 'output'}
                      onFocusChange={setFocusedPanel}
                    />
                  </div>
                </div>
                {tokens.length > 0 && (
                  <div className="token-count-info">
                    <span>{tokens.length} token{tokens.length !== 1 ? 's' : ''} available</span>
                    <button 
                      className="refresh-tokens-btn" 
                      onClick={() => fetchTokens(true)}
                      title="Refresh token list from Jupiter"
                    >
                      🔄 Refresh
                    </button>
                  </div>
                )}
                {loading && (
                  <div className="loading">
                    <div className="spinner"></div>
                    <p>{statusMessage || 'Calculating liquidity depth...'}</p>
                    <p className="loading-subtext">
                      ⏱️ Time elapsed: <strong>{elapsedTime >= 60 ? `${Math.floor(elapsedTime / 60)}m ${elapsedTime % 60}s` : `${elapsedTime}s`}</strong> | This may take 10-30 seconds as we test multiple trade sizes...
                    </p>
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
    </div>
  );
}

export default App;

