/**
 * Mock WebSocket Server for Testing
 * 
 * This is a simple WebSocket server that simulates a market data feed
 * for testing the Trend Sniper WebSocket client.
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 8080;
const CANDLE_INTERVAL = 5000; // 5 seconds between candles

// Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

// Mock data generation
class MockDataGenerator {
  constructor() {
    // Initial price
    this.currentPrice = 50000;
    this.currentTimestamp = Date.now();
    this.volatility = 0.002; // 0.2% price movement per candle
    this.trend = 0;          // Current trend direction
    this.trendStrength = 0;  // Current trend strength
    this.trendDuration = 0;  // How long before trend changes
    this.candleCount = 0;    // Count of candles generated
  }
  
  /**
   * Generate a new candle
   * @param {string} timeframe - Candle timeframe
   * @returns {Object} - Candle data
   */
  generateCandle(timeframe) {
    // Update trend state
    this.updateTrend();
    
    // Get timeframe in milliseconds
    const timeframeMs = this.parseTimeframe(timeframe);
    
    // Update timestamp
    this.currentTimestamp += timeframeMs;
    
    // Generate price movement
    const movement = this.generatePriceMovement();
    
    // Calculate new price
    const close = this.currentPrice * (1 + movement);
    
    // Calculate OHLC
    const open = this.currentPrice;
    const high = Math.max(open, close) * (1 + Math.random() * this.volatility);
    const low = Math.min(open, close) * (1 - Math.random() * this.volatility);
    const volume = Math.floor(Math.random() * 100 + 50) * 0.1;
    
    // Update current price
    this.currentPrice = close;
    this.candleCount++;
    
    // Create candle object
    return {
      timestamp: this.currentTimestamp,
      open,
      high,
      low,
      close,
      volume
    };
  }
  
  /**
   * Parse timeframe string to milliseconds
   * @param {string} timeframe - Timeframe string (e.g., '1m', '5m', '1h')
   * @returns {number} - Timeframe in milliseconds
   */
  parseTimeframe(timeframe) {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1), 10);
    
    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return 60 * 1000; // Default to 1 minute
    }
  }
  
  /**
   * Update trend state
   */
  updateTrend() {
    // Decrease trend duration
    this.trendDuration--;
    
    // Change trend if duration expired
    if (this.trendDuration <= 0) {
      // Random trend duration between 10 and 50 candles
      this.trendDuration = Math.floor(Math.random() * 40) + 10;
      
      // Random trend direction (-1, 0, 1)
      this.trend = Math.floor(Math.random() * 3) - 1;
      
      // Random trend strength
      this.trendStrength = Math.random() * 0.003 + 0.001;
    }
  }
  
  /**
   * Generate price movement based on trend and volatility
   * @returns {number} - Price movement percentage
   */
  generatePriceMovement() {
    // Random movement based on volatility
    const randomMovement = (Math.random() * 2 - 1) * this.volatility;
    
    // Trend-based movement
    const trendMovement = this.trend * this.trendStrength;
    
    // Combined movement
    return randomMovement + trendMovement;
  }
  
  /**
   * Generate historical data
   * @param {string} timeframe - Candle timeframe
   * @param {number} count - Number of candles to generate
   * @returns {Array} - Array of historical candles
   */
  generateHistoricalData(timeframe, count) {
    // Save current state
    const savedState = {
      currentPrice: this.currentPrice,
      currentTimestamp: this.currentTimestamp,
      trend: this.trend,
      trendStrength: this.trendStrength,
      trendDuration: this.trendDuration,
      candleCount: this.candleCount
    };
    
    // Reset for historical data
    this.currentPrice = 50000;
    this.currentTimestamp = Date.now() - this.parseTimeframe(timeframe) * count;
    this.trend = 0;
    this.trendStrength = 0;
    this.trendDuration = 0;
    this.candleCount = 0;
    
    // Generate historical candles
    const candles = [];
    for (let i = 0; i < count; i++) {
      candles.push(this.generateCandle(timeframe));
    }
    
    // Restore state
    this.currentPrice = savedState.currentPrice;
    this.currentTimestamp = savedState.currentTimestamp;
    this.trend = savedState.trend;
    this.trendStrength = savedState.trendStrength;
    this.trendDuration = savedState.trendDuration;
    this.candleCount = savedState.candleCount;
    
    return candles;
  }
}

