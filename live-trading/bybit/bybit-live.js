/**
 * Bybit Live Trading Module
 * Main entry point for integrating J-algo-core with Bybit
 */

import Jalgo from '../../src/core/jalgo.js';
import { createBybitClient } from './bybit-client.js';
import { createOrderManager } from './bybit-order-manager.js';
import { createPositionManager } from './bybit-position-manager.js';
import { createMarketDataHandler } from './bybit-market-data.js';
import { createAccountInfoHandler } from './bybit-account-info.js';
import { 
  validateConfig, 
  createRiskOptions, 
  getMarketType 
} from './bybit-config.js';
import utils from './bybit-utils.js';

/**
 * Bybit Live Trading Class
 * Integrates J-algo-core with Bybit for live trading
 */
class BybitLiveTrading {
  /**
   * Create a new BybitLiveTrading instance
   * @param {Object} config - Configuration object
   */
  constructor(config = {}) {
    // Validate configuration
    this.config = validateConfig(config);
    
    // Create logger
    this.logger = utils.createLogger(this.config.logLevel);
    this.logger.info(`Initializing Bybit ${this.config.isDemo ? 'DEMO' : 'LIVE'} Trading module...`);
    
    // Trading instances map (symbol -> trading instance)
    this.tradingInstances = new Map();
    
    // Initialize Bybit client
    this.bybitClient = createBybitClient({
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      isDemo: this.config.isDemo,
      enableDebug: this.config.enableDebug
    });
    
    // Initialize managers
    this.orderManager = createOrderManager(this.bybitClient, {
      isDemo: this.config.isDemo
    });
    this.positionManager = createPositionManager(this.bybitClient, {
      checkInterval: this.config.positionMonitoringInterval,
      enableAutoMonitoring: this.config.enablePositionMonitoring,
      isDemo: this.config.isDemo
    });
    
    // Use a preferred WebSocket URL based on diagnostic results
    const preferredWebSocketUrls = {
      linear: 'wss://stream.bybit.com/v5/public/linear',
      inverse: 'wss://stream.bybit.com/v5/public/inverse',
      spot: 'wss://stream.bybit.com/v5/public/spot'
    };
    
    this.marketData = createMarketDataHandler({
      reconnectDelay: this.config.webSocketReconnectDelay,
      maxReconnectAttempts: this.config.maxReconnectAttempts,
      preferredWebSocketUrls: preferredWebSocketUrls,
      enableDebug: this.config.enableDebug
    });
    
    this.accountInfo = createAccountInfoHandler(this.bybitClient);
    
    // Auto-request demo funds if configured
    if (this.config.isDemo && this.config.requestDemoFundsOnStart) {
      this.requestDemoFunds()
        .then(result => {
          this.logger.info('Demo funds requested successfully');
        })
        .catch(error => {
          this.logger.error('Failed to request demo funds:', error.message);
        });
    }
    
    this.logger.info('Bybit Live Trading module initialized');

    this.syncAccountBalance = async () => {
      try {
        console.log('Syncing account balance from Bybit...');
        const accountInfo = await this.bybitClient.getWalletBalance('UNIFIED');
        
        if (accountInfo && accountInfo.list && accountInfo.list.length > 0) {
          let totalBalance = 0;
          accountInfo.list.forEach(account => {
            if (account.coin) {
              account.coin.forEach(coin => {
                if (coin.coin === 'USDT') {
                  totalBalance += parseFloat(coin.walletBalance);
                }
              });
            }
          });
          
          if (totalBalance > 0 && totalBalance !== this.config.initialCapital) {
            console.log(`Detected account balance: $${totalBalance}`);
            console.log(`Configured initial capital: $${this.config.initialCapital}`);
            console.log(`Updating risk calculations to use actual balance: $${totalBalance}`);
            
            // Update the config
            this.config.initialCapital = totalBalance;
            
            return true;
          }
        }
        return false;
      } catch (error) {
        this.logger.error('Error syncing account balance:', error);
        return false;
      }
    };

    this.syncAccountBalance().then(updated => {
      if (updated) {
        this.logger.info(`Risk calculations will use actual account balance: $${this.config.initialCapital}`);
      } else {
        this.logger.info(`Using configured initial capital: $${this.config.initialCapital}`);
      }
    });

  }
  
  /**
   * Request demo trading funds (only works in demo mode)
   * @returns {Promise<Object>} - Result of the request
   */
  async requestDemoFunds() {
    if (!this.config.isDemo) {
      throw new Error('Demo funds can only be requested in demo trading mode');
    }
    
    try {
      return await this.bybitClient.requestDemoFunds();
    } catch (error) {
      this.logger.error('Error requesting demo funds:', error);
      throw error;
    }
  }
  
