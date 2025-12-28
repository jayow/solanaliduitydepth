import React, { useState, useRef, useEffect } from 'react';
import './TokenSelector.css';

function TokenSelector({ label, tokens, selectedToken, onSelect, isSelected = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);

  // Debug: Log tokens when they change
  useEffect(() => {
    console.log(`${label} TokenSelector - Received ${Array.isArray(tokens) ? tokens.length : 0} tokens`);
    if (Array.isArray(tokens) && tokens.length > 0) {
      console.log(`First token:`, tokens[0]);
    }
  }, [tokens, label]);

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Improved search function with better matching
  const getSearchScore = (token, searchLower) => {
    if (!token || !searchLower) return 0;
    
    const address = (token.address || token.mintAddress || token.mint || '').toLowerCase();
    const symbol = (token.symbol || '').toLowerCase();
    const name = (token.name || '').toLowerCase();
    
    let score = 0;
    
    // Exact matches get highest score
    if (symbol === searchLower) score += 1000;
    if (name === searchLower) score += 900;
    if (address === searchLower) score += 800;
    
    // Starts with matches get high score
    if (symbol.startsWith(searchLower)) score += 500;
    if (name.startsWith(searchLower)) score += 400;
    if (address.startsWith(searchLower)) score += 300;
    
    // Contains matches get lower score
    if (symbol.includes(searchLower)) score += 100;
    if (name.includes(searchLower)) score += 50;
    if (address.includes(searchLower)) score += 10;
    
    // Word boundary matches (e.g., "usdc" matches "USD Coin")
    const words = name.split(/\s+/);
    words.forEach(word => {
      if (word.startsWith(searchLower)) score += 200;
      if (word.includes(searchLower)) score += 30;
    });
    
    return score;
  };

  const filteredTokens = (Array.isArray(tokens) ? tokens : [])
    .map(token => ({
      token,
      score: getSearchScore(token, searchTerm.toLowerCase())
    }))
    .filter(({ score }) => score > 0 || !searchTerm)
    .sort((a, b) => b.score - a.score) // Sort by score (highest first)
    .map(({ token }) => token)
    .slice(0, 200); // Limit results

  const handleClear = (e) => {
    e.stopPropagation();
    setSearchTerm('');
    searchInputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    // Allow Ctrl+A (Cmd+A on Mac) to select all
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      e.target.select();
    }
    // Escape closes dropdown
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearchTerm('');
    }
  };

  const handleSelect = (token) => {
    onSelect(token);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className={`token-selector ${isSelected ? 'selected' : ''}`} ref={dropdownRef}>
      <label className="token-selector-label">{label}</label>
      <div 
        className={`token-selector-button ${isSelected ? 'selected' : ''}`} 
        onClick={() => {
          setIsOpen(!isOpen);
          if (onFocusChange) {
            onFocusChange(!isOpen ? label.toLowerCase().includes('input') ? 'input' : 'output' : null);
          }
        }}
        onFocus={() => {
          if (onFocusChange) {
            onFocusChange(label.toLowerCase().includes('input') ? 'input' : 'output');
          }
        }}
        onBlur={() => {
          if (onFocusChange) {
            onFocusChange(null);
          }
        }}
        tabIndex={0}
      >
        {selectedToken ? (
          <div className="selected-token">
            <span className="token-symbol">{selectedToken.symbol}</span>
            <span className="token-name">{selectedToken.name}</span>
          </div>
        ) : (
          <span className="placeholder">Select token</span>
        )}
        <span className="dropdown-arrow">▼</span>
      </div>

      {isOpen && (
        <div className="token-dropdown">
          <div className="token-search-wrapper">
            <input
              ref={searchInputRef}
              type="text"
              className="token-search"
              placeholder="Search by name, symbol, or address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
            {searchTerm && (
              <button
                className="token-search-clear"
                onClick={handleClear}
                type="button"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <div className="token-list">
            {filteredTokens.length > 0 ? (
              filteredTokens.map((token) => {
                const tokenAddress = token.address || token.mintAddress || token.mint;
                const isSelected = selectedToken && (
                  selectedToken.address === tokenAddress ||
                  selectedToken.mintAddress === tokenAddress ||
                  selectedToken.mint === tokenAddress
                );
                return (
                  <div
                    key={tokenAddress}
                    className={`token-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelect(token)}
                  >
                    <div className="token-info">
                      <div className="token-main-info">
                        <span className="token-symbol">{token.symbol || 'Unknown'}</span>
                        <span className="token-name">{token.name || token.symbol || 'Unknown Token'}</span>
                      </div>
                      <span className="token-address">{tokenAddress?.slice(0, 8)}...{tokenAddress?.slice(-6)}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="no-tokens">No tokens found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TokenSelector;