// Create data generator instance
const dataGenerator = new MockDataGenerator();

// Client subscription map
const subscriptions = new Map(); // client -> { symbol, timeframe }

// Handle client connection
wss.on('connection', (ws) => {
  console.log('Client connected');
  clients.add(ws);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to Mock WebSocket Server',
    timestamp: Date.now()
  }));
  
  // Handle messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      // Handle different message types
      if (data.type === 'subscribe') {
        handleSubscribe(ws, data);
      } else if (data.type === 'unsubscribe') {
        handleUnsubscribe(ws);
      } else if (data.type === 'history') {
        handleHistoryRequest(ws, data);
      } else if (data.type === 'ping') {
        handlePing(ws);
      }
    } catch (error) {
      console.error(`Error handling message: ${error.message}`);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Invalid message format'
      }));
    }
  });
  
  // Handle disconnection
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
    subscriptions.delete(ws);
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error: ${error.message}`);
  });
});

/**
 * Handle subscription request
 * @param {WebSocket} ws - WebSocket client
 * @param {Object} data - Subscription data
 */
function handleSubscribe(ws, data) {
  const { symbol, timeframe } = data;
  
  console.log(`Client subscribed to ${symbol} ${timeframe}`);
  
  // Store subscription
  subscriptions.set(ws, { symbol, timeframe });
  
  // Send subscription confirmation
  ws.send(JSON.stringify({
    type: 'subscription_success',
    symbol,
    timeframe,
    timestamp: Date.now()
  }));
}

/**
 * Handle unsubscribe request
 * @param {WebSocket} ws - WebSocket client
 */
function handleUnsubscribe(ws) {
  if (subscriptions.has(ws)) {
    const { symbol, timeframe } = subscriptions.get(ws);
    console.log(`Client unsubscribed from ${symbol} ${timeframe}`);
    subscriptions.delete(ws);
    
    // Send unsubscribe confirmation
    ws.send(JSON.stringify({
      type: 'unsubscribe_success',
      timestamp: Date.now()
    }));
  }
}

/**
 * Handle historical data request
 * @param {WebSocket} ws - WebSocket client
 * @param {Object} data - Historical data request
 */
function handleHistoryRequest(ws, data) {
  const { symbol, timeframe, limit = 100 } = data;
  
  console.log(`Client requested ${limit} historical candles for ${symbol} ${timeframe}`);
  
  // Generate historical data
  const historicalCandles = dataGenerator.generateHistoricalData(timeframe, limit);
  
  // Send historical data
  ws.send(JSON.stringify({
    type: 'historical_data',
    symbol,
    timeframe,
    data: historicalCandles,
    timestamp: Date.now()
  }));
}

/**
 * Handle ping request
 * @param {WebSocket} ws - WebSocket client
 */
function handlePing(ws) {
  ws.send(JSON.stringify({
    type: 'pong',
    timestamp: Date.now()
  }));
}

/**
 * Broadcast candle data to subscribed clients
 */
function broadcastCandleData() {
  for (const [client, subscription] of subscriptions.entries()) {
    if (client.readyState === WebSocket.OPEN) {
      const { symbol, timeframe } = subscription;
      
      // Generate new candle
      const candle = dataGenerator.generateCandle(timeframe);
      
      // Send candle data
      client.send(JSON.stringify({
        type: 'candle',
        symbol,
        timeframe,
        data: candle,
        timestamp: Date.now()
      }));
    }
  }
}

// Start the server
server.listen(PORT, () => {
  console.log(`Mock WebSocket Server is running on port ${PORT}`);
  
  // Start broadcasting candle data
  setInterval(broadcastCandleData, CANDLE_INTERVAL);
});

// Export for testing
module.exports = {
  server,
  wss,
  dataGenerator
};
