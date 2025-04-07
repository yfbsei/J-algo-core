import { multiply, subtract, add, round, abs, max, min } from 'mathjs';
import { SMA } from 'technicalindicators';
import trend_sniper from './indicators/jTrendSniper.js';

/**
 * Enhanced J-Trend Sniper v3 indicator with risk management features
 * 
 * @param {Object} source - Object containing OHLC price arrays
 * @param {Object} options - Configuration options
 * @returns {Object} - Object containing indicator values, signals, and trade management data
 */
const jalgo = (source = {}, options = {}) => {
    // Default options with fallbacks
    const {
        // Main parameters (passing through to original trend_sniper)
        length = 6,              // Fast Length
        period = 16,             // ATR Period
        multiplier = 9,          // ATR Multiplier
        fast_multiplier = 5.1,   // Fast ATR Multiplier
        
        // New Scalp mode parameters
        useScalpMode = false,    // Use Scalp Line mode
        scalpPeriod = 21,        // Scalp Line Period
        
        // New Risk-reward parameters
        rewardMultiple = 1.5,    // Reward Multiple (Target = Risk × Multiple)
        initialCapital = 1000,   // Initial Capital ($)
        riskPerTrade = 2.0,      // Risk Per Trade (%)
        
        // New Leverage parameters
        useLeverage = false,     // Use Leverage
        leverageAmount = 2.0,    // Leverage Amount
    } = options;

    // Validate input data
    if (!source || !source.close || !source.open || !source.high || !source.low) {
        console.error("Missing required price data in source object");
        return { 
            indicator: {},
            trades: [],
            statistics: {},
            signal: false 
        };
    }

    try {
        // Get base indicator values from trend_sniper
        const baseIndicator = trend_sniper(source, length, period, multiplier, fast_multiplier);
        
        // Extract values from base indicator
        const { jATR, var_ma, jATR_sma, fast_jATR_sma, signal: baseSignal } = baseIndicator;
        
        // Return early if the base calculation failed
        if (!jATR.length || !var_ma.length) {
            return {
                indicator: baseIndicator,
                trades: [],
                statistics: {},
                signal: false
            };
        }
        
        // *********************
        // 1. ADD SCALP MODE
        // *********************
        
        // Calculate scalp line (similar to the Pine Script implementation)
        let scalpLine = [];
        
        // Create an intermediate array for calculating the scalp line
        const scalpValues = [];
        
        for (let i = 0; i < jATR.length; i++) {
            const jATR_val = jATR[i];
            const var_ma_val = var_ma[i];
            
            // Logic for determining the scalp value based on price action
            let value;
            if (jATR_val > var_ma_val) {
                value = subtract(jATR_val, divide(subtract(jATR_val, var_ma_val), 2));
            } else {
                value = add(jATR_val, divide(subtract(var_ma_val, jATR_val), 2));
            }
            
            scalpValues.push(value);
        }
        
        // Apply SMA to get the final scalp line (similar to the line used in Pine Script)
        if (scalpValues.length >= scalpPeriod) {
            scalpLine = SMA.calculate({period: scalpPeriod, values: scalpValues});
        }
        
        // *********************
        // 2. ADD RISK-REWARD MANAGEMENT
        // *********************
        
        // Get close prices at the same length as jATR for signal processing
        const close = source.close.slice(source.close.length - jATR.length);
        
        // Initialize trade tracking statistics
        let statistics = {
            longWins: 0,
            longLosses: 0,
            shortWins: 0,
            shortLosses: 0,
            longTargetHits: 0,
            shortTargetHits: 0,
            totalProfit: 0,
            totalLoss: 0,
            currentCapital: initialCapital,
            totalProfitLoss: 0,
            totalRiskedAmount: 0,
            efficiency: 0
        };
        
        // *********************
        // 3. ADD LEVERAGE
        // *********************
        
        // Calculate effective leverage factor
        const effectiveLeverage = useLeverage ? leverageAmount : 1.0;
        
        // *********************
        // 4. ADD TRADE TRACKING LOGIC
        // *********************
        
        // Get the signal from the base indicator
        let signal = baseSignal;
        
        // Extend the signal with target levels, stop levels and additional info if a signal exists
        if (signal) {
            const position = signal.position;
            const entryPrice = signal.location;
            
            // Determine stop reference based on scalp mode
            const stopReference = useScalpMode && scalpLine.length ? 
                scalpLine[scalpLine.length - 1] : 
                jATR[jATR.length - 1];
            
            // Calculate risk and target levels
            if (position === 'long') {
                const longRisk = entryPrice - stopReference;
                const targetLevel = entryPrice + (longRisk * rewardMultiple);
                
                // Calculate liquidation level if leverage is used
                const liquidationLevel = useLeverage ? 
                    entryPrice * (1 - (1 / leverageAmount)) : null;
                
                // Calculate risk amount in dollars for this trade
                const riskAmount = (statistics.currentCapital * riskPerTrade) / 100;
                
                // Enhance signal with risk management data
                signal = {
                    ...signal,
                    stopReference, // Not used as actual stop loss, just for reference
                    targetLevel,
                    riskAmount,
                    rewardAmount: riskAmount * rewardMultiple * effectiveLeverage,
                    liquidationLevel
                };
            } 
            else if (position === 'short') {
                const shortRisk = stopReference - entryPrice;
                const targetLevel = entryPrice - (shortRisk * rewardMultiple);
                
                // Calculate liquidation level if leverage is used
                const liquidationLevel = useLeverage ? 
                    entryPrice * (1 + (1 / leverageAmount)) : null;
                
                // Calculate risk amount in dollars for this trade
                const riskAmount = (statistics.currentCapital * riskPerTrade) / 100;
                
                // Enhance signal with risk management data
                signal = {
                    ...signal,
                    stopReference, // Not used as actual stop loss, just for reference
                    targetLevel,
                    riskAmount,
                    rewardAmount: riskAmount * rewardMultiple * effectiveLeverage,
                    liquidationLevel
                };
            }
        }
        
        /**
         * Function to process a candle for an open trade
         * Returns trade result if trade is closed, null if still open
         * 
         * @param {Object} trade - Current trade information
         * @param {Object} candle - Current candle data {open, high, low, close}
         * @param {Object} newSignal - New signal if any
         * @return {Object|null} - Trade result if closed, null if still open
         */
        const processTrade = (trade, candle, newSignal) => {
            // Destructure trade info
            const { 
                position, 
                location: entryPrice, 
                stopReference, // Not used as actual stop, just for R:R
                targetLevel, 
                riskAmount 
            } = trade;
            
            // Default to not exiting the trade
            let shouldExit = false;
            let exitReason = "";
            let exitPrice = candle.close; // Default exit at close
            let tradeResult = 0;
            let isWin = false;
            let isTargetHit = false;
            
            // Process long positions
            if (position === 'long') {
                // Check if target was hit within this candle
                if (candle.high >= targetLevel) {
                    // Take profit was hit
                    shouldExit = true;
                    exitReason = "Target Hit";
                    exitPrice = targetLevel;
                    tradeResult = riskAmount * rewardMultiple * effectiveLeverage;
                    isWin = true;
                    isTargetHit = true;
                    statistics.longTargetHits += 1;
                }
                // Check if we have a new opposing signal
                else if (newSignal && newSignal.position === 'short') {
                    // New signal exit - can be profit or loss
                    shouldExit = true;
                    exitReason = "New Signal";
                    
                    // Calculate P&L
                    const priceDifference = candle.close - entryPrice;
                    
                    if (priceDifference >= 0) {
                        // We're in profit - calculate as percentage of the way to target
                        const targetDifference = targetLevel - entryPrice;
                        const percentageToTarget = Math.min(priceDifference / targetDifference, 1.0);
                        tradeResult = percentageToTarget * riskAmount * rewardMultiple * effectiveLeverage;
                        isWin = true;
                    } else {
                        // We're in loss - calculate relative to theoretical risk
                        const maxRiskDistance = entryPrice - stopReference;
                        // Can lose more than theoretical risk since no actual stop loss
                        const actualLossPercentage = Math.abs(priceDifference) / maxRiskDistance;
                        tradeResult = -actualLossPercentage * riskAmount * effectiveLeverage;
                        isWin = false;
                    }
                }
            }
            // Process short positions
            else if (position === 'short') {
                // Check if target was hit within this candle
                if (candle.low <= targetLevel) {
                    // Take profit was hit
                    shouldExit = true;
                    exitReason = "Target Hit";
                    exitPrice = targetLevel;
                    tradeResult = riskAmount * rewardMultiple * effectiveLeverage;
                    isWin = true;
                    isTargetHit = true;
                    statistics.shortTargetHits += 1;
                }
                // Check if we have a new opposing signal
                else if (newSignal && newSignal.position === 'long') {
                    // New signal exit - can be profit or loss
                    shouldExit = true;
                    exitReason = "New Signal";
                    
                    // Calculate P&L
                    const priceDifference = entryPrice - candle.close;
                    
                    if (priceDifference >= 0) {
                        // We're in profit - calculate as percentage of the way to target
                        const targetDifference = entryPrice - targetLevel;
                        const percentageToTarget = Math.min(priceDifference / targetDifference, 1.0);
                        tradeResult = percentageToTarget * riskAmount * rewardMultiple * effectiveLeverage;
                        isWin = true;
                    } else {
                        // We're in loss - calculate relative to theoretical risk
                        const maxRiskDistance = stopReference - entryPrice;
                        // Can lose more than theoretical risk since no actual stop loss
                        const actualLossPercentage = Math.abs(priceDifference) / maxRiskDistance;
                        tradeResult = -actualLossPercentage * riskAmount * effectiveLeverage;
                        isWin = false;
                    }
                }
            }
            
            // If we're exiting the trade, update statistics
            if (shouldExit) {
                if (isWin) {
                    if (position === 'long') {
                        statistics.longWins += 1;
                    } else {
                        statistics.shortWins += 1;
                    }
                    statistics.totalProfit += tradeResult;
                } else {
                    if (position === 'long') {
                        statistics.longLosses += 1;
                    } else {
                        statistics.shortLosses += 1;
                    }
                    statistics.totalLoss += Math.abs(tradeResult);
                }
                
                // Update capital and total P/L
                statistics.currentCapital += tradeResult;
                statistics.totalProfitLoss += tradeResult;
                
                // Return trade result info
                return {
                    position,
                    entryPrice,
                    exitPrice,
                    targetLevel,
                    pnl: tradeResult,
                    isWin,
                    isTargetHit,
                    exitReason
                };
            }
            
            // If we didn't exit, return null to indicate trade is still open
            return null;
        };
        
        /**
         * Function to simulate backtest over historical data
         * Added extensive logging for debugging
         *
         * @param {Array} historicalCandles - Array of historical candles
         * @return {Object} - Backtest results
         */
        const runBacktest = (historicalCandles) => {
            console.log("******** STARTING BACKTEST ********");
            console.log(`Total candles to process: ${historicalCandles.length}`);
            
            // Reset statistics
            statistics = {
                longWins: 0,
                longLosses: 0,
                shortWins: 0,
                shortLosses: 0,
                longTargetHits: 0,
                shortTargetHits: 0,
                totalProfit: 0,
                totalLoss: 0,
                currentCapital: initialCapital,
                totalProfitLoss: 0,
                totalRiskedAmount: 0,
                efficiency: 0,
                initialCapital: initialCapital
            };
            
            console.log("Statistics initialized with capital:", initialCapital);
            
            // Track current open position
            let currentPosition = null;
            
            // Store trade history
            const tradeHistory = [];
            
            console.log("Processing candles for backtest...");
            
            // Calculate lookback period
            const lookbackPeriod = period + length;
            console.log(`Using lookback period of ${lookbackPeriod} candles`);
            
            // Debug counters
            let candlesProcessed = 0;
            let signalsGenerated = 0;
            let tradesExecuted = 0;
            
            // Process each candle
            const progressInterval = Math.max(1, Math.floor(historicalCandles.length / 20)); // Log every 5%
            
            try {
                for (let i = 0; i < historicalCandles.length; i++) {
                    // Skip candles until we have enough data for indicators
                    if (i < lookbackPeriod) {
                        continue;
                    }
                    
                    // Show progress periodically
                    if (i % progressInterval === 0 || i === historicalCandles.length - 1) {
                        const progressPercent = Math.round((i / historicalCandles.length) * 100);
                        console.log(`Processing candle ${i} of ${historicalCandles.length} (${progressPercent}%)`);
                        console.log(`Stats so far: ${tradesExecuted} trades, Capital: ${statistics.currentCapital.toFixed(2)}`);
                    }
                    
                    // Get current candle
                    const currentCandle = historicalCandles[i];
                    if (!currentCandle) {
                        console.warn(`Candle at index ${i} is undefined, skipping`);
                        continue;
                    }
                    
                    candlesProcessed++;
                    
                    // Create slice of data up to current candle for indicator calculation
                    try {
                        // Extract relevant data for this candle window
                        const dataSlice = {
                            open: historicalCandles.slice(0, i + 1).map(c => c.open),
                            high: historicalCandles.slice(0, i + 1).map(c => c.high),
                            low: historicalCandles.slice(0, i + 1).map(c => c.low),
                            close: historicalCandles.slice(0, i + 1).map(c => c.close)
                        };
                        
                        if (i % progressInterval === 0) {
                            console.log(`Created data slice with ${dataSlice.close.length} candles`);
                        }
                        
                        // Calculate indicators for current slice
                        const indicatorResult = trend_sniper(dataSlice, length, period, multiplier, fast_multiplier);
                        
                        // Get current signal if any
                        const currentSignal = indicatorResult.signal;
                        
                        if (currentSignal) {
                            signalsGenerated++;
                            if (i % progressInterval === 0) {
                                console.log(`Signal generated at candle ${i}: ${currentSignal.position}`);
                            }
                        }
                        
                        // If we have an open position, check if we should close it
                        if (currentPosition) {
                            try {
                                // Process the current candle to see if we should exit
                                const tradeResult = processTrade(currentPosition, currentCandle, currentSignal);
                                
                                // If we have a trade result, the position was closed
                                if (tradeResult) {
                                    tradesExecuted++;
                                    // Console logging for debug
                                    console.log(`Trade closed at candle ${i}: ${tradeResult.position} position, PnL: ${tradeResult.pnl.toFixed(2)}, Reason: ${tradeResult.exitReason}`);
                                    
                                    // Add to trade history
                                    tradeHistory.push({
                                        ...tradeResult,
                                        candleIndex: currentPosition.candleIndex,
                                        exitCandleIndex: i
                                    });
                                    
                                    // Track risk amount for this trade
                                    statistics.totalRiskedAmount += currentPosition.riskAmount;
                                    
                                    // Clear current position
                                    currentPosition = null;
                                } else if (i % progressInterval === 0) {
                                    console.log(`Position still open at candle ${i}: ${currentPosition.position} from candle ${currentPosition.candleIndex}`);
                                }
                            } catch (tradeError) {
                                console.error(`Error processing trade at candle ${i}:`, tradeError);
                                // Continue to next candle even if there's an error
                            }
                        }
                        
                        // If we don't have a position and we have a signal, open a new position
                        if (!currentPosition && currentSignal) {
                            // Get or calculate necessary values
                            const entryPrice = currentCandle.close;
                            let stopReference, targetLevel;
                            
                            // Determine stop reference based on scalp mode
                            if (useScalpMode && scalpLine && scalpLine.length > 0) {
                                // Use the last value of the scalp line calculated above
                                stopReference = scalpLine[scalpLine.length - 1];
                            } else if (jATR && jATR.length > 0) {
                                // Use the last value of jATR calculated above
                                stopReference = jATR[jATR.length - 1];
                            } else {
                                // Fallback if indicators aren't available (shouldn't happen)
                                console.warn(`Using fallback stop reference at candle ${i}`);
                                stopReference = currentSignal.position === 'long' 
                                    ? entryPrice * 0.98  // 2% below for long
                                    : entryPrice * 1.02; // 2% above for short
                            }
                            
                            // Calculate risk amount for this trade
                            const riskAmount = (statistics.currentCapital * riskPerTrade) / 100;
                            
                            // Open new position
                            if (currentSignal.position === 'long') {
                                const longRisk = Math.max(0.001, entryPrice - stopReference); // Ensure risk is positive
                                targetLevel = entryPrice + (longRisk * rewardMultiple);
                                
                                currentPosition = {
                                    position: 'long',
                                    location: entryPrice,
                                    stopReference,  // Not an actual stop, just for R:R
                                    targetLevel,
                                    riskAmount,
                                    candleIndex: i
                                };
                                
                                console.log(`Opening LONG position at candle ${i}, price: ${entryPrice.toFixed(2)}, Target: ${targetLevel.toFixed(2)}`);
                            }
                            else if (currentSignal.position === 'short') {
                                const shortRisk = Math.max(0.001, stopReference - entryPrice); // Ensure risk is positive
                                targetLevel = entryPrice - (shortRisk * rewardMultiple);
                                
                                currentPosition = {
                                    position: 'short',
                                    location: entryPrice,
                                    stopReference,  // Not an actual stop, just for R:R
                                    targetLevel,
                                    riskAmount,
                                    candleIndex: i
                                };
                                
                                console.log(`Opening SHORT position at candle ${i}, price: ${entryPrice.toFixed(2)}, Target: ${targetLevel.toFixed(2)}`);
                            }
                        }
                    } catch (candleError) {
                        console.error(`Error processing candle ${i}:`, candleError);
                        // Continue to next candle
                    }
                } // End of candle loop
                
                console.log("Finished processing all candles");
                console.log(`Processed ${candlesProcessed} candles, generated ${signalsGenerated} signals, executed ${tradesExecuted} trades`);
                
                // Calculate final statistics
                const totalLongTrades = statistics.longWins + statistics.longLosses;
                const totalShortTrades = statistics.shortWins + statistics.shortLosses;
                const totalTrades = totalLongTrades + totalShortTrades;
                
                const longWinRate = totalLongTrades > 0 ? (statistics.longWins / totalLongTrades) * 100 : 0;
                const shortWinRate = totalShortTrades > 0 ? (statistics.shortWins / totalShortTrades) * 100 : 0;
                const overallWinRate = totalTrades > 0 ? 
                    ((statistics.longWins + statistics.shortWins) / totalTrades) * 100 : 0;
                    
                // Calculate efficiency
                statistics.efficiency = statistics.totalRiskedAmount > 0 ? 
                    (statistics.totalProfitLoss / statistics.totalRiskedAmount) * 100 : 0;
                    
                // Final statistics object
                const finalStats = {
                    ...statistics,
                    totalLongTrades,
                    totalShortTrades,
                    totalTrades,
                    longWinRate,
                    shortWinRate,
                    overallWinRate
                };
                
                console.log("Backtest completed successfully");
                console.log("Final capital:", finalStats.currentCapital.toFixed(2));
                console.log("Total trades:", finalStats.totalTrades);
                console.log("Win rate:", finalStats.overallWinRate.toFixed(2) + "%");
                
                // Return backtest results
                return {
                    statistics: finalStats,
                    tradeHistory
                };
            } catch (backtestError) {
                console.error("Critical error in backtest process:", backtestError);
                // Return partial results if available
                return {
                    error: backtestError.message,
                    statistics,
                    tradeHistory
                };
            }
        };
        
        // Return enhanced indicator with all components
        return {
            // Original indicator values
            indicator: {
                ...baseIndicator,
                scalpLine: scalpLine.length ? round(scalpLine, 1) : []
            },
            // Enhanced signal with risk management
            signal,
            // Trade processing function
            processTrade,
            // Backtest function
            runBacktest,
            // Statistics calculation
            statistics,
            // Options used
            options: {
                length,
                period,
                multiplier,
                fast_multiplier,
                useScalpMode,
                scalpPeriod,
                rewardMultiple,
                initialCapital,
                riskPerTrade,
                useLeverage,
                leverageAmount,
                effectiveLeverage
            }
        };
    } catch (error) {
        console.error("Error calculating Enhanced J-Trend Sniper v3:", error);
        return { 
            indicator: {},
            trades: [],
            statistics: {},
            signal: false 
        };
    }
};

// Helper function to correctly divide with protection against division by zero
function divide(a, b) {
    if (Math.abs(b) < 1e-8) {
        return 0;
    }
    return a / b;
}

export default jalgo;