#!/usr/bin/env node
/**
 * Trend Sniper Startup Script
 * 
 * This script starts the Trend Sniper bot with WebSocket connection.
 * It can be used in production to connect to a real market data source,
 * or in development/testing mode with the mock server.
 * 
 * Usage:
 *   node startup.js [--test]
 * 
 * Options:
 *   --test    Run in test mode with mock WebSocket server
 */

const TrendSniperWSClient = require('./websocket-client');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const isTestMode = args.includes('--test');

// Load configuration
let config;
try {
  // Try to load config from file
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('Loaded configuration from config.json');
  } else {
    // Use default configuration
    config = getDefaultConfig(isTestMode);
    console.log('Using default configuration');
    
    // Save default config for future reference
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('Default configuration saved to config.json');
  }
} catch (error) {
  console.error(`Error loading configuration: ${error.message}`);
  config = getDefaultConfig(isTestMode);
  console.log('Using default configuration due to error');
}

// Start test server if in test mode
let mockServer;
if (isTestMode) {
  try {
    mockServer = require('./mock-websocket-server');
    console.log('Started mock WebSocket server for testing');
  } catch (error) {
    console.error(`Error starting mock server: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Start the WebSocket client
 */
function startClient() {
  try {
    console.log(`Starting Trend Sniper WebSocket Client in ${isTestMode ? 'TEST' : 'PRODUCTION'} mode...`);
    
    // Create client instance
    const client = new TrendSniperWSClient(config);
    
    // Connect to WebSocket server
    client.connect();
    
    // Set up interval to print statistics
    const statsInterval = setInterval(() => {
      client.printStats();
    }, 60000); // Print stats every minute
    
    // Handle application exit
    process.on('SIGINT', () => {
      console.log('\nGracefully shutting down...');
      clearInterval(statsInterval);
      client.close();
      
      // Shut down mock server if in test mode
      if (isTestMode && mockServer && mockServer.server) {
        mockServer.server.close();
      }
      
      setTimeout(() => {
        console.log('Final statistics:');
        client.printStats();
        process.exit(0);
      }, 1000);
    });
    
    return client;
  } catch (error) {
    console.error(`Error starting client: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Get default configuration based on mode
 * @param {boolean} testMode - Whether to use test mode configuration
 * @returns {Object} - Configuration object
 */
function getDefaultConfig(testMode) {
  return {
    // WebSocket settings
    wsUrl: testMode ? 'ws://localhost:8080' : 'wss://example.com/ws',
    reconnectInterval: 5000,
    pingInterval: 30000,
    
    // Market data settings
    symbol: 'BTCUSDT',
    timeframe: '5m',
    
    // Indicator settings
    indicatorConfig: {
      // Main parameters
      ATRPeriod: 16,
      ATRMultip: 9,
      ATRMultip_fast: 5.1,
      fastLen: 6,
      
      // Scalp mode parameters
      useScalpMode: false,
      scalpPeriod: 21,
      
      // Risk-reward parameters
      rewardMultiple: 1.5,
      initialCapital: 1000,
      riskPerTrade: 2.0,
      
      // Leverage parameters
      useLeverage: false,
      leverageAmount: 2.0,
      
      // Logging parameters
      logSignals: true
    },
    
    // Logging settings
    logLevel: testMode ? 'debug' : 'info',
    logToFile: true,
    logFilePath: './logs'
  };
}

// Start the client
const client = startClient();

// Log a startup message
console.log(`
=================================================
  TREND SNIPER V3 REAL-TIME TRADING BOT
=================================================
  Mode: ${isTestMode ? 'TEST' : 'PRODUCTION'}
  Symbol: ${config.symbol}
  Timeframe: ${config.timeframe}
  ATR Period: ${config.indicatorConfig.ATRPeriod}
  ATR Multiplier: ${config.indicatorConfig.ATRMultip}
  Risk Per Trade: ${config.indicatorConfig.riskPerTrade}%
  Reward Ratio: 1:${config.indicatorConfig.rewardMultiple}
  Scalp Mode: ${config.indicatorConfig.useScalpMode ? 'ON' : 'OFF'}
  Leverage: ${config.indicatorConfig.useLeverage ? config.indicatorConfig.leverageAmount + 'x' : 'OFF'}
=================================================
  Press Ctrl+C to exit
=================================================
`);
