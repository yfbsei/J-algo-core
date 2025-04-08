import { JALgo } from './src/jalgo.js';
import fetch from 'node-fetch';
import fs from 'fs/promises';

/**
 * Simple Binance Backtester for JALgo
 * Supports both spot and futures markets
 */
class BinanceBacktester {
    constructor(options = {}) {
        // Market options
        this.symbol = options.symbol || 'BTCUSDT';
        this.timeframe = options.timeframe || '5m';
        this.market = options.market || 'futures'; // 'spot' or 'futures'
        this.maxCandles = options.maxCandles || 6000;
        this.startTime = options.startTime || null; // Unix timestamp ms
        this.endTime = options.endTime || null; // Unix timestamp ms
        
        // Trading options
        this.initialCapital = options.initialCapital || 100;
        this.riskPerTrade = options.riskPerTrade || 10;
        this.rewardMultiple = options.rewardMultiple || 1.5;
        this.useLeverage = options.useLeverage || true;
        this.leverageAmount = options.leverageAmount || 1.0;
        this.useScalpMode = options.useScalpMode || true;
        
        // Algorithm options
        this.length = options.length || 6;
        this.period = options.period || 16;
        this.multiplier = options.multiplier || 9;
        this.fast_multiplier = options.fast_multiplier || 5.1;
        
        // Result storage
        this.historicalData = [];
        this.trades = [];
        this.equityCurve = [];
        
        // Initialize algorithm
        this.jalgo = new JALgo({
            length: this.length,
            period: this.period,
            multiplier: this.multiplier,
            fast_multiplier: this.fast_multiplier,
            initialCapital: this.initialCapital,
            riskPerTrade: this.riskPerTrade,
            rewardMultiple: this.rewardMultiple,
            useLeverage: this.useLeverage,
            leverageAmount: this.leverageAmount,
            useScalpMode: this.useScalpMode
        });
    }
    
