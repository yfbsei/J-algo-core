import trend_sniper from './indicators/jTrendSniper.js';
import binance_candles from './utility/binance_market.js';

/**
 * Risk-Reward Manager for J-Trend Sniper
 * No Stop Loss, only exits on target hit or new opposing signal
 */
class RiskRewardManager {
    constructor(options = {}) {
        // Default settings
        this.initialCapital = options.initialCapital || 1000;
        this.riskPerTrade = options.riskPerTrade || 2.0; // percent
        this.rewardMultiple = options.rewardMultiple || 1.5;
        this.useLeverage = options.useLeverage || false;
        this.leverageAmount = options.leverageAmount || 1.0;
        this.useScalpMode = options.useScalpMode || false;
        
        // Internal state
        this.currentCapital = this.initialCapital;
        this.totalProfitLoss = 0.0;
        this.totalProfit = 0.0;
        this.totalLoss = 0.0;
        this.totalRiskedAmount = 0.0;
        
        // Trade tracking
        this.longWins = 0;
        this.longLosses = 0;
        this.shortWins = 0;
        this.shortLosses = 0;
        this.longTargetHits = 0;
        this.shortTargetHits = 0;
        
        // Active trade info
        this.inLongTrade = false;
        this.inShortTrade = false;
        this.longEntryPrice = null;
        this.shortEntryPrice = null;
        this.longStopReference = null;
        this.shortStopReference = null;
        this.longTargetLevel = null;
        this.shortTargetLevel = null;
        this.currentRiskAmount = 0.0;
        
        // Trade history
        this.tradeHistory = [];
    }
    
    /**
     * Gets the effective leverage factor
     * @returns {number} - The effective leverage multiplier
     */
    getEffectiveLeverage() {
        return this.useLeverage ? this.leverageAmount : 1.0;
    }
    
    /**
     * Calculate liquidation price for a long position
     * @param {number} entryPrice - Entry price of the position
     * @returns {number|null} - Liquidation price or null if no leverage
     */
    calculateLongLiquidationPrice(entryPrice) {
        if (!this.useLeverage || this.leverageAmount <= 1.0) return null;
        return entryPrice * (1 - (1 / this.leverageAmount));
    }
    
    /**
     * Calculate liquidation price for a short position
     * @param {number} entryPrice - Entry price of the position
     * @returns {number|null} - Liquidation price or null if no leverage
     */
    calculateShortLiquidationPrice(entryPrice) {
        if (!this.useLeverage || this.leverageAmount <= 1.0) return null;
        return entryPrice * (1 + (1 / this.leverageAmount));
    }
    
    /**
     * Calculate risk amount for the current trade
     * @returns {number} - Dollar amount to risk based on current capital
     */
    calculateRiskAmount() {
        this.currentRiskAmount = parseFloat((this.currentCapital * (this.riskPerTrade / 100)).toFixed(2));
        this.totalRiskedAmount += this.currentRiskAmount;
        return this.currentRiskAmount;
    }

    /**
     * Calculate take profit level based on entry and reference stop
     * @param {number} entryPrice - Entry price of the position
     * @param {number} refStop - Reference stop level (for risk calculation only)
     * @param {number} [rewardMultiple] - Optional custom reward multiple
     * @returns {number} - Take profit price level
     */
    calculateTakeProfit_level(entryPrice, refStop, rewardMultiple = this.rewardMultiple) {
        // Calculate risk (absolute distance from entry to stop)
        const risk = Math.abs(entryPrice - refStop);
        
        // Calculate reward based on the multiple
        const reward = risk * rewardMultiple;
        
        // Calculate take profit based on position direction
        if (entryPrice > refStop) {
            // Long position: reference stop is below entry
            return parseFloat((entryPrice + reward).toFixed(2));
        } else {
            // Short position: reference stop is above entry
            return parseFloat((entryPrice - reward).toFixed(2));
        }
    }
    
