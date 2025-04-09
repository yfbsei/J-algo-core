/**
 * Binance WebSocket Feed for J-Algo Trading System
 * Connects to Binance WebSockets and feeds data into Jalgo
 */

import Jalgo from './src/jalgo.js';
import WebSocket from 'ws';

class BinanceWebsocketFeed {
    constructor(options = {}) {
        // Trading parameters
        this.symbol = options.symbol || 'BTCUSDT';
        this.timeframe = options.timeframe || '5m';
        this.market = options.market || 'futures'; // 'futures' or 'spot'
        
        // Initialize websocket connections
        this.spotWs = null;
        this.futuresWs = null;
        
        // Initialize Jalgo
        this.jalgo = new Jalgo({
            symbol: this.symbol,
            timeframe: this.timeframe,
            market: this.market,
            riskOptions: options.riskOptions || {
                initialCapital: 1000,
                riskPerTrade: 2.0,
                rewardMultiple: 1.5,
                useLeverage: this.market === 'futures',
                leverageAmount: 3.0
            },
            onSignal: this.handleSignal.bind(this),
            onTakeProfitHit: this.handleTakeProfitHit.bind(this),
            onError: this.handleError.bind(this)
        });
        
        // Wait for jalgo initialization before connecting to websockets
        setTimeout(() => {
            this.connectToWebsockets();
        }, 3000);
    }
    
    /**
     * Connect to Binance WebSockets
     */
    connectToWebsockets() {
        try {
            console.log(`Connecting to Binance ${this.market} WebSocket for ${this.symbol}...`);
            
            // Convert timeframe from Jalgo format to WebSocket stream format (e.g., 5m -> 5m)
            const wsTimeframe = this.timeframe;
            
            // Connect to spot or futures based on configuration
            if (this.market === 'spot') {
                // Spot kline/candlestick stream
                const spotStreamUrl = `wss://stream.binance.com:9443/ws/${this.symbol.toLowerCase()}@kline_${wsTimeframe}`;
                this.spotWs = new WebSocket(spotStreamUrl);
                
                this.spotWs.on('open', () => {
                    console.log(`Connected to Binance Spot WebSocket for ${this.symbol}`);
                });
                
                this.spotWs.on('message', (data) => {
                    this.processSpotMessage(data);
                });
                
                this.spotWs.on('error', (error) => {
                    console.error('Spot WebSocket error:', error);
                    // Attempt to reconnect after delay
                    setTimeout(() => this.connectToWebsockets(), 5000);
                });
                
                this.spotWs.on('close', () => {
                    console.log('Spot WebSocket connection closed');
                    // Attempt to reconnect after delay
                    setTimeout(() => this.connectToWebsockets(), 5000);
                });
            } else {
                // Futures kline/candlestick stream
                const futuresStreamUrl = `wss://fstream.binance.com/ws/${this.symbol.toLowerCase()}@kline_${wsTimeframe}`;
                this.futuresWs = new WebSocket(futuresStreamUrl);
                
                this.futuresWs.on('open', () => {
                    console.log(`Connected to Binance Futures WebSocket for ${this.symbol}`);
                });
                
                this.futuresWs.on('message', (data) => {
                    this.processFuturesMessage(data);
                });
                
                this.futuresWs.on('error', (error) => {
                    console.error('Futures WebSocket error:', error);
                    // Attempt to reconnect after delay
                    setTimeout(() => this.connectToWebsockets(), 5000);
                });
                
                this.futuresWs.on('close', () => {
                    console.log('Futures WebSocket connection closed');
                    // Attempt to reconnect after delay
                    setTimeout(() => this.connectToWebsockets(), 5000);
                });
            }
        } catch (error) {
            console.error('Error connecting to WebSockets:', error);
            // Attempt to reconnect after delay
            setTimeout(() => this.connectToWebsockets(), 5000);
        }
    }
    
