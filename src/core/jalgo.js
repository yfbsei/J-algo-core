import trend_sniper from '../indicators/jTrendSniper.js';
import { getMarketData } from '../utility/market-provider.js';

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
        this.rewardMultiple = options.rewardMultiple || 1;
        this.scalpMode = options.scalpMode || false;
        
        // Initialize candles with empty arrays
        this.initialCandles = {
            open: [],
            high: [],
            low: [],
            close: [],
            volume: []
        };
        
        // Tracking variables
        this.isInitialized = false;
        this.lastProcessedCandleTime = null;
        this.isInTrade = false;
        this.target = 0;
        this.side = null;
        
        // Event callbacks
        this.onSignal = options.onSignal || null;
        this.onTrailingStop = options.onTrailingStop || null;
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
            const res = trend_sniper(this.initialCandles, 6, 16, 9, 2);
            
            if (!res || !res.signal) {
                return false;
            }
            
            // Call the signal callback if provided
            if (this.onSignal) {
                this.isInTrade = true;
                this.target = this.calculateTakeProfit_level(res.signal.location, 
                    this.scalpMode ? res.fast_jATR_sma.at(-1) : res.jATR_sma.at(-1), 
                    this.rewardMultiple);

                this.side = res.signal.position;

                this.onSignal({
                    ...res.signal,
                    target: this.target,
                    stop: this.scalpMode ? res.fast_jATR_sma.at(-1) : res.jATR_sma.at(-1),
                    provider: this.provider,
                    symbol: this.symbol
                });
            }
            
        } catch (error) {
            console.error("Error processing trading signal:", error);
            if (this.onError) this.onError(error);
            return false;
        }
    }
 
    trailingStop() {
        // Run the trading algorithm
        const res = trend_sniper(this.initialCandles, 6, 16, 9, 2);

        if(this.side === "Buy") {
            if(this.initialCandles.close.at(-1) <= res.fast_jATR_sma) this.onTrailingStop(true);
        }

        if(this.side === "Sell") {
            if(this.initialCandles.close.at(-1) >= res.fast_jATR_sma) this.onTrailingStop(true);
        }
    }

    takeProfit(candleData) {
        // Extract candle data
        const open = parseFloat(candleData.o), high = parseFloat(candleData.h), low = parseFloat(candleData.l);

        if(this.side === "Buy") {
            if(open >= this.target || high >= this.target) {
                this.isInTrade = false;
                this.target = 0;
                this.side = null;
            } 
        }

        if(this.side === "Sell") {
            if(open <= this.target || low <= this.target) {
                this.isInTrade = false;
                this.target = 0;
                this.side = null;
            } 
        }
    }

    // TODO handle stop loss update

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

            //if(this.isInTrade) this.takeProfit(candleData);
            
            
            // Only process completed candles for signal generation
            if (candleData.x === true) {
                
                // Update inital candles
                this.initialCandles = this.initialCandles_update(candleData);

                // Update last processed candle time
                this.lastProcessedCandleTime = candleData.t;
                
                // check for trailing stop
                //if(this.isInTrade) this.trailingStop();

                // Process for new signals on candle close
                this.processSignal();
            }
        } catch (error) {
            console.error(`Error processing new candle from ${this.provider}:`, error);
            if (this.onError) this.onError(error);
        }
    }

    initialCandles_update(canadle) {
        const temp_initialCandles = Object.fromEntries(
            Object.entries(this.initialCandles).map(([key, arr]) => [key, [...arr]])
          );

        // Extract candle data
        const 
            open = parseFloat(canadle.o),
            high = parseFloat(canadle.h),
            low = parseFloat(canadle.l),
            close = parseFloat(canadle.c),
            volume = parseFloat(canadle.v);
        
        // Update candle data arrays by shifting the oldest and adding the newest
        for (const key of Object.keys(temp_initialCandles)) {
            if (Array.isArray(temp_initialCandles[key]) && temp_initialCandles[key].length > 0) {
                // Remove the oldest candle
                temp_initialCandles[key].shift();
                // Add the new candle value
                const value = 
                    key === 'open' ? open :
                    key === 'high' ? high :
                    key === 'low' ? low :
                    key === 'close' ? close :
                    key === 'volume' ? volume : 0;
                    
                temp_initialCandles[key].push(value);
            }
        }

        return temp_initialCandles;
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
                return parseFloat((entryPrice + reward));
            } else {
                // Short position: reference stop is above entry
                return parseFloat((entryPrice - reward));
            }
        }
}

export default Jalgo;