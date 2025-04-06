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
                signal: baseSignal
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
                    stopLevel: stopReference,
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
                    stopLevel: stopReference,
                    targetLevel,
                    riskAmount,
                    rewardAmount: riskAmount * rewardMultiple * effectiveLeverage,
                    liquidationLevel
                };
            }
        }
        
        // Function to simulate trade execution and update statistics
        // This would typically be used with historical data to backtest
        const executeTrade = (trade, nextPrice) => {
            const { position, location: entryPrice, stopLevel, targetLevel, riskAmount } = trade;
            
            // Update risked amount tracking
            statistics.totalRiskedAmount += riskAmount;
            
            let tradeResult = 0;
            let isWin = false;
            let isTargetHit = false;
            
            if (position === 'long') {
                // Check if target was hit (win with full reward)
                if (nextPrice >= targetLevel) {
                    tradeResult = riskAmount * rewardMultiple * effectiveLeverage;
                    isWin = true;
                    isTargetHit = true;
                    statistics.longTargetHits += 1;
                }
                // Check if stop was hit (loss)
                else if (nextPrice <= stopLevel) {
                    tradeResult = -riskAmount * effectiveLeverage;
                    isWin = false;
                }
                // Otherwise calculate partial result
                else {
                    const priceDelta = nextPrice - entryPrice;
                    const targetDelta = targetLevel - entryPrice;
                    
                    // Calculate what percentage to target
                    const percentToTarget = priceDelta / targetDelta;
                    
                    // Apply pro-rated reward
                    tradeResult = percentToTarget * riskAmount * rewardMultiple * effectiveLeverage;
                    isWin = tradeResult > 0;
                }
                
                // Update long win/loss statistics
                if (isWin) {
                    statistics.longWins += 1;
                    statistics.totalProfit += tradeResult;
                } else {
                    statistics.longLosses += 1;
                    statistics.totalLoss += Math.abs(tradeResult);
                }
            } 
            else if (position === 'short') {
                // Check if target was hit (win with full reward)
                if (nextPrice <= targetLevel) {
                    tradeResult = riskAmount * rewardMultiple * effectiveLeverage;
                    isWin = true;
                    isTargetHit = true;
                    statistics.shortTargetHits += 1;
                }
                // Check if stop was hit (loss)
                else if (nextPrice >= stopLevel) {
                    tradeResult = -riskAmount * effectiveLeverage;
                    isWin = false;
                }
                // Otherwise calculate partial result
                else {
                    const priceDelta = entryPrice - nextPrice;
                    const targetDelta = entryPrice - targetLevel;
                    
                    // Calculate what percentage to target
                    const percentToTarget = priceDelta / targetDelta;
                    
                    // Apply pro-rated reward
                    tradeResult = percentToTarget * riskAmount * rewardMultiple * effectiveLeverage;
                    isWin = tradeResult > 0;
                }
                
                // Update short win/loss statistics
                if (isWin) {
                    statistics.shortWins += 1;
                    statistics.totalProfit += tradeResult;
                } else {
                    statistics.shortLosses += 1;
                    statistics.totalLoss += Math.abs(tradeResult);
                }
            }
            
            // Update capital and total P/L
            statistics.currentCapital += tradeResult;
            statistics.totalProfitLoss += tradeResult;
            
            // Calculate efficiency
            statistics.efficiency = statistics.totalRiskedAmount > 0 ? 
                (statistics.totalProfitLoss / statistics.totalRiskedAmount) * 100 : 0;
            
            // Return trade result info
            return {
                position,
                entryPrice,
                exitPrice: nextPrice,
                stopLevel,
                targetLevel,
                pnl: tradeResult,
                isWin,
                isTargetHit
            };
        };
        
        // Calculate overall statistics
        const calculateStats = () => {
            const totalLongTrades = statistics.longWins + statistics.longLosses;
            const totalShortTrades = statistics.shortWins + statistics.shortLosses;
            const totalTrades = totalLongTrades + totalShortTrades;
            
            const longWinRate = totalLongTrades > 0 ? (statistics.longWins / totalLongTrades) * 100 : 0;
            const shortWinRate = totalShortTrades > 0 ? (statistics.shortWins / totalShortTrades) * 100 : 0;
            const overallWinRate = totalTrades > 0 ? 
                ((statistics.longWins + statistics.shortWins) / totalTrades) * 100 : 0;
            
            return {
                ...statistics,
                totalLongTrades,
                totalShortTrades,
                totalTrades,
                longWinRate,
                shortWinRate,
                overallWinRate
            };
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
            // Trade execution simulation function
            executeTrade,
            // Statistics calculation function
            calculateStats,
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