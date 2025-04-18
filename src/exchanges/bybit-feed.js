/**
 * Bybit WebSocket Feed for J-Algo Trading System
 * Connects to Bybit WebSockets and feeds data into Jalgo
 */

import Jalgo from '../core/jalgo.js';
import WebSocket from 'ws';
import { convertInterval } from '../utility/market-provider.js';

class BybitWebsocketFeed {
    constructor(options = {}) {
        // Trading parameters
        this.symbol = options.symbol || 'BTCUSDT';
        this.timeframe = options.timeframe || '5m';
        this.market = options.market || 'futures'; // 'futures' or 'spot'
        this.rewardMultiple = options.rewardMultiple || 1;
        this.scalpMode = options.scalpMode || false;
        
        // Initialize websocket connection
        this.ws = null;
        this.pingInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        
        // Store event handlers from options or use defaults
        this.onSignal = options.onSignal || this.handleSignal.bind(this);
        this.onError = options.onError || this.handleError.bind(this);
        
        // Initialize Jalgo with Bybit as provider
        this.jalgo = new Jalgo({
            symbol: this.symbol,
            timeframe: this.timeframe,
            market: this.market,
            provider: 'bybit', // Set provider to Bybit
            rewardMultiple: this.rewardMultiple,
            scalpMode: this.scalpMode,

            // Pass all event handlers to Jalgo
            onSignal: this.onSignal,
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
            
            // Determine category and URL based on market type
            let wsUrl;
            if (this.market === 'spot') {
                wsUrl = 'wss://stream.bybit.com/v5/public/spot';
            } else {
                // For futures (linear)
                wsUrl = 'wss://stream.bybit.com/v5/public/linear';
            }
            
            // Create WebSocket connection
            this.ws = new WebSocket(wsUrl);
            
            this.ws.on('open', () => {
                console.log(`Connected to Bybit WebSocket for ${this.symbol}`);
                this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection
                
                // Subscribe to kline/candlestick channel
                const subscribeMsg = JSON.stringify({
                    op: 'subscribe',
                    args: [`kline.${wsTimeframe}.${this.symbol}`],
                    req_id: Date.now().toString()
                });
                
                this.ws.send(subscribeMsg);
                
                // Setup ping interval to keep connection alive (every 20 seconds)
                this.pingInterval = setInterval(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        const pingMsg = JSON.stringify({
                            op: 'ping',
                            req_id: (Date.now() + 1).toString() // Ensure unique req_id
                        });
                        this.ws.send(pingMsg);
                    }
                }, 20000);
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
     * Handle WebSocket reconnection with exponential backoff
     */
    handleReconnect() {
        // Clear existing ping interval if it exists
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        
        this.reconnectAttempts++;
        
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
            // Calculate backoff time (exponential with jitter)
            const baseDelay = 2000; // 2 seconds
            const maxDelay = 60000; // Max 60 seconds
            
            // Exponential backoff with jitter
            const exponentialDelay = Math.min(
                maxDelay,
                baseDelay * Math.pow(2, this.reconnectAttempts - 1)
            );
            
            // Add jitter (±20%)
            const jitter = 0.2 * exponentialDelay * (Math.random() - 0.5);
            const delay = Math.floor(exponentialDelay + jitter);
            
            console.log(`Attempting to reconnect to Bybit WebSocket in ${delay/1000} seconds (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            
            setTimeout(() => {
                if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                    this.connectToWebsocket();
                }
            }, delay);
        } else {
            console.error(`Failed to reconnect to Bybit WebSocket after ${this.maxReconnectAttempts} attempts. Please check your connection or restart the application.`);
        }
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
                // WebSocket connection is alive, no action needed
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
                
                // Convert to standard format for Jalgo
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
                    //console.log(`New completed ${this.timeframe} candle for ${this.symbol} (Bybit): O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}`);
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
     * Handle errors from Jalgo
     * @param {Error} error - Error object
     */
    handleError(error) {
        console.error('Jalgo Error (Bybit):', error);
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