  /**
   * Create a trading instance for a specific symbol
   * @param {Object} options - Trading options
   * @param {string} options.symbol - Trading pair symbol
   * @param {string} options.timeframe - Candlestick timeframe (e.g., '5m')
   * @param {string} [options.market] - Market type ('spot' or 'futures')
   * @param {Object} [options.riskOptions] - Custom risk management options
   * @returns {Object} - Trading instance
   */
  createTradingInstance(options = {}) {
    const { symbol, timeframe, market = null } = options;
    
    if (!symbol || !timeframe) {
      throw new Error('Symbol and timeframe are required');
    }
    
    // Log trading mode
    if (this.config.isDemo) {
      this.logger.info(`Creating ${symbol} trading instance in DEMO mode - no real funds will be used`);
    }
    
    // Check if instance already exists
    const instanceKey = `${symbol}-${timeframe}`;
    if (this.tradingInstances.has(instanceKey)) {
      this.logger.warn(`Trading instance for ${instanceKey} already exists`);
      return this.tradingInstances.get(instanceKey);
    }
    
    this.logger.info(`Creating trading instance for ${symbol} on ${timeframe} timeframe`);
    
    // Determine market type if not provided
    const actualMarket = market || getMarketType(symbol);
    
    // Create Bybit category (spot, linear, inverse)
    const category = utils.convertMarketToCategory(actualMarket, symbol);
    
    // Create risk options for Jalgo
    const riskOptions = createRiskOptions(this.config);
    
    // Override with custom risk options if provided
    if (options.riskOptions) {
      Object.assign(riskOptions, options.riskOptions);
    }
    
    // Set up event callbacks
    const callbacks = {
      onSignal: (signal) => this.handleSignal(instanceKey, signal),
      onPositionOpen: (position) => this.handlePositionOpen(instanceKey, position),
      onPositionClosed: (result) => this.handlePositionClosed(instanceKey, result),
      onTakeProfitHit: (result) => this.handleTakeProfitHit(instanceKey, result),
      onError: (error) => this.handleError(instanceKey, error)
    };
    
    // Initialize Jalgo for this symbol
    const jalgo = new Jalgo({
      symbol,
      timeframe,
      market: actualMarket,
      provider: 'bybit',
      riskOptions,
      ...callbacks
    });
    
    // Create the trading instance
    const instance = {
      jalgo,
      symbol,
      timeframe,
      market: actualMarket,
      category,
      active: true,
      lastSignal: null,
      
      // Initialize market data subscription
      init: async () => {
        try {
          // Get historical candles
          const candles = await this.marketData.getHistoricalCandles(actualMarket, symbol, timeframe, 500);
          
          // Initialize Jalgo with historical candles
          if (candles && candles.close && candles.close.length > 0) {
            // Replace jalgo's initial candles
            Object.assign(jalgo.initialCandles, candles);
            jalgo.isInitialized = true;
            this.logger.info(`Initialized ${symbol} with ${candles.close.length} historical candles`);
            
            // Process for initial signal
            jalgo.processSignal();
          } else {
            throw new Error(`Failed to get historical candles for ${symbol}`);
          }
          
          // Subscribe to real-time candlestick updates
          this.marketData.subscribeToCandlesticks(
            category,
            symbol,
            utils.convertIntervalToBybit(timeframe),
            (candle) => jalgo.processNewCandle(candle)
          );
          
          this.logger.info(`Subscribed to real-time ${timeframe} candles for ${symbol}`);
          return true;
        } catch (error) {
          this.logger.error(`Error initializing ${symbol}:`, error);
          return false;
        }
      },
      
      // Market operations
      getMarketData: () => this.getMarketData(symbol, category),
      
      // Order operations
      placeOrder: (params) => this.placeOrder(category, {
        symbol,
        ...params
      }),
      cancelOrder: (orderId, orderLinkId) => this.cancelOrder(category, symbol, orderId, orderLinkId),
      getOpenOrders: () => this.getOpenOrders(category, symbol),
      
      // Position operations
      getPositions: () => this.getPositions(category, symbol),
      setLeverage: (leverage) => this.setLeverage(category, symbol, leverage),
      
      // Stop trading and cleanup resources
      stop: () => {
        this.marketData.unsubscribeFromCandlesticks(symbol, utils.convertIntervalToBybit(timeframe));
        instance.active = false;
        this.logger.info(`Stopped trading instance for ${symbol}`);
      }
    };
    
    // Store the instance
    this.tradingInstances.set(instanceKey, instance);
    
// Initialize the instance with a delay if there are other instances
const instanceCount = this.tradingInstances.size;
const delay = instanceCount * 2000; // 2 seconds between each initialization

setTimeout(() => {
  instance.init().catch(error => {
    this.logger.error(`Failed to initialize trading instance for ${symbol}:`, error);
  });
}, delay);
    
    return instance;
  }
  
