/**
 * Real-time Trend Sniper v3 Implementation with WebSocket Support
 * 
 * This version is designed to handle live incoming data from WebSockets
 * and provide real-time signals and analytics.
 */

const EventEmitter = require('events');

/**
 * Technical Analysis Utility Functions
 * These replace PineScript's built-in functions
 */
class TechnicalAnalysis {
  /**
   * Calculate True Range
   * @param {number} high - Current high price
   * @param {number} low - Current low price
   * @param {number} close - Current close price
   * @param {number|null} prevClose - Previous close price
   * @returns {number} - True Range value
   */
  static trueRange(high, low, close, prevClose) {
    if (prevClose === null) {
      return high - low; // First bar, use high-low
    }
    
    const range1 = high - low;
    const range2 = Math.abs(high - prevClose);
    const range3 = Math.abs(low - prevClose);
    
    return Math.max(range1, range2, range3);
  }
  
  /**
   * Calculate Simple Moving Average (SMA) for the last value in a series
   * @param {Array} values - Array of price values
   * @param {number} period - SMA period
   * @returns {number|null} - Latest SMA value
   */
  static smaLast(values, period) {
    if (values.length < period) {
      return null;
    }
    
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) {
      sum += values[i];
    }
    
    return sum / period;
  }
  
  /**
   * Update an ATR value with a new data point
   * @param {number} prevAtr - Previous ATR value
   * @param {number} tr - Current True Range value
   * @param {number} period - ATR period
   * @returns {number} - Updated ATR value
   */
  static updateAtr(prevAtr, tr, period) {
    if (prevAtr === null) {
      return tr;
    }
    
    return (prevAtr * (period - 1) + tr) / period;
  }
}

/**
 * Real-Time Trend Sniper Indicator
 * Designed to process data as it arrives via WebSockets
 */
class RealTimeTrendSniper extends EventEmitter {
  /**
   * Create a new RealTimeTrendSniper instance
   * @param {Object} config - Configuration parameters
   */
  constructor(config = {}) {
    super();
    
    // Set default configuration
    this.config = {
      // Main parameters
      fastLen: 6,
      ATRPeriod: 16,
      ATRMultip: 9,
      ATRMultip_fast: 5.1,
      
      // Scalp mode parameters
      useScalpMode: false,
      scalpPeriod: 21,
      
      // Risk-reward parameters
      rewardMultiple: 1.5,
      initialCapital: 1000,
      riskPerTrade: 2.0,
      
      // Leverage parameters
      useLeverage: false,
      leverageAmount: 2.0,
      
      // Real-time specific settings
      maxHistorySize: 1000, // Maximum number of candles to keep in memory
      logSignals: true,     // Whether to log signals to console
      
      // Override with user-provided config
      ...config
    };
    
    // Initialize data arrays with limited size for real-time usage
    this.reset();
    
    // Flag to indicate if we're ready to generate signals
    // (need enough data to calculate indicators)
    this.isReady = false;
  }
  
  /**
   * Reset all trading state variables
   */
  reset() {
    // Data arrays (limited size history)
    this.timestamps = [];
    this.opens = [];
    this.highs = [];
    this.lows = [];
    this.closes = [];
    
    // Indicator values (latest)
    this.atr = null;
    this.defATR = null;
    this.defATR_fast = null;
    this.a = null;
    this.scalpLine = null;
    
    // Trend component history for calculating scalpLine
    this.aHistory = [];
    this.defATRHistory = [];
    
    // Signal state
    this.lastSignal = null;
    this.lastSignalTime = null;
    
    // Trade tracking
    this.longEntryPrice = null;
    this.shortEntryPrice = null;
    this.longTargetLevel = null;
    this.shortTargetLevel = null;
    this.inLongTrade = false;
    this.inShortTrade = false;
    this.longStopReference = null;
    this.shortStopReference = null;
    
    // Statistics
    this.longWins = 0;
    this.longLosses = 0;
    this.shortWins = 0;
    this.shortLosses = 0;
    this.longTargetHits = 0;
    this.shortTargetHits = 0;
    this.currentCapital = this.config.initialCapital;
    this.totalProfitLoss = 0;
    this.totalRiskedAmount = 0;
    this.riskAmount = 0;
    this.totalProfit = 0;
    this.totalLoss = 0;
    
    // Cross state for signal detection
    this.prevA = null;
    this.prevDefATR = null;
  }
  
