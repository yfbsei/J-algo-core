import jalgo from './src/jAlgo.js';
import WebSocket from 'ws';
import https from 'https';

/**
 * J-Algo Trading Strategy Example with Binance API Integration
 * 
 * This example demonstrates how to:
 * 1. Fetch historical candle data from Binance REST API
 * 2. Set up a WebSocket connection for real-time price updates
 * 3. Apply the J-Trend Sniper algorithm to the price data
 * 4. Log trade signals and perform backtesting
 */

// ===== Configuration =====
const CONFIG = {
    symbol: 'BTCUSDT',    // Trading pair
    interval: '5m',       // Candlestick interval (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, etc.)
    limit: 500,           // Number of historical candles to fetch
    marketType: 'futures',   // Market type: 'spot' or 'futures'
    testnet: false,       // Use testnet for futures (safer for testing)
    algoOptions: {
        // Main parameters
        length: 6,              // Fast Length
        period: 16,             // ATR Period
        multiplier: 9,          // ATR Multiplier
        fast_multiplier: 5.1,   // Fast ATR Multiplier
        
        // Scalp mode parameters
        useScalpMode: true,    // Use Scalp Line mode
        scalpPeriod: 21,        // Scalp Line Period
        
        // Risk-reward parameters
        rewardMultiple: 1.5,    // Reward Multiple (Target = Risk × Multiple)
        initialCapital: 100,   // Initial Capital ($)
        riskPerTrade: 10,      // Risk Per Trade (%)
        
        // Leverage parameters
        useLeverage: true,     // Use Leverage (automatically set to true when using futures)
        leverageAmount: 2.0,    // Leverage Amount (1-125x depending on the pair for futures)
    }
};

// ===== Data Storage =====
let candleData = {
    timestamp: [],
    open: [],
    high: [],
    low: [],
    close: [],
    volume: []
};

let activeTrades = [];
let tradeHistory = [];

// ===== Utility Functions =====

/**
 * Fetches historical candlestick data from Binance API
 * @returns {Promise} - Promise that resolves when data is fetched
 */
function fetchHistoricalData() {
    return new Promise((resolve, reject) => {
        // Determine the URL based on market type
        let url;
        
        if (CONFIG.marketType === 'futures') {
            // Use futures API
            const baseUrl = CONFIG.testnet ? 
                'https://testnet.binancefuture.com' : 
                'https://fapi.binance.com';
                
            url = `${baseUrl}/fapi/v1/klines?symbol=${CONFIG.symbol}&interval=${CONFIG.interval}&limit=${CONFIG.limit}`;
        } else {
            // Use spot API
            url = `https://api.binance.com/api/v3/klines?symbol=${CONFIG.symbol}&interval=${CONFIG.interval}&limit=${CONFIG.limit}`;
        }
        
        console.log(`Fetching data from: ${url}`);
        
        https.get(url, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const klines = JSON.parse(data);
                    processHistoricalData(klines);
                    resolve();
                } catch (error) {
                    console.error('Error parsing Binance API response:', error);
                    reject(error);
                }
            });
        }).on('error', (error) => {
            console.error('Error fetching historical data:', error);
            reject(error);
        });
    });
}

/**
 * Processes raw kline data from Binance API into structured format
 * @param {Array} klines - Raw kline data from Binance
 */
function processHistoricalData(klines) {
    // Clear existing data
    candleData = {
        timestamp: [],
        open: [],
        high: [],
        low: [],
        close: [],
        volume: []
    };
    
    // Process each candle
    klines.forEach(candle => {
        // Binance kline format: [time, open, high, low, close, volume, ...]
        candleData.timestamp.push(Number(candle[0]));
        candleData.open.push(Number(candle[1]));
        candleData.high.push(Number(candle[2]));
        candleData.low.push(Number(candle[3]));
        candleData.close.push(Number(candle[4]));
        candleData.volume.push(Number(candle[5]));
    });
    
    console.log(`Loaded ${candleData.close.length} historical candles for ${CONFIG.symbol}`);
}

/**
 * Sets up WebSocket connection to Binance for real-time updates
 */
