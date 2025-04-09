/**
 * Example usage of BinanceWebsocketFeed with event handling
 */

import { BinanceWebsocketFeed } from './binance-websocket.js';

// Define event handlers
const onSignal = (signal) => {
  console.log(`Signal detected: ${signal.position.toUpperCase()} at ${signal.location}`);
};

const onPositionOpen = (position) => {
  console.log(`New ${position.position} position opened at ${position.entry}`);
  console.log(`Target: ${position.target}, Risk: $${position.risk}`);
};

const onPositionClosed = (result) => {
  const profitOrLoss = result.pnl >= 0 ? `profit: +$${result.pnl.toFixed(2)}` : `loss: -$${Math.abs(result.pnl).toFixed(2)}`;
  console.log(`${result.position.toUpperCase()} position closed with ${profitOrLoss}`);
  console.log(`Reason: ${result.closeReason}, New balance: $${result.capitalAfter.toFixed(2)}`);
};

const onTakeProfitHit = (result) => {
  console.log(`🎯 Take profit hit! ${result.position.toUpperCase()} position with profit: +$${result.pnl.toFixed(2)}`);
};

const onError = (error) => {
  console.error(`Error occurred: ${error.message || error}`);
};

// Create a futures market feed with event handlers
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
    },
    // Add event handlers
    onSignal,
    onPositionOpen,
    onPositionClosed,
    onTakeProfitHit,
    onError
});

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('Shutting down...');
    futuresFeed.close();
    process.exit(0);
});

// Print stats every 30 minutes
setInterval(() => {
    console.log('\n========== FUTURES TRADING STATS ==========');
    console.table(futuresFeed.getStats());
    
    // Log current position if any
    futuresFeed.logActivePosition();
}, 30 * 60 * 1000);

console.log('Trading bot started successfully with event handling. Press Ctrl+C to exit.');