  /**
   * Initialize with historical data (to fill indicators before live updates)
   * @param {Array} historicalData - Array of OHLC objects
   */
  initWithHistoricalData(historicalData) {
    // Process historical data to initialize indicators
    for (const candle of historicalData) {
      this.update(candle, false); // Process without emitting events
    }
    
    // Mark as ready after processing historical data
    this.isReady = this.timestamps.length >= Math.max(
      this.config.ATRPeriod,
      this.config.fastLen,
      this.config.scalpPeriod
    );
    
    if (this.isReady) {
      this.emit('ready', {
        timestamp: this.timestamps[this.timestamps.length - 1],
        indicators: this.getIndicators()
      });
    }
  }
  
  /**
   * Update the indicator with a new data point (candle)
   * @param {Object} candle - OHLC candle object { timestamp, open, high, low, close }
   * @param {boolean} emitEvents - Whether to emit events (default: true)
   */
  update(candle, emitEvents = true) {
    const { timestamp, open, high, low, close } = candle;
    
    // Add new data to arrays
    this.timestamps.push(timestamp);
    this.opens.push(open);
    this.highs.push(high);
    this.lows.push(low);
    this.closes.push(close);
    
    // Trim arrays if they exceed maxHistorySize
    if (this.timestamps.length > this.config.maxHistorySize) {
      this.timestamps.shift();
      this.opens.shift();
      this.highs.shift();
      this.lows.shift();
      this.closes.shift();
      
      // Also trim indicator histories
      if (this.aHistory.length > this.config.maxHistorySize) {
        this.aHistory.shift();
      }
      if (this.defATRHistory.length > this.config.maxHistorySize) {
        this.defATRHistory.shift();
      }
    }
    
    // Update indicators with new data
    this.updateIndicators();
    
    // Check for signal conditions
    const signal = this.checkForSignals();
    
    // Check if we should process target hits
    this.checkTargetHits(high, low, timestamp);
    
    // Emit events if necessary
    if (emitEvents) {
      // Emit update event with latest indicators
      this.emit('update', {
        timestamp,
        close,
        indicators: this.getIndicators()
      });
      
      // Emit signal event if we have a new signal
      if (signal) {
        this.emit('signal', {
          type: signal,
          timestamp,
          price: close,
          indicators: this.getIndicators(),
          stats: this.getStats()
        });
      }
    }
  }
  
