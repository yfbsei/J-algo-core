/**
 * Bybit API Client Wrapper
 * Handles authentication and API interaction with Bybit
 */

import { RestClientV5 } from 'bybit-api';
import crypto from 'crypto';

/**
 * Creates a Bybit API client
 * @param {Object} config - Client configuration
 * @param {string} config.apiKey - Bybit API key
 * @param {string} config.apiSecret - Bybit API secret
 * @param {boolean} config.isDemo - Whether to use demo trading (false for live trading)
 * @param {boolean} config.enableDebug - Enable debug logging
 * @returns {Object} - Bybit API client
 */
export const createBybitClient = (config = {}) => {
  const { apiKey, apiSecret, isDemo = false, enableDebug = false } = config;
  
  if (!apiKey || !apiSecret) {
    throw new Error('API key and secret are required for Bybit client');
  }

  // Create the Bybit REST client
  const restClient = new RestClientV5({
    key: apiKey,
    secret: apiSecret,
    testnet: false, // Always use mainnet (even for demo trading)
    recv_window: 5000, // 5 seconds
    enable_time_sync: true, // Auto-sync time
    strict_param_validation: true,
    disable_brackets_parsing: false,
    // Add custom crypto provider for Node.js environment
    cryptoProvider: { 
      hmac: (message, secret) => {
        return crypto.createHmac('sha256', secret)
          .update(message)
          .digest('hex');
      }
    }
  });

  // Enable debug logging if needed
  if (enableDebug) {
    console.log('Debug logging enabled for Bybit client');
    // Note: bybit-api doesn't have a setLogLevel method, we'll use console logging instead
  }
  
  // Log trading mode
  console.log(`Initializing Bybit client in ${isDemo ? 'DEMO (paper trading)' : 'LIVE trading'} mode`);
  console.log('IMPORTANT: Demo/Live mode is determined by the API keys, not by a client setting');

  return {
    rest: restClient,
    
    /**
     * Get wallet balance
     * @param {string} [accountType='UNIFIED'] - Account type: UNIFIED, CONTRACT, SPOT, OPTION, INVESTMENT
     * @param {string} [coin] - Specific coin to query
     * @returns {Promise<Object>} - Wallet information
     */
    getWalletBalance: async (accountType = 'UNIFIED', coin = undefined) => {
      try {
        const params = { accountType };
        if (coin) params.coin = coin;
        
        const response = await restClient.getWalletBalance(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting wallet balance:', error);
        throw error;
      }
    },
    
    /**
     * Get positions for a symbol or all positions
     * @param {string} category - Category: linear, inverse, spot
     * @param {string} [symbol] - Symbol to query
     * @returns {Promise<Object>} - Position information
     */
    getPositions: async (category, symbol = undefined) => {
      try {
        const params = { category };
        if (symbol) params.symbol = symbol;
        
        const response = await restClient.getPositionInfo(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting positions:', error);
        throw error;
      }
    },
    
    /**
     * Place an order
     * @param {Object} orderParams - Order parameters
     * @returns {Promise<Object>} - Order response
     */
    placeOrder: async (orderParams) => {
      try {
        // Demo trading is handled at account/API key level in Bybit
        // so we don't need special handling here
        const response = await restClient.submitOrder(orderParams);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error placing order:', error);
        throw error;
      }
    },
    
    /**
     * Cancel an order
     * @param {string} category - Order category: spot, linear, inverse, option
     * @param {string} symbol - Trading pair symbol
     * @param {string} [orderId] - Order ID (required if orderLinkId not provided)
     * @param {string} [orderLinkId] - Custom order ID (required if orderId not provided)
     * @returns {Promise<Object>} - Cancel result
     */
    cancelOrder: async (category, symbol, orderId, orderLinkId) => {
      try {
        if (!orderId && !orderLinkId) {
          throw new Error('Either orderId or orderLinkId must be provided');
        }
        
        const params = { category, symbol };
        if (orderId) params.orderId = orderId;
        if (orderLinkId) params.orderLinkId = orderLinkId;
        
        const response = await restClient.cancelOrder(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error canceling order:', error);
        throw error;
      }
    },
    
    /**
     * Get open orders
     * @param {string} category - Order category
     * @param {string} [symbol] - Trading pair symbol
     * @returns {Promise<Object>} - Open orders
     */
    getOpenOrders: async (category, symbol = undefined) => {
      try {
        const params = { category };
        if (symbol) params.symbol = symbol;
        
        const response = await restClient.getActiveOrders(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting open orders:', error);
        throw error;
      }
    },
    
    /**
     * Get instruments info (symbols, ticks, etc.)
     * @param {string} category - Category: spot, linear, inverse, option
     * @param {string} [symbol] - Symbol to query
     * @returns {Promise<Object>} - Instruments info
     */
    getInstrumentsInfo: async (category, symbol = undefined) => {
      try {
        const params = { category };
        if (symbol) params.symbol = symbol;
        
        const response = await restClient.getInstrumentsInfo(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting instruments info:', error);
        throw error;
      }
    },
    
    /**
     * Get ticker information
     * @param {string} category - Category: spot, linear, inverse, option
     * @param {string} [symbol] - Symbol to query
     * @returns {Promise<Object>} - Ticker info
     */
    getTickers: async (category, symbol = undefined) => {
      try {
        const params = { category };
        if (symbol) params.symbol = symbol;
        
        const response = await restClient.getTickers(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting tickers:', error);
        throw error;
      }
    },
    
    /**
     * Set leverage for a symbol (futures only)
     * @param {string} category - Category: linear, inverse
     * @param {string} symbol - Symbol to set leverage for
     * @param {string|number} buyLeverage - Buy side leverage
     * @param {string|number} sellLeverage - Sell side leverage
     * @returns {Promise<Object>} - Set leverage result
     */
    setLeverage: async (category, symbol, buyLeverage, sellLeverage) => {
      try {
        const params = {
          category,
          symbol,
          buyLeverage: buyLeverage.toString(),
          sellLeverage: sellLeverage.toString()
        };
        
        const response = await restClient.setLeverage(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error setting leverage:', error);
        throw error;
      }
    },
    
    /**
     * Get account information
     * @returns {Promise<Object>} - Account info
     */
    getAccountInfo: async () => {
      try {
        const response = await restClient.getAccountInfo();
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting account info:', error);
        throw error;
      }
    },
    
    /**
     * Get order history
     * @param {string} category - Category: spot, linear, inverse, option
     * @param {Object} [params] - Additional parameters
     * @returns {Promise<Object>} - Order history
     */
    getOrderHistory: async (category, params = {}) => {
      try {
        const requestParams = { 
          category,
          ...params
        };
        
        const response = await restClient.getHistoricOrders(requestParams);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        return response.result;
      } catch (error) {
        console.error('Error getting order history:', error);
        throw error;
      }
    }
  };
};

export default createBybitClient;