import fs from 'fs/promises';
import jalgo from './src/jAlgo.js';
import fetch from 'node-fetch';  // You may need to install this: npm install node-fetch

/**
 * Example usage of J-Algo for backtesting
 * This script demonstrates how to use the J-Algo library to perform backtesting
 * on historical OHLC data and generate detailed statistics and trade information.
 */

// Enhanced function to fetch multiple batches of historical data from Binance API
async function fetchBinanceData(symbol, interval, totalCandles = 500, market = 'spot', useTestnet = false) {
    try {
        // Determine the base URL based on market type and testnet flag
        let baseUrl;
        if (market === 'futures') {
            baseUrl = useTestnet 
                ? 'https://testnet.binancefuture.com/fapi/v1/klines'
                : 'https://fapi.binance.com/fapi/v1/klines';
        } else {
            // Spot market
            baseUrl = 'https://api.binance.com/api/v3/klines';
        }
        
        // Initialize empty OHLCV object
        const ohlc = {
            date: [],
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        
        // Calculate how many requests we need to make (max 1000 candles per request)
        const batchSize = 1000;
        const batches = Math.ceil(totalCandles / batchSize);
        console.log(`Fetching ${totalCandles} candles in ${batches} batches of max ${batchSize} each`);
        
        // Track the endTime for pagination
        let endTime = Date.now(); // Current time in milliseconds
        
        // Fetch data in batches
        for (let batch = 0; batch < batches; batch++) {
            // Calculate the limit for this batch (may be less than batchSize for the last batch)
            const limit = Math.min(batchSize, totalCandles - (batch * batchSize));
            
            // Construct the API request URL with endTime for pagination
            let url = `${baseUrl}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
            
            // Add endTime parameter if we're not on the first batch
            if (batch > 0) {
                url += `&endTime=${endTime}`;
            }
            
            console.log(`Fetching batch ${batch + 1}/${batches}: ${url}`);
            
            // Fetch data from Binance API
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || !Array.isArray(data) || data.length === 0) {
                console.warn(`No data returned for batch ${batch + 1}`);
                break; // No more data available
            }
            
            // Update endTime for next batch (use the oldest candle's timestamp)
            endTime = data[0][0] - 1;
            
            // Parse Binance kline data into OHLCV format
            data.forEach(candle => {
                // Binance kline format: [time, open, high, low, close, volume, ...]
                const timestamp = new Date(candle[0]);
                ohlc.date.push(timestamp.toISOString());
                ohlc.open.push(parseFloat(candle[1]));
                ohlc.high.push(parseFloat(candle[2]));
                ohlc.low.push(parseFloat(candle[3]));
                ohlc.close.push(parseFloat(candle[4]));
                ohlc.volume.push(parseFloat(candle[5]));
            });
            
            console.log(`Received ${data.length} candles in batch ${batch + 1}`);
            
            // Add a small delay between requests to avoid rate limits
            if (batch < batches - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Reverse the arrays to have oldest data first (since we fetched newest first)
        ohlc.date.reverse();
        ohlc.open.reverse();
        ohlc.high.reverse();
        ohlc.low.reverse();
        ohlc.close.reverse();
        ohlc.volume.reverse();
        
        console.log(`Total candles fetched: ${ohlc.close.length}`);
        
        return ohlc;
    } catch (error) {
        console.error('Error fetching data from Binance:', error);
        return null;
    }
}

// Load historical OHLC data from a CSV file (as a fallback option)
async function loadHistoricalData(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const lines = data.trim().split('\n');
        
        // Skip header line
        const header = lines[0].split(',');
        const dateIndex = header.indexOf('date') >= 0 ? header.indexOf('date') : 0;
        const openIndex = header.indexOf('open') >= 0 ? header.indexOf('open') : 1;
        const highIndex = header.indexOf('high') >= 0 ? header.indexOf('high') : 2;
        const lowIndex = header.indexOf('low') >= 0 ? header.indexOf('low') : 3;
        const closeIndex = header.indexOf('close') >= 0 ? header.indexOf('close') : 4;
        const volumeIndex = header.indexOf('volume') >= 0 ? header.indexOf('volume') : 5;
        
        // Parse data into OHLCV format
        const ohlc = {
            date: [],
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            
            // Skip invalid lines
            if (values.length <= Math.max(dateIndex, openIndex, highIndex, lowIndex, closeIndex, volumeIndex)) {
                continue;
            }
            
            ohlc.date.push(values[dateIndex]);
            ohlc.open.push(parseFloat(values[openIndex]));
            ohlc.high.push(parseFloat(values[highIndex]));
            ohlc.low.push(parseFloat(values[lowIndex]));
            ohlc.close.push(parseFloat(values[closeIndex]));
            ohlc.volume.push(volumeIndex < values.length ? parseFloat(values[volumeIndex]) : 0);
        }
        
        return ohlc;
    } catch (error) {
        console.error('Error loading historical data:', error);
        return null;
    }
}

// Determine the actual exit reason for a trade
function determineExitReason(activeTrade, currentBar, hasNewSignal, targetHit, stopHit) {
    // Use the flags to determine the exit reason
    if (targetHit) {
        return 'Target Hit';
    }
    
    if (stopHit) {
        return 'Stop Hit';
    }
    
    // If we get here, it's closed because of a signal
    return hasNewSignal ? 'New Signal' : 'Signal Reversal';
}

// Run backtest with the given data and options
function runBacktest(data, options = {}) {
    // Validate data
    if (!data || !data.open || !data.high || !data.low || !data.close) {
        console.error('Invalid data format for backtest');
        return null;
    }
    
    console.log('Running backtest with options:', JSON.stringify(options, null, 2));
    
    // Initialize the algorithm with default or provided options
    const defaultOptions = {
        length: 6,               // Fast Length
        period: 16,              // ATR Period
        multiplier: 9,           // ATR Multiplier
        fast_multiplier: 5.1,    // Fast ATR Multiplier
        useScalpMode: false,     // Use Scalp Line mode
        scalpPeriod: 21,         // Scalp Line Period
        rewardMultiple: 1.5,     // Reward Multiple
        initialCapital: 1000,    // Initial Capital ($)
        riskPerTrade: 2.0,       // Risk Per Trade (%)
        useLeverage: false,      // Use Leverage
        leverageAmount: 2.0,     // Leverage Amount
    };
    
    // Merge user options with defaults
    const mergedOptions = { ...defaultOptions, ...options };
    
    // Add debug logging
    console.log('Merged options:', JSON.stringify(mergedOptions, null, 2));
    
    // Storage for trade history
    const trades = [];
    
    // Keep track of active trades
    let activeTrade = null;
    
    // Minimum lookback period to ensure we have enough data for calculations
    const lookbackPeriod = Math.max(
        mergedOptions.period + mergedOptions.scalpPeriod,
        mergedOptions.length + mergedOptions.period
    );
    
    console.log(`Using lookback period of ${lookbackPeriod} candles`);
    
    // Check if we have enough data
    if (data.close.length < lookbackPeriod) {
        console.error(`Not enough data points. Need at least ${lookbackPeriod}, but got ${data.close.length}`);
        return null;
    }
    
    try {
        // Initialize with the first lookback period data
        const initialData = {
            open: data.open.slice(0, lookbackPeriod),
            high: data.high.slice(0, lookbackPeriod),
            low: data.low.slice(0, lookbackPeriod),
            close: data.close.slice(0, lookbackPeriod)
        };
        
        let algo = jalgo(initialData, mergedOptions);
        console.log('Initial algorithm setup successful');
        
        // Initialize manual statistics tracking
        const manualStats = {
            initialCapital: mergedOptions.initialCapital,
            currentCapital: mergedOptions.initialCapital,
            totalProfitLoss: 0,
            longWins: 0,
            longLosses: 0,
            shortWins: 0,
            shortLosses: 0,
            longTargetHits: 0,
            shortTargetHits: 0,
            totalProfit: 0,
            totalLoss: 0,
            totalRiskedAmount: 0
        };
        
        // Iterate through the data point by point (starting after lookback period)
        for (let i = lookbackPeriod; i < data.close.length; i++) {
            // Create a sliding window of data for the algorithm
            const windowData = {
                open: data.open.slice(0, i + 1),
                high: data.high.slice(0, i + 1),
                low: data.low.slice(0, i + 1),
                close: data.close.slice(0, i + 1)
            };
            
            // Run the algorithm on the current window of data
            algo = jalgo(windowData, mergedOptions);
            
            if (!algo) {
                console.error('Algorithm returned null/undefined at index', i);
                continue;
            }
            
            // Get the current bar's data
            const currentBar = {
                date: data.date ? data.date[i] : i,
                open: data.open[i],
                high: data.high[i],
                low: data.low[i],
                close: data.close[i]
            };
            
            // Check if we have an active trade
            if (activeTrade) {
                // Check if we should close the active trade
                if (
                    // Check if there's a signal in the opposite direction
                    (algo.signal && algo.signal.position !== activeTrade.position) ||
                    // Or if target is hit
                    (activeTrade.position === 'long' && currentBar.high >= activeTrade.targetLevel) ||
                    (activeTrade.position === 'short' && currentBar.low <= activeTrade.targetLevel) ||
                    // Or if stop is hit
                    (activeTrade.position === 'long' && currentBar.low <= activeTrade.stopLevel) ||
                    (activeTrade.position === 'short' && currentBar.high >= activeTrade.stopLevel)
                ) {
                    // Determine the exit price
                    let exitPrice;
                    let targetHit = false;
                    let stopHit = false;
                    
                    if (activeTrade.position === 'long') {
                        if (currentBar.high >= activeTrade.targetLevel) {
                            // Target hit - exit at target level
                            exitPrice = activeTrade.targetLevel;
                            targetHit = true;
                        } else if (currentBar.low <= activeTrade.stopLevel) {
                            // Stop hit - exit at stop level
                            exitPrice = activeTrade.stopLevel;
                            stopHit = true;
                        } else {
                            // Signal reversal - exit at open of the bar
                            exitPrice = currentBar.open;
                        }
                    } else { // short position
                        if (currentBar.low <= activeTrade.targetLevel) {
                            // Target hit - exit at target level
                            exitPrice = activeTrade.targetLevel;
                            targetHit = true;
                        } else if (currentBar.high >= activeTrade.stopLevel) {
                            // Stop hit - exit at stop level
                            exitPrice = activeTrade.stopLevel;
                            stopHit = true;
                        } else {
                            // Signal reversal - exit at open of the bar
                            exitPrice = currentBar.open;
                        }
                    }
                    
                    // Execute the trade with the new price
                    if (algo.executeTrade && typeof algo.executeTrade === 'function') {
                        // Store original statistics for debugging
                        console.log('Statistics before trade execution:', JSON.stringify(algo.calculateStats()));
                        
                        const tradeResult = algo.executeTrade(activeTrade, exitPrice);
                        
                        // Check if trade result has expected properties
                        if (!tradeResult || typeof tradeResult !== 'object') {
                            console.error('Trade execution did not return valid result:', tradeResult);
                        } else {
                            console.log('Trade executed:', JSON.stringify(tradeResult));
                        }
                        
                        // Verify statistics updated correctly
                        console.log('Statistics after trade execution:', JSON.stringify(algo.calculateStats()));
                        
                        // Add date and bar information to the trade
                        const completedTrade = {
                            ...tradeResult,
                            entryDate: activeTrade.entryDate,
                            exitDate: currentBar.date,
                            entryBar: activeTrade.entryBar,
                            exitBar: i,
                            holdingPeriod: i - activeTrade.entryBar,
                            exitReason: determineExitReason(
                                activeTrade, 
                                currentBar, 
                                algo.signal && algo.signal.position !== activeTrade.position,
                                targetHit,
                                stopHit
                            )
                        };
                        
                        // Update trade properties based on P&L
                        if (completedTrade.pnl > 0) {
                            completedTrade.isWin = true;
                            completedTrade.isTargetHit = targetHit;
                        } else {
                            completedTrade.isWin = false;
                            completedTrade.isTargetHit = false; // A loss can't be a target hit
                        }
                        
                        // Add to trade history
                        trades.push(completedTrade);
                        
                        // Manually update statistics if not being tracked properly
                        if (completedTrade.pnl > 0) {
                            if (completedTrade.position === 'long') {
                                manualStats.longWins++;
                                if (targetHit) {
                                    manualStats.longTargetHits++;
                                }
                            } else {
                                manualStats.shortWins++;
                                if (targetHit) {
                                    manualStats.shortTargetHits++;
                                }
                            }
                            manualStats.totalProfit += Math.abs(completedTrade.pnl);
                        } else {
                            if (completedTrade.position === 'long') {
                                manualStats.longLosses++;
                            } else {
                                manualStats.shortLosses++;
                            }
                            manualStats.totalLoss += Math.abs(completedTrade.pnl);
                        }
                        
                        // Update capital
                        manualStats.currentCapital += completedTrade.pnl;
                        manualStats.totalProfitLoss += completedTrade.pnl;
                    } else {
                        console.error('executeTrade function not available in algo:', algo);
                    }
                    
                    // Reset active trade
                    activeTrade = null;
                }
            }
            
            // Check for new signal
            if (algo.signal && !activeTrade) {
                // Create new active trade from signal
                activeTrade = {
                    ...algo.signal,
                    entryDate: currentBar.date,
                    entryBar: i
                };
                
                // Track risk amount
                if (algo.signal.riskAmount) {
                    manualStats.totalRiskedAmount += algo.signal.riskAmount;
                }
            }
        }
        
        // Calculate final statistics
        let statistics = {};
        if (algo && algo.calculateStats && typeof algo.calculateStats === 'function') {
            statistics = algo.calculateStats();
            
            // Log statistics for debugging
            console.log('Statistics from algo.calculateStats():', JSON.stringify(statistics));
            
            // If the internal statistics aren't updating correctly, use our manually tracked statistics
            if (statistics.totalTrades === 0 && trades.length > 0) {
                console.log('Using manually tracked statistics as algo statistics appear to be empty');
                
                // Calculate additional manual statistics
                manualStats.totalLongTrades = manualStats.longWins + manualStats.longLosses;
                manualStats.totalShortTrades = manualStats.shortWins + manualStats.shortLosses;
                manualStats.totalTrades = manualStats.totalLongTrades + manualStats.totalShortTrades;
                
                manualStats.longWinRate = manualStats.totalLongTrades > 0 ? 
                    (manualStats.longWins / manualStats.totalLongTrades) * 100 : 0;
                    
                manualStats.shortWinRate = manualStats.totalShortTrades > 0 ? 
                    (manualStats.shortWins / manualStats.totalShortTrades) * 100 : 0;
                    
                manualStats.overallWinRate = manualStats.totalTrades > 0 ? 
                    ((manualStats.longWins + manualStats.shortWins) / manualStats.totalTrades) * 100 : 0;
                
                manualStats.efficiency = manualStats.totalRiskedAmount > 0 ? 
                    (manualStats.totalProfitLoss / manualStats.totalRiskedAmount) * 100 : 0;
                
                // Use manually tracked statistics instead
                statistics = manualStats;
            }
        } else {
            console.error('calculateStats function not available in algo object:', algo);
            // Use manually tracked statistics as fallback
            statistics = manualStats;
        }
        
        // Return all the information from the backtest
        return {
            trades,
            statistics,
            options: mergedOptions
        };
    } catch (error) {
        console.error('Error during backtest execution:', error);
        return {
            error: error.message,
            options: mergedOptions
        };
    }
}

// Print backtest results in a readable format
function printBacktestResults(results) {
    if (!results) {
        console.log('No backtest results to display.');
        return;
    }
    
    // Check if statistics are available
    if (!results.statistics) {
        console.log('No statistics available in the backtest results.');
        return;
    }
    
    // Safely access values with defaults to avoid "cannot read properties of undefined"
    const stats = results.statistics || {};
    const initialCapital = stats.initialCapital || 0;
    const currentCapital = stats.currentCapital || 0;
    const totalProfitLoss = stats.totalProfitLoss || 0;
    const totalTrades = stats.totalTrades || 0;
    const overallWinRate = stats.overallWinRate || 0;
    const totalProfit = stats.totalProfit || 0;
    const totalLoss = stats.totalLoss || 0;
    const totalLongTrades = stats.totalLongTrades || 0;
    const longWinRate = stats.longWinRate || 0;
    const longWins = stats.longWins || 0;
    const longLosses = stats.longLosses || 0;
    const longTargetHits = stats.longTargetHits || 0;
    const totalShortTrades = stats.totalShortTrades || 0;
    const shortWinRate = stats.shortWinRate || 0;
    const shortWins = stats.shortWins || 0;
    const shortLosses = stats.shortLosses || 0;
    const shortTargetHits = stats.shortTargetHits || 0;
    
    // Print overall statistics
    console.log('\n==================== BACKTEST RESULTS ====================\n');
    console.log('STATISTICS:');
    console.log('-----------------------------------------------------------');
    console.log(`Initial Capital: $${initialCapital.toFixed(2)}`);
    console.log(`Final Capital:   $${currentCapital.toFixed(2)}`);
    console.log(`Total P/L:       $${totalProfitLoss.toFixed(2)}`);
    console.log(`Return:          ${((totalProfitLoss / (initialCapital || 1)) * 100).toFixed(2)}%`);
    console.log('-----------------------------------------------------------');
    
    console.log(`Total Trades:    ${totalTrades}`);
    console.log(`Win Rate:        ${overallWinRate.toFixed(2)}%`);
    console.log(`Total Profit:    $${totalProfit.toFixed(2)}`);
    console.log(`Total Loss:      $${totalLoss.toFixed(2)}`);
    console.log(`Profit Factor:   ${(totalProfit / (totalLoss || 1)).toFixed(2)}`);
    console.log('-----------------------------------------------------------');
    
    console.log('TRADE BREAKDOWN:');
    console.log(`Long Trades:     ${totalLongTrades}`);
    console.log(`Long Win Rate:   ${longWinRate.toFixed(2)}%`);
    console.log(`Long Wins:       ${longWins}`);
    console.log(`Long Losses:     ${longLosses}`);
    console.log(`Long Target Hits: ${longTargetHits}`);
    
    console.log('-----------------------------------------------------------');
    console.log(`Short Trades:    ${totalShortTrades}`);
    console.log(`Short Win Rate:  ${shortWinRate.toFixed(2)}%`);
    console.log(`Short Wins:      ${shortWins}`);
    console.log(`Short Losses:    ${shortLosses}`);
    console.log(`Short Target Hits: ${shortTargetHits}`);
    console.log('-----------------------------------------------------------');
    
    // Print trade details
    console.log('\n==================== TRADE DETAILS ====================\n');
    
    // Check if trades array exists and has content
    if (!results.trades || !Array.isArray(results.trades) || results.trades.length === 0) {
        console.log('No trades were executed in this backtest.');
    } else {
        console.log('| #  | Type  | Entry Date | Exit Date  | Entry | Exit  | Risk  | P/L   | Exit Reason  | Bars |');
        console.log('|-----|-------|------------|------------|-------|-------|-------|-------|--------------|------|');
        
        results.trades.forEach((trade, index) => {
            // Safely access trade properties with defaults
            const entryDate = trade.entryDate ? 
                (typeof trade.entryDate === 'string' ? trade.entryDate.substring(0, 10) : trade.entryDate) : 'N/A';
            const exitDate = trade.exitDate ? 
                (typeof trade.exitDate === 'string' ? trade.exitDate.substring(0, 10) : trade.exitDate) : 'N/A';
            const position = trade.position || 'unknown';
            const entryPrice = trade.entryPrice !== undefined ? trade.entryPrice.toFixed(2) : 'N/A';
            const exitPrice = trade.exitPrice !== undefined ? trade.exitPrice.toFixed(2) : 'N/A';
            const stopLevel = trade.stopLevel !== undefined ? trade.stopLevel.toFixed(2) : 'N/A';
            const pnl = trade.pnl !== undefined ? trade.pnl.toFixed(2) : 'N/A';
            const exitReason = trade.exitReason || 'Unknown';
            const holdingPeriod = trade.holdingPeriod !== undefined ? trade.holdingPeriod.toString() : 'N/A';
            
            console.log(
                `| ${(index + 1).toString().padEnd(3)} | ${position.padEnd(5)} | ${entryDate.toString().padEnd(10)} | ${exitDate.toString().padEnd(10)} | ${entryPrice.padEnd(5)} | ${exitPrice.padEnd(5)} | ${stopLevel.padEnd(5)} | ${pnl.padEnd(5)} | ${exitReason.padEnd(12)} | ${holdingPeriod.padEnd(4)} |`
            );
        });
    }
    
    console.log('\n================= TRADE SETTINGS =================\n');
    console.log(JSON.stringify(results.options, null, 2));
}

// Main function to run the backtest
async function main() {
    try {
        // Configuration for the backtest
        const CONFIG = {
            symbol: 'BTCUSDT',       // Trading pair
            interval: '5m',          // Candlestick interval (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, etc.)
            limit: 6000,              // Number of historical candles to fetch
            marketType: 'futures',   // Market type: 'spot' or 'futures'
            testnet: false,          // Use testnet for futures (safer for testing)
            algoOptions: {
                // Main parameters
                length: 6,           // Fast Length
                period: 16,          // ATR Period
                multiplier: 9,       // ATR Multiplier
                fast_multiplier: 5.1, // Fast ATR Multiplier
                
                // Scalp mode parameters
                useScalpMode: true,  // Use Scalp Line mode
                scalpPeriod: 21,     // Scalp Line Period
                
                // Risk-reward parameters
                rewardMultiple: 1.5, // Reward Multiple (Target = Risk × Multiple)
                initialCapital: 100, // Initial Capital ($)
                riskPerTrade: 10,    // Risk Per Trade (%)
                
                // Leverage parameters
                useLeverage: true,   // Use Leverage (automatically set to true when using futures)
                leverageAmount: 2.0, // Leverage Amount (1-125x depending on the pair for futures)
            }
        };
        
        // 1. Load historical data from Binance
        console.log(`Loading historical data for ${CONFIG.symbol} (${CONFIG.interval}) from Binance...`);
        
        // If using futures, ensure useLeverage is true
        if (CONFIG.marketType === 'futures') {
            CONFIG.algoOptions.useLeverage = true;
        }
        
        let data;
        try {
            data = await fetchBinanceData(
                CONFIG.symbol, 
                CONFIG.interval, 
                CONFIG.limit, 
                CONFIG.marketType, 
                CONFIG.testnet
            );
            
            if (!data || !data.close || data.close.length === 0) {
                throw new Error('No data returned from Binance API');
            }
            
            console.log(`Loaded ${data.close.length} data points from Binance.`);
        } catch (fetchError) {
            console.error('Failed to fetch data from Binance:', fetchError);
            console.log('Attempting to load data from local file as fallback...');
            
            // Try to load from local file as fallback
            data = await loadHistoricalData('./data/historical_prices.csv');
            
            if (!data) {
                console.error('Failed to load historical data from local file. Exiting.');
                return;
            }
            
            console.log(`Loaded ${data.close.length} data points from local file.`);
        }
        
        // 2. Configure backtest options using the CONFIG
        const backtestOptions = CONFIG.algoOptions;
        
        // 3. Run the backtest
        console.log('Running backtest...');
        const backtestResults = runBacktest(data, backtestOptions);
        
        if (!backtestResults) {
            console.error('Backtest returned no results.');
            return;
        }
        
        // Check for errors in backtest results
        if (backtestResults.error) {
            console.error('Backtest encountered an error:', backtestResults.error);
        }
        
        // 4. Print the results
        printBacktestResults(backtestResults);
        
        // 5. Export results and save configuration
        // Create backtest results directory if it doesn't exist
        try {
            await fs.mkdir('./backtest results', { recursive: true });
            console.log('Using "backtest results" directory for output files');
        } catch (mkdirError) {
            console.error('Error creating backtest results directory:', mkdirError);
        }

        if (backtestResults.trades && Array.isArray(backtestResults.trades) && backtestResults.trades.length > 0) {
            // Export trades to CSV for easier analysis in spreadsheet software
            console.log('Exporting trades to CSV...');
            
            const csvHeader = 'trade_number,position,entry_date,exit_date,entry_price,exit_price,stop_level,target_level,pnl,is_win,is_target_hit,exit_reason,holding_period\n';
            
            const csvRows = backtestResults.trades.map((trade, index) => {
                // Safely access trade properties
                const position = trade.position || 'unknown';
                const entryDate = trade.entryDate || '';
                const exitDate = trade.exitDate || '';
                const entryPrice = trade.entryPrice !== undefined ? trade.entryPrice : '';
                const exitPrice = trade.exitPrice !== undefined ? trade.exitPrice : '';
                const stopLevel = trade.stopLevel !== undefined ? trade.stopLevel : '';
                const targetLevel = trade.targetLevel !== undefined ? trade.targetLevel : '';
                const pnl = trade.pnl !== undefined ? trade.pnl : '';
                const isWin = trade.isWin !== undefined ? trade.isWin : '';
                const isTargetHit = trade.isTargetHit !== undefined ? trade.isTargetHit : '';
                const exitReason = trade.exitReason || '';
                const holdingPeriod = trade.holdingPeriod !== undefined ? trade.holdingPeriod : '';
                
                return `${index + 1},${position},${entryDate},${exitDate},${entryPrice},${exitPrice},${stopLevel},${targetLevel},${pnl},${isWin},${isTargetHit},${exitReason},${holdingPeriod}`;
            }).join('\n');
            
            await fs.writeFile('./backtest results/trades.csv', csvHeader + csvRows);
        } else {
            console.log('No trades to export to CSV.');
        }
        
        // Save results and configuration
        console.log('Saving detailed results to JSON...');
        await fs.writeFile('./backtest results/backtest_results.json', JSON.stringify(backtestResults, null, 2));
        
        console.log('Saving configuration...');
        await fs.writeFile('./backtest results/backtest_config.json', JSON.stringify(CONFIG, null, 2));
        
        console.log('Backtest completed successfully!');
    } catch (error) {
        console.error('Error running backtest:', error);
    }
}

// Execute the main function
main().catch(console.error);