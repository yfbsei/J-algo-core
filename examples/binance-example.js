/**
 * Example usage of J-Algo Trading System with Binance
 * Shows various tracking and reporting options
 */

import { BinanceWebsocketFeed } from '../index.js';

// Create Binance WebSocket feed instance
const binanceFeed = new BinanceWebsocketFeed({
    symbol: 'BTCUSDT',     // Trading pair
    timeframe: '5m',       // Timeframe (1m, 5m, 15m, 1h, etc.)
    market: 'futures',     // 'futures' or 'spot'
    
    // Risk management configuration
    riskOptions: {
        initialCapital: 10000,      // Starting capital
        riskPerTrade: 2.0,          // Risk per trade (percentage)
        rewardMultiple: 1.5,        // Risk/reward ratio (TP level calculation)
        useLeverage: true,          // Enable/disable leverage
        leverageAmount: 3.0,        // Leverage amount if enabled
        useScalpMode: false         // Use faster signals for scalping
    },
    
    // Custom event handlers (override default handlers)
    onSignal: (signal) => {
        console.log('==== CUSTOM SIGNAL HANDLER ====');
        console.log(`SIGNAL: ${signal.position.toUpperCase()} at ${signal.location}`);
        console.log('===============================');
    },
    
    onPositionOpen: (position) => {
        console.log('==== CUSTOM POSITION OPEN HANDLER ====');
        console.log(`OPENED: ${position.position.toUpperCase()} at ${position.entry}`);
        console.log(`Target: ${position.target}`);
        console.log(`Risk Amount: $${position.risk}`);
        console.log('======================================');
    },
    
    onPositionClosed: (result) => {
        console.log('==== CUSTOM POSITION CLOSE HANDLER ====');
        console.log(`CLOSED: ${result.position.toUpperCase()} at ${result.exit}`);
        console.log(`P&L: $${result.pnl.toFixed(2)}`);
        console.log(`Reason: ${result.closeReason}`);
        console.log('=======================================');
    },
    
    onTakeProfitHit: (result) => {
        console.log('==== CUSTOM TP HIT HANDLER ====');
        console.log(`TP HIT: ${result.position.toUpperCase()} at ${result.exit}`);
        console.log(`P&L: $${result.pnl.toFixed(2)}`);
        console.log('===============================');
    }
});

/**
 * Get and display various trading statistics
 * Call this function periodically or on demand
 */
function displayTradingStats() {
    try {
        // Get performance stats
        const stats = binanceFeed.getStats();
        
        console.log('\n============ BINANCE TRADING STATISTICS ============');
        
        // Overall performance metrics
        console.log('--- Performance Summary ---');
        console.log(`Symbol: ${stats.symbol}`);
        console.log(`Provider: ${stats.provider}`);
        console.log(`Initial Capital: $${stats.initialCapital}`);
        console.log(`Current Capital: $${stats.currentCapital}`);
        console.log(`Total P&L: $${stats.totalProfitLoss}`);
        console.log(`Total Profit: $${stats.totalProfit}`);
        console.log(`Total Loss: $${stats.totalLoss}`);
        
        // Trading metrics
        console.log('\n--- Trading Metrics ---');
        console.log(`Total Trades: ${stats.totalTrades}`);
        console.log(`Long Trades: ${stats.longTrades} (${stats.longWins} wins, ${stats.longLosses} losses)`);
        console.log(`Short Trades: ${stats.shortTrades} (${stats.shortWins} wins, ${stats.shortLosses} losses)`);
        console.log(`Long Win Rate: ${stats.longWinRate}%`);
        console.log(`Short Win Rate: ${stats.shortWinRate}%`);
        console.log(`Overall Win Rate: ${stats.overallWinRate}%`);
        console.log(`Long Target Hits: ${stats.longTargetHits}`);
        console.log(`Short Target Hits: ${stats.shortTargetHits}`);
        
        // Risk metrics
        console.log('\n--- Risk Metrics ---');
        console.log(`Risk Per Trade: ${stats.riskPerTrade}%`);
        console.log(`Reward Multiple: ${stats.rewardRatio}`);
        console.log(`Efficiency: ${stats.efficiency}%`);
        console.log(`Leverage: ${stats.leverageAmount}`);
        console.log(`Scalp Mode: ${stats.scalpMode ? 'ON' : 'OFF'}`);
        
        console.log('\n--- Active Position Status ---');
        
        // Log active position (if any)
        binanceFeed.logActivePosition();
        
        // Access trade history (optional)
        // const tradeHistory = binanceFeed.jalgo.getTradeHistory();
        // console.log('\n--- Recent Trade History ---');
        // console.log(tradeHistory.slice(-5)); // Show last 5 trades
        
        console.log('====================================================\n');
    } catch (error) {
        console.error('Error displaying trading stats:', error);
    }
}

/**
 * Manually close a position (if active)
 * @param {number} currentPrice - Current market price to close at
 */
function manuallyClosePosition(currentPrice) {
    try {
        const result = binanceFeed.jalgo.manuallyClosePosition(currentPrice);
        
        if (result && !result.error) {
            console.log('\n============ MANUAL POSITION CLOSE ============');
            console.log(`Position: ${result.position.toUpperCase()}`);
            console.log(`Close Price: ${result.exit}`);
            console.log(`P&L: $${result.pnl.toFixed(2)}`);
            console.log(`New Capital: $${result.capitalAfter.toFixed(2)}`);
            console.log('===============================================\n');
        } else if (result && result.error) {
            console.log(`\nError closing position: ${result.error}\n`);
        } else {
            console.log('\nNo active position to close\n');
        }
    } catch (error) {
        console.error('Error manually closing position:', error);
    }
}

// Display stats initially
setTimeout(() => {
    displayTradingStats();
}, 5000);

// Display stats every 15 minutes
setInterval(() => {
    displayTradingStats();
}, 15 * 60 * 1000);

// Example of manual close - uncomment to use
// setTimeout(() => {
//     // Close at current market price (example: 40000)
//     manuallyClosePosition(40000);
// }, 30 * 60 * 1000);

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('Shutting down Binance feed...');
    binanceFeed.close();
    process.exit(0);
});

console.log('Binance trading system started. Press Ctrl+C to exit.');