    /**
     * Fetch historical klines (candles) from Binance API
     * @returns {Promise<Array>} - Array of candle data
     */
    async fetchHistoricalData() {
        console.log(`Fetching historical data for ${this.symbol} (${this.timeframe}) on ${this.market} market...`);
        
        // Determine the API base URL based on market type
        const baseUrl = this.market === 'futures' 
            ? 'https://fapi.binance.com/fapi/v1/klines'
            : 'https://api.binance.com/api/v3/klines';
        
        // Build the query parameters
        const params = new URLSearchParams({
            symbol: this.symbol,
            interval: this.timeframe,
            limit: 1000 // Max limit per request
        });
        
        if (this.startTime) {
            params.append('startTime', this.startTime);
        }
        
        if (this.endTime) {
            params.append('endTime', this.endTime);
        }
        
        try {
            // We need to make multiple requests to get up to maxCandles
            let allCandles = [];
            let oldestTimestamp = this.endTime;
            
            // Make requests until we have enough candles or reach the beginning
            while (allCandles.length < this.maxCandles) {
                // Add endTime parameter for pagination if we have an oldest timestamp
                if (oldestTimestamp && allCandles.length > 0) {
                    params.set('endTime', oldestTimestamp - 1);
                }
                
                const response = await fetch(`${baseUrl}?${params}`);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`API error: ${response.status} ${errorText}`);
                }
                
                const candles = await response.json();
                
                // If no candles returned, we've reached the beginning
                if (!candles.length) {
                    break;
                }
                
                // Add to our collection
                allCandles = [...candles, ...allCandles];
                
                // Update oldest timestamp for next request
                oldestTimestamp = candles[0][0];
                
                console.log(`Fetched ${candles.length} candles. Total: ${allCandles.length}`);
                
                // If we got less than the limit, we've reached the beginning
                if (candles.length < 1000) {
                    break;
                }
                
                // Respect rate limits
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            // Trim to max candles if we got more
            if (allCandles.length > this.maxCandles) {
                allCandles = allCandles.slice(allCandles.length - this.maxCandles);
            }
            
            console.log(`Successfully fetched ${allCandles.length} candles.`);
            
            // Format candles to our required format
            this.historicalData = this.formatCandleData(allCandles);
            
            return this.historicalData;
        } catch (error) {
            console.error('Error fetching historical data:', error);
            throw error;
        }
    }
    
    /**
     * Format raw Binance candle data to our required format
     * @param {Array} rawCandles - Raw candle data from Binance
     * @returns {Array} - Formatted candle data
     */
    formatCandleData(rawCandles) {
        // Binance kline format:
        // [
        //   [
        //     1499040000000,      // Open time
        //     "0.01634790",       // Open
        //     "0.80000000",       // High
        //     "0.01575800",       // Low
        //     "0.01577100",       // Close
        //     "148976.11427815",  // Volume
        //     1499644799999,      // Close time
        //     "2434.19055334",    // Quote asset volume
        //     308,                // Number of trades
        //     "1756.87402397",    // Taker buy base asset volume
        //     "28.46694368",      // Taker buy quote asset volume
        //     "17928899.62484339" // Ignore
        //   ]
        // ]
        
        // Convert to our format
        return rawCandles.map(candle => {
            return {
                timestamp: candle[0],
                open: parseFloat(candle[1]),
                high: parseFloat(candle[2]),
                low: parseFloat(candle[3]),
                close: parseFloat(candle[4]),
                volume: parseFloat(candle[5])
            };
        });
    }
    
    /**
     * Run the backtest on the fetched historical data
     * @returns {Object} - Backtest results
     */
    async runBacktest() {
        if (!this.historicalData.length) {
            throw new Error('No historical data available. Call fetchHistoricalData() first.');
        }
        
        console.log(`Running backtest on ${this.historicalData.length} candles...`);
        
        // Reset algorithm state
        this.jalgo.reset();
        this.trades = [];
        this.equityCurve = [{
            timestamp: this.historicalData[0].timestamp,
            equity: this.initialCapital
        }];
        
        // We need to transform our single-candle data into windowed data for the algorithm
        // Each update needs a window of data for the indicators to calculate correctly
        
        // Find the minimum window size needed
        const minWindow = Math.max(
            this.length,   // For variable MA
            this.period,   // For ATR calculation
            30            // Add some extra for safety
        );
        
        // Process each candle
        for (let i = minWindow; i < this.historicalData.length; i++) {
            // Create a window of candles up to the current one
            const window = {
                timestamp: this.historicalData[i].timestamp,
                open: this.historicalData.slice(i - minWindow, i + 1).map(c => c.open),
                high: this.historicalData.slice(i - minWindow, i + 1).map(c => c.high),
                low: this.historicalData.slice(i - minWindow, i + 1).map(c => c.low),
                close: this.historicalData.slice(i - minWindow, i + 1).map(c => c.close)
            };
            
            // Process the window
            const result = this.jalgo.update(window);
            
            // If there was a trade action, record it
            if (result.trade && (result.trade.action || result.trade.hit)) {
                const trade = {
                    timestamp: window.timestamp,
                    candle: this.historicalData[i],
                    action: result.trade
                };
                
                this.trades.push(trade);
            }
            
            // Record equity point
            this.equityCurve.push({
                timestamp: window.timestamp,
                equity: result.stats.currentCapital
            });
            
            // Log progress every 1000 candles
            if (i % 1000 === 0) {
                console.log(`Processed ${i}/${this.historicalData.length} candles (${(i/this.historicalData.length*100).toFixed(1)}%)`);
            }
        }
        
        console.log(`Backtest complete. Processed ${this.historicalData.length} candles with ${this.trades.length} trades.`);
        
        // Prepare and return the results
        return this.generateResults();
    }
    
    /**
     * Generate comprehensive backtest results
     * @returns {Object} - Backtest results and statistics
     */
    generateResults() {
        const stats = this.jalgo.getStats();
        const startDate = new Date(this.historicalData[0].timestamp);
        const endDate = new Date(this.historicalData[this.historicalData.length - 1].timestamp);
        
        // Calculate additional metrics
        const totalDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
        const annualReturn = ((stats.currentCapital / this.initialCapital) ** (365 / totalDays) - 1) * 100;
        
        // Calculate drawdown
        let maxEquity = this.initialCapital;
        let maxDrawdown = 0;
        let currentDrawdown = 0;
        
        for (const point of this.equityCurve) {
            if (point.equity > maxEquity) {
                maxEquity = point.equity;
                currentDrawdown = 0;
            } else {
                currentDrawdown = (maxEquity - point.equity) / maxEquity * 100;
                
                if (currentDrawdown > maxDrawdown) {
                    maxDrawdown = currentDrawdown;
                }
            }
        }
        
        // Calculate Sharpe Ratio (simplified)
        let returns = [];
        for (let i = 1; i < this.equityCurve.length; i++) {
            const dailyReturn = (this.equityCurve[i].equity / this.equityCurve[i-1].equity) - 1;
            returns.push(dailyReturn);
        }
        
        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const stdDevReturn = Math.sqrt(
            returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length
        );
        
        const sharpeRatio = (avgReturn / stdDevReturn) * Math.sqrt(365); // Annualized
        
        return {
            symbol: this.symbol,
            timeframe: this.timeframe,
            market: this.market,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            duration: `${totalDays.toFixed(1)} days`,
            
            // Trading settings
            tradingSettings: {
                initialCapital: this.initialCapital,
                riskPerTrade: this.riskPerTrade,
                rewardMultiple: this.rewardMultiple,
                useLeverage: this.useLeverage,
                leverageAmount: this.leverageAmount,
                useScalpMode: this.useScalpMode
            },
            
            // Algorithm settings
            algoSettings: {
                length: this.length,
                period: this.period,
                multiplier: this.multiplier,
                fast_multiplier: this.fast_multiplier
            },
            
            // Performance statistics
            performance: {
                finalCapital: stats.currentCapital,
                totalReturn: ((stats.currentCapital / this.initialCapital) - 1) * 100,
                annualizedReturn: annualReturn,
                maxDrawdown: maxDrawdown,
                sharpeRatio: sharpeRatio,
                profitFactor: stats.totalLoss > 0 ? stats.totalProfit / stats.totalLoss : stats.totalProfit,
                recoveryFactor: stats.totalProfitLoss > 0 && maxDrawdown > 0 ? 
                    stats.totalProfitLoss / (maxDrawdown * this.initialCapital / 100) : 0
            },
            
            // Trade statistics
            tradeStats: {
                totalTrades: stats.totalTrades,
                winRate: stats.overallWinRate,
                averageWin: stats.totalWins > 0 ? stats.totalProfit / stats.totalWins : 0,
                averageLoss: stats.totalLosses > 0 ? stats.totalLoss / stats.totalLosses : 0,
                largestWin: this.getLargestTradeValue(true),
                largestLoss: this.getLargestTradeValue(false),
                targetHits: stats.totalTargetHits,
                targetHitRate: stats.totalTrades > 0 ? (stats.totalTargetHits / stats.totalTrades) * 100 : 0
            },
            
            // Raw data for further analysis
            rawData: {
                trades: this.trades,
                equityCurve: this.equityCurve,
                stats: stats
            }
        };
    }
    
    /**
     * Get the largest win or loss value
     * @param {boolean} isWin - Whether to find largest win (true) or loss (false)
     * @returns {number} - The largest value
     */
    getLargestTradeValue(isWin) {
        let largest = 0;
        
        for (const trade of this.trades) {
            if (trade.action.openingResult) continue; // Skip opening trades
            
            let pnl = 0;
            
            if (trade.action.closingResult && trade.action.closingResult.pnl) {
                pnl = trade.action.closingResult.pnl;
            } else if (trade.action.hit && trade.action.profit) {
                pnl = trade.action.profit;
            } else {
                continue;
            }
            
            if ((isWin && pnl > 0 && pnl > largest) || 
                (!isWin && pnl < 0 && Math.abs(pnl) > largest)) {
                largest = isWin ? pnl : Math.abs(pnl);
            }
        }
        
        return largest;
    }
    
    /**
     * Save backtest results to a file
     * @param {Object} results - Backtest results
     * @param {string} filename - Optional filename override
     * @returns {Promise<string>} - Path to saved file
     */
    async saveResults(results, filename) {
        if (!results) {
            results = this.generateResults();
        }
        
        // Generate a default filename if not provided
        if (!filename) {
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
            filename = `backtest_${this.symbol}_${this.timeframe}_${timestamp}.json`;
        }
        
        try {
            await fs.writeFile(filename, JSON.stringify(results, null, 2));
            console.log(`Results saved to ${filename}`);
            return filename;
        } catch (error) {
            console.error('Error saving results:', error);
            throw error;
        }
    }
    
    /**
     * Print a summary of the backtest results to the console
     * @param {Object} results - Backtest results (optional, generated if not provided)
     */
    printSummary(results) {
        if (!results) {
            results = this.generateResults();
        }
        
        console.log('\n=================================================');
        console.log(`BACKTEST SUMMARY: ${this.symbol} (${this.timeframe}) - ${this.market.toUpperCase()}`);
        console.log('=================================================');
        console.log(`Period: ${results.startDate} to ${results.endDate} (${results.duration})`);
        console.log(`Initial Capital: $${this.initialCapital.toFixed(2)}`);
        console.log(`Final Capital: $${results.performance.finalCapital.toFixed(2)}`);
        console.log(`Total Return: ${results.performance.totalReturn.toFixed(2)}%`);
        console.log(`Annualized Return: ${results.performance.annualizedReturn.toFixed(2)}%`);
        console.log(`Max Drawdown: ${results.performance.maxDrawdown.toFixed(2)}%`);
        console.log(`Sharpe Ratio: ${results.performance.sharpeRatio.toFixed(2)}`);
        console.log(`Profit Factor: ${results.performance.profitFactor.toFixed(2)}`);
        console.log('\n-------------------------------------------------');
        console.log('TRADE STATISTICS');
        console.log('-------------------------------------------------');
        console.log(`Total Trades: ${results.tradeStats.totalTrades}`);
        console.log(`Win Rate: ${results.tradeStats.winRate.toFixed(2)}%`);
        console.log(`Average Win: $${results.tradeStats.averageWin.toFixed(2)}`);
        console.log(`Average Loss: $${results.tradeStats.averageLoss.toFixed(2)}`);
        console.log(`Largest Win: $${results.tradeStats.largestWin.toFixed(2)}`);
        console.log(`Largest Loss: $${results.tradeStats.largestLoss.toFixed(2)}`);
        console.log(`Target Hits: ${results.tradeStats.targetHits} (${results.tradeStats.targetHitRate.toFixed(2)}%)`);
        console.log('\n-------------------------------------------------');
        console.log('SETTINGS');
        console.log('-------------------------------------------------');
        console.log(`Risk Per Trade: ${this.riskPerTrade}%`);
        console.log(`Reward Multiple: ${this.rewardMultiple}`);
        console.log(`Leverage: ${this.useLeverage ? this.leverageAmount + 'x' : 'OFF'}`);
        console.log(`Scalp Mode: ${this.useScalpMode ? 'ON' : 'OFF'}`);
        console.log('=================================================\n');
    }
}

// Example usage
async function runBacktest() {
    const backtester = new BinanceBacktester({
        symbol: 'BTCUSDT',
        timeframe: '5m',
        market: 'futures', // 'spot' or 'futures'
        maxCandles: 6000,
        
        // Trading settings
        initialCapital: 100,
        riskPerTrade: 10,
        rewardMultiple: 0.5,
        useLeverage: false,
        leverageAmount: 2.0,
        useScalpMode: true,
        
        // Optional date range (null for most recent)
        // Format: Unix timestamp in milliseconds
        startTime: null, // e.g., new Date('2023-01-01').getTime()
        endTime: null    // e.g., new Date('2023-12-31').getTime()
    });
    
    try {
        // Fetch historical data
        await backtester.fetchHistoricalData();
        
        // Run the backtest
        const results = await backtester.runBacktest();
        
        // Print summary
        backtester.printSummary(results);
        
        // Save results to file
        await backtester.saveResults(results);
        
    } catch (error) {
        console.error('Backtest failed:', error);
    }
}

// Run the backtest
runBacktest();

// Export the backtester for use in other files
export default BinanceBacktester;