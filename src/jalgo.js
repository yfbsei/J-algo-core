import { multiply, subtract, add, round, divide, abs } from 'mathjs';
import { ATR, SMA } from 'technicalindicators';

/**
 * Calculate Smoothed ATR (SATR)
 * @param {Object} source - Object containing OHLC price arrays
 * @param {number} period - ATR period
 * @param {number} multiplier - ATR multiplier
 * @returns {Array} - Array of Smoothed ATR values
 */
const SATR = (source = {}, period = 16, multiplier = 9) => {
    // Validate input data
    if (!source || !source.high || !source.low || !source.close) {
        console.error("Missing required price data in source object");
        return [];
    }

    // Ensure data arrays have enough elements
    if (source.high.length < period || source.low.length < period || source.close.length < period) {
        console.warn("Not enough data points to calculate ATR. Need at least", period);
        return [];
    }

    try {
        const defATR = [];

        // Calculate regular ATR
        const aTR = ATR.calculate({
            high: source.high,
            low: source.low,
            close: source.close,
            period: period
        });

        if (!aTR.length) {
            console.warn("ATR calculation returned no values");
            return [];
        }

        // Calculate normalized lines
        const nl = aTR.map(x => multiply(multiplier, x));
        const close = source.close.slice(-nl.length); // same length as nl

        for (let i = 0; i < nl.length; i++) {
            // Safe access to previous values with fallbacks
            const pre_defATR = i > 0 ? defATR[i - 1] : close[0];
            const pre_close = i > 0 ? close[i - 1] : close[0];

            // Logic for determining the ATR value based on price action
            let val;
            
            if (close[i] > pre_defATR && pre_close > pre_defATR) {
                val = Math.max(pre_defATR, subtract(close[i], nl[i]));
            } else if (close[i] < pre_defATR && pre_close < pre_defATR) {
                val = Math.min(pre_defATR, add(close[i], nl[i]));
            } else if (close[i] > pre_defATR) {
                val = subtract(close[i], nl[i]);
            } else {
                val = add(close[i], nl[i]);
            }

            defATR.push(val);
        }
        
        return round(defATR, 1);
    } catch (error) {
        console.error("Error calculating Smoothed ATR:", error);
        return [];
    }
};

/**
 * Calculate Variable Moving Average
 * @param {Object} source - Object containing OHLC price arrays
 * @param {number} length - Length of the moving average period
 * @returns {Array} - Array of VAR MA values
 */
const variable_moving_average = (source = {}, length = 6) => {
    // Validate input data
    if (!source || !source.close || !source.open || !source.high || !source.low) {
        console.error("Missing required price data in source object");
        return [];
    }

    try {
        const var_ma = [];
    
        // Calculate SMAs for different price components
        const c_sma = SMA.calculate({period: length, values: source.close });
        const o_sma = SMA.calculate({period: length, values: source.open });
        const h_sma = SMA.calculate({period: length, values: source.high });
        const l_sma = SMA.calculate({period: length, values: source.low });

        // Ensure we have calculated values before proceeding
        if (!c_sma.length || !o_sma.length || !h_sma.length || !l_sma.length) {
            console.warn("Not enough data to calculate SMAs");
            return [];
        }

        const close = source.close.slice(-c_sma.length); // same length as close_sma

        for(let i = 0; i < close.length; i++) {
            // Safe division - check for zero divisor
            let lv = 0;
            const highLowDiff = subtract(h_sma[i], l_sma[i]);
            
            if (Math.abs(highLowDiff) > 1e-8) { // Avoid division by zero or very small numbers
                lv = abs(divide(subtract(c_sma[i], o_sma[i]), highLowDiff));
            }
            
            // Previous value with safe fallback
            const prevValue = i > 0 ? var_ma[i-1] : close[0];
            
            // Calculate the variable MA value
            const value = add(
                multiply(lv, close[i]), 
                multiply(subtract(1, lv), prevValue)
            );

            var_ma.push(value); 
        }
        return round(var_ma, 1);
    } catch (error) {
        console.error("Error calculating Variable Moving Average:", error);
        return [];
    }
};

