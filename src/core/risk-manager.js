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
        
        // Event callbacks
        this.onPositionOpen = options.onPositionOpen || null;
        this.onPositionClosed = options.onPositionClosed || null;
        
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
            
            // If there's an opposing position, close it first with the actual current price
            if (res.signal.position === "long" && this.inShortTrade) {
                const exitPrice = res.signal.location;
                this.closePosition("short", exitPrice, "signal");
            } else if (res.signal.position === "short" && this.inLongTrade) {
                const exitPrice = res.signal.location;
                this.closePosition("long", exitPrice, "signal");
            }
            
            let result = null;
            
            // Process new position
            if (res.signal.position === "long") {
                // Open a new long position
                this.inLongTrade = true;
                this.longEntryPrice = res.signal.location;
                
                // Use appropriate reference for calculating TP
                const refStop = this.useScalpMode ? 
                    res.fast_jATR_sma[res.fast_jATR_sma.length - 1] : 
                    res.jATR_sma[res.jATR_sma.length - 1];
                
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
                
                result = {
                    position: "long",
                    entry: this.longEntryPrice,
                    target: this.longTargetLevel,
                    risk: this.currentRiskAmount,
                    refStop: refStop,
                    timestamp: tradeInfo.timestamp
                };
            }
            else if (res.signal.position === "short") {
                // Open a new short position
                this.inShortTrade = true;
                this.shortEntryPrice = res.signal.location;
                
                // Use appropriate reference for calculating TP
                const refStop = this.useScalpMode ? 
                    res.fast_jATR_sma[res.fast_jATR_sma.length - 1] : 
                    res.jATR_sma[res.jATR_sma.length - 1];
                
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
                
                result = {
                    position: "short",
                    entry: this.shortEntryPrice,
                    target: this.shortTargetLevel,
                    risk: this.currentRiskAmount,
                    refStop: refStop,
                    timestamp: tradeInfo.timestamp
                };
            } else {
                return "invalid signal position";
            }
            
            // Call the onPositionOpen callback if provided and if we opened a position
            if (result && typeof this.onPositionOpen === 'function') {
                this.onPositionOpen(result);
            }
            
            return result;
        } catch (error) {
            console.error("Error handling new signal:", error);
            return "error";
        }
    }

    /**
     * Close an existing position
     * @param {string} positionType - "long" or "short"
     * @param {number} exitPrice - Price at which to exit the position
     * @param {string} [closeReason="signal"] - Reason for closing position: "signal", "tp_hit", or "manual"
     * @returns {Object} - Information about the closed position
     */
    closePosition(positionType, exitPrice, closeReason = "signal") {
        try {
            let result = null;
            
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
                
                // Determine win/loss based on target hit or direction of profitLoss
                let isWin = false;
                
                if (closeReason === "tp_hit") {
                    // If closed due to TP hit, it's always a win
                    isWin = true;
                    this.longTargetHits++;
                } else {
                    // For signal or manual close, it's a win only if profitLoss > 0
                    isWin = profitLoss > 0;
                }
                
                if (isWin) {
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
                    this.tradeHistory[actualIndex].status = closeReason === "tp_hit" ? "tp_hit" : "closed";
                    this.tradeHistory[actualIndex].closeTimestamp = new Date().toISOString();
                    this.tradeHistory[actualIndex].isWin = isWin;
                    this.tradeHistory[actualIndex].closeReason = closeReason;
                }
                
                // Reset position state
                this.inLongTrade = false;
                this.longEntryPrice = null;
                this.longStopReference = null;
                this.longTargetLevel = null;
                
                result = {
                    position: "long",
                    exit: exitPrice,
                    pnl: profitLoss,
                    capitalAfter: this.currentCapital,
                    isWin: isWin,
                    closeReason: closeReason
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
                
                // Determine win/loss based on target hit or direction of profitLoss
                let isWin = false;
                
                if (closeReason === "tp_hit") {
                    // If closed due to TP hit, it's always a win
                    isWin = true;
                    this.shortTargetHits++;
                } else {
                    // For signal or manual close, it's a win only if profitLoss > 0
                    isWin = profitLoss > 0;
                }
                
                if (isWin) {
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
                    this.tradeHistory[actualIndex].status = closeReason === "tp_hit" ? "tp_hit" : "closed";
                    this.tradeHistory[actualIndex].closeTimestamp = new Date().toISOString();
                    this.tradeHistory[actualIndex].isWin = isWin;
                    this.tradeHistory[actualIndex].closeReason = closeReason;
                }
                
                // Reset position state
                this.inShortTrade = false;
                this.shortEntryPrice = null;
                this.shortStopReference = null;
                this.shortTargetLevel = null;
                
                result = {
                    position: "short",
                    exit: exitPrice,
                    pnl: profitLoss,
                    capitalAfter: this.currentCapital,
                    isWin: isWin,
                    closeReason: closeReason
                };
            } else {
                result = {
                    error: `No ${positionType} position to close`
                };
            }
            
            // Call the onPositionClosed callback if provided
            if (result && !result.error && typeof this.onPositionClosed === 'function') {
                this.onPositionClosed(result);
            }
            
            return result;
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
            // Use the updated closePosition method with closeReason="tp_hit"
            if (positionType === "long" && this.inLongTrade) {
                return this.closePosition("long", exitPrice, "tp_hit");
            }
            else if (positionType === "short" && this.inShortTrade) {
                return this.closePosition("short", exitPrice, "tp_hit");
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

export default RiskRewardManager;