  /**
   * Update all indicator values with the latest data
   */
  updateIndicators() {
    const { fastLen, ATRPeriod, ATRMultip, ATRMultip_fast, scalpPeriod } = this.config;
    
    // Calculate latest indicators
    
    // 1. Update ATR
    const dataLength = this.closes.length;
    if (dataLength < 2) {
      // Not enough data yet
      this.atr = null;
      return;
    }
    
    // Calculate latest True Range
    const currentHigh = this.highs[dataLength - 1];
    const currentLow = this.lows[dataLength - 1];
    const currentClose = this.closes[dataLength - 1];
    const prevClose = this.closes[dataLength - 2];
    
    const tr = TechnicalAnalysis.trueRange(currentHigh, currentLow, currentClose, prevClose);
    
    // Update ATR
    if (this.atr === null && dataLength >= ATRPeriod) {
      // Calculate first ATR (simple average of TR values)
      let sum = tr;
      for (let i = 1; i < ATRPeriod; i++) {
        const idx = dataLength - 1 - i;
        if (idx >= 0) {
          sum += TechnicalAnalysis.trueRange(
            this.highs[idx],
            this.lows[idx],
            this.closes[idx],
            idx > 0 ? this.closes[idx - 1] : null
          );
        }
      }
      this.atr = sum / ATRPeriod;
    } else if (this.atr !== null) {
      // Update existing ATR
      this.atr = TechnicalAnalysis.updateAtr(this.atr, tr, ATRPeriod);
    }
    
    if (this.atr === null) {
      // Still don't have enough data
      return;
    }
    
    // 2. Calculate SMAs for cc, oo, hh, ll
    const hasEnoughDataForSMA = dataLength >= fastLen;
    let cc = null, oo = null, hh = null, ll = null;
    
    if (hasEnoughDataForSMA) {
      cc = TechnicalAnalysis.smaLast(this.closes, fastLen);
      oo = TechnicalAnalysis.smaLast(this.opens, fastLen);
      hh = TechnicalAnalysis.smaLast(this.highs, fastLen);
      ll = TechnicalAnalysis.smaLast(this.lows, fastLen);
    }
    
    if (!hasEnoughDataForSMA || cc === null || oo === null || hh === null || ll === null) {
      // Not enough data for SMAs
      return;
    }
    
    // 3. Calculate 'a' value (trend component)
    const lv = Math.abs(cc - oo) / (hh - ll);
    if (this.a === null) {
      this.a = currentClose;
    } else {
      this.a = lv * currentClose + (1 - lv) * this.a;
    }
    
    // Keep history for scalpLine calculation
    this.aHistory.push(this.a);
    
    // 4. Calculate defATR (ATR trailing stop)
    const nl = ATRMultip * this.atr;
    
    if (this.defATR === null) {
      this.defATR = currentClose > this.a ? currentClose - nl : currentClose + nl;
    } else {
      // Save previous value for crossover detection
      this.prevDefATR = this.defATR;
      this.prevA = this.a;
      
      if (currentClose > this.defATR && prevClose > this.defATR) {
        this.defATR = Math.max(this.defATR, currentClose - nl);
      } else if (currentClose < this.defATR && prevClose < this.defATR) {
        this.defATR = Math.min(this.defATR, currentClose + nl);
      } else if (currentClose > this.defATR) {
        this.defATR = currentClose - nl;
      } else {
        this.defATR = currentClose + nl;
      }
    }
    
    // Keep history for scalpLine calculation
    this.defATRHistory.push(this.defATR);
    
    // 5. Calculate defATR_fast
    const nl_fast = ATRMultip_fast * this.atr;
    
    if (this.defATR_fast === null) {
      this.defATR_fast = currentClose > this.a ? currentClose - nl_fast : currentClose + nl_fast;
    } else {
      if (currentClose > this.defATR_fast && prevClose > this.defATR_fast) {
        this.defATR_fast = Math.max(this.defATR_fast, currentClose - nl_fast);
      } else if (currentClose < this.defATR_fast && prevClose < this.defATR_fast) {
        this.defATR_fast = Math.min(this.defATR_fast, currentClose + nl_fast);
      } else if (currentClose > this.defATR_fast) {
        this.defATR_fast = currentClose - nl_fast;
      } else {
        this.defATR_fast = currentClose + nl_fast;
      }
    }
    
    // 6. Calculate scalpLine
    if (this.aHistory.length >= scalpPeriod && this.defATRHistory.length >= scalpPeriod) {
      const ssValues = [];
      
      // Calculate SS values for SMA
      for (let i = 1; i <= scalpPeriod; i++) {
        const idx = this.aHistory.length - i;
        if (idx >= 0 && idx < this.defATRHistory.length) {
          const aVal = this.aHistory[idx];
          const defATRVal = this.defATRHistory[idx];
          
          const ss = defATRVal > aVal 
            ? defATRVal - (defATRVal - aVal) / 2 
            : defATRVal + (aVal - defATRVal) / 2;
          
          ssValues.push(ss);
        }
      }
      
      // Calculate SMA of SS values
      if (ssValues.length >= scalpPeriod) {
        let sum = 0;
        for (const value of ssValues) {
          sum += value;
        }
        this.scalpLine = sum / ssValues.length;
      }
    }
    
    // Mark as ready once we have all indicators
    this.isReady = this.atr !== null && this.a !== null && 
                   this.defATR !== null && this.defATR_fast !== null && 
                   this.scalpLine !== null;
  }
  