/**
 * Calculate Scalp Line
 * @param {Array} defATR - The defATR values
 * @param {Array} var_ma - The variable moving average values
 * @param {number} period - The period for the SMA of the scalp line
 * @returns {Array} - Array of scalp line values
 */
const calculateScalpLine = (defATR, var_ma, period = 21) => {
    if (!defATR.length || !var_ma.length) {
        return [];
    }

    try {
        // Calculate the midpoint between defATR and var_ma
        const ss = defATR.map((val, i) => {
            if (i >= var_ma.length) return val;
            
            if (val > var_ma[i]) {
                return val - (val - var_ma[i]) / 2;
            } else {
                return val + (var_ma[i] - val) / 2;
            }
        });

        // Apply SMA to the midpoint values
        if (ss.length >= period) {
            return SMA.calculate({period: period, values: ss});
        } else {
            console.warn("Not enough data to calculate Scalp Line SMA");
            return ss; // Return raw values if not enough data for SMA
        }
    } catch (error) {
        console.error("Error calculating Scalp Line:", error);
        return [];
    }
};

/**
 * Generate signal based on indicator values
 * @param {Array} var_ma - Variable moving average values
 * @param {Array} defATR - defATR values
 * @param {Array} close - Closing prices
 * @returns {Object|false} - Signal object or false if no signal
 */
const generateSignal = (var_ma, defATR, close) => {
    // Only generate signals if we have enough data points
    if (var_ma.length < 2 || defATR.length < 2 || close.length < 1) {
        console.log("Not enough data points for signal generation");
        return false;
    }

    // Get the last two values for comparison
    const current_var_ma = var_ma[var_ma.length - 1];
    const previous_var_ma = var_ma[var_ma.length - 2];
    const current_defATR = defATR[defATR.length - 1];
    const previous_defATR = defATR[defATR.length - 2];
    const current_close = close[close.length - 1];

    // Debug log
    console.log("Signal check - current_var_ma:", current_var_ma, "current_defATR:", current_defATR);
    console.log("Signal check - previous_var_ma:", previous_var_ma, "previous_defATR:", previous_defATR);
    console.log("Cross conditions - long:", current_var_ma > current_defATR && previous_var_ma <= previous_defATR);
    console.log("Cross conditions - short:", current_var_ma < current_defATR && previous_var_ma >= previous_defATR);

    // Cross over - bullish signal
    if (current_var_ma > current_defATR && previous_var_ma <= previous_defATR) {
        console.log("LONG SIGNAL GENERATED");
        return {
            order: "market",
            position: 'long',
            location: current_close
        };
    } 
    // Cross under - bearish signal
    else if (current_var_ma < current_defATR && previous_var_ma >= previous_defATR) {
        console.log("SHORT SIGNAL GENERATED");
        return {
            order: "market",
            position: 'short',
            location: current_close
        };
    }

    return false;
};

/**
 * Initialize trading state
 * @param {Object} config - Configuration options
 * @returns {Object} - Initial state object
 */
const initializeState = (config = {}) => {
    return {
        // Trade tracking
        inLongTrade: false,
        inShortTrade: false,
        longEntryPrice: null,
        shortEntryPrice: null,
        longTargetLevel: null,
        shortTargetLevel: null,
        longStopReference: null,
        shortStopReference: null,
        
        // Statistics
        longWins: 0,
        longLosses: 0,
        shortWins: 0,
        shortLosses: 0,
        longTargetHits: 0,
        shortTargetHits: 0,
        
        // Capital tracking
        initialCapital: config.initialCapital || 100,
        currentCapital: config.initialCapital || 100,
        totalProfitLoss: 0,
        totalProfit: 0,
        totalLoss: 0,
        totalRiskedAmount: 0,
        
        // Current risk amount
        riskAmount: 0
    };
};

