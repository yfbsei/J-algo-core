/**
 * Bybit Market Data Handler
 * Handles market data from Bybit exchange
 */

import WebSocket from 'ws';
import bybit_candles from '../../src/utility/bybit-market.js';
// import { formatWebSocketCandle } from '../../../src/utility/market-provider.js';

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
  
  // WebSocket connection
  let ws = null;
  let pingInterval = null;
  let reconnectCount = 0;
  
  // Subscriptions tracking
  const subscriptions = new Set();
  
  // Callbacks
  const candleCallbacks = new Map();
  const tickerCallbacks = new Map();
  
  /**
   * Get the WebSocket base URL
   * @param {string} market - Market type (spot, linear, inverse)
   * @returns {string} - WebSocket URL
   */
  const getWebSocketUrl = (market) => {
    // Bybit always uses mainnet URL for demo and live
    switch (market) {
      case 'spot':
        return 'wss://stream.bybit.com/v5/public/spot';
      case 'linear':
        return 'wss://stream.bybit.com/v5/public/linear';
      case 'inverse':
        return 'wss://stream.bybit.com/v5/public/inverse';
      default:
        throw new Error(`Unsupported market type: ${market}`);
    }
  };
  
  /**
   * Connect to WebSocket
   * @param {string} market - Market type (spot, linear, inverse)
   */
  const connect = (market) => {
    try {
      if (ws) {
        // Close existing connection
        ws.terminate();
      }
      
      ws = new WebSocket(getWebSocketUrl(market));
      
      ws.on('open', () => {
        console.log(`Connected to Bybit ${market} WebSocket`);
        reconnectCount = 0;
        
        // Resubscribe to channels
        resubscribe();
        
        // Set up ping interval
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, config.pingInterval);
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          
          // Handle pong message
          if (message.op === 'pong') {
            return;
          }
          
          // Handle subscription success
          if (message.op === 'subscribe' && message.success) {
            console.log(`Successfully subscribed to ${message.args && Array.isArray(message.args) ? message.args.join(', ') : 'channels'}`);
            return;
          }
          
          // Handle data messages
          if (message.topic) {
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
          console.error('Error processing WebSocket message:', error);
        }
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        // Auto-reconnect will be handled by 'close' event
      });
      
      ws.on('close', () => {
        console.log('WebSocket connection closed');
        
        // Clear ping interval
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        
        // Reconnect logic
        reconnectCount++;
        if (reconnectCount <= config.maxReconnectAttempts) {
          const reconnectDelay = config.reconnectDelay * Math.pow(1.5, reconnectCount - 1);
          console.log(`Reconnecting in ${reconnectDelay}ms (attempt ${reconnectCount}/${config.maxReconnectAttempts})...`);
          
          setTimeout(() => {
            connect(market);
          }, reconnectDelay);
        } else {
          console.error(`Failed to reconnect after ${config.maxReconnectAttempts} attempts`);
        }
      });
      
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  };
  
  /**
   * Resubscribe to all channels after reconnect
   */
  const resubscribe = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    
    if (subscriptions.size > 0) {
      const subscriptionArray = Array.from(subscriptions);
      if (subscriptionArray && subscriptionArray.length > 0) {
        const subMsg = JSON.stringify({
          op: 'subscribe',
          args: subscriptionArray
        });
        ws.send(subMsg);
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
        // Check if we're using 'linear' or 'inverse', map to 'futures'
        const mappedMarket = market === 'linear' || market === 'inverse' ? 'futures' : market;
        
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
        if (!ws) {
          connect(market);
        }
        
        const channelName = `kline.${interval}.${symbol}`;
        
        // Add to subscriptions set
        subscriptions.add(channelName);
        
        // Add the callback
        const key = `${symbol}-${interval}`;
        if (!candleCallbacks.has(key)) {
          candleCallbacks.set(key, new Set());
        }
        candleCallbacks.get(key).add(callback);
        
        // Subscribe if already connected
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
        
        if (callback && candleCallbacks.has(key)) {
          // Remove specific callback
          candleCallbacks.get(key).delete(callback);
          
          // If no callbacks left, remove channel
          if (candleCallbacks.get(key).size === 0) {
            candleCallbacks.delete(key);
            subscriptions.delete(channelName);
          }
        } else {
          // Remove all callbacks for this key
          candleCallbacks.delete(key);
          subscriptions.delete(channelName);
        }
        
        // Unsubscribe from the channel if connected
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
        if (!ws) {
          connect(market);
        }
        
        const channelName = `tickers.${symbol}`;
        
        // Add to subscriptions set
        subscriptions.add(channelName);
        
        // Add the callback
        if (!tickerCallbacks.has(symbol)) {
          tickerCallbacks.set(symbol, new Set());
        }
        tickerCallbacks.get(symbol).add(callback);
        
        // Subscribe if already connected
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
        
        if (callback && tickerCallbacks.has(symbol)) {
          // Remove specific callback
          tickerCallbacks.get(symbol).delete(callback);
          
          // If no callbacks left, remove channel
          if (tickerCallbacks.get(symbol).size === 0) {
            tickerCallbacks.delete(symbol);
            subscriptions.delete(channelName);
          }
        } else {
          // Remove all callbacks for this key
          tickerCallbacks.delete(symbol);
          subscriptions.delete(channelName);
        }
        
        // Unsubscribe from the channel if connected
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
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      
      if (ws) {
        ws.terminate();
        ws = null;
      }
      
      // Clear subscriptions and callbacks
      subscriptions.clear();
      candleCallbacks.clear();
      tickerCallbacks.clear();
      
      console.log('Market data connections closed');
    }
  };
};

export default createMarketDataHandler;