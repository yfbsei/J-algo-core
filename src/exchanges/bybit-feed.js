/**
 * Bybit WebSocket Feed for J-Algo Trading System
 * Connects to Bybit WebSockets and feeds data into Jalgo
 */

import Jalgo from '../core/jalgo.js';
import WebSocket from 'ws';
import { formatWebSocketCandle, convertInterval } from '../utility/market-provider.js';

class BybitWebsocketFeed {
    constructor(options = {}) {
        // Trading parameters
        this.symbol = options.symbol || 'BTCUSDT';
        this.timeframe = options.timeframe || '5m';
        this.market = options.market || 'futures'; // 'futures' or 'spot'
        
        // Initialize websocket connection
        this.ws = null;
        this.pingInterval = null;
        
        // Store event handlers from options or use defaults
        this.onSignal = options.onSignal || this.handleSignal.bind(this);
        this.onPositionOpen = options.onPositionOpen || this.handlePositionOpen.bind(this);
        this.onPositionClosed = options.onPositionClosed || this.handlePositionClosed.bind(this);
        this.onTakeProfitHit = options.onTakeProfitHit || this.handleTakeProfitHit.bind(this);
        this.onError = options.onError || this.handleError.bind(this);
        
        // Initialize Jalgo with Bybit as provider
        this.jalgo = new Jalgo({
            symbol: this.symbol,
            timeframe: this.timeframe,
            market: this.market,
            provider: 'bybit', // Set provider to Bybit
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
            this.connectToWebsocket();
        }, 3000);
    }
    
    /**
     * Connect to Bybit WebSocket
     */
    connectToWebsocket() {
        try {
            console.log(`Connecting to Bybit WebSocket for ${this.symbol}...`);
            
            // Convert timeframe from Jalgo format to Bybit WebSocket format
            const wsTimeframe = convertInterval('bybit', this.timeframe);
            
            // Determine category based on market type
            const category = this.market === 'spot' ? 'spot' : 'linear';
            
            // Construct the WebSocket URL
            const wsUrl = 'wss://stream.bybit.com/v5/public';
            
            // Create WebSocket connection
            this.ws = new WebSocket(wsUrl);
            
            this.ws.on('open', () => {
                console.log(`Connected to Bybit WebSocket for ${this.symbol}`);
                
                // Subscribe to kline/candlestick channel
                const subscribeMsg = JSON.stringify({
                    op: 'subscribe',
                    args: [`kline.${wsTimeframe}.${this.symbol}`],
                    req_id: Date.now().toString()
                });
                
                this.ws.send(subscribeMsg);
                
                // Setup ping interval to keep connection alive
                this.pingInterval = setInterval(() => {
                    if (this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ op: 'ping' }));
                    }
                }, 20000); // Send ping every 20 seconds
            });
            
            this.ws.on('message', (data) => {
                this.processMessage(data);
            });
            
            this.ws.on('error', (error) => {
                console.error('Bybit WebSocket error:', error);
                // Attempt to reconnect after delay
                this.handleReconnect();
            });
            
            this.ws.on('close', () => {
                console.log('Bybit WebSocket connection closed');
                // Clear ping interval
                if (this.pingInterval) {
                    clearInterval(this.pingInterval);
                    this.pingInterval = null;
                }
                // Attempt to reconnect after delay
                this.handleReconnect();
            });
            
        } catch (error) {
            console.error('Error connecting to Bybit WebSocket:', error);
            // Attempt to reconnect after delay
            this.handleReconnect();
        }
    }
    
    /**
     * Handle WebSocket reconnection
     */
    handleReconnect() {
        // Clear existing ping interval if it exists
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
            if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                console.log('Attempting to reconnect to Bybit WebSocket...');
                this.connectToWebsocket();
            }
        }, 5000);
    }
    
    /**
     * Process WebSocket messages
     * @param {Buffer|String} data - Raw websocket message
     */
    processMessage(data) {
        try {
            const message = JSON.parse(data);
            
            // Handle pong response
            if (message.op === 'pong') {
                // WebSocket connection is alive, do nothing
                return;
            }
            
            // Handle subscription success
            if (message.op === 'subscribe' && message.success) {
                console.log(`Successfully subscribed to Bybit ${this.symbol} kline feed`);
                return;
            }
            
            // Handle kline/candlestick data
            if (message.topic && message.topic.includes('kline') && Array.isArray(message.data)) {
                const candle = message.data[0];
                
                // Convert to standard format
                const standardCandle = {
                    t: parseInt(candle.start),
                    o: candle.open,
                    h: candle.high,
                    l: candle.low,
                    c: candle.close,
                    v: candle.volume,
                    x: candle.confirm // candle closed
                };
                
                // Pass the candle to Jalgo for processing
                this.jalgo.processNewCandle(standardCandle);
                
                // Log candles that are complete (confirm = true)
                if (candle.confirm) {
                    console.log(`New completed ${this.timeframe} candle for ${this.symbol} (Bybit): O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
                }
            }
        } catch (error) {
            console.error('Error processing Bybit message:', error);
        }
    }
    
    /**
     * Handle signal detection from Jalgo
     * @param {Object} signal - Signal information
     */
    handleSignal(signal) {
        console.log('--------------------------------------------------');
        console.log(`📊 SIGNAL DETECTED (Bybit ${this.symbol}): ${signal.position.toUpperCase()}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle new position opened from Jalgo
     * @param {Object} position - Position information
     */
    handlePositionOpen(position) {
        console.log('--------------------------------------------------');
        console.log(`🔔 NEW POSITION OPENED (Bybit ${this.symbol}): ${position.position.toUpperCase()} @ ${position.entry}`);
        console.log(`Target: ${position.target}`);
        console.log(`Reference Stop: ${position.refStop}`);
        console.log(`Risk Amount: $${position.risk}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle position closed from Jalgo
     * @param {Object} result - Position close result
     */
    handlePositionClosed(result) {
        console.log('--------------------------------------------------');
        console.log(`🏁 POSITION CLOSED (Bybit ${this.symbol}): ${result.position.toUpperCase()} @ ${result.exit}`);
        console.log(`Close Reason: ${result.closeReason}`);
        const profitOrLoss = result.pnl >= 0 ? `PROFIT: +$${result.pnl.toFixed(2)}` : `LOSS: -$${Math.abs(result.pnl).toFixed(2)}`;
        console.log(profitOrLoss);
        console.log(`Capital: $${result.capitalAfter.toFixed(2)}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle take profit hits from Jalgo
     * @param {Object} result - Take profit result
     */
    handleTakeProfitHit(result) {
        console.log('--------------------------------------------------');
        console.log(`🎯 TARGET HIT (Bybit ${this.symbol}): ${result.position.toUpperCase()} @ ${result.exit}`);
        console.log(`PnL: $${result.pnl.toFixed(2)}`);
        console.log(`Capital: $${result.capitalAfter.toFixed(2)}`);
        console.log('--------------------------------------------------');
    }
    
    /**
     * Handle errors from Jalgo
     * @param {Error} error - Error object
     */
    handleError(error) {
        console.error('Jalgo Error (Bybit):', error);
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
            console.log('Active position logging not available for Bybit');
        }
    }
    
    /**
     * Close the WebSocket connection
     */
    close() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            console.log('Bybit WebSocket connection closed');
        }
    }
}

export default BybitWebsocketFeed;