/**
 * Process a bar of price data
 * @param {Object} source - Object containing OHLC price arrays for current bar
 * @param {Object} state - Current state object
 * @param {Object} indicators - Current indicator values
 * @param {Object} config - Configuration options
 * @returns {Object} - Updated state object
 */
const processBar = (source, state, indicators, config) => {
    const { defATR, var_ma, scalpLine } = indicators;
    const { rewardMultiple, riskPerTrade, leverageAmount, useLeverage } = config;
    
    // Get the close, high, and low for the current bar
    const close = source.close[source.close.length - 1];
    const high = source.high[source.high.length - 1];
    const low = source.low[source.low.length - 1];
    
    // Calculate effective leverage
    const effectiveLeverage = useLeverage ? leverageAmount : 1.0;
    
    // Check for target hits
    let updatedState = { ...state };
    
    // IMPORTANT: Check for target hits BEFORE processing new signals
    // Check if long target is hit
    if (updatedState.inLongTrade && high >= updatedState.longTargetLevel) {
        // Calculate P/L for the winning long trade
        const longWinAmount = updatedState.riskAmount * rewardMultiple * effectiveLeverage;
        
        // Update capital and stats
        updatedState.currentCapital += longWinAmount;
        updatedState.totalProfitLoss += longWinAmount;
        updatedState.totalProfit += longWinAmount;
        updatedState.longWins++;
        updatedState.longTargetHits++;
        
        // Close the trade
        updatedState.inLongTrade = false;
        
        // Return early - we don't want to process signals for this bar if we've already hit a target
        return {
            state: updatedState,
            signal: false // No new signal since we're closing an existing trade by target hit
        };
    }
    
    // Check if short target is hit
    if (updatedState.inShortTrade && low <= updatedState.shortTargetLevel) {
        // Calculate P/L for the winning short trade
        const shortWinAmount = updatedState.riskAmount * rewardMultiple * effectiveLeverage;
        
        // Update capital and stats
        updatedState.currentCapital += shortWinAmount;
        updatedState.totalProfitLoss += shortWinAmount;
        updatedState.totalProfit += shortWinAmount;
        updatedState.shortWins++;
        updatedState.shortTargetHits++;
        
        // Close the trade
        updatedState.inShortTrade = false;
        
        // Return early - we don't want to process signals for this bar if we've already hit a target
        return {
            state: updatedState,
            signal: false // No new signal since we're closing an existing trade by target hit
        };
    }
    
    // Only check for signals if we haven't already hit a target on this bar
    // Check for signals
    const signal = generateSignal(var_ma, defATR, source.close);
    
    if (signal) {
        // Process long signal
        if (signal.position === 'long') {
            // If we're in a short trade, close it first
            if (updatedState.inShortTrade) {
                // Calculate actual P/L based on current price
                const shortPL = updatedState.shortEntryPrice - close;
                const shortRisk = updatedState.shortStopReference - updatedState.shortEntryPrice;
                
                // Calculate P/L proportionally
                const maxReward = updatedState.riskAmount * rewardMultiple * effectiveLeverage;
                let shortTradeResult = 0.0;
                
                if (shortPL > 0) {
                    // In profit but didn't hit target
                    // Calculate what percentage of the way to target we got
                    const targetDistance = updatedState.shortEntryPrice - updatedState.shortTargetLevel;
                    const actualDistance = shortPL;
                    const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
                    shortTradeResult = percentageToTarget * maxReward;
                    updatedState.totalProfit += shortTradeResult;
                } else {
                    // In loss - proportional to the distance to the reference stop
                    const percentageLoss = Math.min(Math.abs(shortPL) / Math.abs(shortRisk), 1.0);
                    // Losses are also affected by leverage
                    shortTradeResult = -percentageLoss * updatedState.riskAmount * effectiveLeverage;
                    updatedState.totalLoss += Math.abs(shortTradeResult);
                }
                
                updatedState.currentCapital += shortTradeResult;
                updatedState.totalProfitLoss += shortTradeResult;
                
                // Determine win/loss based on actual profit/loss amount
                if (shortTradeResult > 0) {
                    updatedState.shortWins++;
                } else {
                    updatedState.shortLosses++;
                }
                
                // Reset short trade state
                updatedState.inShortTrade = false;
            }
            
            // Start a new long trade
            updatedState.longEntryPrice = close;
            
            // Set reference stop based on scalp line
            updatedState.longStopReference = scalpLine[scalpLine.length - 1];
            
            const longRisk = updatedState.longEntryPrice - updatedState.longStopReference;
            updatedState.longTargetLevel = updatedState.longEntryPrice + (longRisk * rewardMultiple);
            
            // Calculate risk amount in dollars for this trade
            updatedState.riskAmount = (updatedState.currentCapital * riskPerTrade) / 100;
            updatedState.totalRiskedAmount += updatedState.riskAmount;
            
            // Set trade as active
            updatedState.inLongTrade = true;
        }
        
        // Process short signal
        else if (signal.position === 'short') {
            // If we're in a long trade, close it first
            if (updatedState.inLongTrade) {
                // Calculate actual P/L based on current price
                const longPL = close - updatedState.longEntryPrice;
                const longRisk = updatedState.longEntryPrice - updatedState.longStopReference;
                
                // Calculate P/L proportionally
                const maxReward = updatedState.riskAmount * rewardMultiple * effectiveLeverage;
                let longTradeResult = 0.0;
                
                if (longPL > 0) {
                    // In profit but didn't hit target
                    // Calculate what percentage of the way to target we got
                    const targetDistance = updatedState.longTargetLevel - updatedState.longEntryPrice;
                    const actualDistance = longPL;
                    const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
                    longTradeResult = percentageToTarget * maxReward;
                    updatedState.totalProfit += longTradeResult;
                } else {
                    // In loss - proportional to the distance to the reference stop
                    const percentageLoss = Math.min(Math.abs(longPL) / Math.abs(longRisk), 1.0);
                    // Losses are also affected by leverage
                    longTradeResult = -percentageLoss * updatedState.riskAmount * effectiveLeverage;
                    updatedState.totalLoss += Math.abs(longTradeResult);
                }
                
                updatedState.currentCapital += longTradeResult;
                updatedState.totalProfitLoss += longTradeResult;
                
                // Determine win/loss based on actual profit/loss amount
                if (longTradeResult > 0) {
                    updatedState.longWins++;
                } else {
                    updatedState.longLosses++;
                }
                
                // Reset long trade state
                updatedState.inLongTrade = false;
            }
            
            // Start a new short trade
            updatedState.shortEntryPrice = close;
            
            // Set reference stop based on scalp line
            updatedState.shortStopReference = scalpLine[scalpLine.length - 1];
            
            const shortRisk = updatedState.shortStopReference - updatedState.shortEntryPrice;
            updatedState.shortTargetLevel = updatedState.shortEntryPrice - (shortRisk * rewardMultiple);
            
            // Calculate risk amount in dollars for this trade
            updatedState.riskAmount = (updatedState.currentCapital * riskPerTrade) / 100;
            updatedState.totalRiskedAmount += updatedState.riskAmount;
            
            // Set trade as active
            updatedState.inShortTrade = true;
        }
    }
    
    return {
        state: updatedState,
        signal: signal
    };
};