function setupWebSocket() {
    // Determine WebSocket URL based on market type
    let wsUrl;
    
    if (CONFIG.marketType === 'futures') {
        // Use futures WebSocket
        const baseWsUrl = CONFIG.testnet ? 
            'wss://stream.binancefuture.com' : 
            'wss://fstream.binance.com';
            
        wsUrl = `${baseWsUrl}/ws/${CONFIG.symbol.toLowerCase()}@kline_${CONFIG.interval}`;
    } else {
        // Use spot WebSocket
        wsUrl = `wss://stream.binance.com:9443/ws/${CONFIG.symbol.toLowerCase()}@kline_${CONFIG.interval}`;
    }
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    
    const ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
        console.log(`WebSocket connection established for ${CONFIG.symbol} (${CONFIG.marketType} market)`);
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // Check if we have a valid kline
            if (message.e === 'kline') {
                const candle = message.k;
                
                // Only process completed candles to avoid noise
                if (candle.x) { // x = is this kline closed?
                    updateLatestCandle(candle);
                    runAlgorithm();
                }
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
    
    ws.on('close', () => {
        console.log('WebSocket connection closed');
        // Attempt to reconnect after a delay
        setTimeout(setupWebSocket, 5000);
    });
    
    return ws;
}

/**
 * Updates data storage with the latest candle from WebSocket
 * @param {Object} candle - Candle data from WebSocket
 */
function updateLatestCandle(candle) {
    // Check if this candle is already in our data
    const lastTimestamp = candleData.timestamp[candleData.timestamp.length - 1];
    
    if (candle.t === lastTimestamp) {
        // Update the last candle
        candleData.close[candleData.close.length - 1] = Number(candle.c);
        candleData.high[candleData.high.length - 1] = Number(candle.h);
        candleData.low[candleData.low.length - 1] = Number(candle.l);
        candleData.volume[candleData.volume.length - 1] = Number(candle.v);
    } else {
        // Add new candle
        candleData.timestamp.push(Number(candle.t));
        candleData.open.push(Number(candle.o));
        candleData.high.push(Number(candle.h));
        candleData.low.push(Number(candle.l));
        candleData.close.push(Number(candle.c));
        candleData.volume.push(Number(candle.v));
        
        // Keep data size consistent by removing oldest entry if needed
        if (candleData.timestamp.length > CONFIG.limit) {
            candleData.timestamp.shift();
            candleData.open.shift();
            candleData.high.shift();
            candleData.low.shift();
            candleData.close.shift();
            candleData.volume.shift();
        }
    }
    
    const date = new Date(candle.t);
    console.log(`Updated data with candle: ${date.toISOString()} - O: ${candle.o}, H: ${candle.h}, L: ${candle.l}, C: ${candle.c}`);
}

/**
 * Runs the J-Algo trading algorithm on the current data
 */
function runAlgorithm() {
    // Prepare data in the format expected by jalgo
    const source = {
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close
    };
    
    // Run the algorithm
    const result = jalgo(source, CONFIG.algoOptions);
    
    // Check for signals
    if (result.signal) {
        const signal = result.signal;
        const currentPrice = candleData.close[candleData.close.length - 1];
        const timestamp = candleData.timestamp[candleData.timestamp.length - 1];
        const date = new Date(timestamp);
        
        console.log('----------------------------------------');
        console.log(`SIGNAL DETECTED at ${date.toISOString()}`);
        console.log(`Position: ${signal.position.toUpperCase()}`);
        console.log(`Entry Price: ${signal.location}`);
        console.log(`Stop Level: ${signal.stopLevel}`);
        console.log(`Target Level: ${signal.targetLevel}`);
        console.log(`Risk Amount: $${signal.riskAmount}`);
        console.log(`Reward Amount: $${signal.rewardAmount}`);
        
        if (signal.liquidationLevel) {
            console.log(`Liquidation Level: ${signal.liquidationLevel}`);
        }
        
        // Add to active trades
        activeTrades.push({
            ...signal,
            entryTime: date,
            entryTimestamp: timestamp
        });
        
        console.log('----------------------------------------');
    }
    
    // Update active trades (check for exits, targets hit, etc.)
    updateActiveTrades();
    
    // Log some statistics
    const stats = result.calculateStats();
    
    if (tradeHistory.length > 0) {
        console.log('Current Trading Statistics:');
        console.log(`Total Trades: ${stats.totalTrades}`);
        console.log(`Win Rate: ${stats.overallWinRate.toFixed(2)}%`);
        console.log(`Current Capital: $${stats.currentCapital.toFixed(2)}`);
        console.log(`P/L: $${stats.totalProfitLoss.toFixed(2)}`);
    }
}

/**
 * Updates all active trades with the latest price data
 */
function updateActiveTrades() {
    const latestHigh = candleData.high[candleData.high.length - 1];
    const latestLow = candleData.low[candleData.low.length - 1];
    const latestClose = candleData.close[candleData.close.length - 1];
    const latestTimestamp = candleData.timestamp[candleData.timestamp.length - 1];
    const date = new Date(latestTimestamp);
    
    // Process each active trade
    const remainingTrades = [];
    
    activeTrades.forEach(trade => {
        let isTradeCompleted = false;
        let exitReason = '';
        let exitPrice = 0;
        let profit = 0;
        
        // Check for long position exits
        if (trade.position === 'long') {
            // Check if target was hit
            if (latestHigh >= trade.targetLevel) {
                isTradeCompleted = true;
                exitReason = 'Target Hit';
                exitPrice = trade.targetLevel;
                profit = trade.rewardAmount;
            }
            // Check if stop was hit
            else if (latestLow <= trade.stopLevel) {
                isTradeCompleted = true;
                exitReason = 'Stop Hit';
                exitPrice = trade.stopLevel;
                profit = -trade.riskAmount;
            }
            // Check if liquidation was hit (if using leverage)
            else if (trade.liquidationLevel && latestLow <= trade.liquidationLevel) {
                isTradeCompleted = true;
                exitReason = 'Liquidation';
                exitPrice = trade.liquidationLevel;
                profit = -trade.riskAmount; // Full loss in case of liquidation
            }
        }
        // Check for short position exits
        else if (trade.position === 'short') {
            // Check if target was hit
            if (latestLow <= trade.targetLevel) {
                isTradeCompleted = true;
                exitReason = 'Target Hit';
                exitPrice = trade.targetLevel;
                profit = trade.rewardAmount;
            }
            // Check if stop was hit
            else if (latestHigh >= trade.stopLevel) {
                isTradeCompleted = true;
                exitReason = 'Stop Hit';
                exitPrice = trade.stopLevel;
                profit = -trade.riskAmount;
            }
            // Check if liquidation was hit (if using leverage)
            else if (trade.liquidationLevel && latestHigh >= trade.liquidationLevel) {
                isTradeCompleted = true;
                exitReason = 'Liquidation';
                exitPrice = trade.liquidationLevel;
                profit = -trade.riskAmount; // Full loss in case of liquidation
            }
        }
        
        // If trade is completed, add to history
        if (isTradeCompleted) {
            const completedTrade = {
                ...trade,
                exitTime: date,
                exitTimestamp: latestTimestamp,
                exitPrice: exitPrice,
                exitReason: exitReason,
                profit: profit
            };
            
            tradeHistory.push(completedTrade);
            
            console.log('----------------------------------------');
            console.log(`TRADE COMPLETED at ${date.toISOString()}`);
            console.log(`Position: ${trade.position.toUpperCase()}`);
            console.log(`Entry Price: ${trade.location}`);
            console.log(`Exit Price: ${exitPrice}`);
            console.log(`Exit Reason: ${exitReason}`);
            console.log(`P/L: $${profit.toFixed(2)}`);
            console.log('----------------------------------------');
        } else {
            // Trade still active
            remainingTrades.push(trade);
        }
    });
    
    // Update active trades
    activeTrades = remainingTrades;
}

/**
 * Performs backtest on historical data
 */
function runBacktest() {
    console.log('Running backtest on historical data...');
    
    // Reset trade history for backtest
    tradeHistory = [];
    activeTrades = [];
    
    // Create a copy of the candleData for progressive testing
    const backtestData = {
        open: [],
        high: [],
        low: [],
        close: [],
        timestamp: [...candleData.timestamp]
    };
    
    // Process each historical candle sequentially
    for (let i = CONFIG.algoOptions.period + CONFIG.algoOptions.length; i < candleData.close.length; i++) {
        // Add data up to current candle (simulating having only this much data available)
        backtestData.open = candleData.open.slice(0, i + 1);
        backtestData.high = candleData.high.slice(0, i + 1);
        backtestData.low = candleData.low.slice(0, i + 1);
        backtestData.close = candleData.close.slice(0, i + 1);
        
        // Run algorithm on this subset of data
        const result = jalgo(backtestData, CONFIG.algoOptions);
        
        // Process signals
        if (result.signal) {
            const signal = result.signal;
            const currentPrice = backtestData.close[backtestData.close.length - 1];
            const timestamp = backtestData.timestamp[backtestData.timestamp.length - 1];
            const date = new Date(timestamp);
            
            // Add to active trades
            activeTrades.push({
                ...signal,
                entryTime: date,
                entryTimestamp: timestamp
            });
        }
        
        // Simulate looking ahead to next candle for trade resolution
        if (i < candleData.close.length - 1) {
            const nextCandle = {
                high: candleData.high[i + 1],
                low: candleData.low[i + 1],
                close: candleData.close[i + 1],
                timestamp: candleData.timestamp[i + 1]
            };
            
            // Process trade outcomes with next candle data
            simulateTradeOutcomes(nextCandle);
        }
    }
    
    // Display backtest results
    printBacktestSummary();
}

/**
 * Simulates trade outcomes using the next candle data
 * @param {Object} nextCandle - Data for the next candle to use for simulating outcomes
 */
function simulateTradeOutcomes(nextCandle) {
    const remainingTrades = [];
    
    activeTrades.forEach(trade => {
        let isTradeCompleted = false;
        let exitReason = '';
        let exitPrice = 0;
        let profit = 0;
        
        // Process long positions
        if (trade.position === 'long') {
            // Check if target was hit in next candle
            if (nextCandle.high >= trade.targetLevel) {
                isTradeCompleted = true;
                exitReason = 'Target Hit';
                exitPrice = trade.targetLevel;
                profit = trade.rewardAmount;
            }
            // Check if stop was hit in next candle
            else if (nextCandle.low <= trade.stopLevel) {
                isTradeCompleted = true;
                exitReason = 'Stop Hit';
                exitPrice = trade.stopLevel;
                profit = -trade.riskAmount;
            }
            // Check if liquidation was hit (if using leverage)
            else if (trade.liquidationLevel && nextCandle.low <= trade.liquidationLevel) {
                isTradeCompleted = true;
                exitReason = 'Liquidation';
                exitPrice = trade.liquidationLevel;
                profit = -trade.riskAmount;
            }
        }
        // Process short positions
        else if (trade.position === 'short') {
            // Check if target was hit in next candle
            if (nextCandle.low <= trade.targetLevel) {
                isTradeCompleted = true;
                exitReason = 'Target Hit';
                exitPrice = trade.targetLevel;
                profit = trade.rewardAmount;
            }
            // Check if stop was hit in next candle
            else if (nextCandle.high >= trade.stopLevel) {
                isTradeCompleted = true;
                exitReason = 'Stop Hit';
                exitPrice = trade.stopLevel;
                profit = -trade.riskAmount;
            }
            // Check if liquidation was hit (if using leverage)
            else if (trade.liquidationLevel && nextCandle.high >= trade.liquidationLevel) {
                isTradeCompleted = true;
                exitReason = 'Liquidation';
                exitPrice = trade.liquidationLevel;
                profit = -trade.riskAmount;
            }
        }
        
        // If trade is completed, add to history
        if (isTradeCompleted) {
            const date = new Date(nextCandle.timestamp);
            const completedTrade = {
                ...trade,
                exitTime: date,
                exitTimestamp: nextCandle.timestamp,
                exitPrice: exitPrice,
                exitReason: exitReason,
                profit: profit
            };
            
            tradeHistory.push(completedTrade);
        } else {
            // Trade still active
            remainingTrades.push(trade);
        }
    });
    
    // Update active trades
    activeTrades = remainingTrades;
}

/**
 * Prints backtest summary statistics
 */
function printBacktestSummary() {
    console.log('========== BACKTEST SUMMARY ==========');
    console.log(`Symbol: ${CONFIG.symbol}, Interval: ${CONFIG.interval}`);
    console.log(`Timeframe: ${new Date(candleData.timestamp[0]).toISOString()} to ${new Date(candleData.timestamp[candleData.timestamp.length - 1]).toISOString()}`);
    
    // Count statistics
    const totalTrades = tradeHistory.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let longWins = 0;
    let longLosses = 0;
    let shortWins = 0;
    let shortLosses = 0;
    
    tradeHistory.forEach(trade => {
        if (trade.profit > 0) {
            winningTrades++;
            totalProfit += trade.profit;
            
            if (trade.position === 'long') {
                longWins++;
            } else {
                shortWins++;
            }
        } else {
            losingTrades++;
            totalLoss += Math.abs(trade.profit);
            
            if (trade.position === 'long') {
                longLosses++;
            } else {
                shortLosses++;
            }
        }
    });
    
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;
    const netProfit = totalProfit - totalLoss;
    
    // Calculate starting and ending capital
    const initialCapital = CONFIG.algoOptions.initialCapital;
    const finalCapital = initialCapital + netProfit;
    const percentReturn = ((finalCapital / initialCapital) - 1) * 100;
    
    // Print statistics
    console.log(`Total Trades: ${totalTrades}`);
    console.log(`Winning Trades: ${winningTrades} (${winRate.toFixed(2)}%)`);
    console.log(`Losing Trades: ${losingTrades} (${(100 - winRate).toFixed(2)}%)`);
    console.log('----------------------------------------');
    console.log(`Long Trades: ${longWins + longLosses}`);
    console.log(`Long Wins: ${longWins}, Long Losses: ${longLosses}`);
    console.log(`Long Win Rate: ${longWins + longLosses > 0 ? ((longWins / (longWins + longLosses)) * 100).toFixed(2) : 0}%`);
    console.log('----------------------------------------');
    console.log(`Short Trades: ${shortWins + shortLosses}`);
    console.log(`Short Wins: ${shortWins}, Short Losses: ${shortLosses}`);
    console.log(`Short Win Rate: ${shortWins + shortLosses > 0 ? ((shortWins / (shortWins + shortLosses)) * 100).toFixed(2) : 0}%`);
    console.log('----------------------------------------');
    console.log(`Total Profit: $${totalProfit.toFixed(2)}`);
    console.log(`Total Loss: $${totalLoss.toFixed(2)}`);
    console.log(`Net Profit: $${netProfit.toFixed(2)}`);
    console.log(`Profit Factor: ${profitFactor.toFixed(2)}`);
    console.log('----------------------------------------');
    console.log(`Initial Capital: $${initialCapital.toFixed(2)}`);
    console.log(`Final Capital: $${finalCapital.toFixed(2)}`);
    console.log(`Return: ${percentReturn.toFixed(2)}%`);
    console.log('========================================');
}

/**
 * Validates configuration settings
 */
function validateConfig() {
    // Validate market type
    if (!['spot', 'futures'].includes(CONFIG.marketType)) {
        throw new Error(`Invalid market type: ${CONFIG.marketType}. Must be 'spot' or 'futures'.`);
    }
    
    // Validate symbol format
    if (!CONFIG.symbol || typeof CONFIG.symbol !== 'string') {
        throw new Error('Symbol must be a valid string');
    }
    
    // Check for correct futures setup
    if (CONFIG.marketType === 'futures') {
        // Auto-enable leverage for futures trading
        if (CONFIG.algoOptions.useLeverage === false) {
            console.warn('Note: Auto-enabling leverage for futures trading.');
            CONFIG.algoOptions.useLeverage = true;
        }
        
        // Warn about high leverage
        if (CONFIG.algoOptions.leverageAmount > 20) {
            console.warn(`Warning: Using very high leverage (${CONFIG.algoOptions.leverageAmount}x). This significantly increases risk of liquidation.`);
        }
    }
    
    console.log(`Validated configuration: ${CONFIG.marketType} market using ${CONFIG.symbol} on ${CONFIG.interval} timeframe`);
    
    if (CONFIG.marketType === 'futures') {
        console.log(`Futures mode: Using ${CONFIG.testnet ? 'TESTNET' : 'MAINNET'} with leverage set to ${CONFIG.algoOptions.useLeverage ? CONFIG.algoOptions.leverageAmount + 'x' : 'OFF'}`);
    }
}

/**
 * Main function to run the application
 */
async function main() {
    try {
        console.log('Starting J-Algo Example with Binance API...');
        
        // Step 0: Validate configuration
        validateConfig();
        
        // Step 1: Fetch historical data
        console.log(`Fetching historical data for ${CONFIG.symbol}...`);
        await fetchHistoricalData();
        
        // Step 2: Run backtest on historical data
        runBacktest();
        
        // Step 3: Set up WebSocket for real-time updates
        console.log('Setting up WebSocket for real-time updates...');
        const ws = setupWebSocket();
        
        // Step 4: Run initial algorithm with current data
        console.log('Running initial algorithm...');
        runAlgorithm();
        
        console.log('Setup complete. Waiting for real-time updates...');
        console.log(`\nTo exit, press Ctrl+C\n`);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            if (ws) {
                ws.close();
            }
            printBacktestSummary();
            process.exit(0);
        });
    } catch (error) {
        console.error('Error in main function:', error);
    }
}

// Run the application
main();