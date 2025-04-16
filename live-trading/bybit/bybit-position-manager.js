/**
 * Bybit Position Manager
 * Handles position operations for the Bybit exchange
 */

/**
 * Creates a Bybit position manager
 * @param {Object} bybitClient - Initialized Bybit client
 * @param {Object} options - Position manager options
 * @returns {Object} - Position manager methods
 */
export const createPositionManager = (bybitClient, options = {}) => {
  if (!bybitClient) {
    throw new Error('Bybit client is required for position manager');
  }
  
  // Cache positions locally
  const positionCache = new Map();
  
  // Default options
  const defaultOptions = {
    checkInterval: 10000, // Check positions every 10 seconds
    enableAutoMonitoring: false,
    isDemo: false,
  };
  
  const config = { ...defaultOptions, ...options };
  
  // Log if in demo mode
  if (config.isDemo) {
    console.log('Position Manager initialized in DEMO mode - positions will use paper trading account');
  }
  let monitoringInterval = null;
  
  /**
   * Update position cache with latest positions
   * @param {string} category - Category: linear, inverse
   * @param {string} [symbol] - Symbol to update (optional)
   * @private
   */
  const updatePositionCache = async (category, symbol = undefined) => {
    try {
      const positions = await bybitClient.getPositions(category, symbol);
      
      if (!positions || !positions.list) {
        console.warn('No positions returned from API');
        return;
      }
      
      // Update cache with latest position data
      positions.list.forEach(position => {
        const key = `${position.symbol}-${position.positionIdx}`;
        positionCache.set(key, {
          ...position,
          lastUpdated: Date.now()
        });
      });
    } catch (error) {
      console.error('Error updating position cache:', error);
    }
  };
  
  /**
   * Start position monitoring
   * @private
   */
  const startMonitoring = () => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
    }
    
    monitoringInterval = setInterval(async () => {
      try {
        // Update linear positions
        await updatePositionCache('linear');
        
        // Update inverse positions
        await updatePositionCache('inverse');
      } catch (error) {
        console.error('Error in position monitoring:', error);
      }
    }, config.checkInterval);
    
    console.log(`Position monitoring started with ${config.checkInterval}ms interval`);
  };
  
  /**
   * Stop position monitoring
   * @private
   */
  const stopMonitoring = () => {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
      console.log('Position monitoring stopped');
    }
  };
  
  // Start monitoring if enabled
  if (config.enableAutoMonitoring) {
    startMonitoring();
  }
  
  return {
    /**
     * Get current positions
     * @param {string} category - Category: linear, inverse
     * @param {string} [symbol] - Symbol to get positions for (optional)
     * @param {boolean} [forceUpdate=false] - Force API update instead of using cache
     * @returns {Promise<Object>} - Position information
     */
    getPositions: async (category, symbol = undefined, forceUpdate = false) => {
      try {
        if (forceUpdate) {
          await updatePositionCache(category, symbol);
        }
        
        // If looking for a specific symbol, return just that position
        if (symbol) {
          const positions = [];
          positionCache.forEach(position => {
            if (position.symbol === symbol && position.category === category) {
              positions.push(position);
            }
          });
          return { category, list: positions };
        }
        
        // Return all positions for the category
        const positions = [];
        positionCache.forEach(position => {
          if (position.category === category) {
            positions.push(position);
          }
        });
        
        return { category, list: positions };
      } catch (error) {
        console.error('Error getting positions:', error);
        throw error;
      }
    },
    
    /**
     * Set trading stop (take profit / stop loss) for an existing position
     * @param {string} category - Category: linear, inverse
     * @param {string} symbol - Symbol
     * @param {Object} params - TP/SL parameters
     * @returns {Promise<Object>} - Result
     */
    setTradingStop: async (category, symbol, params) => {
      try {
        const requestParams = {
          category,
          symbol,
          ...params
        };
        
        const response = await bybitClient.rest.setTradingStop(requestParams);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        // Update position cache after setting TP/SL
        await updatePositionCache(category, symbol);
        
        return response.result;
      } catch (error) {
        console.error('Error setting trading stop:', error);
        throw error;
      }
    },
    
    /**
     * Set leverage for a symbol
     * @param {string} category - Category: linear, inverse
     * @param {string} symbol - Symbol
     * @param {string|number} buyLeverage - Buy leverage
     * @param {string|number} sellLeverage - Sell leverage
     * @returns {Promise<Object>} - Leverage result
     */
    setLeverage: async (category, symbol, buyLeverage, sellLeverage) => {
      try {
        return await bybitClient.setLeverage(category, symbol, buyLeverage, sellLeverage);
      } catch (error) {
        console.error('Error setting leverage:', error);
        throw error;
      }
    },
    
    /**
     * Switch between cross and isolated margin
     * @param {string} category - Category: linear, inverse
     * @param {string} symbol - Symbol
     * @param {number} tradeMode - 0: cross margin, 1: isolated margin
     * @param {string|number} buyLeverage - Buy leverage
     * @param {string|number} sellLeverage - Sell leverage
     * @returns {Promise<Object>} - Result
     */
    switchMarginMode: async (category, symbol, tradeMode, buyLeverage, sellLeverage) => {
      try {
        const params = {
          category,
          symbol,
          tradeMode,
          buyLeverage: buyLeverage.toString(),
          sellLeverage: sellLeverage.toString()
        };
        
        const response = await bybitClient.rest.switchIsolatedMargin(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        // Update position cache
        await updatePositionCache(category, symbol);
        
        return response.result;
      } catch (error) {
        console.error('Error switching margin mode:', error);
        throw error;
      }
    },
    
    /**
     * Add or reduce margin for isolated positions
     * @param {string} category - Category: linear, inverse
     * @param {string} symbol - Symbol
     * @param {string|number} margin - Margin amount (positive to add, negative to reduce)
     * @returns {Promise<Object>} - Result
     */
    adjustMargin: async (category, symbol, margin) => {
      try {
        const params = {
          category,
          symbol,
          margin: margin.toString()
        };
        
        const response = await bybitClient.rest.addOrReduceMargin(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        // Update position cache
        await updatePositionCache(category, symbol);
        
        return response.result;
      } catch (error) {
        console.error('Error adjusting margin:', error);
        throw error;
      }
    },
    
    /**
     * Get closed P&L records
     * @param {string} category - Category: linear, inverse
     * @param {Object} [params] - Additional parameters
     * @returns {Promise<Object>} - Closed P&L records
     */
    getClosedPnL: async (category, params = {}) => {
      try {
        const requestParams = {
          category,
          ...params
        };
        
        const response = await bybitClient.rest.getClosedPnL(requestParams);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting closed P&L:', error);
        throw error;
      }
    },
    
    /**
     * Start position monitoring
     */
    startMonitoring,
    
    /**
     * Stop position monitoring
     */
    stopMonitoring,
    
    /**
     * Get the entire position cache
     * @returns {Map} - Position cache
     */
    getPositionCache: () => {
      return positionCache;
    },
    
    /**
     * Clear the position cache
     */
    clearPositionCache: () => {
      positionCache.clear();
    },
    
    /**
     * Force update of position cache
     * @param {string} category - Category: linear, inverse
     * @param {string} [symbol] - Symbol (optional)
     * @returns {Promise<void>}
     */
    forceUpdateCache: async (category, symbol = undefined) => {
      await updatePositionCache(category, symbol);
    }
  };
};

export default createPositionManager;