/**
 * Example usage of Bybit Live Trading module
 */

import BybitLiveTrading from '../live-trading/bybit/bybit-live.js';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Example function to run the trading system
async function runTradingSystem() {
  console.log('Starting Bybit trading system...');
  
  // Create configuration from environment variables
  const config = {
    apiKey: process.env.BYBIT_API_KEY,
    apiSecret: process.env.BYBIT_API_SECRET,
    isDemo: process.env.BYBIT_DEMO === 'true',
    leverage: parseFloat(process.env.BYBIT_LEVERAGE || '3.0'),
    initialCapital: parseFloat(process.env.BYBIT_INITIAL_CAPITAL || '1000'),
    riskPerTrade: parseFloat(process.env.BYBIT_RISK_PER_TRADE || '2.0'),
    rewardMultiple: parseFloat(process.env.BYBIT_REWARD_MULTIPLE || '1.5'),
    enableAutoTrading: process.env.BYBIT_AUTO_TRADING === 'true',
    enableDebug: process.env.BYBIT_DEBUG === 'true',
    logLevel: process.env.BYBIT_LOG_LEVEL || 'info'
  };
  
  // Create Bybit trading instance
  const bybitTrading = new BybitLiveTrading(config);
  
  // Define trading pairs and timeframes
  const tradingPairs = [
    { symbol: 'BTCUSDT', timeframe: '5m', market: 'futures' },
    { symbol: 'ETHUSDT', timeframe: '15m', market: 'futures' },
    { symbol: 'BTCUSDT', timeframe: '1h', market: 'futures' }
  ];
  
  // Initialize trading instances for each pair
  for (const pair of tradingPairs) {
    console.log(`Creating trading instance for ${pair.symbol} on ${pair.timeframe} timeframe`);
    
    const instance = bybitTrading.createTradingInstance({
      symbol: pair.symbol,
      timeframe: pair.timeframe,
      market: pair.market
    });
  }
  
  // Get account info
  try {
    const accountInfo = await bybitTrading.getAccountInfo();
    console.log('Account Information:');
    
    if (accountInfo && accountInfo.list) {
      accountInfo.list.forEach(account => {
        console.log(`Account: ${account.accountType}`);
        
        if (account.coin && account.coin.length > 0) {
          console.log('  Balances:');
          account.coin.forEach(coin => {
            if (parseFloat(coin.walletBalance) > 0) {
              console.log(`    ${coin.coin}: ${coin.walletBalance} (${coin.usdValue} USD)`);
            }
          });
        }
      });
    }
  } catch (error) {
    console.error('Error getting account info:', error);
  }
  
  // Setup periodic logging of positions
  setInterval(() => {
    bybitTrading.logAllActivePositions();
  }, 60000); // Log active positions every minute
  
  // Setup periodic performance reporting
  setInterval(() => {
    const stats = bybitTrading.getPerformanceStats();
    console.log('\n=== PERFORMANCE STATISTICS ===');
    console.log(`Total Instances: ${stats.totalInstances}`);
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Total P&L: ${stats.totalPnl}`);
    
    if (stats.instances.length > 0) {
      console.log('\nPerformance by Instance:');
      stats.instances.forEach(instance => {
        console.log(`${instance.symbol} (${instance.timeframe}): ${instance.totalTrades} trades, Win Rate: ${instance.winRate}%, P&L: ${instance.pnl}`);
      });
    }
    
    console.log('===============================\n');
  }, 300000); // Log performance every 5 minutes
  
  // Graceful shutdown handler
  process.on('SIGINT', async () => {
    console.log('\nStopping trading system...');
    bybitTrading.stopAll();
    console.log('Trading system stopped. Exiting...');
    process.exit(0);
  });
  
  console.log('Trading system running. Press Ctrl+C to stop.');
}

// Create an example of how to manually place orders
async function manualOrderExample(bybitTrading) {
  try {
    // Get an instance
    const instance = bybitTrading.getInstance('BTCUSDT', '5m');
    
    if (!instance) {
      console.error('Trading instance for BTCUSDT not found');
      return;
    }
    
    // Get current market price
    const marketData = await instance.getMarketData();
    if (!marketData) {
      console.error('Failed to get market data');
      return;
    }
    
    const currentPrice = parseFloat(marketData.lastPrice);
    console.log(`Current price of BTCUSDT: ${currentPrice}`);
    
    // Example: Place a limit buy order 2% below market price
    const limitPrice = (currentPrice * 0.98).toFixed(2);
    const orderSize = '0.001'; // BTC
    
    console.log(`Placing limit buy order for ${orderSize} BTC at ${limitPrice}`);
    
    const orderResult = await instance.placeOrder({
      side: 'Buy',
      orderType: 'Limit',
      price: limitPrice,
      qty: orderSize,
      timeInForce: 'GTC'
    });
    
    console.log('Order placed:', orderResult);
    
    // Example: Get open orders
    const openOrders = await instance.getOpenOrders();
    console.log('Open orders:', openOrders);
    
  } catch (error) {
    console.error('Error in manual order example:', error);
  }
}

// Create an example of how to manage positions
async function positionManagementExample(bybitTrading) {
  try {
    // Get an instance
    const instance = bybitTrading.getInstance('BTCUSDT', '5m');
    
    if (!instance) {
      console.error('Trading instance for BTCUSDT not found');
      return;
    }
    
    // Get current positions
    const positions = await instance.getPositions();
    
    if (!positions || !positions.list || positions.list.length === 0) {
      console.log('No open positions for BTCUSDT');
      return;
    }
    
    console.log('Current positions:');
    positions.list.forEach(position => {
      const side = parseFloat(position.size) > 0 ? 'Long' : 'Short';
      console.log(`${side} position of ${Math.abs(position.size)} contracts at ${position.entryPrice}`);
      console.log(`Unrealized P&L: ${position.unrealisedPnl}`);
      
      // Example: Set stop loss for position
      if (parseFloat(position.size) !== 0) {
        console.log('Setting stop loss...');
        
        // For a long position, set stop loss 2% below entry
        // For a short position, set stop loss 2% above entry
        const entryPrice = parseFloat(position.entryPrice);
        const stopLossPrice = side === 'Long' 
          ? (entryPrice * 0.98).toFixed(2) 
          : (entryPrice * 1.02).toFixed(2);
        
        console.log(`Setting stop loss at ${stopLossPrice}`);
        
        // Set trading stop (stop loss)
        bybitTrading.positionManager.setTradingStop(instance.category, instance.symbol, {
          stopLoss: stopLossPrice,
          slTriggerBy: 'MarkPrice',
          positionIdx: position.positionIdx
        }).then(result => {
          console.log('Stop loss set:', result);
        }).catch(error => {
          console.error('Error setting stop loss:', error);
        });
      }
    });
    
  } catch (error) {
    console.error('Error in position management example:', error);
  }
}

// Run the example
(async () => {
  try {
    await runTradingSystem();
    
    // Uncomment to run manual order example after 10 seconds
    // setTimeout(() => manualOrderExample(bybitTrading), 10000);
    
    // Uncomment to run position management example after 20 seconds
    // setTimeout(() => positionManagementExample(bybitTrading), 20000);
    
  } catch (error) {
    console.error('Error running trading system:', error);
    process.exit(1);
  }
})();