    /**
     * Process spot market websocket messages
     * @param {Buffer|String} data - Raw websocket message
     */
    processSpotMessage(data) {
        try {
            const message = JSON.parse(data);
            
            // Only process kline data
            if (message.e === 'kline') {
                const candle = message.k;
                // Pass the candle to Jalgo for processing
                this.jalgo.processNewCandle(candle);
                
                // Log candles that are complete (x = true)
                if (candle.x) {
                    console.log(`New completed ${this.timeframe} candle for ${this.symbol}: O=${candle.o} H=${candle.h} L=${candle.l} C=${candle.c}`);
                }
            }
        } catch (error) {
            console.error('Error processing spot message:', error);
        }
    }
    
    /**
     * Process futures market websocket messages
     * @param {Buffer|String} data - Raw websocket message
     */
    processFuturesMessage(data) {
        try {
            const message = JSON.parse(data);
            
            // Only process kline data
            if (message.e === 'kline') {
                const candle = message.k;
                // Pass the candle to Jalgo for processing
                this.jalgo.processNewCandle(candle);
                
                // Log candles that are complete (x = true)
                if (candle.x) {
                    console.log(`New completed ${this.timeframe} candle for ${this.symbol}: O=${candle.o} H=${candle.h} L=${candle.l} C=${candle.c}`);
                }
            }
        } catch (error) {
            console.error('Error processing futures message:', error);
        }
    }
    
    /**
     * Handle trading signals from Jalgo
     * @param {Object} signal - Signal information
     */
    handleSignal(signal) {
        console.log('--------------------------------------------------');
        console.log(`🔔 NEW SIGNAL: ${signal.position.toUpperCase()} @ ${signal.entry}`);
        console.log(`Target: ${signal.target}`);
        console.log(`Risk Amount: $${signal.risk}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle take profit hits from Jalgo
     * @param {Object} result - Take profit result
     */
    handleTakeProfitHit(result) {
        console.log('--------------------------------------------------');
        console.log(`🎯 TARGET HIT: ${result.position.toUpperCase()} @ ${result.exit}`);
        console.log(`PnL: $${result.pnl.toFixed(2)}`);
        console.log(`Capital: $${result.capitalAfter.toFixed(2)}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle errors from Jalgo
     * @param {Error} error - Error object
     */
    handleError(error) {
        console.error('Jalgo Error:', error);
    }
    
    /**
     * Get current performance stats
     * @returns {Object} - Performance statistics
     */
    getStats() {
        return this.jalgo.getPerformanceStats();
    }
    
    /**
     * Close all WebSocket connections
     */
    close() {
        if (this.spotWs) {
            this.spotWs.close();
        }
        
        if (this.futuresWs) {
            this.futuresWs.close();
        }
        
        console.log('All WebSocket connections closed');
    }
}

// Example usage
const startTrading = () => {
    const feed = new BinanceWebsocketFeed({
        symbol: 'BTCUSDT',     // Symbol to trade
        timeframe: '5m',       // Timeframe to use
        market: 'futures',     // 'futures' or 'spot'
        riskOptions: {
            initialCapital: 1000,
            riskPerTrade: 2.0,
            rewardMultiple: 1.5,
            useLeverage: true,
            leverageAmount: 3.0,
            useScalpMode: false
        }
    });
    
    // Print stats every hour
    setInterval(() => {
        const stats = feed.getStats();
        console.log('--------------------------------------------------');
        console.log('PERFORMANCE STATS:');
        console.log(`Total Trades: ${stats.totalTrades}`);
        console.log(`Win Rate: ${stats.overallWinRate}%`);
        console.log(`Capital: $${stats.currentCapital}`);
        console.log(`P&L: $${stats.totalProfitLoss}`);
        console.log('--------------------------------------------------');
    }, 60 * 60 * 1000); // Every hour
    
    return feed;
};

// Export both the class and a ready-to-use function
export { BinanceWebsocketFeed, startTrading };

// Auto-start if run directly
if (process.argv[1].includes('binance-websocket.js')) {
    console.log('Starting Binance WebSocket feed...');
    startTrading();
}