  /**
   * Check for signal conditions
   * @returns {string|null} - Signal type ('long', 'short') or null if no signal
   */
  checkForSignals() {
    // Need previous values for crossover/crossunder detection
    if (!this.isReady || this.prevA === null || this.prevDefATR === null) {
      return null;
    }
    
    // Check for long signal (a crosses over defATR)
    if (this.a > this.defATR && this.prevA <= this.prevDefATR) {
      this.processLongSignal();
      return 'long';
    }
    
    // Check for short signal (a crosses under defATR)
    if (this.a < this.defATR && this.prevA >= this.prevDefATR) {
      this.processShortSignal();
      return 'short';
    }
    
    return null;
  }
  
  /**
   * Process a long signal
   */
  processLongSignal() {
    const { useScalpMode, rewardMultiple, riskPerTrade, useLeverage, leverageAmount } = this.config;
    const timestamp = this.timestamps[this.timestamps.length - 1];
    const close = this.closes[this.closes.length - 1];
    
    // If in a short trade when a long signal appears, close it
    if (this.inShortTrade) {
      // Calculate actual P/L based on current price
      const shortPL = this.shortEntryPrice - close;
      const shortRisk = this.shortStopReference - this.shortEntryPrice;
      
      // Calculate P/L proportionally
      const effectiveLeverage = useLeverage ? leverageAmount : 1.0;
      const maxReward = this.riskAmount * rewardMultiple * effectiveLeverage;
      let shortTradeResult = 0;
      
      if (shortPL > 0) {
        // In profit but didn't hit target
        const targetDistance = this.shortEntryPrice - this.shortTargetLevel;
        const actualDistance = shortPL;
        const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
        shortTradeResult = percentageToTarget * maxReward;
        this.totalProfit += shortTradeResult;
      } else {
        // In loss - proportional to the distance to the reference stop
        const percentageLoss = Math.min(Math.abs(shortPL) / shortRisk, 1.0);
        shortTradeResult = -percentageLoss * this.riskAmount * effectiveLeverage;
        this.totalLoss += Math.abs(shortTradeResult);
      }
      
      this.currentCapital += shortTradeResult;
      this.totalProfitLoss += shortTradeResult;
      
      // Determine win/loss based on actual profit/loss amount
      if (shortTradeResult > 0) {
        this.shortWins++;
        if (this.config.logSignals) {
          console.log(`${new Date(timestamp).toISOString()}: CLOSED SHORT (SIGNAL) - Profit: $${shortTradeResult.toFixed(2)}, Price: ${close.toFixed(4)}`);
        }
      } else {
        this.shortLosses++;
        if (this.config.logSignals) {
          console.log(`${new Date(timestamp).toISOString()}: CLOSED SHORT (SIGNAL) - Loss: $${Math.abs(shortTradeResult).toFixed(2)}, Price: ${close.toFixed(4)}`);
        }
      }
      
      // Emit trade event
      this.emit('trade', {
        action: 'close',
        direction: 'short',
        timestamp,
        price: close,
        pl: shortTradeResult,
        capital: this.currentCapital
      });
      
      // Reset short trade state
      this.inShortTrade = false;
    }
    
    // Start a new long trade
    this.longEntryPrice = close;
    
    // Set reference stop based on mode (defATR or scalpLine)
    this.longStopReference = useScalpMode ? this.scalpLine : this.defATR;
    
    const longRisk = this.longEntryPrice - this.longStopReference;
    this.longTargetLevel = this.longEntryPrice + (longRisk * rewardMultiple);
    
    // Calculate risk amount in dollars for this trade
    this.riskAmount = (this.currentCapital * riskPerTrade) / 100;
    this.totalRiskedAmount += this.riskAmount;
    
    // Log new long trade
    if (this.config.logSignals) {
      console.log(`${new Date(timestamp).toISOString()}: NEW LONG - Entry: ${this.longEntryPrice.toFixed(4)}, Stop: ${this.longStopReference.toFixed(4)}, Target: ${this.longTargetLevel.toFixed(4)}, Risk: $${this.riskAmount.toFixed(2)}`);
    }
    
    // Emit trade event
    this.emit('trade', {
      action: 'open',
      direction: 'long',
      timestamp,
      price: close,
      stop: this.longStopReference,
      target: this.longTargetLevel,
      risk: this.riskAmount
    });
    
    // Set trade as active
    this.inLongTrade = true;
    this.lastSignal = 'long';
    this.lastSignalTime = timestamp;
  }
  