    /**
     * Handle a new trading signal
     * @param {Object} res - Result from trend_sniper with signal info
     * @returns {Object|string} - Information about the handled signal or error
     */
    handleNewSignal(res = {}) {
        try {
            if (!res.signal) return "no signal";
            
            // If there's an opposing position, close it first
            if (res.signal.position === "long" && this.inShortTrade) {
                this.closePosition("short", res.jATR[res.jATR.length - 1]);
            } else if (res.signal.position === "short" && this.inLongTrade) {
                this.closePosition("long", res.jATR[res.jATR.length - 1]);
            }
            
            // Process new position
            if (res.signal.position === "long") {
                // Open a new long position
                this.inLongTrade = true;
                this.longEntryPrice = res.signal.location;
                
                // Use appropriate reference for calculating TP
                const refStop = this.useScalpMode ? 
                    res.fast_jATR_sma[res.fast_jATR_sma.length - 1] : 
                    res.jATR[res.jATR.length - 1];
                
                this.longStopReference = refStop;
                this.longTargetLevel = this.calculateTakeProfit_level(this.longEntryPrice, refStop);
                this.calculateRiskAmount();
                
                // Record the trade
                const tradeInfo = {
                    type: "long",
                    entry: this.longEntryPrice,
                    refStop: refStop,
                    target: this.longTargetLevel,
                    riskAmount: this.currentRiskAmount,
                    timestamp: new Date().toISOString(),
                    status: "open"
                };
                
                this.tradeHistory.push(tradeInfo);
                
                return {
                    position: "long",
                    entry: this.longEntryPrice,
                    target: this.longTargetLevel,
                    risk: this.currentRiskAmount
                };
            }
            else if (res.signal.position === "short") {
                // Open a new short position
                this.inShortTrade = true;
                this.shortEntryPrice = res.signal.location;
                
                // Use appropriate reference for calculating TP
                const refStop = this.useScalpMode ? 
                    res.fast_jATR_sma[res.fast_jATR_sma.length - 1] : 
                    res.jATR[res.jATR.length - 1];
                
                this.shortStopReference = refStop;
                this.shortTargetLevel = this.calculateTakeProfit_level(this.shortEntryPrice, refStop);
                this.calculateRiskAmount();
                
                // Record the trade
                const tradeInfo = {
                    type: "short",
                    entry: this.shortEntryPrice,
                    refStop: refStop,
                    target: this.shortTargetLevel,
                    riskAmount: this.currentRiskAmount,
                    timestamp: new Date().toISOString(),
                    status: "open"
                };
                
                this.tradeHistory.push(tradeInfo);
                
                return {
                    position: "short",
                    entry: this.shortEntryPrice,
                    target: this.shortTargetLevel,
                    risk: this.currentRiskAmount
                };
            } else {
                return "invalid signal position";
            }
        } catch (error) {
            console.error("Error handling new signal:", error);
            return "error";
        }
    }

    /**
     * Close an existing position
     * @param {string} positionType - "long" or "short"
     * @param {number} exitPrice - Price at which to exit the position
     * @returns {Object} - Information about the closed position
     */
    closePosition(positionType, exitPrice) {
        try {
            if (positionType === "long" && this.inLongTrade) {
                // Calculate P&L for the long position
                const priceDifference = exitPrice - this.longEntryPrice;
                const directionMultiplier = priceDifference >= 0 ? 1 : -1;
                
                // Calculate profit/loss based on risk amount and effective leverage
                const refStopDifference = Math.abs(this.longEntryPrice - this.longStopReference);
                const percentOfTarget = Math.min(Math.abs(priceDifference) / refStopDifference, this.rewardMultiple);
                
                // Calculate P&L based on percentage of target reached
                const profitLoss = this.currentRiskAmount * percentOfTarget * directionMultiplier * this.getEffectiveLeverage();
                
                // Update statistics
                this.currentCapital += profitLoss;
                this.totalProfitLoss += profitLoss;
                
                if (profitLoss > 0) {
                    this.totalProfit += profitLoss;
                    this.longWins++;
                } else {
                    this.totalLoss += Math.abs(profitLoss);
                    this.longLosses++;
                }
                
                // Update trade history
                const lastLongTradeIndex = [...this.tradeHistory].reverse().findIndex(trade => 
                    trade.type === "long" && trade.status === "open");
                
                if (lastLongTradeIndex !== -1) {
                    const actualIndex = this.tradeHistory.length - 1 - lastLongTradeIndex;
                    this.tradeHistory[actualIndex].exitPrice = exitPrice;
                    this.tradeHistory[actualIndex].pnl = profitLoss;
                    this.tradeHistory[actualIndex].status = "closed";
                    this.tradeHistory[actualIndex].closeTimestamp = new Date().toISOString();
                }
                
                // Reset position state
                this.inLongTrade = false;
                this.longEntryPrice = null;
                this.longStopReference = null;
                this.longTargetLevel = null;
                
                return {
                    position: "long",
                    exit: exitPrice,
                    pnl: profitLoss,
                    capitalAfter: this.currentCapital
                };
            }
            else if (positionType === "short" && this.inShortTrade) {
                // Calculate P&L for the short position
                const priceDifference = this.shortEntryPrice - exitPrice;
                const directionMultiplier = priceDifference >= 0 ? 1 : -1;
                
                // Calculate profit/loss based on risk amount and effective leverage
                const refStopDifference = Math.abs(this.shortEntryPrice - this.shortStopReference);
                const percentOfTarget = Math.min(Math.abs(priceDifference) / refStopDifference, this.rewardMultiple);
                
                // Calculate P&L based on percentage of target reached
                const profitLoss = this.currentRiskAmount * percentOfTarget * directionMultiplier * this.getEffectiveLeverage();
                
                // Update statistics
                this.currentCapital += profitLoss;
                this.totalProfitLoss += profitLoss;
                
                if (profitLoss > 0) {
                    this.totalProfit += profitLoss;
                    this.shortWins++;
                } else {
                    this.totalLoss += Math.abs(profitLoss);
                    this.shortLosses++;
                }
                
                // Update trade history
                const lastShortTradeIndex = [...this.tradeHistory].reverse().findIndex(trade => 
                    trade.type === "short" && trade.status === "open");
                
                if (lastShortTradeIndex !== -1) {
                    const actualIndex = this.tradeHistory.length - 1 - lastShortTradeIndex;
                    this.tradeHistory[actualIndex].exitPrice = exitPrice;
                    this.tradeHistory[actualIndex].pnl = profitLoss;
                    this.tradeHistory[actualIndex].status = "closed";
                    this.tradeHistory[actualIndex].closeTimestamp = new Date().toISOString();
                }
                
                // Reset position state
                this.inShortTrade = false;
                this.shortEntryPrice = null;
                this.shortStopReference = null;
                this.shortTargetLevel = null;
                
                return {
                    position: "short",
                    exit: exitPrice,
                    pnl: profitLoss,
                    capitalAfter: this.currentCapital
                };
            }
            
            return {
                error: `No ${positionType} position to close`
            };
        } catch (error) {
            console.error(`Error closing ${positionType} position:`, error);
            return { error: "Failed to close position" };
        }
    }

