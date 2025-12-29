import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './TokenSelector.css';

const API_BASE = '/api';

function TokenSelector({ label, selectedToken, onSelect, isSelected = false, onFocusChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Default tokens (USDC and SOL) - always available
  const defaultTokens = [
    {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
      isVerified: true,
      organicScore: 100,
      organicScoreLabel: 'high'
    },
    {
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      icon: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
      isVerified: true,
      organicScore: 100,
      organicScoreLabel: 'high'
    }
  ];

  // Search tokens as user types (with debouncing)
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSearchResults([]);
      return;
    }

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If search term is empty, show default tokens (USDC and SOL)
    if (!searchTerm || searchTerm.trim().length === 0) {
      setSearchResults(defaultTokens);
      setSearching(false);
      return;
    }

    // Debounce search - wait 300ms after user stops typing
    setSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await axios.get(`${API_BASE}/tokens/search`, {
          params: { q: searchTerm.trim() }
        });
        const results = Array.isArray(response.data) ? response.data : [];
        setSearchResults(results);
        console.log(`Found ${results.length} tokens for "${searchTerm}"`);
      } catch (error) {
        console.error('Token search error:', error);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm, isOpen]);

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

  // Use search results directly (already filtered and sorted by Jupiter's API)
  const filteredTokens = searchResults;

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
    // Keep the panel selected after selection
    if (onFocusChange) {
      const panelType = label.toLowerCase().includes('input') ? 'input' : 'output';
      onFocusChange(panelType);
    }
  };

  return (
    <div className={`token-selector ${isSelected ? 'selected' : ''}`} ref={dropdownRef}>
      <label className="token-selector-label">{label}</label>
      <div 
        className={`token-selector-button ${isSelected ? 'selected' : ''}`} 
        onClick={() => {
          const newIsOpen = !isOpen;
          setIsOpen(newIsOpen);
          if (onFocusChange) {
            const panelType = label.toLowerCase().includes('input') ? 'input' : 'output';
            onFocusChange(newIsOpen ? panelType : panelType); // Keep selected when opening dropdown
          }
        }}
        onFocus={() => {
          if (onFocusChange) {
            onFocusChange(label.toLowerCase().includes('input') ? 'input' : 'output');
          }
        }}
        onBlur={(e) => {
          // Only blur if focus is not moving to dropdown
          if (!dropdownRef.current?.contains(e.relatedTarget)) {
            // Delay blur to allow click events to register
            setTimeout(() => {
              if (onFocusChange && !isOpen) {
                onFocusChange(null);
              }
            }, 200);
          }
        }}
        tabIndex={0}
      >
        {selectedToken ? (
          <div className="selected-token">
            <div className="selected-token-left">
              {(selectedToken.icon || selectedToken.logoURI || selectedToken.logoUri || selectedToken.image) ? (
                <img 
                  src={selectedToken.icon || selectedToken.logoURI || selectedToken.logoUri || selectedToken.image} 
                  alt={selectedToken.symbol || selectedToken.name}
                  className="selected-token-icon"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    const placeholder = e.target.nextElementSibling;
                    if (placeholder) placeholder.style.display = 'flex';
                  }}
                />
              ) : null}
              <div 
                className="selected-token-icon-placeholder"
                style={{ display: (selectedToken.icon || selectedToken.logoURI || selectedToken.logoUri || selectedToken.image) ? 'none' : 'flex' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="12" r="10" fill="#1A2433" stroke="#6B7280" strokeWidth="1.5"/>
                  <path d="M12 8V12M12 16H12.01" stroke="#9AA4B2" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="selected-token-info">
                <span className="token-symbol">{selectedToken.symbol}</span>
                <span className="token-name">{selectedToken.name}</span>
              </div>
            </div>
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
            {searching ? (
              <div className="no-tokens">Searching...</div>
            ) : filteredTokens.length > 0 ? (
              filteredTokens.map((token) => {
                const tokenAddress = token.address || token.mintAddress || token.mint || token.id;
                const isSelectedToken = selectedToken && (
                  selectedToken.address === tokenAddress ||
                  selectedToken.mintAddress === tokenAddress ||
                  selectedToken.mint === tokenAddress ||
                  selectedToken.id === tokenAddress
                );
                const tokenIcon = token.icon || token.logoURI || token.logoUri || token.image || null;
                const isVerified = token.isVerified || (token.tags && token.tags.includes('verified')) || false;
                const organicScore = token.organicScore || null;
                const organicScoreLabel = token.organicScoreLabel || null;
                
                return (
                  <div
                    key={tokenAddress}
                    className={`token-item ${isSelectedToken ? 'selected' : ''}`}
                    onClick={() => handleSelect(token)}
                  >
                    <div className="token-info">
                      <div className="token-left">
                        {tokenIcon && (
                          <img 
                            src={tokenIcon} 
                            alt={token.symbol || token.name}
                            className="token-icon"
                            onError={(e) => {
                              e.target.style.display = 'none';
                            }}
                          />
                        )}
                        {!tokenIcon && (
                          <div className="token-icon-placeholder">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="12" cy="12" r="10" fill="#1A2433" stroke="#6B7280" strokeWidth="1.5"/>
                              <path d="M12 8V12M12 16H12.01" stroke="#9AA4B2" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </div>
                        )}
                        <div className="token-main-info">
                          <div className="token-name-row">
                            <span className="token-symbol">{token.symbol || 'Unknown'}</span>
                            {isVerified && (
                              <span className="token-verified-badge" title="Verified token">
                                ✓
                              </span>
                            )}
                            {organicScore !== null && (
                              <span className={`token-score token-score-${organicScoreLabel || 'medium'}`} title={`Organic Score: ${organicScore.toFixed(1)}`}>
                                {Math.round(organicScore)}
                              </span>
                            )}
                          </div>
                          <span className="token-name">{token.name || token.symbol || 'Unknown Token'}</span>
                          <span className="token-address">{tokenAddress?.slice(0, 8)}...{tokenAddress?.slice(-6)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : searchTerm ? (
              <div className="no-tokens">No tokens found for "{searchTerm}"</div>
            ) : (
              <div className="no-tokens">Type to search for tokens...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TokenSelector;

