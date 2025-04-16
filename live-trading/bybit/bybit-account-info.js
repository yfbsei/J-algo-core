/**
 * Bybit Account Information Handler
 * Handles account, balance, and wallet information
 */

/**
 * Creates a Bybit account information handler
 * @param {Object} bybitClient - Initialized Bybit client
 * @returns {Object} - Account information methods
 */
export const createAccountInfoHandler = (bybitClient) => {
  if (!bybitClient) {
    throw new Error('Bybit client is required for account info handler');
  }
  
  // Cache account info
  let accountInfoCache = null;
  let accountInfoTimestamp = 0;
  
  // Cache wallet balances
  const walletBalanceCache = new Map();
  
  return {
    /**
     * Get account information
     * @param {boolean} [forceUpdate=false] - Force update from API
     * @returns {Promise<Object>} - Account information
     */
    getAccountInfo: async (forceUpdate = false) => {
      try {
        const cacheAge = Date.now() - accountInfoTimestamp;
        
        // Use cache if available and not expired (30 seconds)
        if (!forceUpdate && accountInfoCache && cacheAge < 30000) {
          return accountInfoCache;
        }
        
        const accountInfo = await bybitClient.getAccountInfo();
        
        // Update cache
        accountInfoCache = accountInfo;
        accountInfoTimestamp = Date.now();
        
        return accountInfo;
      } catch (error) {
        console.error('Error getting account info:', error);
        throw error;
      }
    },
    
    /**
     * Get wallet balance
     * @param {string} accountType - Account type: UNIFIED, CONTRACT, SPOT, OPTION, INVESTMENT
     * @param {string} [coin] - Specific coin to query
     * @param {boolean} [forceUpdate=false] - Force update from API
     * @returns {Promise<Object>} - Wallet balance
     */
    getWalletBalance: async (accountType, coin = undefined, forceUpdate = false) => {
      try {
        const cacheKey = coin ? `${accountType}-${coin}` : accountType;
        const cachedBalance = walletBalanceCache.get(cacheKey);
        
        // Use cache if available and not expired (10 seconds)
        if (!forceUpdate && cachedBalance && (Date.now() - cachedBalance.timestamp < 10000)) {
          return cachedBalance.data;
        }
        
        const balance = await bybitClient.getWalletBalance(accountType, coin);
        
        // Update cache
        walletBalanceCache.set(cacheKey, {
          data: balance,
          timestamp: Date.now()
        });
        
        return balance;
      } catch (error) {
        console.error('Error getting wallet balance:', error);
        throw error;
      }
    },
    
    /**
     * Get fee rates
     * @param {string} category - Category: spot, linear, inverse, option
     * @param {string} [symbol] - Symbol to get fee rates for
     * @returns {Promise<Object>} - Fee rates
     */
    getFeeRates: async (category, symbol = undefined) => {
      try {
        const params = { category };
        if (symbol) params.symbol = symbol;
        
        const response = await bybitClient.rest.getFeeRate(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting fee rates:', error);
        throw error;
      }
    },
    
    /**
     * Get available coins for a specific account type
     * @returns {Promise<Object>} - Coin information
     */
    getCoinInfo: async () => {
      try {
        const response = await bybitClient.rest.getCoinInfo();
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting coin info:', error);
        throw error;
      }
    },
    
    /**
     * Calculate total equity across all account types and coins
     * @returns {Promise<Object>} - Total equity information
     */
    getTotalEquity: async () => {
      try {
        // Get unified account balance (most comprehensive)
        const unifiedBalance = await bybitClient.getWalletBalance('UNIFIED');
        
        let totalUsdtEquity = 0;
        const coinEquities = [];
        
        if (unifiedBalance && unifiedBalance.list) {
          unifiedBalance.list.forEach(account => {
            if (account.coin && account.coin.length > 0) {
              account.coin.forEach(coin => {
                const usdtValue = parseFloat(coin.usdValue) || 0;
                totalUsdtEquity += usdtValue;
                
                if (usdtValue > 0) {
                  coinEquities.push({
                    coin: coin.coin,
                    equity: coin.equity,
                    usdValue: coin.usdValue
                  });
                }
              });
            }
          });
        }
        
        return {
          totalUsdtEquity,
          coinEquities,
          timestamp: Date.now()
        };
      } catch (error) {
        console.error('Error calculating total equity:', error);
        throw error;
      }
    },
    
    /**
     * Get transaction history 
     * @param {Object} params - Query parameters
     * @returns {Promise<Object>} - Transaction history
     */
    getTransactionHistory: async (params = {}) => {
      try {
        const response = await bybitClient.rest.getTransactionLog(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting transaction history:', error);
        throw error;
      }
    },
    
    /**
     * Get information about trading limits, margins, etc.
     * @param {string} category - Category: spot, linear, inverse
     * @param {string} symbol - Symbol
     * @returns {Promise<Object>} - Trading risk information
     */
    getRiskLimits: async (category, symbol) => {
      try {
        const params = { category, symbol };
        
        const response = await bybitClient.rest.getRiskLimit(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting risk limits:', error);
        throw error;
      }
    },
    
    /**
     * Clear the account info cache
     */
    clearCache: () => {
      accountInfoCache = null;
      accountInfoTimestamp = 0;
      walletBalanceCache.clear();
    }
  };
};

export default createAccountInfoHandler;