  /**
   * Handle trading signal from Jalgo
   * @param {string} instanceKey - Trading instance key
   * @param {Object} signal - Signal information
   * @private
   */
  handleSignal(instanceKey, signal) {
    if (!this.tradingInstances.has(instanceKey)) {
      return;
    }
    
    const instance = this.tradingInstances.get(instanceKey);
    
    // Log signal details
    this.logger.info(`📊 SIGNAL DETECTED (${instance.symbol}): ${signal.position.toUpperCase()}`);
    
    // Store the signal
    instance.lastSignal = {
      ...signal,
      timestamp: new Date().toISOString()
    };
    
    // If auto trading is enabled, place order
    if (this.config.enableAutoTrading) {
      try {
        // Convert signal to order parameters
        const orderParams = utils.convertSignalToOrder(signal, instance.category);
        
        if (orderParams) {
          this.placeOrder(instance.category, orderParams).catch(error => {
            this.logger.error(`Error placing order for ${instance.symbol}:`, error);
          });
        }
      } catch (error) {
        this.logger.error(`Error processing signal for ${instance.symbol}:`, error);
      }
    }
  }
  
  /**
   * Handle position open event
   * @param {string} instanceKey - Trading instance key
   * @param {Object} position - Position information
   * @private
   */
  handlePositionOpen(instanceKey, position) {
    if (!this.tradingInstances.has(instanceKey)) {
      return;
    }
    
    const instance = this.tradingInstances.get(instanceKey);
    
    this.logger.info(`🔔 NEW POSITION OPENED (${instance.symbol}): ${position.position.toUpperCase()} @ ${position.entry}`);
    this.logger.info(`Target: ${position.target}, Reference Stop: ${position.refStop}, Risk: ${position.risk}`);
  }
  
  /**
   * Handle position closed event
   * @param {string} instanceKey - Trading instance key
   * @param {Object} result - Position close result
   * @private
   */
  handlePositionClosed(instanceKey, result) {
    if (!this.tradingInstances.has(instanceKey)) {
      return;
    }
    
    const instance = this.tradingInstances.get(instanceKey);
    
    this.logger.info(`🏁 POSITION CLOSED (${instance.symbol}): ${result.position.toUpperCase()} @ ${result.exit}`);
    this.logger.info(`Close Reason: ${result.closeReason}, PnL: ${result.pnl.toFixed(2)}, Capital: ${result.capitalAfter.toFixed(2)}`);
  }
  
  /**
   * Handle take profit hit event
   * @param {string} instanceKey - Trading instance key
   * @param {Object} result - Take profit result
   * @private
   */
  handleTakeProfitHit(instanceKey, result) {
    if (!this.tradingInstances.has(instanceKey)) {
      return;
    }
    
    const instance = this.tradingInstances.get(instanceKey);
    
    this.logger.info(`🎯 TARGET HIT (${instance.symbol}): ${result.position.toUpperCase()} @ ${result.exit}`);
    this.logger.info(`PnL: ${result.pnl.toFixed(2)}, Capital: ${result.capitalAfter.toFixed(2)}`);
  }
  
  /**
   * Handle error event
   * @param {string} instanceKey - Trading instance key
   * @param {Error} error - Error object
   * @private
   */
  handleError(instanceKey, error) {
    if (!this.tradingInstances.has(instanceKey)) {
      this.logger.error(`Error in unknown instance:`, error);
      return;
    }
    
    const instance = this.tradingInstances.get(instanceKey);
    this.logger.error(`Error in ${instance.symbol}:`, error);
  }
  
