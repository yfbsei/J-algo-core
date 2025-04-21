import BybitWebsocketFeed from '../../src/exchanges/bybit-feed.js'
import { getWalletBalance, closePosition, calculateQty, submitTradeWithTPSL } from './client.js';
import { getTradingStats } from './stats.js';

const USDT_balance = await getWalletBalance(); // BTC.jalgo.riskManager.initialCapital * 33%

const createOptions = ({
  symbol = "BTCUSDT",
  timeframe = "1m",
  market = "futures",
  rewardMultiple = 1,
  scalpMode = false,
  leverageAmount = 10
} = {}) => {
  return {
    symbol,
    timeframe,
    market,
    rewardMultiple,
    scalpMode,

    onSignal: async (signal) => {
      await closePosition(signal.symbol);

      await submitTradeWithTPSL(
        signal.symbol,
        signal.position,
        await calculateQty(signal.symbol, USDT_balance * (0.01 / 100)),
        signal.target.toString(),
        signal.stop.toString(),
        leverageAmount
      );

      const trade = await getTradingStats(signal.symbol);
      console.log(trade);
    },

    onTrailingStop: async (val) => val,

    onError: (error) => console.log(`Custom error handler:`, error)
  };
};

const BTC = new BybitWebsocketFeed(createOptions({ leverageAmount: 50 }));
const AERGO = new BybitWebsocketFeed(createOptions({ symbol: "AERGOUSDT" }));


  // Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Closing WebSocket connections...');
    BTC.close();
    AERGO.close;
    process.exit(0);
  });