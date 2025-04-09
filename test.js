import trend_sniper from './src/indicators/jTrendSniper.js';
import binance_candles from './src/utility/binance_market.js';

const candles = await binance_candles("futures", "BTCUSDT", "5m", 500);

const { jATR, var_ma, jATR_sma, fast_jATR_sma, signal} = trend_sniper(candles);

console.log(
    candles
);