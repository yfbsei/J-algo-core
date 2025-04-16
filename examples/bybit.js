/**
 * Example usage of Bybit Live Trading module with demo trading support
 * Shows statistics directly from Bybit API instead of Jalgo
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
    leverage: parseFloat(process.env.BYBIT_LEVERAGE || '10'),
    initialCapital: parseFloat(process.env.BYBIT_INITIAL_CAPITAL || '100'),
    riskPerTrade: parseFloat(process.env.BYBIT_RISK_PER_TRADE || '0.1'),
    rewardMultiple: parseFloat(process.env.BYBIT_REWARD_MULTIPLE || '0.5'),
    enableAutoTrading: process.env.BYBIT_AUTO_TRADING === 'true',
    enableDebug: process.env.BYBIT_DEBUG === 'true',
    logLevel: process.env.BYBIT_LOG_LEVEL || 'info',
    
    syncAccountBalance: process.env.BYBIT_SYNC_ACCOUNT_BALANCE === 'true',
    requestDemoFundsOnStart: process.env.BYBIT_REQUEST_DEMO_FUNDS === 'true',
    useFastHmacSigning: process.env.BYBIT_FAST_HMAC !== 'false'
  };
  
  // Create Bybit trading instance
  const bybitTrading = new BybitLiveTrading(config);
  
  // If in demo mode and not auto-requesting funds, request funds manually
  if (config.isDemo && config.requestDemoFundsOnStart) {
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
    { symbol: 'BTCUSDT', timeframe: '1m', market: 'futures' },
    { symbol: 'ETHUSDT', timeframe: '1m', market: 'futures' },
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
    logAllActivePositionsFromBybit(bybitTrading);
  }, 60000); // Log active positions every minute
  
  // Setup periodic performance reporting
  setInterval(() => {
    fetchAndDisplayBybitStats(bybitTrading);
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

/**
 * Fetch and display trading statistics directly from Bybit
 * @param {Object} bybitTrading - BybitLiveTrading instance
 */
async function fetchAndDisplayBybitStats(bybitTrading) {
  try {
    console.log('\n=== BYBIT TRADING STATISTICS ===');
    
    // 1. Get Account Overview
    const accountInfo = await bybitTrading.getAccountInfo();
    if (accountInfo && accountInfo.list && accountInfo.list.length > 0) {
      const unifiedAccount = accountInfo.list.find(a => a.accountType === 'UNIFIED');
      
      if (unifiedAccount) {
        console.log('Account Balance:');
        let totalEquity = 0;
        
        if (unifiedAccount.coin && unifiedAccount.coin.length > 0) {
          unifiedAccount.coin.forEach(coin => {
            if (parseFloat(coin.equity) > 0) {
              console.log(`  ${coin.coin}: ${coin.equity} (${coin.usdValue} USD)`);
              totalEquity += parseFloat(coin.usdValue || 0);
            }
          });
        }
        
        console.log(`Total Equity: $${totalEquity.toFixed(2)} USD`);
      }
    }
    
    // 2. Get Position Information
    console.log('\nPosition Summary:');
    
    // Get linear positions (USDT futures)
    const linearPositions = await bybitTrading.bybitClient.getPositions('linear');
    if (linearPositions && linearPositions.list && linearPositions.list.length > 0) {
      console.log('  USDT Futures Positions:');
      
      const activePositions = linearPositions.list.filter(p => parseFloat(p.size) > 0);
      if (activePositions.length > 0) {
        activePositions.forEach(pos => {
          const side = pos.side;
          const size = parseFloat(pos.size);
          const entryPrice = parseFloat(pos.entryPrice);
          const markPrice = parseFloat(pos.markPrice);
          const unrealizedPnl = parseFloat(pos.unrealisedPnl);
          
          console.log(`    ${pos.symbol}: ${side} ${size} contracts @ ${entryPrice} | Mark: ${markPrice} | PnL: ${unrealizedPnl.toFixed(2)} USD`);
        });
      } else {
        console.log('    No active positions');
      }
    }
    
    // 3. Get Recent Trade History
    console.log('\nRecent Trades:');
    
    try {
      // Get execution history for both categories
      const tradeHistory = await bybitTrading.bybitClient.rest.getExecutionList({
        category: 'linear',
        limit: 10
      });
      
      if (tradeHistory && tradeHistory.result && tradeHistory.result.list && tradeHistory.result.list.length > 0) {
        console.log('  Latest Executions:');
        tradeHistory.result.list.slice(0, 5).forEach(trade => {
          const time = new Date(trade.execTime).toLocaleString();
          console.log(`    ${time} | ${trade.symbol} | ${trade.side} ${trade.execQty} @ ${trade.execPrice} | Fee: ${trade.execFee}`);
        });
      } else {
        console.log('  No recent trades found');
      }
    } catch (error) {
      console.log('  Error fetching trade history:', error.message);
    }
    
    // 4. Get P&L Data
    console.log('\nP&L Summary:');
    
    try {
      const closedPnl = await bybitTrading.bybitClient.rest.getClosedPnL({
        category: 'linear',
        limit: 50
      });
      
      if (closedPnl && closedPnl.result && closedPnl.result.list && closedPnl.result.list.length > 0) {
        const trades = closedPnl.result.list;
        const totalTrades = trades.length;
        let totalPnl = 0;
        let winCount = 0;
        
        trades.forEach(trade => {
          const pnl = parseFloat(trade.closedPnl);
          totalPnl += pnl;
          if (pnl > 0) winCount++;
        });
        
        const winRate = totalTrades > 0 ? (winCount / totalTrades * 100).toFixed(2) : 0;
        
        console.log(`  Total Trades: ${totalTrades}`);
        console.log(`  Win Rate: ${winRate}%`);
        console.log(`  Total Closed P&L: ${totalPnl.toFixed(2)} USD`);
        
        // Show most recent closed trades
        console.log('\n  Recent Closed Trades:');
        trades.slice(0, 5).forEach(trade => {
          const closeTime = new Date(trade.updatedTime).toLocaleString();
          const pnl = parseFloat(trade.closedPnl);
          const result = pnl >= 0 ? 'WIN' : 'LOSS';
          console.log(`    ${closeTime} | ${trade.symbol} | ${trade.side} | ${result}: ${pnl.toFixed(2)} USD`);
        });
      } else {
        console.log('  No closed P&L data found');
      }
    } catch (error) {
      console.log('  Error fetching P&L data:', error.message);
    }
    
    console.log('=====================================\n');
  } catch (error) {
    console.error('Error fetching Bybit statistics:', error);
  }
}

