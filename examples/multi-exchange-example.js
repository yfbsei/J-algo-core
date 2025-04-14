/**
 * Example usage of Multi-Exchange Trading Engine
 * Running both Binance and Bybit simultaneously
 */

import MultiExchangeEngine from '../src/multi-exchange/engine.js';

// Create and configure the Multi-Exchange Engine
const engine = new MultiExchangeEngine({
    tradingStrategy: 'independent', // 'independent', 'mirror', or 'consensus'
    riskStrategy: 'independent', // 'independent' or 'coordinated'
    consensusThreshold: 2, // Required for 'consensus' strategy
    enableDetailedLogs: true, // Set to false for less verbose output
    
    // Configure exchanges
    exchanges: [
        // Binance BTC Futures
        {
            provider: 'binance',
            symbol: 'BTCUSDT',
            timeframe: '5m',
            market: 'futures',
            riskOptions: {
                initialCapital: 1000,
                riskPerTrade: 2.0,
                rewardMultiple: 1.5,
                useLeverage: true,
                leverageAmount: 3.0,
                useScalpMode: false
            }
        },
        
        // Bybit BTC Futures
        {
            provider: 'bybit',
            symbol: 'BTCUSDT',
            timeframe: '5m',
            market: 'futures',
            riskOptions: {
                initialCapital: 1000,
                riskPerTrade: 2.0,
                rewardMultiple: 1.5,
                useLeverage: true,
                leverageAmount: 3.0,
                useScalpMode: false
            }
        },
        
        // Binance ETH Futures - different symbol example
        {
            provider: 'binance',
            symbol: 'ETHUSDT',
            timeframe: '5m',
            market: 'futures',
            riskOptions: {
                initialCapital: 1000,
                riskPerTrade: 2.0,
                rewardMultiple: 1.5,
                useLeverage: true,
                leverageAmount: 3.0,
                useScalpMode: false
            }
        },
        
        // Bybit ETH Futures - different symbol example
        {
            provider: 'bybit',
            symbol: 'ETHUSDT',
            timeframe: '5m',
            market: 'futures',
            riskOptions: {
                initialCapital: 1000,
                riskPerTrade: 2.0,
                rewardMultiple: 1.5,
                useLeverage: true,
                leverageAmount: 3.0,
                useScalpMode: false
            }
        }
    ]
});

// Start the engine
engine.start();

// Print consolidated stats every 30 minutes
setInterval(() => {
    console.log('\n========== MULTI-EXCHANGE TRADING STATS ==========');
    console.table(engine.getConsolidatedStats().exchanges);
    
    const totalStats = engine.getConsolidatedStats();
    console.log(`Total Trades: ${totalStats.totalTrades}`);
    console.log(`Total PnL: $${totalStats.totalPnl}`);
    console.log(`Total Capital: $${totalStats.totalCapital}`);
    
    // Log all active positions
    engine.logAllActivePositions();
}, 30 * 60 * 1000); // Every 30 minutes

// Graceful shutdown handler
process.on('SIGINT', () => {
    console.log('Shutting down...');
    engine.stop();
    process.exit(0);
});

console.log('Multi-Exchange Trading Engine started successfully. Press Ctrl+C to exit.');