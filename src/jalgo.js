import trend_sniper from './indicators/jTrendSniper.js';
import binance_candles from './utility/binance_market.js';

/**
 * Risk-Reward Manager for J-Trend Sniper
 * Corrected version - No Stop Loss, only exits on target hit or new signal
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
    
    handleNewSignal(res = {}) {
        if(res.signal.position === "long") {
            this.inLongTrade = true;
            this.longEntryPrice = res.signal.location;
            this.longStopReference = this.useScalpMode ? res.fast_jATR_sma : res.jATR_sma;
            this.longTargetLevel = this.calculateTakeProfit_level(res.signal.location, longStopReference);
            this.calculateRiskAmount();
        }
        else if(res.signal.position === "short") {
            this.inShortTrade = true;
            this.shortEntryPrice = res.signal.location;
            this.shortStopReference = this.useScalpMode ? res.fast_jATR_sma : res.jATR_sma;
            this.shortTargetLevel = this.calculateTakeProfit_level(res.signal.location, shortStopReference);
            this.calculateRiskAmount();
        } else {
            return "error";
        }
    }

    handleTakeProfitHit(positionType = "") {
        if(positionType = "long") {}

        if(positionType = "short") {}
    }

    calculateRiskAmount() {
        return this.currentRiskAmount = this.currentCapital * (this.riskPerTrade / 100); // TODO decimal round
    }

    calculateTakeProfit_level(entryPrice, stopLoss, rewardMultiple = this.rewardMultiple) {
        // Calculate risk (absolute distance from entry to stop)
        const risk = Math.abs(entryPrice - stopLoss);
        
        // Calculate reward based on the multiple
        const reward = risk * rewardMultiple;
        
        // Calculate take profit based on position direction
        if (entryPrice > stopLoss) {
          // Long position: stop is below entry
          return entryPrice + reward;
        } else {
          // Short position: stop is above entry
          return entryPrice - reward;
        }
      }


}

class Jalgo {
    constructor(options = {}){
        this.symbol = options.symbol || "BTCUSDT";
        this.timeframe = options.timeframe || "5m";
        this.market = options.market || "futures"; // futures or spot
        this.initialCandles = binance_candles(this.market, this.symbol, this.timeframe, 500);

        this.riskManager = new RiskRewardManager(options.riskOptions || {});
    }

  /**
   * Process market data and generate trading signals
   */
  processSignal() {
    try {
      // Run the trading algorithm
      const res = trend_sniper(this.initialCandles);
      
      if (res.signal) {
        this.riskManager.handleNewSignal(res);
      } else {
        return false;
      }
    } catch (error) {
      console.error("Error processing trading signal:", error);
    }
  }

  processTakeProfitHit(candle = {}) {
    if(this.riskManager.inLongTrade && candle.high >= this.riskManager.longTargetLevel) {
        this.riskManager.handleTakeProfitHit("long");
    }

    else if(this.riskManager.inShortTrade && candle.low <= this.riskManager.shortTargetLevel) {
        this.riskManager.handleTakeProfitHit("short");
    }

    return false;
  }

    processNewCandle(candle = {}) {  // Only process completed candles
        // Extract candle data
        const candle = [
            parseFloat(candle.o), // open
            parseFloat(candle.h), // high
            parseFloat(candle.l), // low
            parseFloat(candle.c), // close
            parseFloat(candle.v)  // volume
          ];
          
          if(candle.x) {
          // Update candle data arrays
          for (const [i, key] of Object.keys(this.initialCandles).entries()) {
            if (this.initialCandles[key].length > 0) {
              this.initialCandles[key].shift(); // remove oldest candle
              this.initialCandles[key].push(this.initialCandles[i]);
            }
        };
        this.processSignal(); // check at every candle close for new signal
        }

        if(this.riskManager.inLongTrade || this.riskManager.inShortTrade) { // if in a trade
            this.processTakeProfitHit({high: candle[1], low: candle[2]}); // check if hit TP
        }
    }
}