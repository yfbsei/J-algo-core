/**
 * WebSocket Client Implementation for Real-time Trend Sniper
 * 
 * This implementation connects to a WebSocket server to receive market data
 * and processes it using the RealTimeTrendSniper indicator.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const RealTimeTrendSniper = require('./websocket-trend-sniper');

/**
 * WebSocket Client for processing real-time market data
 */
class TrendSniperWSClient {
  /**
   * Create a new TrendSniperWSClient
   * @param {Object} config - Configuration object
   */
  constructor(config = {}) {
    // Default configuration
    this.config = {
      // WebSocket settings
      wsUrl: null,                    // WebSocket server URL
      reconnectInterval: 5000,        // Reconnect interval in milliseconds
      pingInterval: 30000,            // Ping interval in milliseconds
      
      // Market data settings
      symbol: null,                   // Trading symbol
      timeframe: '1m',                // Candle timeframe
      
      // Indicator settings
      indicatorConfig: {},            // Configuration for RealTimeTrendSniper
      
      // Logging settings
      logLevel: 'info',               // Log level (debug, info, warn, error)
      logToFile: false,               // Whether to log to file
      logFilePath: './logs',          // Path to log files
      
      // Override with user-provided config
      ...config
    };
    
    // Validate required configuration
    if (!this.config.wsUrl) {
      throw new Error('WebSocket URL is required');
    }
    
    if (!this.config.symbol) {
      throw new Error('Trading symbol is required');
    }
    
    // Initialize the indicator
    this.indicator = new RealTimeTrendSniper(this.config.indicatorConfig);
    
    // Initialize state variables
    this.ws = null;
    this.connected = false;
    this.reconnecting = false;
    this.pingInterval = null;
    this.currentCandle = null;
    this.lastCandleTime = null;
    
    // Set up event handlers for the indicator
    this.setupIndicatorEvents();
    
    // Set up logging
    this.setupLogging();
  }
  
  /**
   * Set up indicator event handlers
   */
  setupIndicatorEvents() {
    // Handle ready event
    this.indicator.on('ready', (data) => {
      this.log('info', `Indicator ready at ${new Date(data.timestamp).toISOString()}`);
    });
    
    // Handle signal event
    this.indicator.on('signal', (data) => {
      this.log('info', `${data.type.toUpperCase()} SIGNAL detected at ${new Date(data.timestamp).toISOString()}, Price: ${data.price.toFixed(4)}`);
    });
    
    // Handle trade event
    this.indicator.on('trade', (data) => {
      if (data.action === 'open') {
        this.log('info', `OPEN ${data.direction.toUpperCase()} at ${new Date(data.timestamp).toISOString()}, Price: ${data.price.toFixed(4)}, Stop: ${data.stop.toFixed(4)}, Target: ${data.target.toFixed(4)}`);
      } else if (data.action === 'close') {
        this.log('info', `CLOSE ${data.direction.toUpperCase()} at ${new Date(data.timestamp).toISOString()}, Price: ${data.price.toFixed(4)}, P/L: $${data.pl.toFixed(2)}`);
      } else if (data.action === 'target_hit') {
        this.log('info', `TARGET HIT ${data.direction.toUpperCase()} at ${new Date(data.timestamp).toISOString()}, Price: ${data.price.toFixed(4)}, Profit: $${data.pl.toFixed(2)}`);
      }
    });
  }
  
  /**
   * Set up logging system
   */
  setupLogging() {
    this.logLevels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    
    this.currentLogLevel = this.logLevels[this.config.logLevel] || 1;
    
    // Create log directory if logging to file
    if (this.config.logToFile && !fs.existsSync(this.config.logFilePath)) {
      fs.mkdirSync(this.config.logFilePath, { recursive: true });
    }
  }
  
  /**
   * Log a message with specified level
   * @param {string} level - Log level
   * @param {string} message - Log message
   */
  log(level, message) {
    if (this.logLevels[level] < this.currentLogLevel) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    // Console output
    if (level === 'error') {
      console.error(formattedMessage);
    } else if (level === 'warn') {
      console.warn(formattedMessage);
    } else {
      console.log(formattedMessage);
    }
    
    // File output
    if (this.config.logToFile) {
      const today = new Date().toISOString().split('T')[0];
      const logFile = path.join(this.config.logFilePath, `${today}-${this.config.symbol}.log`);
      
      fs.appendFileSync(logFile, formattedMessage + '\n');
    }
  }
  
  /**
   * Connect to WebSocket server
   */
  connect() {
    this.log('info', `Connecting to WebSocket server at ${this.config.wsUrl}`);
    
    try {
      // Create WebSocket connection
      this.ws = new WebSocket(this.config.wsUrl);
      
      // Set up WebSocket event handlers
      this.ws.on('open', this.onOpen.bind(this));
      this.ws.on('message', this.onMessage.bind(this));
      this.ws.on('error', this.onError.bind(this));
      this.ws.on('close', this.onClose.bind(this));
    } catch (error) {
      this.log('error', `WebSocket connection error: ${error.message}`);
      this.scheduleReconnect();
    }
  }
  
  /**
   * Handle WebSocket open event
   */
  onOpen() {
    this.log('info', 'WebSocket connection established');
    this.connected = true;
    this.reconnecting = false;
    
    // Subscribe to market data
    this.subscribe();
    
    // Set up ping interval
    this.setupPingInterval();
  }
  