    /**
     * Handle when price hits the take profit level
     * @param {string} positionType - "long" or "short"
     * @param {number} exitPrice - Price level where TP was hit
     * @returns {Object|boolean} - Trade result or false if no TP hit
     */
    handleTakeProfitHit(positionType, exitPrice) {
        try {
            if (positionType === "long") {
                // Calculate win amount for long TP hit
                const winAmount = this.currentRiskAmount * this.rewardMultiple * this.getEffectiveLeverage();
                
                // Update capital and tracker stats
                this.currentCapital += winAmount;
                this.totalProfitLoss += winAmount;
                this.totalProfit += winAmount;
                this.longWins++;
                this.longTargetHits++;
                
                // Update trade history
                const lastLongTradeIndex = [...this.tradeHistory].reverse().findIndex(trade => 
                    trade.type === "long" && trade.status === "open");
                
                if (lastLongTradeIndex !== -1) {
                    const actualIndex = this.tradeHistory.length - 1 - lastLongTradeIndex;
                    this.tradeHistory[actualIndex].exitPrice = exitPrice;
                    this.tradeHistory[actualIndex].pnl = winAmount;
                    this.tradeHistory[actualIndex].status = "tp_hit";
                    this.tradeHistory[actualIndex].closeTimestamp = new Date().toISOString();
                }
                
                // Reset position state
                this.inLongTrade = false;
                this.longEntryPrice = null;
                this.longStopReference = null;
                this.longTargetLevel = null;
                
                return {
                    position: "long",
                    exit: exitPrice,
                    pnl: winAmount,
                    capitalAfter: this.currentCapital,
                    targetHit: true
                };
            }
            else if (positionType === "short") {
                // Calculate win amount for short TP hit
                const winAmount = this.currentRiskAmount * this.rewardMultiple * this.getEffectiveLeverage();
                
                // Update capital and tracker stats
                this.currentCapital += winAmount;
                this.totalProfitLoss += winAmount;
                this.totalProfit += winAmount;
                this.shortWins++;
                this.shortTargetHits++;
                
                // Update trade history
                const lastShortTradeIndex = [...this.tradeHistory].reverse().findIndex(trade => 
                    trade.type === "short" && trade.status === "open");
                
                if (lastShortTradeIndex !== -1) {
                    const actualIndex = this.tradeHistory.length - 1 - lastShortTradeIndex;
                    this.tradeHistory[actualIndex].exitPrice = exitPrice;
                    this.tradeHistory[actualIndex].pnl = winAmount;
                    this.tradeHistory[actualIndex].status = "tp_hit";
                    this.tradeHistory[actualIndex].closeTimestamp = new Date().toISOString();
                }
                
                // Reset position state
                this.inShortTrade = false;
                this.shortEntryPrice = null;
                this.shortStopReference = null;
                this.shortTargetLevel = null;
                
                return {
                    position: "short",
                    exit: exitPrice,
                    pnl: winAmount,
                    capitalAfter: this.currentCapital,
                    targetHit: true
                };
            }
            
            return false;
        } catch (error) {
            console.error(`Error handling take profit for ${positionType}:`, error);
            return false;
        }
    }
    
