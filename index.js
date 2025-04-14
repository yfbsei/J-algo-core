/**
 * J-Algo Trading System
 * Main entry point for the trading algorithm with multi-exchange support
 */

import Jalgo from './src/core/jalgo.js';
import BinanceWebsocketFeed from './src/exchanges/binance-feed.js';
import BybitWebsocketFeed from './src/exchanges/bybit-feed.js';
import MultiExchangeEngine from './src/multi-exchange/engine.js';
import binance_candles from './src/utility/binance-market.js';
import bybit_candles from './src/utility/bybit-market.js';

export { 
    Jalgo,               // Core algorithm class
    BinanceWebsocketFeed,// Binance WebSocket feed
    BybitWebsocketFeed,  // Bybit WebSocket feed
    MultiExchangeEngine, // Multi-exchange engine
    binance_candles,     // Binance market data utility
    bybit_candles        // Bybit market data utility
};

export default Jalgo;