/**
 * Calculate statistics from state
 * @param {Object} state - Current state object
 * @returns {Object} - Statistics object
 */
const calculateStats = (state) => {
    // Calculate total trades and win rates
    const totalLongTrades = state.longWins + state.longLosses;
    const totalShortTrades = state.shortWins + state.shortLosses;
    const totalTrades = totalLongTrades + totalShortTrades;
    
    const longWinRate = totalLongTrades > 0 ? (state.longWins / totalLongTrades) * 100 : 0;
    const shortWinRate = totalShortTrades > 0 ? (state.shortWins / totalShortTrades) * 100 : 0;
    const overallWinRate = totalTrades > 0 ? ((state.longWins + state.shortWins) / totalTrades) * 100 : 0;
    
    // Calculate efficiency
    const efficiency = state.totalRiskedAmount > 0 ? (state.totalProfitLoss / state.totalRiskedAmount) * 100 : 0;
    
    return {
        totalLongTrades,
        totalShortTrades,
        longWinRate,
        shortWinRate,
        overallWinRate,
        efficiency
    };
};

/**
 * J-Trend Sniper v3 Algorithm
 * @param {Object} source - Object containing OHLC price arrays
 * @param {Object} state - Previous state object (or null for initialization)
 * @param {Object} config - Configuration options
 * @returns {Object} - Indicator values, signals, and updated state
 */
