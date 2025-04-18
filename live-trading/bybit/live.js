import BybitWebsocketFeed from '../../src/exchanges/bybit-feed.js'
import { getWalletBalance, closePosition, calculateQty, submitTradeWithTP } from './client.js';
import { getTradingStats } from './stats.js';

const USDT_balance = await getWalletBalance(); // BTC.jalgo.riskManager.initialCapital * 33%

  // Create configuration options
const options = {
    symbol: 'BTCUSDT',           // Trading pair symbol
    timeframe: '1m',             // Candlestick timeframe (1m, 5m, 15m, 1h, etc.)
    market: 'futures',           // 'futures' or 'spot'
    
    // Risk management options
    riskOptions: {
      initialCapital: USDT_balance,      // Starting capital
      riskPerTrade: 0.01,         // Risk x% per trade
      rewardMultiple: 0.5,       // Target profit is 1.5x the risk
      useLeverage: true,         // Use leverage for futures
      leverageAmount: 10        // x leverage
    },

      // Custom event handlers
  onSignal: async (signal) => {
    await closePosition(signal.symbol); // check and close trade if open
    
    console.log(signal)
    
    await submitTradeWithTP({
        symbol: signal.symbol, 
        side: signal.position === "long" ? "buy" : "sell", 
        qty: calculateQty(signal.symbol, USDT_balance * (0.01/100)), // riskPerTrade 
        takeProfit: signal.target, 
        leverage: 10 // leverageAmount
    }); 

    const trade = await getTradingStats(signal.symbol);
    console.log(trade);
  },

  onError: (error) => {
    console.log(`Custom error handler:`, error);
  }
  };

  const BTC = new BybitWebsocketFeed(options);

  // Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Closing WebSocket connections...');
    BTC.close();
    process.exit(0);
  });