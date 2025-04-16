/**
 * Example usage of Bybit Live Trading module with demo trading support
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
    logLevel: process.env.BYBIT_LOG_LEVEL || 'info',
    // Demo trading specific options
    requestDemoFundsOnStart: process.env.BYBIT_REQUEST_DEMO_FUNDS === 'true',
    useFastHmacSigning: process.env.BYBIT_FAST_HMAC !== 'false'
  };
  
  // Create Bybit trading instance
  const bybitTrading = new BybitLiveTrading(config);
  
  // If in demo mode and not auto-requesting funds, request funds manually
  if (config.isDemo && !config.requestDemoFundsOnStart) {
    try {
      console.log('Requesting demo trading funds...');
      await bybitTrading.requestDemoFunds();
      console.log('Successfully requested demo funds');
    } catch (error) {
      console.error('Failed to request demo funds:', error.message);
    }
  }
  
  // Define trading pairs and timeframes
  const tradingPairs = [
    { symbol: 'BTCUSDT', timeframe: '5m', market: 'futures' }, // Use 'futures' instead of 'linear'
    { symbol: 'ETHUSDT', timeframe: '15m', market: 'futures' }, // Use 'futures' instead of 'linear'
    // { symbol: 'BTCUSDT', timeframe: '1h', market: 'futures' }  // Use 'futures' instead of 'linear'
  ];
  
// Initialize trading instances for each pair with a delay
const tradingInstances = [];
for (let i = 0; i < tradingPairs.length; i++) {
  const pair = tradingPairs[i];
  console.log(`Setting up trading instance for ${pair.symbol} on ${pair.timeframe} timeframe (will initialize in ${i * 3} seconds)`);
  
  setTimeout(() => {
    console.log(`Creating trading instance for ${pair.symbol} on ${pair.timeframe} timeframe`);
    
    const instance = bybitTrading.createTradingInstance({
      symbol: pair.symbol,
      timeframe: pair.timeframe,
      market: pair.market
    });
    
    tradingInstances.push(instance);
  }, i * 3000); // 3 seconds between each instance creation
}
  
  // Get account info
  try {
    console.log('Getting account information...');
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
  
  return {
    bybitTrading,
    tradingInstances
  };
}

// Example of demo trading - placing a manual order
async function demoDemoTrading(bybitTrading, tradingInstances) {
  if (!bybitTrading.config.isDemo) {
    console.error("This example is for demo trading only! Set BYBIT_DEMO=true to use it.");
    return;
  }
  
  console.log("\n=== DEMO TRADING EXAMPLE ===");
  console.log("This will place a small market order on BTC using demo funds.");
  
  try {
    // Find BTCUSDT instance
    const btcInstance = tradingInstances.find(
      instance => instance.symbol === 'BTCUSDT' && instance.timeframe === '5m'
    );
    
    if (!btcInstance) {
      console.error('Could not find BTCUSDT trading instance');
      return;
    }
    
    // Get current market price
    console.log('Getting current market data...');
    const marketData = await btcInstance.getMarketData();
    if (!marketData) {
      console.error('Failed to get market data');
      return;
    }
    
    const currentPrice = parseFloat(marketData.lastPrice);
    console.log(`Current price of BTCUSDT: ${currentPrice}`);
    
    // Place a small market buy order (0.001 BTC)
    console.log('Placing a demo market buy order for 0.001 BTC...');
    
    const orderResult = await btcInstance.placeOrder({
      side: 'Buy',
      orderType: 'Market',
      qty: '0.001'
    });
    
    console.log('Order placed successfully:', orderResult);
    
    // Get positions after order
    console.log('Checking positions after order...');
    setTimeout(async () => {
      try {
        const positions = await btcInstance.getPositions();
        console.log('Current positions:', positions);
        
        // Log account info again to see the change
        const accountInfo = await bybitTrading.getAccountInfo();
        if (accountInfo && accountInfo.list && accountInfo.list.length > 0) {
          const unifiedAccount = accountInfo.list.find(a => a.accountType === 'UNIFIED');
          if (unifiedAccount && unifiedAccount.coin) {
            const btcBalance = unifiedAccount.coin.find(c => c.coin === 'BTC');
            if (btcBalance) {
              console.log(`Updated BTC balance: ${btcBalance.walletBalance} (${btcBalance.usdValue} USD)`);
            }
          }
        }
      } catch (error) {
        console.error('Error getting positions after order:', error);
      }
    }, 2000); // Wait 2 seconds for the order to process
    
  } catch (error) {
    console.error('Error in demo trading example:', error);
  }
}

// Run the trading system and demo trading example
(async () => {
  try {
    const { bybitTrading, tradingInstances } = await runTradingSystem();
    
    // Wait a bit for initialization
    setTimeout(() => {
      // Only run the demo trading example if in demo mode
      if (process.env.BYBIT_DEMO === 'true' && process.env.BYBIT_RUN_DEMO_EXAMPLE === 'true') {
        demoDemoTrading(bybitTrading, tradingInstances);
      }
    }, 10000); // Wait 10 seconds
    
  } catch (error) {
    console.error('Error running trading system:', error);
    process.exit(1);
  }
})();