  /**
   * Handle WebSocket message event
   * @param {Object} data - Message data
   */
  onMessage(data) {
    try {
      // Parse message data
      const message = JSON.parse(data);
      
      // Handle different message types
      if (message.type === 'ping') {
        this.handlePing(message);
      } else if (message.type === 'subscription_success') {
        this.handleSubscriptionSuccess(message);
      } else if (message.type === 'candle') {
        this.handleCandleData(message);
      } else if (message.type === 'historical_data') {
        this.handleHistoricalData(message);
      } else if (message.type === 'error') {
        this.handleError(message);
      } else {
        this.log('debug', `Received unknown message type: ${message.type}`);
      }
    } catch (error) {
      this.log('error', `Error processing message: ${error.message}`);
    }
  }
  
  /**
   * Handle WebSocket error event
   * @param {Error} error - Error object
   */
  onError(error) {
    this.log('error', `WebSocket error: ${error.message}`);
  }
  
  /**
   * Handle WebSocket close event
   * @param {number} code - Close code
   * @param {string} reason - Close reason
   */
  onClose(code, reason) {
    this.log('warn', `WebSocket connection closed: ${code} ${reason}`);
    this.connected = false;
    
    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Schedule reconnect
    this.scheduleReconnect();
  }
  
  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (!this.reconnecting) {
      this.reconnecting = true;
      this.log('info', `Scheduling reconnect in ${this.config.reconnectInterval}ms`);
      
      setTimeout(() => {
        this.log('info', 'Attempting to reconnect...');
        this.connect();
      }, this.config.reconnectInterval);
    }
  }
  
  /**
   * Set up ping interval
   */
  setupPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    
    this.pingInterval = setInterval(() => {
      if (this.connected && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.config.pingInterval);
  }
  
  /**
   * Subscribe to market data
   */
  subscribe() {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot subscribe: WebSocket not connected');
      return;
    }
    
    const subscribeMessage = {
      type: 'subscribe',
      symbol: this.config.symbol,
      timeframe: this.config.timeframe
    };
    
    this.log('info', `Subscribing to ${this.config.symbol} ${this.config.timeframe} data`);
    this.ws.send(JSON.stringify(subscribeMessage));
  }
  
  /**
   * Request historical data
   * @param {number} limit - Number of candles to request
   */
  requestHistoricalData(limit = 1000) {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', 'Cannot request historical data: WebSocket not connected');
      return;
    }
    
    const historyMessage = {
      type: 'history',
      symbol: this.config.symbol,
      timeframe: this.config.timeframe,
      limit
    };
    
    this.log('info', `Requesting ${limit} historical candles for ${this.config.symbol} ${this.config.timeframe}`);
    this.ws.send(JSON.stringify(historyMessage));
  }
  
  /**
   * Handle ping message
   * @param {Object} message - Ping message
   */
  handlePing(message) {
    // Respond with pong if needed
    if (message.requireResponse) {
      this.ws.send(JSON.stringify({ type: 'pong' }));
    }
  }
  
  /**
   * Handle subscription success message
   * @param {Object} message - Subscription success message
   */
  handleSubscriptionSuccess(message) {
    this.log('info', `Successfully subscribed to ${message.symbol} ${message.timeframe}`);
    
    // Request historical data to initialize the indicator
    this.requestHistoricalData();
  }
  
  /**
   * Handle historical data message
   * @param {Object} message - Historical data message
   */
  handleHistoricalData(message) {
    const { data } = message;
    
    this.log('info', `Received ${data.length} historical candles`);
    
    // Initialize indicator with historical data
    this.indicator.initWithHistoricalData(data);
    
    // Update last candle time
    if (data.length > 0) {
      this.lastCandleTime = data[data.length - 1].timestamp;
    }
  }
  
  /**
   * Handle candle data message
   * @param {Object} message - Candle data message
   */
  handleCandleData(message) {
    const { data } = message;
    
    // Check if this is a new candle or update to current candle
    if (this.lastCandleTime !== data.timestamp) {
      // New candle
      this.log('debug', `New candle: ${new Date(data.timestamp).toISOString()}, O: ${data.open}, H: ${data.high}, L: ${data.low}, C: ${data.close}`);
      this.lastCandleTime = data.timestamp;
    } else {
      // Update to current candle
      this.log('debug', `Candle update: ${new Date(data.timestamp).toISOString()}, O: ${data.open}, H: ${data.high}, L: ${data.low}, C: ${data.close}`);
    }
    
    // Update indicator with new data
    this.indicator.update(data);
    
    // Store current candle
    this.currentCandle = data;
  }
  
  /**
   * Handle error message
   * @param {Object} message - Error message
   */
  handleError(message) {
    this.log('error', `Server error: ${message.error}`);
  }
  
  /**
   * Get current statistics
   * @returns {Object} - Current statistics
   */
  getStats() {
    return this.indicator.getStats();
  }
  
  /**
   * Print current statistics
   */
  printStats() {
    this.indicator.printStats();
  }
  
  /**
   * Close the WebSocket connection
   */
  close() {
    if (this.connected && this.ws) {
      this.log('info', 'Closing WebSocket connection');
      
      // Clear ping interval
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      
      // Close WebSocket
      this.ws.close();
      this.connected = false;
    }
  }
}

module.exports = TrendSniperWSClient;