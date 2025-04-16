/**
 * Bybit Market Data Handler
 * Handles market data from Bybit exchange
 */

import WebSocket from 'ws';
import bybit_candles from '../../src/utility/bybit-market.js';

/**
 * Creates a Bybit market data handler
 * @param {Object} options - Configuration options
 * @returns {Object} - Market data handler methods
 */
export const createMarketDataHandler = (options = {}) => {
  // Default options
  const defaultOptions = {
    pingInterval: 20000, // 20 seconds (Bybit requires ping every 30 seconds)
    reconnectDelay: 5000, // 5 seconds delay before reconnecting
    maxReconnectAttempts: 10,
  };
  
  const config = { ...defaultOptions, ...options };
  
  // WebSocket connections (per market)
  const wsConnections = new Map();
  const pingIntervals = new Map();
  const reconnectCounts = new Map();
  
  // Subscriptions tracking
  const subscriptions = new Map(); // market -> Set of channels
  
  // Callbacks
  const candleCallbacks = new Map();
  const tickerCallbacks = new Map();
  
  /**
   * Get the WebSocket base URL with fallback options
   * @param {string} market - Market type (spot, linear, inverse)
   * @param {number} [attempt=0] - Connection attempt number
   * @returns {string} - WebSocket URL
   */
  const getWebSocketUrl = (market, attempt = 0) => {
    // Default endpoints - UPDATED based on diagnostic results
    // Only use endpoints that have been confirmed working
    const endpoints = {
      spot: [
        'wss://stream.bybit.com/v5/public/spot',
        'wss://stream.bytick.com/v5/public/spot'
      ],
      linear: [
        'wss://stream.bybit.com/v5/public/linear',
        'wss://stream.bytick.com/v5/public/linear'
      ],
      inverse: [
        'wss://stream.bybit.com/v5/public/inverse',
        'wss://stream.bytick.com/v5/public/inverse'
      ]
    };
    
    // If preferred URLs are provided in the options, use them first
    if (config.preferredWebSocketUrls && config.preferredWebSocketUrls[market]) {
      return config.preferredWebSocketUrls[market];
    }
    
    // Get available endpoints for this market
    const marketEndpoints = endpoints[market] || endpoints.linear;
    
    // Rotate through available endpoints based on attempt number
    const index = attempt % marketEndpoints.length;
    const endpoint = marketEndpoints[index];
    
    console.log(`[WS-${market}] Using endpoint (attempt ${attempt}): ${endpoint}`);
    return endpoint;
  };
  
/**
   * Connect to WebSocket for a specific market
   * @param {string} market - Market type (spot, linear, inverse)
   */
const connect = (market) => {
  try {
    // If connection already exists, close it
    if (wsConnections.has(market)) {
      const ws = wsConnections.get(market);
      if (ws) {
        try {
          console.log(`[WS-${market}] Terminating existing connection (state: ${ws.readyState})`);
          ws.terminate();
        } catch (err) {
          console.error(`[WS-${market}] Error terminating WebSocket:`, err);
        }
      }
      
      // Clear ping interval
      if (pingIntervals.has(market)) {
        console.log(`[WS-${market}] Clearing ping interval`);
        clearInterval(pingIntervals.get(market));
        pingIntervals.delete(market);
      }
    }
    
    // Initialize reconnect count if needed
    if (!reconnectCounts.has(market)) {
      reconnectCounts.set(market, 0);
    }
    
    // Get WebSocket URL for this market
    const wsUrl = getWebSocketUrl(market);
    console.log(`[WS-${market}] Connecting to Bybit WebSocket at ${wsUrl}...`);
    
    // Create new connection with error handling
    let ws;
    try {
      // Log DNS lookup before connecting
      const urlObj = new URL(wsUrl);
      console.log(`[WS-${market}] Resolving hostname: ${urlObj.hostname}`);
      
      ws = new WebSocket(wsUrl);
      wsConnections.set(market, ws);
      console.log(`[WS-${market}] WebSocket instance created`);
    } catch (err) {
      console.error(`[WS-${market}] Failed to create WebSocket:`, err);
      // Schedule reconnect
      setTimeout(() => connect(market), config.reconnectDelay);
      return;
    }
    
    // Set timeout for connection
    const connectionTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        console.error(`[WS-${market}] Connection timeout after 10 seconds (state: ${ws.readyState})`);
        try {
          ws.terminate();
        } catch (err) {
          console.error(`[WS-${market}] Error terminating timed-out connection:`, err);
        }
        // Connection will be retried in the close event handler
      }
    }, 10000); // 10 second connection timeout
    
    // Track state changes
    const originalReadyState = ws.readyState;
    console.log(`[WS-${market}] Initial readyState: ${originalReadyState}`);
    
    // Monitor readyState changes
    const readyStateInterval = setInterval(() => {
      if (ws && ws.readyState !== originalReadyState) {
        console.log(`[WS-${market}] ReadyState changed: ${originalReadyState} -> ${ws.readyState}`);
        clearInterval(readyStateInterval);
      }
    }, 500);
    
    // Clear interval after 15 seconds regardless
    setTimeout(() => {
      clearInterval(readyStateInterval);
    }, 15000);
    
    ws.on('open', () => {
      clearTimeout(connectionTimeout);
      clearInterval(readyStateInterval);
      console.log(`[WS-${market}] Connection opened successfully`);
      reconnectCounts.set(market, 0);
      
      // Resubscribe to channels for this market
      resubscribe(market);
      
      // Set up ping interval
      const pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          console.log(`[WS-${market}] Sending ping...`);
          try {
            ws.send(JSON.stringify({ op: 'ping' }));
          } catch (err) {
            console.error(`[WS-${market}] Error sending ping:`, err);
            
            // If we can't send a ping, the connection might be broken
            if (ws.readyState === WebSocket.OPEN) {
              console.log(`[WS-${market}] Connection appears broken despite OPEN state, terminating...`);
              ws.terminate();
            }
          }
        } else if (ws) {
          console.log(`[WS-${market}] Cannot send ping, connection not open (state: ${ws.readyState})`);
        }
      }, config.pingInterval);
      
      pingIntervals.set(market, pingInterval);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        // Handle pong message
        if (message.op === 'pong') {
          console.log(`[WS-${market}] Received pong response`);
          return;
        }
        
        // Handle subscription success
        if (message.op === 'subscribe') {
          if (message.success) {
            console.log(`[WS-${market}] Successfully subscribed to channels:`, message.args || []);
            
            // Clear subscription timeout if it exists
            if (ws._subTimeout) {
              clearTimeout(ws._subTimeout);
              ws._subTimeout = null;
            }
          } else {
            console.error(`[WS-${market}] Subscription failed:`, message);
          }
          return;
        }
        
        // Handle data messages
        if (message.topic) {
          // Just log the topic for debugging, don't log the entire message (too verbose)
          console.log(`[WS-${market}] Received data for topic: ${message.topic}`);
          
          // Kline/candlestick data
          if (message.topic.includes('kline')) {
            handleKlineMessage(message);
          }
          // Tickers
          else if (message.topic.includes('tickers')) {
            handleTickerMessage(message);
          }
        }
      } catch (error) {
        console.error(`[WS-${market}] Error processing message:`, error);
        console.error(`[WS-${market}] Raw message:`, data.toString().substring(0, 200) + '...');
      }
    });
    
    ws.on('error', (error) => {
      clearTimeout(connectionTimeout);
      clearInterval(readyStateInterval);
      console.error(`[WS-${market}] WebSocket error:`, error);
      
      // Check connection properties
      if (ws) {
        console.log(`[WS-${market}] Connection state at error: ${ws.readyState}`);
        console.log(`[WS-${market}] Connection details:`, {
          bufferedAmount: ws.bufferedAmount,
          protocol: ws.protocol || 'none'
        });
      }
      
      // Auto-reconnect will be handled by 'close' event
    });
    
    ws.on('close', (code, reason) => {
      clearTimeout(connectionTimeout);
      clearInterval(readyStateInterval);
      console.log(`[WS-${market}] Connection closed with code ${code}${reason ? ': ' + reason : ''}`);
      
      // Clear ping interval
      if (pingIntervals.has(market)) {
        clearInterval(pingIntervals.get(market));
        pingIntervals.delete(market);
      }
      
      // Reconnect logic
      const reconnectCount = reconnectCounts.get(market) || 0;
      reconnectCounts.set(market, reconnectCount + 1);
      
      if (reconnectCount < config.maxReconnectAttempts) {
        // Use fixed reconnect delay to avoid IPv6/connectivity issues
        const reconnectDelay = 5000; // Fixed 5 second delay
        console.log(`[WS-${market}] Reconnecting in ${reconnectDelay}ms (attempt ${reconnectCount + 1}/${config.maxReconnectAttempts})...`);
        
        setTimeout(() => {
          connect(market);
        }, reconnectDelay);
      } else {
        console.error(`[WS-${market}] Failed to reconnect after ${config.maxReconnectAttempts} attempts`);
        
        // Try an alternative WebSocket URL approach
        console.log(`[WS-${market}] Attempting alternative connection approach...`);
        
        // Reset reconnect count so we can try again with the new approach
        reconnectCounts.set(market, 0);
        
        // Try to connect with explicit IPv4 DNS resolution
        setTimeout(() => {
          // Will use the original connection method, but with reset counter
          connect(market);
        }, 10000); // Wait 10 seconds before trying again
      }
    });
    
  } catch (error) {
    console.error(`[WS-${market}] Error setting up connection:`, error);
    
    // Schedule reconnect
    setTimeout(() => connect(market), config.reconnectDelay);
  }
};
  
