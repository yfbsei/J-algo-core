/**
 * Example usage of BinanceWebsocketFeed
 */

import { BinanceWebsocketFeed } from './binance-websocket.js';

// Create a spot market feed
// const spotFeed = new BinanceWebsocketFeed({
//     symbol: 'ETHUSDT',
//     timeframe: '1m',
//     market: 'spot',
//     riskOptions: {
//         initialCapital: 1000,
//         riskPerTrade: 1.5,
//         rewardMultiple: 2.0,
//         useLeverage: false
//     }
// });

// Create a futures market feed
const futuresFeed = new BinanceWebsocketFeed({
    symbol: 'BTCUSDT',
    timeframe: '1m',
    market: 'futures',
    riskOptions: {
        initialCapital: 100,
        riskPerTrade: 10,
        rewardMultiple: 0.5,
        useLeverage: true,
        leverageAmount: 10,
        useScalpMode: false
    }
});

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('Shutting down...');
    // spotFeed.close();
    futuresFeed.close();
    process.exit(0);
});

// Print stats every 30 minutes
setInterval(() => {
    // console.log('\n========== SPOT TRADING STATS ==========');
    // console.table(spotFeed.getStats());
    
    console.log('\n========== FUTURES TRADING STATS ==========');
    console.table(futuresFeed.getStats());
}, 30 * 60 * 1000);

console.log('Trading bots started successfully. Press Ctrl+C to exit.');