    /**
     * Get performance statistics
     * @returns {Object} - Performance metrics
     */
    getPerformanceStats() {
        const totalLongTrades = this.longWins + this.longLosses;
        const totalShortTrades = this.shortWins + this.shortLosses;
        const totalTrades = totalLongTrades + totalShortTrades;
        
        const longWinRate = totalLongTrades > 0 ? (this.longWins / totalLongTrades) * 100 : 0;
        const shortWinRate = totalShortTrades > 0 ? (this.shortWins / totalShortTrades) * 100 : 0;
        const overallWinRate = totalTrades > 0 ? ((this.longWins + this.shortWins) / totalTrades) * 100 : 0;
        
        const efficiency = this.totalRiskedAmount > 0 ? (this.totalProfitLoss / this.totalRiskedAmount) * 100 : 0;
        
        return {
            longTrades: totalLongTrades,
            shortTrades: totalShortTrades,
            totalTrades: totalTrades,
            longWins: this.longWins,
            shortWins: this.shortWins,
            longLosses: this.longLosses,
            shortLosses: this.shortLosses,
            longTargetHits: this.longTargetHits,
            shortTargetHits: this.shortTargetHits,
            longWinRate: parseFloat(longWinRate.toFixed(2)),
            shortWinRate: parseFloat(shortWinRate.toFixed(2)),
            overallWinRate: parseFloat(overallWinRate.toFixed(2)),
            initialCapital: this.initialCapital,
            currentCapital: parseFloat(this.currentCapital.toFixed(2)),
            totalProfitLoss: parseFloat(this.totalProfitLoss.toFixed(2)),
            totalProfit: parseFloat(this.totalProfit.toFixed(2)),
            totalLoss: parseFloat(this.totalLoss.toFixed(2)),
            rewardRatio: parseFloat(this.rewardMultiple.toFixed(2)),
            riskPerTrade: this.riskPerTrade,
            efficiency: parseFloat(efficiency.toFixed(2)),
            scalpMode: this.useScalpMode,
            leverageAmount: this.useLeverage ? this.leverageAmount : "OFF"
        };
    }
}

/**
 * Main Jalgo trading class
 */
class Jalgo {
    /**
     * Create a new Jalgo instance
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        // Trading parameters
        this.symbol = options.symbol || "BTCUSDT";
        this.timeframe = options.timeframe || "5m";
        this.market = options.market || "futures"; // futures or spot
        
        // Initialize candles with empty arrays
        this.initialCandles = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        
        // Risk management
        this.riskManager = new RiskRewardManager(options.riskOptions || {});
        
        // Tracking variables
        this.isInitialized = false;
        this.lastProcessedCandleTime = null;
        this.lastSignal = null;
        
        // Event callbacks
        this.onSignal = options.onSignal || null;
        this.onTakeProfitHit = options.onTakeProfitHit || null;
        this.onError = options.onError || null;
        
        // Initialize the system
        this.initialize();
    }
    
    /**
     * Initialize the system with historical candles
     */
    async initialize() {
        try {
            console.log(`Initializing Jalgo for ${this.symbol} on ${this.timeframe} timeframe...`);
            
            // Fetch initial candles
            this.initialCandles = await binance_candles(this.market, this.symbol, this.timeframe, 500);
            
            if (!this.initialCandles || !this.initialCandles.close || this.initialCandles.close.length < 100) {
                throw new Error("Failed to initialize with sufficient candle data");
            }
            
            console.log(`Initialized with ${this.initialCandles.close.length} candles`);
            this.isInitialized = true;
            
            // Check for initial signal
            this.processSignal();
            
        } catch (error) {
            console.error("Initialization error:", error);
            if (this.onError) this.onError(error);
        }
    }