const jAlgo = (source = {}, state = null, config = {}) => {
    // Set default configuration
    const defaultConfig = {
        // Core indicator parameters
        fastLength: 6,           // Fast Length for Variable MA
        ATRPeriod: 16,           // Period for ATR
        ATRMultiplier: 9,        // Multiplier for main ATR
        ATRMultiplierFast: 5.1,  // Multiplier for fast ATR
        
        // Scalp mode parameters
        scalpPeriod: 21,         // Scalp Line Period for SMA
        
        // Risk-reward parameters
        rewardMultiple: 1.5,     // Target = Risk × Multiple
        initialCapital: 100,     // Initial Capital in $
        riskPerTrade: 10,        // Risk Per Trade in %
        
        // Leverage parameters
        useLeverage: false,      // Whether to use leverage
        leverageAmount: 2.0      // Leverage amount (e.g., 2.0 = 2x leverage)
    };
    
    // Merge provided config with defaults
    const mergedConfig = { ...defaultConfig, ...config };
    
    // Initialize state if not provided
    const currentState = state || initializeState(mergedConfig);
    
    try {
        // Validate input data
        if (!source || !source.high || !source.low || !source.close || !source.open) {
            console.error("Missing required price data in source object");
            return { 
                indicators: {},
                signal: false,
                state: currentState,
                stats: calculateStats(currentState)
            };
        }
        
        // Calculate main indicators
        const defATR = SATR(source, mergedConfig.ATRPeriod, mergedConfig.ATRMultiplier);
        const fast_jATR = SATR(source, mergedConfig.ATRPeriod, mergedConfig.ATRMultiplierFast);
        const var_ma = variable_moving_average(source, mergedConfig.fastLength);
        
        // Early return if we couldn't calculate core indicators
        if (!defATR.length || !var_ma.length) {
            return { 
                indicators: {
                    defATR: defATR || [],
                    fast_jATR: fast_jATR || [],
                    var_ma: var_ma || [],
                    scalpLine: []
                },
                signal: false,
                state: currentState,
                stats: calculateStats(currentState)
            };
        }

        // Calculate Scalp Line (this is our reference for stops)
        const scalpLine = calculateScalpLine(defATR, var_ma, mergedConfig.scalpPeriod);
        
        // Compile indicators
        const indicators = {
            defATR,
            fast_jATR,
            var_ma,
            scalpLine
        };
        
        // Process bar data - update trading state and check for signals
        const result = processBar(source, currentState, indicators, mergedConfig);
        
        // Calculate statistics
        const stats = calculateStats(result.state);
        
        // Return comprehensive result
        return {
            indicators,
            signal: result.signal,
            state: result.state,
            stats
        };
    } catch (error) {
        console.error("Error in jAlgo calculation:", error);
        return { 
            indicators: {
                defATR: [],
                fast_jATR: [],
                var_ma: [],
                scalpLine: []
            },
            signal: false,
            state: currentState,
            stats: calculateStats(currentState)
        };
    }
};

export default jAlgo;