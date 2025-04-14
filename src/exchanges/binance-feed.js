/**
 * Binance WebSocket Feed for J-Algo Trading System
 * Connects to Binance WebSockets and feeds data into Jalgo
 */

import Jalgo from '../core/jalgo.js';
import WebSocket from 'ws';
import { getWebSocketBaseUrl } from '../utility/market-provider.js';

class BinanceWebsocketFeed {
    constructor(options = {}) {
        // Trading parameters
        this.symbol = options.symbol || 'BTCUSDT';
        this.timeframe = options.timeframe || '5m';
        this.market = options.market || 'futures'; // 'futures' or 'spot'
        
        // Initialize websocket connections
        this.spotWs = null;
        this.futuresWs = null;
        
        // Store event handlers from options or use defaults
        this.onSignal = options.onSignal || this.handleSignal.bind(this);
        this.onPositionOpen = options.onPositionOpen || this.handlePositionOpen.bind(this);
        this.onPositionClosed = options.onPositionClosed || this.handlePositionClosed.bind(this);
        this.onTakeProfitHit = options.onTakeProfitHit || this.handleTakeProfitHit.bind(this);
        this.onError = options.onError || this.handleError.bind(this);
        
        // Initialize Jalgo with Binance as provider
        this.jalgo = new Jalgo({
            symbol: this.symbol,
            timeframe: this.timeframe,
            market: this.market,
            provider: 'binance', // Set provider to Binance
            riskOptions: options.riskOptions || {
                initialCapital: 1000,
                riskPerTrade: 2.0,
                rewardMultiple: 1.5,
                useLeverage: this.market === 'futures',
                leverageAmount: 3.0
            },
            // Pass all event handlers to Jalgo
            onSignal: this.onSignal,
            onPositionOpen: this.onPositionOpen,
            onPositionClosed: this.onPositionClosed,
            onTakeProfitHit: this.onTakeProfitHit,
            onError: this.onError
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
            
            // Convert timeframe from Jalgo format to WebSocket stream format
            const wsTimeframe = this.timeframe;
            
            // Connect to spot or futures based on configuration
            if (this.market === 'spot') {
                // Spot kline/candlestick stream
                const spotStreamUrl = `${getWebSocketBaseUrl('binance', 'spot')}/${this.symbol.toLowerCase()}@kline_${wsTimeframe}`;
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
                const futuresStreamUrl = `${getWebSocketBaseUrl('binance', 'futures')}/${this.symbol.toLowerCase()}@kline_${wsTimeframe}`;
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
                    console.log(`New completed ${this.timeframe} candle for ${this.symbol} (Binance Spot): O=${candle.o} H=${candle.h} L=${candle.l} C=${candle.c}`);
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
                    console.log(`New completed ${this.timeframe} candle for ${this.symbol} (Binance Futures): O=${candle.o} H=${candle.h} L=${candle.l} C=${candle.c}`);
                }
            }
        } catch (error) {
            console.error('Error processing futures message:', error);
        }
    }
    
    /**
     * Handle signal detection from Jalgo
     * @param {Object} signal - Signal information
     */
    handleSignal(signal) {
        console.log('--------------------------------------------------');
        console.log(`📊 SIGNAL DETECTED (Binance ${this.symbol}): ${signal.position.toUpperCase()}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle new position opened from Jalgo
     * @param {Object} position - Position information
     */
    handlePositionOpen(position) {
        console.log('--------------------------------------------------');
        console.log(`🔔 NEW POSITION OPENED (Binance ${this.symbol}): ${position.position.toUpperCase()} @ ${position.entry}`);
        console.log(`Target: ${position.target}`);
        console.log(`Reference Stop: ${position.refStop}`);
        console.log(`Risk Amount: ${position.risk}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle position closed from Jalgo
     * @param {Object} result - Position close result
     */
    handlePositionClosed(result) {
        console.log('--------------------------------------------------');
        console.log(`🏁 POSITION CLOSED (Binance ${this.symbol}): ${result.position.toUpperCase()} @ ${result.exit}`);
        console.log(`Close Reason: ${result.closeReason}`);
        const profitOrLoss = result.pnl >= 0 ? `PROFIT: +${result.pnl.toFixed(2)}` : `LOSS: -${Math.abs(result.pnl).toFixed(2)}`;
        console.log(profitOrLoss);
        console.log(`Capital: ${result.capitalAfter.toFixed(2)}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle take profit hits from Jalgo
     * @param {Object} result - Take profit result
     */
    handleTakeProfitHit(result) {
        console.log('--------------------------------------------------');
        console.log(`🎯 TARGET HIT (Binance ${this.symbol}): ${result.position.toUpperCase()} @ ${result.exit}`);
        console.log(`PnL: ${result.pnl.toFixed(2)}`);
        console.log(`Capital: ${result.capitalAfter.toFixed(2)}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle errors from Jalgo
     * @param {Error} error - Error object
     */
    handleError(error) {
        console.error('Jalgo Error (Binance):', error);
    }
    
    /**
     * Get current performance stats
     * @returns {Object} - Performance statistics
     */
    getStats() {
        return this.jalgo.getPerformanceStats();
    }
    
    /**
     * Log current active position details
     */
    logActivePosition() {
        if (this.jalgo && typeof this.jalgo.logActivePosition === 'function') {
            this.jalgo.logActivePosition();
        } else {
            console.log('Active position logging not available for Binance');
        }
    }
    
    /**
     * Close all WebSocket connections
     */
    close() {
        if (this.spotWs) {
            this.spotWs.close();
            this.spotWs = null;
        }
        
        if (this.futuresWs) {
            this.futuresWs.close();
            this.futuresWs = null;
        }
        
        console.log('All Binance WebSocket connections closed');
    }
}

// Export the class
export default BinanceWebsocketFeed;