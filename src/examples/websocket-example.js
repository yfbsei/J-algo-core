/**
 * Example: Using Real-time Trend Sniper with WebSockets
 * 
 * This example demonstrates how to use the TrendSniperWSClient
 * to connect to a WebSocket server and process real-time market data.
 */

const TrendSniperWSClient = require('./websocket-client');

// Example configuration
const config = {
  // WebSocket settings
  wsUrl: 'wss://your-websocket-server.com/ws',  // Replace with your WebSocket server URL
  reconnectInterval: 5000,
  pingInterval: 30000,
  
  // Market data settings
  symbol: 'BTCUSDT',   // Example trading pair
  timeframe: '5m',     // 5-minute candles
  
  // Indicator settings
  indicatorConfig: {
    // Main parameters
    ATRPeriod: 16,
    ATRMultip: 9,
    ATRMultip_fast: 5.1,
    fastLen: 6,
    
    // Scalp mode parameters
    useScalpMode: false,
    
    // Risk-reward parameters
    rewardMultiple: 1.5,
    initialCapital: 1000,
    riskPerTrade: 2.0,
    
    // Leverage parameters
    useLeverage: false,
    
    // Logging parameters
    logSignals: true
  },
  
  // Logging settings
  logLevel: 'info',
  logToFile: true,
  logFilePath: './logs'
};

/**
 * Start the WebSocket client
 */
function startClient() {
  try {
    console.log('Starting Trend Sniper WebSocket Client...');
    
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

// Start the client
const client = startClient();

// Log a startup message
console.log(`
=================================================
  TREND SNIPER V3 REAL-TIME TRADING BOT
=================================================
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
