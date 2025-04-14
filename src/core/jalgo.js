import trend_sniper from '../indicators/jTrendSniper.js';
import { getMarketData } from '../utility/market-provider.js';
import RiskRewardManager from './risk-manager.js';

/**
 * Main Jalgo trading class with multi-exchange support
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
        this.provider = options.provider || "binance"; // Exchange provider (binance or bybit)
        
        // Initialize candles with empty arrays
        this.initialCandles = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        
        // Create event callback options for RiskRewardManager
        const riskOptions = {
            ...(options.riskOptions || {}),
            onPositionOpen: options.onPositionOpen || null,
            onPositionClosed: options.onPositionClosed || null
        };
        
        // Risk management
        this.riskManager = new RiskRewardManager(riskOptions);
        
        // Tracking variables
        this.isInitialized = false;
        this.lastProcessedCandleTime = null;
        this.lastSignal = null;
        
        // Event callbacks
        this.onSignal = options.onSignal || null;
        this.onPositionOpen = options.onPositionOpen || null;
        this.onTakeProfitHit = options.onTakeProfitHit || null;
        this.onPositionClosed = options.onPositionClosed || null;
        this.onError = options.onError || null;
        
        // Initialize the system
        this.initialize();
    }
    
    /**
     * Initialize the system with historical candles
     */
    async initialize() {
        try {
            console.log(`Initializing Jalgo for ${this.symbol} on ${this.provider} ${this.timeframe} timeframe...`);
            
            // Fetch initial candles from the appropriate provider
            this.initialCandles = await getMarketData(this.provider, this.market, this.symbol, this.timeframe, 500);
            
            if (!this.initialCandles || !this.initialCandles.close || this.initialCandles.close.length < 100) {
                throw new Error("Failed to initialize with sufficient candle data");
            }
            
            console.log(`Initialized with ${this.initialCandles.close.length} candles from ${this.provider}`);
            this.isInitialized = true;
            
            // Check for initial signal
            this.processSignal();
            
        } catch (error) {
            console.error(`Initialization error for ${this.provider}:`, error);
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
            
            // Call the signal callback if provided
            if (this.onSignal) {
                this.onSignal({
                    ...res.signal,
                    provider: this.provider,
                    symbol: this.symbol
                });
            }
            
            // Handle the signal
            const signalResult = this.riskManager.handleNewSignal(res);
            this.lastSignal = {
                ...signalResult,
                timestamp: new Date().toISOString(),
                provider: this.provider,
                symbol: this.symbol
            };
            
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
                
                // Add provider info to the result
                if (result) {
                    result.provider = this.provider;
                    result.symbol = this.symbol;
                }
                
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
                
                // Add provider info to the result
                if (result) {
                    result.provider = this.provider;
                    result.symbol = this.symbol;
                }
                
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
     * @param {Object} candleData - New candle data in standardized format
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
            console.error(`Error processing new candle from ${this.provider}:`, error);
            if (this.onError) this.onError(error);
        }
    }
    
    /**
     * Get performance statistics
     * @returns {Object} - Performance statistics
     */
    getPerformanceStats() {
        const stats = this.riskManager.getPerformanceStats();
        return {
            ...stats,
            provider: this.provider,
            symbol: this.symbol
        };
    }
    
    /**
     * Get trade history
     * @returns {Array} - Trade history
     */
    getTradeHistory() {
        return this.riskManager.tradeHistory.map(trade => ({
            ...trade,
            provider: this.provider,
            symbol: this.symbol
        }));
    }
    
    /**
     * Get current positions
     * @returns {Object} - Current position information
     */
    getCurrentPositions() {
        return {
            provider: this.provider,
            symbol: this.symbol,
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

    /**
     * Log the active position details
     * @param {number} [currentPrice] - Optional current price for P&L calculation
     */
    logActivePosition(currentPrice = null) {
        try {
            if (!this.isInitialized) {
                console.warn(`Cannot log position: system not initialized on ${this.provider}`);
                return;
            }
            
            // If currentPrice is not provided, use the last known close price
            if (currentPrice === null && this.initialCandles.close.length > 0) {
                currentPrice = this.initialCandles.close[this.initialCandles.close.length - 1];
            }
            
            // Check if we have any active positions
            if (!this.riskManager.inLongTrade && !this.riskManager.inShortTrade) {
                console.log(`=== NO ACTIVE POSITIONS (${this.provider} ${this.symbol}) ===`);
                return;
            }
            
            // Log long position details
            if (this.riskManager.inLongTrade) {
                const entry = this.riskManager.longEntryPrice;
                const target = this.riskManager.longTargetLevel;
                const refStop = this.riskManager.longStopReference;
                const riskAmount = this.riskManager.currentRiskAmount;
                const leverage = this.riskManager.getEffectiveLeverage();
                
                let currentPnL = null;
                let percentToTarget = null;
                
                if (currentPrice) {
                    // Calculate current P&L
                    const priceDifference = currentPrice - entry;
                    const refStopDifference = Math.abs(entry - refStop);
                    const percentOfTarget = Math.min(Math.abs(priceDifference) / refStopDifference, this.riskManager.rewardMultiple);
                    const directionMultiplier = priceDifference >= 0 ? 1 : -1;
                    
                    currentPnL = riskAmount * percentOfTarget * directionMultiplier * leverage;
                    percentToTarget = target ? ((currentPrice - entry) / (target - entry) * 100).toFixed(2) + '%' : 'N/A';
                }
                
                console.log(`=== ACTIVE LONG POSITION (${this.provider} ${this.symbol}) ===`);
                console.log({
                    entry,
                    currentPrice: currentPrice || 'Unknown',
                    target,
                    percentToTarget,
                    refStop,
                    riskAmount,
                    leverage,
                    potentialProfit: riskAmount * this.riskManager.rewardMultiple * leverage,
                    currentPnL: currentPnL !== null ? currentPnL.toFixed(2) : 'N/A',
                    openedAt: this.riskManager.tradeHistory.find(t => t.type === 'long' && t.status === 'open')?.timestamp || 'Unknown'
                });
            }
            
            // Log short position details
            if (this.riskManager.inShortTrade) {
                const entry = this.riskManager.shortEntryPrice;
                const target = this.riskManager.shortTargetLevel;
                const refStop = this.riskManager.shortStopReference;
                const riskAmount = this.riskManager.currentRiskAmount;
                const leverage = this.riskManager.getEffectiveLeverage();
                
                let currentPnL = null;
                let percentToTarget = null;
                
                if (currentPrice) {
                    // Calculate current P&L
                    const priceDifference = entry - currentPrice;
                    const refStopDifference = Math.abs(entry - refStop);
                    const percentOfTarget = Math.min(Math.abs(priceDifference) / refStopDifference, this.riskManager.rewardMultiple);
                    const directionMultiplier = priceDifference >= 0 ? 1 : -1;
                    
                    currentPnL = riskAmount * percentOfTarget * directionMultiplier * leverage;
                    percentToTarget = target ? ((entry - currentPrice) / (entry - target) * 100).toFixed(2) + '%' : 'N/A';
                }
                
                console.log(`=== ACTIVE SHORT POSITION (${this.provider} ${this.symbol}) ===`);
                console.log({
                    entry,
                    currentPrice: currentPrice || 'Unknown',
                    target,
                    percentToTarget,
                    refStop,
                    riskAmount,
                    leverage,
                    potentialProfit: riskAmount * this.riskManager.rewardMultiple * leverage,
                    currentPnL: currentPnL !== null ? currentPnL.toFixed(2) : 'N/A',
                    openedAt: this.riskManager.tradeHistory.find(t => t.type === 'short' && t.status === 'open')?.timestamp || 'Unknown'
                });
            }
        } catch (error) {
            console.error(`Error logging active position for ${this.provider}:`, error);
        }
    }

    /**
     * Manually close an active position at current price
     * @param {number} currentPrice - Current market price to close at
     * @returns {Object|boolean} - Close result or false if no active position
     */
    manuallyClosePosition(currentPrice) {
        try {
            if (!this.isInitialized) {
                console.warn(`Cannot close position: system not initialized on ${this.provider}`);
                return false;
            }

            let result = false;
            
            if (this.riskManager.inLongTrade) {
                result = this.riskManager.closePosition("long", currentPrice, "manual");
            } else if (this.riskManager.inShortTrade) {
                result = this.riskManager.closePosition("short", currentPrice, "manual");
            }
            
            // Add provider info to the result
            if (result && !result.error) {
                result.provider = this.provider;
                result.symbol = this.symbol;
            }
            
            return result;
        } catch (error) {
            console.error(`Error manually closing position on ${this.provider}:`, error);
            if (this.onError) this.onError(error);
            return false;
        }
    }
}

export default Jalgo;