/**
 * Bybit Configuration Module
 * Provides configuration settings for Bybit trading
 */

/**
 * Default configuration options
 */
export const DEFAULT_CONFIG = {
  // API credentials
  apiKey: '',
  apiSecret: '',
  
  // Trading mode
  isDemo: false, // Demo mode (Paper trading) vs Live trading
  
  // Trading parameters
  leverage: 3.0,
  marginMode: 'ISOLATED', // 'ISOLATED' or 'CROSS'
  
  // Risk management
  initialCapital: 1000,
  riskPerTrade: 2.0, // percentage of capital
  rewardMultiple: 1.5, // risk:reward ratio
  
  // Market data settings
  webSocketReconnectDelay: 5000, // ms
  maxReconnectAttempts: 10,
  
  // Position monitoring
  positionMonitoringInterval: 10000, // ms
  enablePositionMonitoring: true,
  
  // Logging
  enableDebug: false,
  logLevel: 'info', // 'debug', 'info', 'warn', 'error'
};

/**
 * Validate configuration settings
 * @param {Object} config - Configuration to validate
 * @returns {Object} - Validated config with any missing fields set to defaults
 * @throws {Error} - If required fields are missing or invalid
 */
export const validateConfig = (config = {}) => {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Validate required fields
  if (!mergedConfig.apiKey || !mergedConfig.apiSecret) {
    throw new Error('API key and secret are required in configuration');
  }
  
  // Validate risk parameters
  if (mergedConfig.riskPerTrade <= 0 || mergedConfig.riskPerTrade > 100) {
    throw new Error('Risk per trade must be between 0 and 100 percent');
  }
  
  if (mergedConfig.rewardMultiple <= 0) {
    throw new Error('Reward multiple must be greater than 0');
  }
  
  if (mergedConfig.leverage < 1) {
    throw new Error('Leverage must be at least 1');
  }
  
  // Validate margin mode
  if (mergedConfig.marginMode !== 'ISOLATED' && mergedConfig.marginMode !== 'CROSS') {
    throw new Error('Margin mode must be either ISOLATED or CROSS');
  }
  
  // Validate intervals
  if (mergedConfig.positionMonitoringInterval < 1000) {
    console.warn('Position monitoring interval is very low, setting to 1000ms minimum');
    mergedConfig.positionMonitoringInterval = 1000;
  }
  
  return mergedConfig;
};

/**
 * Load configuration from environment variables
 * @returns {Object} - Configuration object
 */
export const loadConfigFromEnv = () => {
  return {
    apiKey: process.env.BYBIT_API_KEY || '',
    apiSecret: process.env.BYBIT_API_SECRET || '',
    isDemo: (process.env.BYBIT_DEMO === 'true'),
    leverage: parseFloat(process.env.BYBIT_LEVERAGE || DEFAULT_CONFIG.leverage),
    marginMode: process.env.BYBIT_MARGIN_MODE || DEFAULT_CONFIG.marginMode,
    initialCapital: parseFloat(process.env.BYBIT_INITIAL_CAPITAL || DEFAULT_CONFIG.initialCapital),
    riskPerTrade: parseFloat(process.env.BYBIT_RISK_PER_TRADE || DEFAULT_CONFIG.riskPerTrade),
    rewardMultiple: parseFloat(process.env.BYBIT_REWARD_MULTIPLE || DEFAULT_CONFIG.rewardMultiple),
    enableDebug: (process.env.BYBIT_DEBUG === 'true'),
    logLevel: process.env.BYBIT_LOG_LEVEL || DEFAULT_CONFIG.logLevel
  };
};

/**
 * Create Jalgo-compatible risk management options
 * @param {Object} config - Validated configuration
 * @returns {Object} - Risk management options for Jalgo
 */
export const createRiskOptions = (config) => {
  return {
    initialCapital: config.initialCapital,
    riskPerTrade: config.riskPerTrade,
    rewardMultiple: config.rewardMultiple,
    useLeverage: config.leverage > 1,
    leverageAmount: config.leverage,
    useScalpMode: false // default to standard mode
  };
};

/**
 * Get the appropriate market type based on symbol
 * @param {string} symbol - Trading symbol
 * @returns {string} - Market type: 'spot', 'linear', or 'inverse'
 */
export const getMarketType = (symbol) => {
  // By default, assume linear futures for most symbols ending with USDT
  if (symbol.endsWith('USDT')) {
    return 'linear';
  }
  
  // For symbols ending with USD (without T), typically inverse futures
  if (symbol.endsWith('USD')) {
    return 'inverse';
  }
  
  // Default to spot for everything else
  return 'spot';
};

export default {
  DEFAULT_CONFIG,
  validateConfig,
  loadConfigFromEnv,
  createRiskOptions,
  getMarketType
};