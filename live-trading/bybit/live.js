import BybitWebsocketFeed from '../../src/exchanges/bybit-feed.js'
import { getWalletBalance, closePosition, calculateQty, submitTradeWithTP } from './client.js';
import { getTradingStats } from './stats.js';

const USDT_balance = await getWalletBalance(); // BTC.jalgo.riskManager.initialCapital * 33%

  // Create configuration options
const options = {
    symbol: 'BTCUSDT',           // Trading pair symbol
    timeframe: '1m',             // Candlestick timeframe (1m, 5m, 15m, 1h, etc.)
    market: 'futures',           // 'futures' or 'spot'
    rewardMultiple: 0.5,
    scalpMode: false,

      // Custom event handlers
  onSignal: async (signal) => {
    await closePosition(signal.symbol); // check and close trade if open
        
    await submitTradeWithTP(
        signal.symbol, 
        signal.position, 
        await calculateQty(signal.symbol, USDT_balance * (0.01/100)), // riskPerTrade CHANGE FOR PRODCUTION
        signal.target.toString(), 
        10 // leverageAmount
    );

    const trade = await getTradingStats(signal.symbol);
    console.log(trade);
  },

  onTrailingStop: async (val) => {
    await closePosition(options.symbol);
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