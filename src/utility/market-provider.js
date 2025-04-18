/**
 * Market provider factory for supporting multiple exchanges
 */

import binance_candles from './binance-market.js';
import bybit_candles from './bybit-market.js';

/**
 * Factory function to get the appropriate market data fetcher
 * @param {string} provider - Exchange provider name ('binance' or 'bybit')
 * @param {string} market - Market type ('spot' or 'futures')
 * @param {string} symbol - Trading pair symbol
 * @param {string} interval - Candle interval
 * @param {number} limit - Number of candles to fetch
 * @returns {Promise<Object>} - Promise resolving to OHLCV data
 */
const getMarketData = async (provider, market, symbol, interval, limit) => {
    switch (provider.toLowerCase()) {
        case 'binance':
            return binance_candles(market, symbol, interval, limit);
        case 'bybit':
            return bybit_candles(market, symbol, interval, limit);
        default:
            throw new Error(`Unsupported exchange provider: ${provider}`);
    }
};

/**
 * Get WebSocket base URL for the given provider and market
 * @param {string} provider - Exchange provider name
 * @param {string} market - Market type ('spot' or 'futures')
 * @returns {string} - WebSocket base URL
 */
// const getWebSocketBaseUrl = (provider, market) => {
//     switch (provider.toLowerCase()) {
//         case 'binance':
//             return market === 'spot' 
//                 ? 'wss://stream.binance.com:9443/ws'
//                 : 'wss://fstream.binance.com/ws';
//         case 'bybit':
//             return 'wss://stream.bybit.com/v5/public';
//         default:
//             throw new Error(`Unsupported exchange provider: ${provider}`);
//     }
// };

/**
 * Convert standard interval to provider-specific format
 * @param {string} provider - Exchange provider name
 * @param {string} interval - Standard interval (e.g. "1m", "5m", "1h", "1d")
 * @returns {string} - Provider-specific interval format
 */
const convertInterval = (provider, interval) => {
    if (provider.toLowerCase() === 'binance') {
        // Binance already uses the standard format
        return interval;
    } else if (provider.toLowerCase() === 'bybit') {
        // Map to Bybit intervals
        const intervalMap = {
            "1m": "1",
            "3m": "3",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "1h": "60",
            "2h": "120",
            "4h": "240",
            "6h": "360",
            "12h": "720",
            "1d": "D",
            "1w": "W",
            "1M": "M"
        };
        return intervalMap[interval] || interval;
    }
    return interval; // Default return original
};

/**
 * Format candle data from WebSocket to a standard format
 * @param {string} provider - Exchange provider name
 * @param {Object} wsData - WebSocket data from exchange
 * @returns {Object|null} - Standardized candle data or null if invalid
 */
// const formatWebSocketCandle = (provider, wsData) => {
//     try {
//         if (provider.toLowerCase() === 'binance') {
//             // Binance format already matches our expected format
//             if (wsData.e === 'kline') {
//                 return {
//                     t: wsData.k.t,
//                     o: wsData.k.o,
//                     h: wsData.k.h,
//                     l: wsData.k.l,
//                     c: wsData.k.c,
//                     v: wsData.k.v,
//                     x: wsData.k.x // candle closed
//                 };
//             }
//         } else if (provider.toLowerCase() === 'bybit') {
//             // Convert Bybit format to our standard format
//             if (wsData.topic && wsData.topic.includes('kline')) {
//                 const data = wsData.data[0];
//                 return {
//                     t: parseInt(data.start),
//                     o: data.open,
//                     h: data.high,
//                     l: data.low,
//                     c: data.close,
//                     v: data.volume,
//                     x: data.confirm // candle closed
//                 };
//             }
//         }
//         return null; // Not a candle or unsupported format
//     } catch (error) {
//         console.error(`Error formatting WebSocket candle for ${provider}:`, error);
//         return null;
//     }
// };

export {
    getMarketData,
    //getWebSocketBaseUrl,
    convertInterval,
    //formatWebSocketCandle
};