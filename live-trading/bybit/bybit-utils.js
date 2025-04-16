/**
 * Bybit Utilities
 * Helper functions for Bybit trading integration
 * Includes support for demo trading, market data conversion, and trading tools
 */

/**
 * Convert interval from J-algo format to Bybit format
 * @param {string} interval - J-algo interval (e.g. "1m", "5m", "1h", "1d")
 * @returns {string} - Bybit interval format
 */
export const convertIntervalToBybit = (interval) => {
  // Map of standard intervals to Bybit intervals
  const intervalMap = {
    "1m": "1",
    "3m": "3",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "2h": "120",
    "4h": "240",
    "6h": "360",
    "12h": "720",
    "1d": "D",
    "1w": "W",
    "1M": "M"
  };
  
  return intervalMap[interval] || "5"; // Default to 5m if not found
};

/**
 * Convert J-algo market type to Bybit category
 * @param {string} market - J-algo market type ("spot" or "futures")
 * @param {string} symbol - Trading symbol
 * @returns {string} - Bybit category
 */
export const convertMarketToCategory = (market, symbol) => {
  if (market === "spot") {
    return "spot";
  }
  
  // Determine if linear or inverse based on symbol
  if (market === "futures") {
    // Symbol ends with USDT = linear futures
    if (symbol.endsWith("USDT")) {
      return "linear";
    }
    
    // Symbol ends with USD (no T) = inverse futures
    if (symbol.endsWith("USD")) {
      return "inverse";
    }
  }
  
  // Default to linear if unknown
  return "linear";
};

/**
 * Calculate position size based on risk parameters
 * @param {number} capital - Account capital
 * @param {number} riskPercent - Risk percentage per trade
 * @param {number} entryPrice - Entry price
 * @param {number} stopLoss - Stop loss price
 * @param {number} leverage - Position leverage
 * @returns {Object} - Position sizing information
 */
export const calculatePositionSize = (capital, riskPercent, entryPrice, stopLoss, leverage = 1) => {
  // Ensure valid inputs
  if (!capital || !entryPrice || !stopLoss || entryPrice === stopLoss) {
    return { error: "Invalid inputs for position sizing" };
  }
  
  // Calculate risk amount in account currency
  const riskAmount = (capital * riskPercent) / 100;
  
  // Calculate distance to stop loss
  const distance = Math.abs(entryPrice - stopLoss);
  const distancePercent = (distance / entryPrice) * 100;
  
  // Calculate position size with leverage
  const basePositionSize = riskAmount / (distancePercent / 100 * entryPrice);
  const leveragedPositionSize = basePositionSize * leverage;
  
  // Calculate total position value
  const positionValue = leveragedPositionSize * entryPrice;
  
  return {
    riskAmount,
    distancePercent,
    positionSizeRaw: leveragedPositionSize,
    positionSize: leveragedPositionSize.toFixed(8),
    positionValue: positionValue.toFixed(2),
    leverage
  };
};

/**
 * Check if demo trading mode is appropriate for testing
 * @param {string} symbol - Trading symbol
 * @param {string} market - Market type (spot, linear, inverse)
 * @param {number} capital - Initial capital
 * @returns {Object} - Recommendations for demo trading
 */
export const getDemoTradingRecommendations = (symbol, market, capital) => {
  // Recommendations for demo trading
  const recommendations = {
    initialCapital: 1000,
    suggestedLeverage: 1,
    requestFundsCycle: 'session', // when to request funds: 'never', 'session', 'daily'
    idealDemoAssets: ['BTC', 'ETH', 'USDT']
  };
  
  // High value assets need more initial capital
  if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) {
    recommendations.initialCapital = 10000;
  }
  
  // Leverage recommendations based on market type
  if (market === 'linear' || market === 'inverse') {
    recommendations.suggestedLeverage = 3;
    
    // For volatile assets, use lower leverage
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) {
      recommendations.suggestedLeverage = 2;
    }
    // For less volatile assets, can use higher leverage
    else if (symbol.includes('1000') || symbol.includes('LINK') || symbol.includes('SOL')) {
      recommendations.suggestedLeverage = 5;
    }
  }
  
  // If initial capital is small, request funds more frequently
  if (capital < 500) {
    recommendations.requestFundsCycle = 'daily';
  } else if (capital > 5000) {
    recommendations.requestFundsCycle = 'never';
  }
  
  return recommendations;
};

/**
 * Format number with fixed precision (trim trailing zeros)
 * @param {number} number - Number to format
 * @param {number} precision - Maximum decimal precision
 * @returns {string} - Formatted number string
 */
export const formatNumber = (number, precision = 8) => {
  if (number === undefined || number === null) {
    return "0";
  }
  
  // Convert to string with fixed precision
  const fixed = parseFloat(number).toFixed(precision);
  
  // Trim trailing zeros
  return fixed.replace(/\.?0+$/, '');
};

/**
 * Generate a unique order ID
 * @param {string} symbol - Trading symbol
 * @param {string} side - Order side
 * @returns {string} - Unique order ID
 */
export const generateOrderId = (symbol, side) => {
  const timestamp = Date.now().toString();
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${symbol}-${side}-${timestamp}-${randomPart}`;
};

/**
 * Convert J-algo signal to Bybit order parameters
 * @param {Object} signal - J-algo trading signal
 * @param {string} category - Bybit category (spot, linear, inverse)
 * @returns {Object} - Bybit order parameters
 */
export const convertSignalToOrder = (signal, category) => {
  if (!signal || !signal.position) {
    return null;
  }
  
  // Convert position direction to side
  const side = signal.position === 'long' ? 'Buy' : 'Sell';
  
  // Base order parameters
  const orderParams = {
    category,
    symbol: signal.symbol,
    side,
    orderType: 'Market',
    qty: signal.qty || '0',
    positionIdx: 0, // Default to one-way mode
    orderLinkId: generateOrderId(signal.symbol, side),
  };
  
  // For futures (linear/inverse), set reduce-only if closing
  if (category !== 'spot' && signal.isClosing) {
    orderParams.reduceOnly = true;
  }
  
  return orderParams;
};

/**
 * Parse WebSocket message for error information
 * @param {Object} message - WebSocket message
 * @returns {string|null} - Error message or null if no error
 */
export const parseWSError = (message) => {
  if (!message) {
    return null;
  }
  
  // Check for standard error format
  if (message.success === false && message.ret_msg) {
    return message.ret_msg;
  }
  
  // Check for success field
  if (message.success === false) {
    return "Unknown WebSocket error";
  }
  
  return null;
};

/**
 * Create error logger that respects log levels
 * @param {string} logLevel - Log level ('debug', 'info', 'warn', 'error')
 * @returns {Object} - Logger functions
 */
export const createLogger = (logLevel = 'info') => {
  const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  
  const currentLevel = levels[logLevel] || levels.info;
  
  return {
    debug: (...args) => {
      if (currentLevel <= levels.debug) {
        console.debug('[Bybit-Debug]', ...args);
      }
    },
    info: (...args) => {
      if (currentLevel <= levels.info) {
        console.info('[Bybit-Info]', ...args);
      }
    },
    warn: (...args) => {
      if (currentLevel <= levels.warn) {
        console.warn('[Bybit-Warn]', ...args);
      }
    },
    error: (...args) => {
      if (currentLevel <= levels.error) {
        console.error('[Bybit-Error]', ...args);
      }
    }
  };
};

export default {
  convertIntervalToBybit,
  convertMarketToCategory,
  calculatePositionSize,
  formatNumber,
  generateOrderId,
  convertSignalToOrder,
  parseWSError,
  createLogger
};