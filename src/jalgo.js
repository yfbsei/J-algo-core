import trend_sniper from './indicators/jTrendSniper.js';

/**
 * Risk-Reward Manager for J-Trend Sniper
 * Inspired by the TradingView J-Trend Sniper v3 implementation
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
     * Process a new signal from the indicator
     * @param {Object} signal - Signal object from trend_sniper
     * @param {Object} indicators - Current indicator values
     * @param {Object} prices - Current price data
     * @returns {Object} - Trade action and updated stats
     */
    processSignal(signal, indicators, prices) {
        if (!signal) return { action: null };
        
        const { position, location } = signal;
        const entryPrice = location;
        const currentPrice = prices.close[prices.close.length - 1];

        // Reference stop levels - can be either jATR or jATR_sma based on mode
        const referenceStop = this.useScalpMode 
            ? indicators.jATR_sma[indicators.jATR_sma.length - 1] 
            : indicators.jATR[indicators.jATR.length - 1];
            
        // Close existing position if signal is opposite
        let closingResult = null;
        
        if (position === 'long' && this.inShortTrade) {
            closingResult = this.closeShortTrade(currentPrice);
        } else if (position === 'short' && this.inLongTrade) {
            closingResult = this.closeLongTrade(currentPrice);
        }
        
        // Open new position
        let openingResult = null;
        
        if (position === 'long') {
            openingResult = this.openLongTrade(entryPrice, referenceStop);
        } else if (position === 'short') {
            openingResult = this.openShortTrade(entryPrice, referenceStop);
        }
        
        return {
            action: position,
            closingResult,
            openingResult,
            stats: this.getStats()
        };
    }
    
    /**
     * Open a new long trade
     * @param {number} entryPrice - Entry price
     * @param {number} stopReference - Reference stop level
     * @returns {Object} - Trade details
     */
    openLongTrade(entryPrice, stopReference) {
        this.longEntryPrice = entryPrice;
        this.longStopReference = stopReference;
        
        // Calculate risk and target
        const longRisk = entryPrice - stopReference;
        this.longTargetLevel = entryPrice + (longRisk * this.rewardMultiple);
        
        // Calculate risk amount in dollars for this trade
        this.currentRiskAmount = (this.currentCapital * this.riskPerTrade) / 100;
        this.totalRiskedAmount += this.currentRiskAmount;
        
        // Set trade as active
        this.inLongTrade = true;
        
        // Calculate liquidation level if using leverage
        const liquidationLevel = this.calculateLongLiquidationPrice(entryPrice);
        
        return {
            type: 'long',
            entryPrice,
            stopLevel: stopReference,
            targetLevel: this.longTargetLevel,
            riskAmount: this.currentRiskAmount,
            liquidationLevel
        };
    }
    
    /**
     * Open a new short trade
     * @param {number} entryPrice - Entry price
     * @param {number} stopReference - Reference stop level
     * @returns {Object} - Trade details
     */
    openShortTrade(entryPrice, stopReference) {
        this.shortEntryPrice = entryPrice;
        this.shortStopReference = stopReference;
        
        // Calculate risk and target
        const shortRisk = stopReference - entryPrice;
        this.shortTargetLevel = entryPrice - (shortRisk * this.rewardMultiple);
        
        // Calculate risk amount in dollars for this trade
        this.currentRiskAmount = (this.currentCapital * this.riskPerTrade) / 100;
        this.totalRiskedAmount += this.currentRiskAmount;
        
        // Set trade as active
        this.inShortTrade = true;
        
        // Calculate liquidation level if using leverage
        const liquidationLevel = this.calculateShortLiquidationPrice(entryPrice);
        
        return {
            type: 'short',
            entryPrice,
            stopLevel: stopReference,
            targetLevel: this.shortTargetLevel,
            riskAmount: this.currentRiskAmount,
            liquidationLevel
        };
    }
    
    /**
     * Check if target or stop has been hit for active trades
     * @param {Object} prices - Latest price data (high, low, close)
     * @returns {Object} - Hit result if any
     */
    checkTargetAndStopHits(prices) {
        if (!prices || !prices.high || !prices.low) {
            return { hit: false };
        }
        
        const { high, low } = prices;
        const lastHigh = high[high.length - 1];
        const lastLow = low[low.length - 1];
        
        // Check for long target hit
        if (this.inLongTrade && lastHigh >= this.longTargetLevel) {
            return this.processLongTargetHit();
        }
        
        // Check for short target hit
        if (this.inShortTrade && lastLow <= this.shortTargetLevel) {
            return this.processShortTargetHit();
        }
        
        // Check for long stop hit
        if (this.inLongTrade && lastLow <= this.longStopReference) {
            return this.closeLongTrade(this.longStopReference, true);
        }
        
        // Check for short stop hit
        if (this.inShortTrade && lastHigh >= this.shortStopReference) {
            return this.closeShortTrade(this.shortStopReference, true);
        }
        
        return { hit: false };
    }
    
    /**
     * Process a long target hit
     * @returns {Object} - Hit details
     */
    processLongTargetHit() {
        // Calculate P/L for the winning long trade
        const longWinAmount = this.currentRiskAmount * this.rewardMultiple * this.getEffectiveLeverage();
        
        // Update capital and track the win
        this.currentCapital += longWinAmount;
        this.totalProfitLoss += longWinAmount;
        this.totalProfit += longWinAmount;
        this.longWins += 1;
        this.longTargetHits += 1;
        
        // Store result data
        const result = {
            hit: true,
            type: 'long_target',
            entryPrice: this.longEntryPrice,
            exitPrice: this.longTargetLevel,
            profit: longWinAmount,
            riskRewardRatio: this.rewardMultiple
        };
        
        // Reset active trade state
        this.inLongTrade = false;
        this.longEntryPrice = null;
        this.longStopReference = null;
        this.longTargetLevel = null;
        
        return result;
    }
    
    /**
     * Process a short target hit
     * @returns {Object} - Hit details
     */
    processShortTargetHit() {
        // Calculate P/L for the winning short trade
        const shortWinAmount = this.currentRiskAmount * this.rewardMultiple * this.getEffectiveLeverage();
        
        // Update capital and track the win
        this.currentCapital += shortWinAmount;
        this.totalProfitLoss += shortWinAmount;
        this.totalProfit += shortWinAmount;
        this.shortWins += 1;
        this.shortTargetHits += 1;
        
        // Store result data
        const result = {
            hit: true,
            type: 'short_target',
            entryPrice: this.shortEntryPrice,
            exitPrice: this.shortTargetLevel,
            profit: shortWinAmount,
            riskRewardRatio: this.rewardMultiple
        };
        
        // Reset active trade state
        this.inShortTrade = false;
        this.shortEntryPrice = null;
        this.shortStopReference = null;
        this.shortTargetLevel = null;
        
        return result;
    }
    
    /**
     * Close a long trade at current price or stop level
     * @param {number} currentPrice - Current price to exit at
     * @param {boolean} isStopHit - Whether this is triggered by stop level
     * @returns {Object} - Close details
     */
    closeLongTrade(currentPrice, isStopHit = false) {
        if (!this.inLongTrade) return { closed: false };
        
        // Calculate actual P/L based on current price
        const longPL = currentPrice - this.longEntryPrice;
        const longRisk = this.longEntryPrice - this.longStopReference;
        
        // Default to full stop loss if stop hit
        let longTradeResult = 0;
        
        if (isStopHit) {
            // Full stop loss (affected by leverage)
            longTradeResult = -this.currentRiskAmount * this.getEffectiveLeverage();
            this.longLosses += 1;
        } else if (longPL > 0) {
            // In profit but didn't hit target - calculate partial profit
            const targetDistance = this.longTargetLevel - this.longEntryPrice;
            const actualDistance = longPL;
            const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
            const maxReward = this.currentRiskAmount * this.rewardMultiple * this.getEffectiveLeverage();
            
            longTradeResult = percentageToTarget * maxReward;
            this.longWins += 1;
            this.totalProfit += longTradeResult;
        } else {
            // In loss - proportional to the distance to the reference stop
            const percentageLoss = Math.min(Math.abs(longPL) / longRisk, 1.0);
            longTradeResult = -percentageLoss * this.currentRiskAmount * this.getEffectiveLeverage();
            this.longLosses += 1;
            this.totalLoss += Math.abs(longTradeResult);
        }
        
        // Update capital
        this.currentCapital += longTradeResult;
        this.totalProfitLoss += longTradeResult;
        
        // Store result data
        const result = {
            closed: true,
            type: 'long_close',
            entryPrice: this.longEntryPrice,
            exitPrice: currentPrice,
            pnl: longTradeResult,
            isStopHit
        };
        
        // Reset active trade state
        this.inLongTrade = false;
        this.longEntryPrice = null;
        this.longStopReference = null;
        this.longTargetLevel = null;
        
        return result;
    }
    
    /**
     * Close a short trade at current price or stop level
     * @param {number} currentPrice - Current price to exit at
     * @param {boolean} isStopHit - Whether this is triggered by stop level
     * @returns {Object} - Close details
     */
    closeShortTrade(currentPrice, isStopHit = false) {
        if (!this.inShortTrade) return { closed: false };
        
        // Calculate actual P/L based on current price
        const shortPL = this.shortEntryPrice - currentPrice;
        const shortRisk = this.shortStopReference - this.shortEntryPrice;
        
        // Default to full stop loss if stop hit
        let shortTradeResult = 0;
        
        if (isStopHit) {
            // Full stop loss (affected by leverage)
            shortTradeResult = -this.currentRiskAmount * this.getEffectiveLeverage();
            this.shortLosses += 1;
        } else if (shortPL > 0) {
            // In profit but didn't hit target - calculate partial profit
            const targetDistance = this.shortEntryPrice - this.shortTargetLevel;
            const actualDistance = shortPL;
            const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
            const maxReward = this.currentRiskAmount * this.rewardMultiple * this.getEffectiveLeverage();
            
            shortTradeResult = percentageToTarget * maxReward;
            this.shortWins += 1;
            this.totalProfit += shortTradeResult;
        } else {
            // In loss - proportional to the distance to the reference stop
            const percentageLoss = Math.min(Math.abs(shortPL) / shortRisk, 1.0);
            shortTradeResult = -percentageLoss * this.currentRiskAmount * this.getEffectiveLeverage();
            this.shortLosses += 1;
            this.totalLoss += Math.abs(shortTradeResult);
        }
        
        // Update capital
        this.currentCapital += shortTradeResult;
        this.totalProfitLoss += shortTradeResult;
        
        // Store result data
        const result = {
            closed: true,
            type: 'short_close',
            entryPrice: this.shortEntryPrice,
            exitPrice: currentPrice,
            pnl: shortTradeResult,
            isStopHit
        };
        
        // Reset active trade state
        this.inShortTrade = false;
        this.shortEntryPrice = null;
        this.shortStopReference = null;
        this.shortTargetLevel = null;
        
        return result;
    }
    
    /**
     * Get statistics about the trading system
     * @returns {Object} - Trading statistics
     */
    getStats() {
        const totalLongTrades = this.longWins + this.longLosses;
        const totalShortTrades = this.shortWins + this.shortLosses;
        const totalTrades = totalLongTrades + totalShortTrades;
        
        const longWinRate = totalLongTrades > 0 ? (this.longWins / totalLongTrades) * 100 : 0;
        const shortWinRate = totalShortTrades > 0 ? (this.shortWins / totalShortTrades) * 100 : 0;
        const overallWinRate = totalTrades > 0 ? ((this.longWins + this.shortWins) / totalTrades) * 100 : 0;
        
        const efficiency = this.totalRiskedAmount > 0 ? (this.totalProfitLoss / this.totalRiskedAmount) * 100 : 0;
        
        return {
            // Capital metrics
            initialCapital: this.initialCapital,
            currentCapital: this.currentCapital,
            totalProfitLoss: this.totalProfitLoss,
            totalProfit: this.totalProfit,
            totalLoss: this.totalLoss,
            
            // Trade count metrics
            longTrades: totalLongTrades,
            shortTrades: totalShortTrades,
            totalTrades,
            
            // Win metrics
            longWins: this.longWins,
            shortWins: this.shortWins,
            totalWins: this.longWins + this.shortWins,
            
            // Loss metrics
            longLosses: this.longLosses,
            shortLosses: this.shortLosses,
            totalLosses: this.longLosses + this.shortLosses,
            
            // Target hits
            longTargetHits: this.longTargetHits,
            shortTargetHits: this.shortTargetHits,
            totalTargetHits: this.longTargetHits + this.shortTargetHits,
            
            // Rate metrics
            longWinRate,
            shortWinRate,
            overallWinRate,
            efficiency,
            
            // System settings
            riskRewardRatio: this.rewardMultiple,
            riskPerTrade: this.riskPerTrade,
            leverageAmount: this.leverageAmount,
            isUsingLeverage: this.useLeverage,
            isUsingScalpMode: this.useScalpMode,
            
            // Current trade status
            inLongTrade: this.inLongTrade,
            inShortTrade: this.inShortTrade,
            longEntryPrice: this.longEntryPrice,
            shortEntryPrice: this.shortEntryPrice,
            longTargetLevel: this.longTargetLevel,
            shortTargetLevel: this.shortTargetLevel,
            longStopReference: this.longStopReference,
            shortStopReference: this.shortStopReference
        };
    }
    
    /**
     * Get the current active trade details
     * @returns {Object} - Current trade details
     */
    getCurrentTradeInfo() {
        if (this.inLongTrade) {
            return {
                type: 'long',
                entryPrice: this.longEntryPrice,
                stopLevel: this.longStopReference,
                targetLevel: this.longTargetLevel,
                liquidationLevel: this.calculateLongLiquidationPrice(this.longEntryPrice)
            };
        } else if (this.inShortTrade) {
            return {
                type: 'short',
                entryPrice: this.shortEntryPrice, 
                stopLevel: this.shortStopReference,
                targetLevel: this.shortTargetLevel,
                liquidationLevel: this.calculateShortLiquidationPrice(this.shortEntryPrice)
            };
        } else {
            return { type: 'none' };
        }
    }
    
    /**
     * Reset all trade statistics
     */
    reset() {
        this.currentCapital = this.initialCapital;
        this.totalProfitLoss = 0.0;
        this.totalProfit = 0.0;
        this.totalLoss = 0.0;
        this.totalRiskedAmount = 0.0;
        
        this.longWins = 0;
        this.longLosses = 0;
        this.shortWins = 0;
        this.shortLosses = 0;
        this.longTargetHits = 0;
        this.shortTargetHits = 0;
        
        this.inLongTrade = false;
        this.inShortTrade = false;
        this.longEntryPrice = null;
        this.shortEntryPrice = null;
        this.longStopReference = null;
        this.shortStopReference = null;
        this.longTargetLevel = null;
        this.shortTargetLevel = null;
        this.currentRiskAmount = 0.0;
    }
}