  /**
   * Process a short signal
   */
  processShortSignal() {
    const { useScalpMode, rewardMultiple, riskPerTrade, useLeverage, leverageAmount } = this.config;
    const timestamp = this.timestamps[this.timestamps.length - 1];
    const close = this.closes[this.closes.length - 1];
    
    // If in a long trade when a short signal appears, close it
    if (this.inLongTrade) {
      // Calculate actual P/L based on current price
      const longPL = close - this.longEntryPrice;
      const longRisk = this.longEntryPrice - this.longStopReference;
      
      // Calculate P/L proportionally
      const effectiveLeverage = useLeverage ? leverageAmount : 1.0;
      const maxReward = this.riskAmount * rewardMultiple * effectiveLeverage;
      let longTradeResult = 0;
      
      if (longPL > 0) {
        // In profit but didn't hit target
        const targetDistance = this.longTargetLevel - this.longEntryPrice;
        const actualDistance = longPL;
        const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
        longTradeResult = percentageToTarget * maxReward;
        this.totalProfit += longTradeResult;
      } else {
        // In loss - proportional to the distance to the reference stop
        const percentageLoss = Math.min(Math.abs(longPL) / longRisk, 1.0);
        longTradeResult = -percentageLoss * this.riskAmount * effectiveLeverage;
        this.totalLoss += Math.abs(longTradeResult);
      }
      
      this.currentCapital += longTradeResult;
      this.totalProfitLoss += longTradeResult;
      
      // Determine win/loss based on actual profit/loss amount
      if (longTradeResult > 0) {
        this.longWins++;
        if (this.config.logSignals) {
          console.log(`${new Date(timestamp).toISOString()}: CLOSED LONG (SIGNAL) - Profit: $${longTradeResult.toFixed(2)}, Price: ${close.toFixed(4)}`);
        }
      } else {
        this.longLosses++;
        if (this.config.logSignals) {
          console.log(`${new Date(timestamp).toISOString()}: CLOSED LONG (SIGNAL) - Loss: $${Math.abs(longTradeResult).toFixed(2)}, Price: ${close.toFixed(4)}`);
        }
      }
      
      // Emit trade event
      this.emit('trade', {
        action: 'close',
        direction: 'long',
        timestamp,
        price: close,
        pl: longTradeResult,
        capital: this.currentCapital
      });
      
      // Reset long trade state
      this.inLongTrade = false;
    }
    
    // Start a new short trade
    this.shortEntryPrice = close;
    
    // Set reference stop based on mode (defATR or scalpLine)
    this.shortStopReference = useScalpMode ? this.scalpLine : this.defATR;
    
    const shortRisk = this.shortStopReference - this.shortEntryPrice;
    this.shortTargetLevel = this.shortEntryPrice - (shortRisk * rewardMultiple);
    
    // Calculate risk amount in dollars for this trade
    this.riskAmount = (this.currentCapital * riskPerTrade) / 100;
    this.totalRiskedAmount += this.riskAmount;
    
    // Log new short trade
    if (this.config.logSignals) {
      console.log(`${new Date(timestamp).toISOString()}: NEW SHORT - Entry: ${this.shortEntryPrice.toFixed(4)}, Stop: ${this.shortStopReference.toFixed(4)}, Target: ${this.shortTargetLevel.toFixed(4)}, Risk: $${this.riskAmount.toFixed(2)}`);
    }
    
    // Emit trade event
    this.emit('trade', {
      action: 'open',
      direction: 'short',
      timestamp,
      price: close,
      stop: this.shortStopReference,
      target: this.shortTargetLevel,
      risk: this.riskAmount
    });
    
    // Set trade as active
    this.inShortTrade = true;
    this.lastSignal = 'short';
    this.lastSignalTime = timestamp;
  }
  
