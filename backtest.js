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
    
    try {
        // Convert OHLC format to candles format with progress indicator
        console.log('Converting data to candle format...');
        const candles = [];
        for (let i = 0; i < data.close.length; i++) {
            // Add progress indicator every 1000 candles
            if (i % 1000 === 0) {
                console.log(`Processing candle ${i} of ${data.close.length} (${Math.round(i/data.close.length*100)}%)`);
            }
            
            candles.push({
                date: data.date ? data.date[i] : i,
                open: data.open[i],
                high: data.high[i],
                low: data.low[i],
                close: data.close[i],
                volume: data.volume ? data.volume[i] : 0
            });
        }
        console.log('Data conversion complete.');

        // Initialize jalgo with the complete dataset and options
        console.log('Initializing algorithm...');
        const algo = jalgo({
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close
        }, mergedOptions);

        // Check if the algo was properly initialized
        if (!algo) {
            console.error('Failed to initialize algorithm');
            return null;
        }

        // Check if runBacktest function is available
        if (algo.runBacktest && typeof algo.runBacktest === 'function') {
            // Use the built-in runBacktest function
            console.log('Using built-in runBacktest function...');
            return {
                trades: algo.runBacktest(candles).tradeHistory || [],
                statistics: algo.runBacktest(candles).statistics || {},
                options: mergedOptions
            };
        }
        
        // Use the custom backtest runner with progress indicator
        console.log('Starting backtest calculation...');
        const results = runBacktestWithProgress(algo, candles, mergedOptions);
        console.log('Backtest calculation complete.');
        
        // Return the backtest results along with the options used
        return {
            trades: results.tradeHistory,
            statistics: results.statistics,
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

// Custom function to run backtest with progress indicators
function runBacktestWithProgress(algo, candles, options) {
    // Check if algo exists and has processTrade method
    if (!algo) {
        console.error('Algorithm object is null or undefined');
        return { tradeHistory: [], statistics: {} };
    }
    
    // Get the processTrade function from the algo
    const processTrade = algo.processTrade;
    
    if (!processTrade || typeof processTrade !== 'function') {
        console.error('processTrade function not available in algo');
        // Fall back to the built-in runBacktest if available
        if (algo.runBacktest && typeof algo.runBacktest === 'function') {
            console.log('Falling back to built-in runBacktest...');
            return algo.runBacktest(candles);
        } else {
            console.error('No suitable backtest function available');
            return { tradeHistory: [], statistics: {} };
        }
    }
    
    // Initialize statistics
    let statistics = {
        longWins: 0,
        longLosses: 0,
        shortWins: 0,
        shortLosses: 0,
        longTargetHits: 0,
        shortTargetHits: 0,
        totalProfit: 0,
        totalLoss: 0,
        currentCapital: options.initialCapital || 1000,
        totalProfitLoss: 0,
        totalRiskedAmount: 0,
        efficiency: 0,
        initialCapital: options.initialCapital || 1000
    };
    
    // Store trade history
    const tradeHistory = [];
    
    // Track current open position
    let currentPosition = null;
    
    // Minimum lookback period
    const lookbackPeriod = Math.max(
        (options.period || 16) + (options.scalpPeriod || 21),
        (options.length || 6) + (options.period || 16)
    );
    
    console.log(`Using lookback period of ${lookbackPeriod} candles`);
    
    // Process each candle
    const progressInterval = Math.max(1, Math.floor(candles.length / 100)); // Show progress every 1%
    
    for (let i = lookbackPeriod; i < candles.length; i++) {
        // Show progress
        if (i % progressInterval === 0 || i === candles.length - 1) {
            const progressPercent = Math.round((i - lookbackPeriod) / (candles.length - lookbackPeriod) * 100);
            console.log(`Processing candle ${i} of ${candles.length} (${progressPercent}%)`);
        }
        
        const currentCandle = candles[i];
        if (!currentCandle) {
            console.warn(`Candle at index ${i} is undefined, skipping`);
            continue;
        }
        
        // Create slice of data up to current candle for indicator calculation
        try {
            const dataSlice = {
                open: candles.slice(0, i + 1).map(c => c?.open || 0),
                high: candles.slice(0, i + 1).map(c => c?.high || 0),
                low: candles.slice(0, i + 1).map(c => c?.low || 0),
                close: candles.slice(0, i + 1).map(c => c?.close || 0)
            };
            
            // Calculate indicators for current slice
            const indicatorResult = jalgo(dataSlice, options);
            
            // Get current signal if any - with null checks
            const currentSignal = indicatorResult && indicatorResult.signal ? indicatorResult.signal : null;
            
            // If we have an open position, check if we should close it
            if (currentPosition) {
                try {
                    // Process the current candle to see if we should exit
                    const tradeResult = processTrade(currentPosition, currentCandle, currentSignal);
                    
                    // If we have a trade result, the position was closed
                    if (tradeResult) {
                        // Add candle index information
                        tradeResult.entryCandle = currentPosition.candleIndex;
                        tradeResult.exitCandle = i;
                        
                        // Add to trade history
                        tradeHistory.push(tradeResult);
                        
                        // Show trade completion
                        console.log(`Trade closed: ${tradeResult.position} position, PnL: ${tradeResult.pnl ? tradeResult.pnl.toFixed(2) : 'N/A'}, Reason: ${tradeResult.exitReason || 'Unknown'}`);
                        
                        // Clear current position
                        currentPosition = null;
                    }
                } catch (error) {
                    console.error(`Error processing trade at candle ${i}:`, error);
                    // Continue to next candle
                }
            }
            
            // If we don't have a position and we have a signal, open a new position
            if (!currentPosition && currentSignal) {
                try {
                    // Handle possible undefined values safely
                    let stopReference = null;
                    
                    // If scalp mode is enabled and scalpLine exists, use it as reference
                    if (options.useScalpMode && 
                        indicatorResult && 
                        indicatorResult.indicator && 
                        indicatorResult.indicator.scalpLine && 
                        Array.isArray(indicatorResult.indicator.scalpLine) && 
                        indicatorResult.indicator.scalpLine.length > 0) {
                        stopReference = indicatorResult.indicator.scalpLine[indicatorResult.indicator.scalpLine.length - 1];
                    } 
                    // Else use jATR if available
                    else if (indicatorResult && 
                             indicatorResult.indicator && 
                             indicatorResult.indicator.jATR && 
                             Array.isArray(indicatorResult.indicator.jATR) && 
                             indicatorResult.indicator.jATR.length > 0) {
                        stopReference = indicatorResult.indicator.jATR[indicatorResult.indicator.jATR.length - 1];
                    } 
                    // Fallback to a default value based on close price
                    else {
                        stopReference = currentCandle.close * 0.98; // default reference point 2% below close
                        console.warn(`Using fallback stop reference at candle ${i} because indicator values are missing`);
                    }
                    
                    const entryPrice = currentCandle.close;
                    
                    // Calculate risk amount for this trade
                    const riskAmount = (statistics.currentCapital * (options.riskPerTrade || 2)) / 100;
                    
                    // Open new position
                    if (currentSignal.position === 'long') {
                        const longRisk = Math.max(0.01, entryPrice - stopReference); // Ensure risk is positive
                        const targetLevel = entryPrice + (longRisk * (options.rewardMultiple || 1.5));
                        
                        currentPosition = {
                            position: 'long',
                            location: entryPrice,
                            stopReference,  // Not an actual stop, just for R:R
                            targetLevel,
                            riskAmount,
                            candle: currentCandle,
                            candleIndex: i
                        };
                        
                        console.log(`Opening LONG position at ${entryPrice.toFixed(2)}, Target: ${targetLevel.toFixed(2)}`);
                    }
                    else if (currentSignal.position === 'short') {
                        const shortRisk = Math.max(0.01, stopReference - entryPrice); // Ensure risk is positive
                        const targetLevel = entryPrice - (shortRisk * (options.rewardMultiple || 1.5));
                        
                        currentPosition = {
                            position: 'short',
                            location: entryPrice,
                            stopReference,  // Not an actual stop, just for R:R
                            targetLevel,
                            riskAmount,
                            candle: currentCandle,
                            candleIndex: i
                        };
                        
                        console.log(`Opening SHORT position at ${entryPrice.toFixed(2)}, Target: ${targetLevel.toFixed(2)}`);
                    }
                } catch (error) {
                    console.error(`Error opening position at candle ${i}:`, error);
                    // Continue to next candle
                }
            }
        } catch (error) {
            console.error(`Error processing candle ${i}:`, error);
            // Continue to next candle
        }
    }
    
    // Update statistics based on trade history
    console.log(`Processing ${tradeHistory.length} completed trades for statistics...`);
    tradeHistory.forEach((trade, index) => {
        try {
            // Safety checks for trade properties
            if (!trade) {
                console.warn(`Trade at index ${index} is undefined, skipping`);
                return;
            }
            
            // Update statistics based on trade result
            if (trade.isWin) {
                if (trade.position === 'long') {
                    statistics.longWins += 1;
                    if (trade.isTargetHit) {
                        statistics.longTargetHits += 1;
                    }
                } else if (trade.position === 'short') {
                    statistics.shortWins += 1;
                    if (trade.isTargetHit) {
                        statistics.shortTargetHits += 1;
                    }
                }
                statistics.totalProfit += (trade.pnl || 0);
            } else {
                if (trade.position === 'long') {
                    statistics.longLosses += 1;
                } else if (trade.position === 'short') {
                    statistics.shortLosses += 1;
                }
                statistics.totalLoss += Math.abs(trade.pnl || 0);
            }
            
            // Update total P/L
            statistics.totalProfitLoss += (trade.pnl || 0);
            
            // Track risked amount
            statistics.totalRiskedAmount += (trade.riskAmount || 0);
        } catch (error) {
            console.error(`Error processing trade statistics for trade ${index}:`, error);
        }
    });
    
    // Update final capital
    statistics.currentCapital = statistics.initialCapital + statistics.totalProfitLoss;
    
    // Calculate efficiency
    statistics.efficiency = statistics.totalRiskedAmount > 0 ? 
        (statistics.totalProfitLoss / statistics.totalRiskedAmount) * 100 : 0;
        
    // Calculate trade count statistics
    statistics.totalLongTrades = statistics.longWins + statistics.longLosses;
    statistics.totalShortTrades = statistics.shortWins + statistics.shortLosses;
    statistics.totalTrades = statistics.totalLongTrades + statistics.totalShortTrades;
    statistics.longWinRate = statistics.totalLongTrades > 0 ? 
        (statistics.longWins / statistics.totalLongTrades) * 100 : 0;
    statistics.shortWinRate = statistics.totalShortTrades > 0 ? 
        (statistics.shortWins / statistics.totalShortTrades) * 100 : 0;
    statistics.overallWinRate = statistics.totalTrades > 0 ? 
        ((statistics.longWins + statistics.shortWins) / statistics.totalTrades) * 100 : 0;
    
    console.log(`Backtest completed: ${tradeHistory.length} trades executed`);
    
    // Return results
    return {
        statistics,
        tradeHistory
    };
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
        console.log('Exit Reason | Bars | PnL');
        console.log('----------------------------------------');
        
        results.trades.forEach((trade, index) => {
            if (!trade) {
                console.log(`[Trade ${index + 1}] Invalid trade data`);
                return;
            }
            
            // Calculate bars held (if we have entry and exit data)
            const bars = trade.entryCandle !== undefined && trade.exitCandle !== undefined 
                ? trade.exitCandle - trade.entryCandle
                : 'N/A';
                
            // Format PnL with sign
            const pnlStr = trade.pnl !== undefined 
                ? (trade.pnl >= 0 ? `+${trade.pnl.toFixed(2)}` : `${trade.pnl.toFixed(2)}`)
                : 'N/A';
                
            console.log(`${(trade.exitReason || 'Unknown').padEnd(12)} | ${bars.toString().padEnd(4)} | ${pnlStr}`);
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
            
            const csvHeader = 'trade_number,position,entry_date,exit_date,entry_price,exit_price,target_level,pnl,is_win,is_target_hit,exit_reason\n';
            
            const csvRows = backtestResults.trades.map((trade, index) => {
                if (!trade) {
                    return `${index + 1},invalid,,,,,,,,,`;
                }
                
                // Safely access trade properties
                const position = trade.position || 'unknown';
                const entryDate = trade.entryDate || '';
                const exitDate = trade.exitDate || '';
                const entryPrice = trade.entryPrice !== undefined ? trade.entryPrice : '';
                const exitPrice = trade.exitPrice !== undefined ? trade.exitPrice : '';
                const targetLevel = trade.targetLevel !== undefined ? trade.targetLevel : '';
                const pnl = trade.pnl !== undefined ? trade.pnl : '';
                const isWin = trade.isWin !== undefined ? trade.isWin : '';
                const isTargetHit = trade.isTargetHit !== undefined ? trade.isTargetHit : '';
                const exitReason = trade.exitReason || '';
                
                return `${index + 1},${position},${entryDate},${exitDate},${entryPrice},${exitPrice},${targetLevel},${pnl},${isWin},${isTargetHit},${exitReason}`;
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