    /**
     * Process market data and generate trading signals
     * @returns {Object|boolean} - Signal information or false if no signal
     */
    processSignal() {
        try {
            if (!this.isInitialized) {
                console.warn("Cannot process signal: system not initialized");
                return false;
            }
            
            // Run the trading algorithm
            const res = trend_sniper(this.initialCandles);
            
            if (!res || !res.signal) {
                return false;
            }
            
            // Handle the signal
            const signalResult = this.riskManager.handleNewSignal(res);
            this.lastSignal = {
                ...signalResult,
                timestamp: new Date().toISOString()
            };
            
            // Call the signal callback if provided
            if (this.onSignal && signalResult !== "no signal" && signalResult !== "error") {
                this.onSignal(this.lastSignal);
            }
            
            return this.lastSignal;
            
        } catch (error) {
            console.error("Error processing trading signal:", error);
            if (this.onError) this.onError(error);
            return false;
        }
    }

    /**
     * Check if price hits take profit levels
     * @param {Object} candle - Price candle data
     * @returns {Object|boolean} - Take profit result or false
     */
    processTakeProfitHit(candle) {
        try {
            // Check for long take profit hit
            if (this.riskManager.inLongTrade && 
                this.riskManager.longTargetLevel && 
                candle.high >= this.riskManager.longTargetLevel) {
                
                const result = this.riskManager.handleTakeProfitHit("long", this.riskManager.longTargetLevel);
                
                // Call the callback if provided
                if (this.onTakeProfitHit && result) {
                    this.onTakeProfitHit(result);
                }
                
                return result;
            }
            // Check for short take profit hit
            else if (this.riskManager.inShortTrade && 
                    this.riskManager.shortTargetLevel && 
                    candle.low <= this.riskManager.shortTargetLevel) {
                
                const result = this.riskManager.handleTakeProfitHit("short", this.riskManager.shortTargetLevel);
                
                // Call the callback if provided
                if (this.onTakeProfitHit && result) {
                    this.onTakeProfitHit(result);
                }
                
                return result;
            }
            
            return false;
        } catch (error) {
            console.error("Error processing take profit hit:", error);
            if (this.onError) this.onError(error);
            return false;
        }
    }

    /**
     * Process a new candle from the market
     * @param {Object} candleData - New candle data
     */
    processNewCandle(candleData) {
        try {
            if (!this.isInitialized) {
                console.warn("Cannot process candle: system not initialized");
                return;
            }
            
            // Skip duplicate candles
            if (this.lastProcessedCandleTime === candleData.t) {
                return;
            }
            
            // Extract candle data
            const open = parseFloat(candleData.o);
            const high = parseFloat(candleData.h);
            const low = parseFloat(candleData.l);
            const close = parseFloat(candleData.c);
            const volume = parseFloat(candleData.v);
            
            // Create candle object for TP checking
            const candle = { high, low };
            
            // First, check for take profit hits on every tick (completed or not)
            if (this.riskManager.inLongTrade || this.riskManager.inShortTrade) {
                this.processTakeProfitHit(candle);
            }
            
            // Only process completed candles for signal generation
            if (candleData.x === true) {
                // Update candle data arrays by shifting the oldest and adding the newest
                for (const key of Object.keys(this.initialCandles)) {
                    if (Array.isArray(this.initialCandles[key]) && this.initialCandles[key].length > 0) {
                        // Remove the oldest candle
                        this.initialCandles[key].shift();
                        
                        // Add the new candle value
                        const value = key === 'open' ? open :
                                    key === 'high' ? high :
                                    key === 'low' ? low :
                                    key === 'close' ? close :
                                    key === 'volume' ? volume : 0;
                                    
                        this.initialCandles[key].push(value);
                    }
                }
                
                // Update last processed candle time
                this.lastProcessedCandleTime = candleData.t;
                
                // Process for new signals on candle close
                this.processSignal();
            }
        } catch (error) {
            console.error("Error processing new candle:", error);
            if (this.onError) this.onError(error);
        }
    }
    
    /**
     * Get performance statistics
     * @returns {Object} - Performance statistics
     */
    getPerformanceStats() {
        return this.riskManager.getPerformanceStats();
    }
    
    /**
     * Get trade history
     * @returns {Array} - Trade history
     */
    getTradeHistory() {
        return this.riskManager.tradeHistory;
    }
    
    /**
     * Get current positions
     * @returns {Object} - Current position information
     */
    getCurrentPositions() {
        return {
            inLongTrade: this.riskManager.inLongTrade,
            inShortTrade: this.riskManager.inShortTrade,
            longEntry: this.riskManager.longEntryPrice,
            shortEntry: this.riskManager.shortEntryPrice,
            longTP: this.riskManager.longTargetLevel,
            shortTP: this.riskManager.shortTargetLevel,
            currentRisk: this.riskManager.currentRiskAmount,
            leverageUsed: this.riskManager.getEffectiveLeverage()
        };
    }
}

export default Jalgo;