  /**
   * Check if target levels have been hit
   * @param {number} high - Current high price
   * @param {number} low - Current low price
   * @param {number} timestamp - Current timestamp
   */
  checkTargetHits(high, low, timestamp) {
    const { rewardMultiple, useLeverage, leverageAmount } = this.config;
    const effectiveLeverage = useLeverage ? leverageAmount : 1.0;
    
    // Check if long target is hit
    if (this.inLongTrade && high >= this.longTargetLevel) {
      // Calculate P/L for the winning long trade
      const longWinAmount = this.riskAmount * rewardMultiple * effectiveLeverage;
      
      // Update capital and track the win
      this.currentCapital += longWinAmount;
      this.totalProfitLoss += longWinAmount;
      this.totalProfit += longWinAmount;
      this.longWins++;
      this.longTargetHits++;
      
      // Log target hit
      if (this.config.logSignals) {
        console.log(`${new Date(timestamp).toISOString()}: LONG TARGET HIT - Profit: $${longWinAmount.toFixed(2)}, New Capital: $${this.currentCapital.toFixed(2)}`);
      }
      
      // Emit trade event
      this.emit('trade', {
        action: 'target_hit',
        direction: 'long',
        timestamp,
        price: this.longTargetLevel,
        pl: longWinAmount,
        capital: this.currentCapital
      });
      
      // Close the trade
      this.inLongTrade = false;
    }
    
    // Check if short target is hit
    if (this.inShortTrade && low <= this.shortTargetLevel) {
      // Calculate P/L for the winning short trade
      const shortWinAmount = this.riskAmount * rewardMultiple * effectiveLeverage;
      
      // Update capital and track the win
      this.currentCapital += shortWinAmount;
      this.totalProfitLoss += shortWinAmount;
      this.totalProfit += shortWinAmount;
      this.shortWins++;
      this.shortTargetHits++;
      
      // Log target hit
      if (this.config.logSignals) {
        console.log(`${new Date(timestamp).toISOString()}: SHORT TARGET HIT - Profit: $${shortWinAmount.toFixed(2)}, New Capital: $${this.currentCapital.toFixed(2)}`);
      }
      
      // Emit trade event
      this.emit('trade', {
        action: 'target_hit',
        direction: 'short',
        timestamp,
        price: this.shortTargetLevel,
        pl: shortWinAmount,
        capital: this.currentCapital
      });
      
      // Close the trade
      this.inShortTrade = false;
    }
  }
  
  /**
   * Get current indicator values
   * @returns {Object} - Object with current indicator values
   */
  getIndicators() {
    return {
      atr: this.atr,
      defATR: this.defATR,
      defATR_fast: this.defATR_fast,
      a: this.a,
      scalpLine: this.scalpLine,
      signal: this.lastSignal,
      signalTime: this.lastSignalTime
    };
  }
  
  /**
   * Get current trading statistics
   * @returns {Object} - Object with current statistics
   */
  getStats() {
    // Calculate total trades and win rates
    const totalLongTrades = this.longWins + this.longLosses;
    const totalShortTrades = this.shortWins + this.shortLosses;
    const totalTrades = totalLongTrades + totalShortTrades;
    
    const longWinRate = totalLongTrades > 0 ? (this.longWins / totalLongTrades) * 100 : 0;
    const shortWinRate = totalShortTrades > 0 ? (this.shortWins / totalShortTrades) * 100 : 0;
    const overallWinRate = totalTrades > 0 ? ((this.longWins + this.shortWins) / totalTrades) * 100 : 0;
    
    // Calculate efficiency
    const efficiency = this.totalRiskedAmount > 0 ? (this.totalProfitLoss / this.totalRiskedAmount) * 100 : 0;
    
    // Calculate percentage gain
    const percentGain = ((this.currentCapital - this.config.initialCapital) / this.config.initialCapital) * 100;
    
    return {
      longWins: this.longWins,
      longLosses: this.longLosses,
      shortWins: this.shortWins,
      shortLosses: this.shortLosses,
      longTargetHits: this.longTargetHits,
      shortTargetHits: this.shortTargetHits,
      totalTrades,
      longWinRate,
      shortWinRate,
      overallWinRate,
      initialCapital: this.config.initialCapital,
      currentCapital: this.currentCapital,
      totalProfitLoss: this.totalProfitLoss,
      totalProfit: this.totalProfit,
      totalLoss: this.totalLoss,
      efficiency,
      percentGain,
      activeTrade: this.inLongTrade ? 'long' : (this.inShortTrade ? 'short' : null),
      activeEntry: this.inLongTrade ? this.longEntryPrice : (this.inShortTrade ? this.shortEntryPrice : null),
      activeTarget: this.inLongTrade ? this.longTargetLevel : (this.inShortTrade ? this.shortTargetLevel : null),
      activeStop: this.inLongTrade ? this.longStopReference : (this.inShortTrade ? this.shortStopReference : null)
    };
  }
  