/**
 * Main JALgo class that combines trend indicator with risk management
 */
class JALgo {
    constructor(options = {}) {
        // Set default parameters
        this.length = options.length || 6;
        this.period = options.period || 16;
        this.multiplier = options.multiplier || 9;
        this.fast_multiplier = options.fast_multiplier || 5.1;
        
        // Create risk manager with passed or default options
        this.riskManager = new RiskRewardManager({
            initialCapital: options.initialCapital || 1000,
            riskPerTrade: options.riskPerTrade || 2.0,
            rewardMultiple: options.rewardMultiple || 1.5,
            useLeverage: options.useLeverage || false,
            leverageAmount: options.leverageAmount || 1.0,
            useScalpMode: options.useScalpMode || false
        });
        
        // Track last processed candle time to avoid duplicate signals
        this.lastProcessedTimestamp = null;
    }
    
    /**
     * Update the algorithm with new price data
     * @param {Object} priceData - Object containing OHLC arrays and timestamp
     * @returns {Object} - Updated indicator values and signals
     */
    update(priceData) {
        if (!priceData || !priceData.close || !priceData.open || !priceData.high || !priceData.low) {
            return { 
                error: "Invalid price data", 
                indicators: null, 
                trade: null, 
                stats: this.riskManager.getStats()
            };
        }
        
        // Skip update if timestamp is the same as last processed
        if (priceData.timestamp && priceData.timestamp === this.lastProcessedTimestamp) {
            return {
                indicators: null,
                trade: { action: null, message: "Duplicate timestamp" },
                stats: this.riskManager.getStats()
            };
        }
        
        // Calculate trend sniper indicators
        const indicators = trend_sniper(
            priceData, 
            this.length, 
            this.period, 
            this.multiplier, 
            this.fast_multiplier
        );
        
        // Check for target/stop hits first
        const hitResult = this.riskManager.checkTargetAndStopHits(priceData);
        
        // Process any new signals from the indicator
        const signalResult = this.riskManager.processSignal(
            indicators.signal, 
            indicators, 
            priceData
        );
        
        // Update last processed timestamp
        if (priceData.timestamp) {
            this.lastProcessedTimestamp = priceData.timestamp;
        }
        
        // Return combined results
        return {
            indicators,
            trade: hitResult.hit ? hitResult : signalResult,
            stats: this.riskManager.getStats(),
            currentTrade: this.riskManager.getCurrentTradeInfo()
        };
    }
    