  /**
   * Place an order on Bybit
   * @param {string} category - Order category (spot, linear, inverse)
   * @param {Object} params - Order parameters
   * @returns {Promise<Object>} - Order result
   */
  async placeOrder(category, params) {
    try {
      const orderResult = await this.bybitClient.placeOrder({
        category,
        ...params
      });
      
      this.logger.info(`Order placed for ${params.symbol}: ${params.side} ${params.orderType}`, orderResult);
      return orderResult;
    } catch (error) {
      this.logger.error(`Error placing order for ${params.symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Cancel an order
   * @param {string} category - Order category
   * @param {string} symbol - Trading symbol
   * @param {string} [orderId] - Order ID (required if orderLinkId not provided)
   * @param {string} [orderLinkId] - Custom order ID (required if orderId not provided)
   * @returns {Promise<Object>} - Cancel result
   */
  async cancelOrder(category, symbol, orderId, orderLinkId) {
    try {
      return await this.orderManager.cancelOrder(category, symbol, orderId, orderLinkId);
    } catch (error) {
      this.logger.error(`Error canceling order for ${symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Get open orders
   * @param {string} category - Order category
   * @param {string} [symbol] - Trading symbol (optional)
   * @returns {Promise<Object>} - Open orders
   */
  async getOpenOrders(category, symbol = undefined) {
    try {
      return await this.orderManager.getOpenOrders(category, symbol);
    } catch (error) {
      this.logger.error('Error getting open orders:', error);
      throw error;
    }
  }
  
  /**
   * Get positions
   * @param {string} category - Position category (linear, inverse)
   * @param {string} [symbol] - Trading symbol (optional)
   * @returns {Promise<Object>} - Positions
   */
  async getPositions(category, symbol = undefined) {
    try {
      return await this.positionManager.getPositions(category, symbol, true);
    } catch (error) {
      this.logger.error('Error getting positions:', error);
      throw error;
    }
  }
  
  /**
   * Set leverage for a symbol
   * @param {string} category - Position category (linear, inverse)
   * @param {string} symbol - Trading symbol
   * @param {number} leverage - Leverage value
   * @returns {Promise<Object>} - Result
   */
  async setLeverage(category, symbol, leverage) {
    try {
      const leverageValue = leverage.toString();
      return await this.positionManager.setLeverage(category, symbol, leverageValue, leverageValue);
    } catch (error) {
      this.logger.error(`Error setting leverage for ${symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Get market data for a symbol
   * @param {string} symbol - Trading symbol
   * @param {string} category - Market category
   * @returns {Promise<Object>} - Market data
   */
  async getMarketData(symbol, category) {
    try {
      const tickers = await this.bybitClient.getTickers(category, symbol);
      
      if (!tickers || !tickers.list || tickers.list.length === 0) {
        throw new Error(`No ticker data for ${symbol}`);
      }
      
      return tickers.list[0];
    } catch (error) {
      this.logger.error(`Error getting market data for ${symbol}:`, error);
      throw error;
    }
  }
  
  /**
   * Get account information
   * @param {string} [accountType='UNIFIED'] - Account type
   * @returns {Promise<Object>} - Account information
   */
  async getAccountInfo(accountType = 'UNIFIED') {
    try {
      return await this.accountInfo.getWalletBalance(accountType);
    } catch (error) {
      this.logger.error('Error getting account info:', error);
      throw error;
    }
  }
  
  /**
   * Get all trading instances
   * @returns {Array} - Array of trading instances
   */
  getAllInstances() {
    return Array.from(this.tradingInstances.values());
  }
  
  /**
   * Get a specific trading instance
   * @param {string} symbol - Trading symbol
   * @param {string} timeframe - Candlestick timeframe
   * @returns {Object|null} - Trading instance or null if not found
   */
  getInstance(symbol, timeframe) {
    const key = `${symbol}-${timeframe}`;
    return this.tradingInstances.get(key) || null;
  }
  
  /**
   * Stop all trading instances
   */
  stopAll() {
    this.logger.info('Stopping all trading instances...');
    
    for (const instance of this.tradingInstances.values()) {
      if (instance.active) {
        instance.stop();
      }
    }
    
    // Close market data connections
    this.marketData.close();
    
    // Stop position monitoring
    this.positionManager.stopMonitoring();
    
    this.logger.info('All trading instances stopped');
  }
  
  /**
   * Log active positions across all instances
   */
  logAllActivePositions() {
    this.logger.info('=== ACTIVE POSITIONS ACROSS INSTANCES ===');
    
    let hasActivePositions = false;
    
    for (const instance of this.tradingInstances.values()) {
      if (instance.active && instance.jalgo) {
        const positions = instance.jalgo.getCurrentPositions();
        
        if (positions.inLongTrade || positions.inShortTrade) {
          hasActivePositions = true;
          instance.jalgo.logActivePosition();
        }
      }
    }
    
    if (!hasActivePositions) {
      this.logger.info('No active positions');
    }
    
    this.logger.info('============================================');
  }
  
  /**
   * Get performance statistics for all instances
   * @returns {Object} - Performance statistics
   */
  getPerformanceStats() {
    const statsByInstance = [];
    let totalPnl = 0;
    let totalTrades = 0;
    
    for (const instance of this.tradingInstances.values()) {
      if (instance.jalgo) {
        const stats = instance.jalgo.getPerformanceStats();
        
        statsByInstance.push({
          symbol: instance.symbol,
          timeframe: instance.timeframe,
          market: instance.market,
          totalTrades: stats.totalTrades,
          winRate: stats.overallWinRate,
          pnl: stats.totalProfitLoss,
          capital: stats.currentCapital
        });
        
        totalPnl += stats.totalProfitLoss;
        totalTrades += stats.totalTrades;
      }
    }
    
    return {
      instances: statsByInstance,
      totalInstances: this.tradingInstances.size,
      totalTrades,
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      timestamp: new Date().toISOString()
    };
  }
}

export default BybitLiveTrading;