/**
   * Resubscribe to all channels for a market after reconnect
   * @param {string} market - Market type
   */
const resubscribe = (market) => {
  const ws = wsConnections.get(market);
  if (!ws) {
    console.warn(`[WS-${market}] Cannot resubscribe: No WebSocket instance found`);
    return;
  }
  
  if (ws.readyState !== WebSocket.OPEN) {
    console.warn(`[WS-${market}] Cannot resubscribe: WebSocket not open (state: ${ws.readyState})`);
    return;
  }
  
  // Get channels for this market
  const channels = subscriptions.get(market);
  if (!channels || channels.size === 0) {
    console.log(`[WS-${market}] No channels to resubscribe`);
    return;
  }
  
  // Convert to array and subscribe
  const channelArray = Array.from(channels);
  if (channelArray.length > 0) {
    try {
      console.log(`[WS-${market}] Sending subscription request for ${channelArray.length} channels:`, channelArray);
      
      const subMsg = JSON.stringify({
        op: 'subscribe',
        args: channelArray
      });
      
      // Add a confirmation step to make sure the message is sent
      const bytesSent = ws.send(subMsg);
      console.log(`[WS-${market}] Subscription message sent. Buffered amount: ${ws.bufferedAmount}`);
      
      // Setup a timeout to detect if subscription acknowledgement isn't received
      const subTimeout = setTimeout(() => {
        console.warn(`[WS-${market}] No subscription acknowledgement received within 5 seconds`);
        // Consider reconnecting if no acknowledgement received
      }, 5000);
      
      // Store the timeout so we can clear it when acknowledgement is received
      ws._subTimeout = subTimeout;
    } catch (error) {
      console.error(`[WS-${market}] Error resubscribing to channels:`, error);
      // If we can't send subscription, the connection might be broken
      if (ws.readyState === WebSocket.OPEN) {
        console.log(`[WS-${market}] Connection appears broken despite OPEN state, terminating...`);
        setTimeout(() => ws.terminate(), 100);
      }
    }
  }
};
  
  /**
   * Handle kline/candlestick messages
   * @param {Object} message - WebSocket message
   */
  const handleKlineMessage = (message) => {
    try {
      if (!message.data || !Array.isArray(message.data)) {
        return;
      }
      
      // Format for Bybit: "kline.{interval}.{symbol}"
      const parts = message.topic.split('.');
      if (parts.length !== 3) return;
      
      const interval = parts[1];
      const symbol = parts[2];
      const key = `${symbol}-${interval}`;
      
      // Process each candle
      message.data.forEach(candle => {
        // Create standardized candle format (matching Jalgo's expectation)
        const standardCandle = {
          t: parseInt(candle.start),
          o: candle.open,
          h: candle.high,
          l: candle.low,
          c: candle.close,
          v: candle.volume,
          x: candle.confirm // candle closed
        };
        
        // Notify all callbacks for this symbol+interval
        if (candleCallbacks.has(key)) {
          candleCallbacks.get(key).forEach(callback => {
            try {
              callback(standardCandle);
            } catch (err) {
              console.error(`Error in candle callback for ${key}:`, err);
            }
          });
        }
      });
    } catch (error) {
      console.error('Error handling kline message:', error);
    }
  };
  
  /**
   * Handle ticker messages
   * @param {Object} message - WebSocket message
   */
  const handleTickerMessage = (message) => {
    try {
      if (!message.data) {
        return;
      }
      
      // Format for Bybit: "tickers.{symbol}"
      const parts = message.topic.split('.');
      if (parts.length !== 2) return;
      
      const symbol = parts[1];
      
      // Notify all callbacks for this symbol
      if (tickerCallbacks.has(symbol)) {
        tickerCallbacks.get(symbol).forEach(callback => {
          try {
            callback(message.data);
          } catch (err) {
            console.error(`Error in ticker callback for ${symbol}:`, err);
          }
        });
      }
    } catch (error) {
      console.error('Error handling ticker message:', error);
    }
  };
  
  return {
    /**
     * Fetch historical candles from Bybit
     * @param {string} market - Market type: "spot" or "futures"
     * @param {string} symbol - Trading pair symbol e.g. "BTCUSDT"
     * @param {string} interval - Candlestick interval e.g. "5m"
     * @param {number} limit - Number of candles to fetch
     * @returns {Promise<Object>} - Promise resolving to OHLCV data
     */
    getHistoricalCandles: async (market, symbol, interval, limit) => {
      try {
        // Properly map internal market types to what bybit_candles expects:
        // - 'linear' and 'inverse' should be mapped to 'futures'
        // - 'spot' remains as 'spot'
        let mappedMarket;
        if (market === 'linear' || market === 'inverse') {
          mappedMarket = 'futures';
        } else if (market === 'spot') {
          mappedMarket = 'spot';
        } else {
          // Default to 'futures' if unknown
          console.warn(`Unknown market type "${market}" - defaulting to "futures"`);
          mappedMarket = 'futures';
        }
        
        console.log(`Fetching historical candles for ${symbol} (${market} -> ${mappedMarket})`);
        return await bybit_candles(mappedMarket, symbol, interval, limit);
      } catch (error) {
        console.error('Error fetching historical candles:', error);
        throw error;
      }
    },
    
    /**
     * Subscribe to real-time candlestick data
     * @param {string} market - Market type: spot, linear, inverse
     * @param {string} symbol - Trading pair symbol e.g. "BTCUSDT"
     * @param {string} interval - Candlestick interval
     * @param {Function} callback - Callback function for candle updates
     * @returns {boolean} - Success status
     */
    subscribeToCandlesticks: (market, symbol, interval, callback) => {
      try {
        // Ensure connection exists for this market
        if (!wsConnections.has(market) || wsConnections.get(market).readyState !== WebSocket.OPEN) {
          connect(market);
        }
        
        const channelName = `kline.${interval}.${symbol}`;
        
        // Add to subscriptions map for this market
        if (!subscriptions.has(market)) {
          subscriptions.set(market, new Set());
        }
        subscriptions.get(market).add(channelName);
        
        // Add the callback
        const key = `${symbol}-${interval}`;
        if (!candleCallbacks.has(key)) {
          candleCallbacks.set(key, new Set());
        }
        candleCallbacks.get(key).add(callback);
        
        // Subscribe if already connected
        const ws = wsConnections.get(market);
        if (ws && ws.readyState === WebSocket.OPEN) {
          const subMsg = JSON.stringify({
            op: 'subscribe',
            args: [channelName]
          });
          ws.send(subMsg);
        }
        
        return true;
      } catch (error) {
        console.error('Error subscribing to candlesticks:', error);
        return false;
      }
    },
    
    /**
     * Unsubscribe from candlestick data
     * @param {string} symbol - Trading pair symbol
     * @param {string} interval - Candlestick interval
     * @param {Function} [callback] - Specific callback to remove (if not provided, removes all)
     * @returns {boolean} - Success status
     */
    unsubscribeFromCandlesticks: (symbol, interval, callback = undefined) => {
      try {
        const key = `${symbol}-${interval}`;
        const channelName = `kline.${interval}.${symbol}`;
        
        // Find which market this subscription belongs to
        let foundMarket = null;
        for (const [market, channels] of subscriptions.entries()) {
          if (channels.has(channelName)) {
            foundMarket = market;
            break;
          }
        }
        
        if (!foundMarket) {
          console.warn(`No subscription found for ${channelName}`);
          return false;
        }
        
        if (callback && candleCallbacks.has(key)) {
          // Remove specific callback
          candleCallbacks.get(key).delete(callback);
          
          // If no callbacks left, remove channel
          if (candleCallbacks.get(key).size === 0) {
            candleCallbacks.delete(key);
            subscriptions.get(foundMarket).delete(channelName);
          }
        } else {
          // Remove all callbacks for this key
          candleCallbacks.delete(key);
          subscriptions.get(foundMarket).delete(channelName);
        }
        
        // Unsubscribe from the channel if connected
        const ws = wsConnections.get(foundMarket);
        if (ws && ws.readyState === WebSocket.OPEN) {
          const unsubMsg = JSON.stringify({
            op: 'unsubscribe',
            args: [channelName]
          });
          ws.send(unsubMsg);
        }
        
        return true;
      } catch (error) {
        console.error('Error unsubscribing from candlesticks:', error);
        return false;
      }
    },
    
    /**
     * Subscribe to ticker data
     * @param {string} market - Market type: spot, linear, inverse
     * @param {string} symbol - Trading pair symbol
     * @param {Function} callback - Callback function for ticker updates
     * @returns {boolean} - Success status
     */
    subscribeToTickers: (market, symbol, callback) => {
      try {
        // Ensure connection exists for this market
        if (!wsConnections.has(market) || wsConnections.get(market).readyState !== WebSocket.OPEN) {
          connect(market);
        }
        
        const channelName = `tickers.${symbol}`;
        
        // Add to subscriptions map for this market
        if (!subscriptions.has(market)) {
          subscriptions.set(market, new Set());
        }
        subscriptions.get(market).add(channelName);
        
        // Add the callback
        if (!tickerCallbacks.has(symbol)) {
          tickerCallbacks.set(symbol, new Set());
        }
        tickerCallbacks.get(symbol).add(callback);
        
        // Subscribe if already connected
        const ws = wsConnections.get(market);
        if (ws && ws.readyState === WebSocket.OPEN) {
          const subMsg = JSON.stringify({
            op: 'subscribe',
            args: [channelName]
          });
          ws.send(subMsg);
        }
        
        return true;
      } catch (error) {
        console.error('Error subscribing to tickers:', error);
        return false;
      }
    },
    
    /**
     * Unsubscribe from ticker data
     * @param {string} symbol - Trading pair symbol
     * @param {Function} [callback] - Specific callback to remove (if not provided, removes all)
     * @returns {boolean} - Success status
     */
    unsubscribeFromTickers: (symbol, callback = undefined) => {
      try {
        const channelName = `tickers.${symbol}`;
        
        // Find which market this subscription belongs to
        let foundMarket = null;
        for (const [market, channels] of subscriptions.entries()) {
          if (channels.has(channelName)) {
            foundMarket = market;
            break;
          }
        }
        
        if (!foundMarket) {
          console.warn(`No subscription found for ${channelName}`);
          return false;
        }
        
        if (callback && tickerCallbacks.has(symbol)) {
          // Remove specific callback
          tickerCallbacks.get(symbol).delete(callback);
          
          // If no callbacks left, remove channel
          if (tickerCallbacks.get(symbol).size === 0) {
            tickerCallbacks.delete(symbol);
            subscriptions.get(foundMarket).delete(channelName);
          }
        } else {
          // Remove all callbacks for this symbol
          tickerCallbacks.delete(symbol);
          subscriptions.get(foundMarket).delete(channelName);
        }
        
        // Unsubscribe from the channel if connected
        const ws = wsConnections.get(foundMarket);
        if (ws && ws.readyState === WebSocket.OPEN) {
          const unsubMsg = JSON.stringify({
            op: 'unsubscribe',
            args: [channelName]
          });
          ws.send(unsubMsg);
        }
        
        return true;
      } catch (error) {
        console.error('Error unsubscribing from tickers:', error);
        return false;
      }
    },
    
    /**
     * Close all WebSocket connections
     */
    close: () => {
      // Clear all ping intervals
      for (const interval of pingIntervals.values()) {
        clearInterval(interval);
      }
      pingIntervals.clear();
      
      // Close all WebSocket connections
      for (const [market, ws] of wsConnections.entries()) {
        try {
          if (ws) {
            ws.terminate();
            console.log(`Closed WebSocket connection for ${market}`);
          }
        } catch (error) {
          console.error(`Error closing WebSocket for ${market}:`, error);
        }
      }
      
      wsConnections.clear();
      
      // Clear subscriptions and callbacks
      subscriptions.clear();
      candleCallbacks.clear();
      tickerCallbacks.clear();
      
      console.log('All market data connections closed');
    }
  };
};

export default createMarketDataHandler;