/**
 * Log all active positions by querying Bybit directly
 * @param {Object} bybitTrading - BybitLiveTrading instance
 */
async function logAllActivePositionsFromBybit(bybitTrading) {
  try {
    console.log('\n=== ACTIVE POSITIONS FROM BYBIT ===');
    
    // Get positions for different categories
    const categories = ['linear', 'inverse'];
    let hasActivePositions = false;
    
    for (const category of categories) {
      try {
        const positions = await bybitTrading.bybitClient.getPositions(category);
        
        if (positions && positions.list && positions.list.length > 0) {
          const activePositions = positions.list.filter(p => parseFloat(p.size) > 0);
          
          if (activePositions.length > 0) {
            hasActivePositions = true;
            console.log(`${category.toUpperCase()} POSITIONS:`);
            
            activePositions.forEach(pos => {
              const side = pos.side;
              const leverage = pos.leverage;
              const size = parseFloat(pos.size);
              const entryPrice = parseFloat(pos.entryPrice);
              const markPrice = parseFloat(pos.markPrice);
              const unrealizedPnl = parseFloat(pos.unrealisedPnl);
              const pnlPercent = ((markPrice / entryPrice - 1) * 100 * (side === 'Buy' ? 1 : -1)).toFixed(2);
              
              console.log(`  ${pos.symbol}: ${side} ${size} @ ${entryPrice} | Mark: ${markPrice} | PnL: ${unrealizedPnl.toFixed(2)} USD (${pnlPercent}%) | Leverage: ${leverage}x`);
              
              // Show take profit/stop loss if set
              if (pos.takeProfit && parseFloat(pos.takeProfit) > 0) {
                console.log(`    Take Profit: ${pos.takeProfit}`);
              }
              if (pos.stopLoss && parseFloat(pos.stopLoss) > 0) {
                console.log(`    Stop Loss: ${pos.stopLoss}`);
              }
            });
          }
        }
      } catch (error) {
        console.error(`Error fetching ${category} positions:`, error.message);
      }
    }
    
    if (!hasActivePositions) {
      console.log('No active positions found in Bybit account');
    }
    
    console.log('=====================================\n');
  } catch (error) {
    console.error('Error logging active positions from Bybit:', error);
  }
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
        
        // Show Bybit stats right away
        await fetchAndDisplayBybitStats(bybitTrading);
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
      // Show initial Bybit stats
      fetchAndDisplayBybitStats(bybitTrading);
      
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