    /**
     * Update risk manager settings
     * @param {Object} options - New risk manager options
     */
    updateSettings(options = {}) {
        // Update indicator settings if provided
        if (options.length !== undefined) this.length = options.length;
        if (options.period !== undefined) this.period = options.period;
        if (options.multiplier !== undefined) this.multiplier = options.multiplier;
        if (options.fast_multiplier !== undefined) this.fast_multiplier = options.fast_multiplier;
        
        // Update risk manager settings if provided
        if (options.initialCapital !== undefined) this.riskManager.initialCapital = options.initialCapital;
        if (options.riskPerTrade !== undefined) this.riskManager.riskPerTrade = options.riskPerTrade;
        if (options.rewardMultiple !== undefined) this.riskManager.rewardMultiple = options.rewardMultiple;
        if (options.useLeverage !== undefined) this.riskManager.useLeverage = options.useLeverage;
        if (options.leverageAmount !== undefined) this.riskManager.leverageAmount = options.leverageAmount;
        if (options.useScalpMode !== undefined) this.riskManager.useScalpMode = options.useScalpMode;
    }
    
    /**
     * Reset the algorithm state
     */
    reset() {
        this.riskManager.reset();
        this.lastProcessedTimestamp = null;
    }
    
    /**
     * Get current statistics
     * @returns {Object} - Current stats
     */
    getStats() {
        return this.riskManager.getStats();
    }
}

export { JALgo, RiskRewardManager };