/**
 * Bybit Order Manager
 * Handles order operations for the Bybit exchange
 */

/**
 * Creates a Bybit order manager
 * @param {Object} bybitClient - Initialized Bybit client
 * @returns {Object} - Order manager methods
 */
export const createOrderManager = (bybitClient, options = {}) => {
  if (!bybitClient) {
    throw new Error('Bybit client is required for order manager');
  }
  
  // Get options
  const isDemo = options.isDemo || false;
  
  // Track locally placed orders for reference
  const orderCache = new Map();
  
  // Log if in demo mode
  if (isDemo) {
    console.log('Order Manager initialized in DEMO mode - orders will use paper trading account');
  }
  
  return {
    /**
     * Create a market order
     * @param {string} category - Category: spot, linear, inverse
     * @param {string} symbol - Symbol to trade
     * @param {string} side - Order side: Buy or Sell
     * @param {string|number} qty - Order quantity
     * @param {Object} [options] - Additional order options
     * @returns {Promise<Object>} - Order result
     */
    createMarketOrder: async (category, symbol, side, qty, options = {}) => {
      try {
        const orderParams = {
          category,
          symbol,
          side,
          orderType: 'Market',
          qty: qty.toString(),
          ...options
        };
        
        const orderResult = await bybitClient.placeOrder(orderParams);
        
        // Cache the order
        if (orderResult && orderResult.orderId) {
          orderCache.set(orderResult.orderId, {
            ...orderParams,
            orderId: orderResult.orderId,
            orderLinkId: orderResult.orderLinkId,
            status: 'CREATED',
            createTime: Date.now()
          });
        }
        
        return orderResult;
      } catch (error) {
        console.error('Error creating market order:', error);
        throw error;
      }
    },
    
    /**
     * Create a limit order
     * @param {string} category - Category: spot, linear, inverse
     * @param {string} symbol - Symbol to trade
     * @param {string} side - Order side: Buy or Sell
     * @param {string|number} qty - Order quantity
     * @param {string|number} price - Order price
     * @param {string} [timeInForce='GTC'] - Time in force: GTC, IOC, FOK, PostOnly
     * @param {Object} [options] - Additional order options
     * @returns {Promise<Object>} - Order result
     */
    createLimitOrder: async (category, symbol, side, qty, price, timeInForce = 'GTC', options = {}) => {
      try {
        const orderParams = {
          category,
          symbol,
          side,
          orderType: 'Limit',
          qty: qty.toString(),
          price: price.toString(),
          timeInForce,
          ...options
        };
        
        const orderResult = await bybitClient.placeOrder(orderParams);
        
        // Cache the order
        if (orderResult && orderResult.orderId) {
          orderCache.set(orderResult.orderId, {
            ...orderParams,
            orderId: orderResult.orderId,
            orderLinkId: orderResult.orderLinkId,
            status: 'CREATED',
            createTime: Date.now()
          });
        }
        
        return orderResult;
      } catch (error) {
        console.error('Error creating limit order:', error);
        throw error;
      }
    },
    
    /**
     * Cancel an order
     * @param {string} category - Category: spot, linear, inverse
     * @param {string} symbol - Symbol
     * @param {string} [orderId] - Order ID (required if orderLinkId not provided)
     * @param {string} [orderLinkId] - Custom order ID (required if orderId not provided)
     * @returns {Promise<Object>} - Cancel result
     */
    cancelOrder: async (category, symbol, orderId, orderLinkId) => {
      try {
        const result = await bybitClient.cancelOrder(category, symbol, orderId, orderLinkId);
        
        // Update local cache
        if (orderId && orderCache.has(orderId)) {
          const cachedOrder = orderCache.get(orderId);
          orderCache.set(orderId, {
            ...cachedOrder,
            status: 'CANCELED',
            updateTime: Date.now()
          });
        }
        
        return result;
      } catch (error) {
        console.error('Error canceling order:', error);
        throw error;
      }
    },
    
    /**
     * Cancel all open orders for a symbol
     * @param {string} category - Category: spot, linear, inverse
     * @param {string} [symbol] - Symbol to cancel orders for (optional)
     * @returns {Promise<Object>} - Batch cancel result
     */
    cancelAllOrders: async (category, symbol = undefined) => {
      try {
        const params = { category };
        if (symbol) params.symbol = symbol;
        
        const response = await bybitClient.rest.cancelAllOrders(params);
        
        if (response.retCode !== 0) {
          throw new Error(`Bybit API error: ${response.retCode} - ${response.retMsg}`);
        }
        
        // Update local cache for all canceled orders
        if (response.result && response.result.list) {
          response.result.list.forEach(order => {
            if (order.orderId && orderCache.has(order.orderId)) {
              const cachedOrder = orderCache.get(order.orderId);
              orderCache.set(order.orderId, {
                ...cachedOrder,
                status: 'CANCELED',
                updateTime: Date.now()
              });
            }
          });
        }
        
        return response.result;
      } catch (error) {
        console.error('Error canceling all orders:', error);
        throw error;
      }
    },
    
    /**
     * Get open orders for a symbol or all symbols
     * @param {string} category - Category: spot, linear, inverse
     * @param {string} [symbol] - Symbol to get orders for (optional)
     * @returns {Promise<Object>} - Open orders
     */
    getOpenOrders: async (category, symbol = undefined) => {
      try {
        return await bybitClient.getOpenOrders(category, symbol);
      } catch (error) {
        console.error('Error getting open orders:', error);
        throw error;
      }
    },
    
    /**
     * Get order history
     * @param {string} category - Category: spot, linear, inverse
     * @param {string} [symbol] - Symbol to get order history for (optional)
     * @param {Object} [options] - Additional parameters
     * @returns {Promise<Object>} - Order history
     */
    getOrderHistory: async (category, symbol = undefined, options = {}) => {
      try {
        const params = { ...options };
        if (symbol) params.symbol = symbol;
        
        return await bybitClient.getOrderHistory(category, params);
      } catch (error) {
        console.error('Error getting order history:', error);
        throw error;
      }
    },
    
    /**
     * Create a take profit/stop loss order
     * @param {string} category - Category: linear, inverse
     * @param {string} symbol - Symbol to trade
     * @param {string} side - Order side: Buy or Sell
     * @param {string|number} qty - Order quantity
     * @param {string|number} triggerPrice - Trigger price
     * @param {string|number} [price] - Order price (for limit orders)
     * @param {string} [triggerBy='LastPrice'] - Trigger price type: LastPrice, MarkPrice, IndexPrice
     * @param {string} [orderType='Market'] - Order type: Market or Limit
     * @param {Object} [options] - Additional order options
     * @returns {Promise<Object>} - Order result
     */
    createTPSLOrder: async (category, symbol, side, qty, triggerPrice, price = undefined, triggerBy = 'LastPrice', orderType = 'Market', options = {}) => {
      try {
        const orderParams = {
          category,
          symbol,
          side,
          orderType: orderType,
          qty: qty.toString(),
          triggerPrice: triggerPrice.toString(),
          triggerBy,
          positionIdx: 0, // Default position for one-way mode
          timeInForce: 'GTC',
          reduceOnly: true, // TP/SL orders should be reduce-only
          closeOnTrigger: true,
          ...options
        };
        
        // Add price for limit orders
        if (orderType === 'Limit' && price) {
          orderParams.price = price.toString();
        }
        
        const orderResult = await bybitClient.placeOrder(orderParams);
        
        // Cache the order
        if (orderResult && orderResult.orderId) {
          orderCache.set(orderResult.orderId, {
            ...orderParams,
            orderId: orderResult.orderId,
            orderLinkId: orderResult.orderLinkId,
            status: 'CREATED',
            createTime: Date.now()
          });
        }
        
        return orderResult;
      } catch (error) {
        console.error('Error creating TP/SL order:', error);
        throw error;
      }
    },
    
    /**
     * Get the local order cache
     * @returns {Map} - Order cache
     */
    getOrderCache: () => {
      return orderCache;
    },
    
    /**
     * Clear the order cache
     */
    clearOrderCache: () => {
      orderCache.clear();
    }
  };
};

export default createOrderManager;