  /**
   * Print current statistics to console
   */
  printStats() {
    const stats = this.getStats();
    
    // Print header
    console.log('\n===== TREND SNIPER V3 REAL-TIME STATISTICS =====');
    
    // Print configuration
    console.log('\n--- Configuration ---');
    console.log(`ATR Period: ${this.config.ATRPeriod}`);
    console.log(`ATR Multiplier: ${this.config.ATRMultip}`);
    console.log(`Fast Multiplier: ${this.config.ATRMultip_fast}`);
    console.log(`Scalp Mode: ${this.config.useScalpMode ? 'ON' : 'OFF'}`);
    console.log(`Reward Multiple: 1:${this.config.rewardMultiple}`);
    console.log(`Risk Per Trade: ${this.config.riskPerTrade}%`);
    console.log(`Leverage: ${this.config.useLeverage ? this.config.leverageAmount + 'x' : 'OFF'}`);
    
    // Print trade signals
    console.log('\n--- Trade Signals ---');
    console.log(`Long Signals: ${stats.longWins + stats.longLosses}`);
    console.log(`Short Signals: ${stats.shortWins + stats.shortLosses}`);
    console.log(`Total Signals: ${stats.totalTrades}`);
    
    // Print performance
    console.log('\n--- Performance ---');
    console.log(`Successful Longs: ${stats.longWins}`);
    console.log(`Successful Shorts: ${stats.shortWins}`);
    console.log(`Long Target Hits: ${stats.longTargetHits}`);
    console.log(`Short Target Hits: ${stats.shortTargetHits}`);
    console.log(`Long Win Rate: ${stats.longWinRate.toFixed(2)}%`);
    console.log(`Short Win Rate: ${stats.shortWinRate.toFixed(2)}%`);
    console.log(`Overall Win Rate: ${stats.overallWinRate.toFixed(2)}%`);
    
    // Print capital and profit metrics
    console.log('\n--- Capital & Profit ---');
    console.log(`Initial Capital: ${stats.initialCapital.toFixed(2)}`);
    console.log(`Current Capital: ${stats.currentCapital.toFixed(2)}`);
    console.log(`Total P/L: ${stats.totalProfitLoss.toFixed(2)}`);
    console.log(`Total Profit: ${stats.totalProfit.toFixed(2)}`);
    console.log(`Total Loss: ${stats.totalLoss.toFixed(2)}`);
    console.log(`Efficiency: ${stats.efficiency.toFixed(2)}%`);
    console.log(`Percentage Gain: ${stats.percentGain.toFixed(2)}%`);
    
    // Print active trade info if any
    if (stats.activeTrade) {
      console.log('\n--- Active Trade ---');
      console.log(`Direction: ${stats.activeTrade.toUpperCase()}`);
      console.log(`Entry Price: ${stats.activeEntry.toFixed(4)}`);
      console.log(`Stop Level: ${stats.activeStop.toFixed(4)}`);
      console.log(`Target Level: ${stats.activeTarget.toFixed(4)}`);
    }
    
    console.log('\n=====================================');
  }
}

module.exports = RealTimeTrendSniper;