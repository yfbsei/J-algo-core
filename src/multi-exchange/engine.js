/**
 * Multi-Exchange Trading Engine
 * Manages multiple exchange instances simultaneously
 */

import BinanceWebsocketFeed from '../exchanges/binance-feed.js';
import BybitWebsocketFeed from '../exchanges/bybit-feed.js';

class MultiExchangeEngine {
    /**
     * Create a new Multi-Exchange Engine
     * @param {Object} config - Configuration object
     */
    constructor(config = {}) {
        this.exchanges = [];
        this.tradingStrategy = config.tradingStrategy || 'independent'; // 'independent', 'mirror', or 'consensus'
        this.riskStrategy = config.riskStrategy || 'independent'; // 'independent' or 'coordinated'
        this.consensusThreshold = config.consensusThreshold || 2;
        this.initialized = false;
        
        // Event logging
        this.enableDetailedLogs = config.enableDetailedLogs || false;
        
        // Initialize exchanges
        this.initialize(config.exchanges || []);
    }
    
    /**
     * Initialize exchanges based on configuration
     * @param {Array} exchangesConfig - Array of exchange configurations
     */
    initialize(exchangesConfig) {
        if (!Array.isArray(exchangesConfig) || exchangesConfig.length === 0) {
            console.warn('No exchanges configured. Please provide at least one exchange configuration.');
            return;
        }
        
        console.log(`Initializing Multi-Exchange Engine with ${exchangesConfig.length} exchanges...`);
        console.log(`Trading Strategy: ${this.tradingStrategy}`);
        console.log(`Risk Strategy: ${this.riskStrategy}`);
        
        // Create exchange instances for each configuration
        exchangesConfig.forEach((config, index) => {
            try {
                const exchangeId = `${config.provider}-${config.symbol}-${config.market}`;
                
                // Create event handlers with exchange ID context
                const eventHandlers = {
                    onSignal: (signal) => this.handleSignal(exchangeId, signal),
                    onPositionOpen: (position) => this.handlePositionOpen(exchangeId, position),
                    onPositionClosed: (result) => this.handlePositionClosed(exchangeId, result),
                    onTakeProfitHit: (result) => this.handleTakeProfitHit(exchangeId, result),
                    onError: (error) => this.handleError(exchangeId, error)
                };
                
                // Create exchange instance with the right class
                let exchange;
                
                if (config.provider.toLowerCase() === 'binance') {
                    exchange = new BinanceWebsocketFeed({
                        ...config,
                        ...eventHandlers
                    });
                } else if (config.provider.toLowerCase() === 'bybit') {
                    exchange = new BybitWebsocketFeed({
                        ...config,
                        ...eventHandlers
                    });
                } else {
                    throw new Error(`Unsupported exchange provider: ${config.provider}`);
                }
                
                // Add additional metadata
                exchange.id = exchangeId;
                exchange.index = index;
                
                // Add to exchanges array
                this.exchanges.push(exchange);
                
                console.log(`Initialized ${config.provider} for ${config.symbol} (${config.market})`);
            } catch (error) {
                console.error(`Failed to initialize exchange:`, error);
            }
        });
        
        this.initialized = this.exchanges.length > 0;
    }
    
    /**
     * Handle signal from an exchange
     * @param {string} exchangeId - Exchange identifier
     * @param {Object} signal - Signal information
     */
    handleSignal(exchangeId, signal) {
        if (this.enableDetailedLogs) {
            console.log(`[${exchangeId}] Signal detected: ${signal.position.toUpperCase()}`);
        }
        
        // If using 'mirror' strategy, propagate the signal to other exchanges with the same symbol
        if (this.tradingStrategy === 'mirror') {
            this.mirrorSignalToOtherExchanges(exchangeId, signal);
        }
        
        // If using 'consensus' strategy, check for consensus across exchanges
        if (this.tradingStrategy === 'consensus') {
            this.checkForConsensus(signal.symbol);
        }
    }
    
    /**
     * Mirror a signal to other exchanges with the same symbol
     * @param {string} originExchangeId - Exchange ID that originated the signal
     * @param {Object} signal - Signal information
     */
    mirrorSignalToOtherExchanges(originExchangeId, signal) {
        const originExchange = this.exchanges.find(exchange => exchange.id === originExchangeId);
        if (!originExchange) return;
        
        // Find other exchanges with the same symbol
        const otherExchanges = this.exchanges.filter(exchange => 
            exchange.id !== originExchangeId && 
            exchange.symbol === originExchange.symbol
        );
        
        if (otherExchanges.length === 0) return;
        
        console.log(`Mirroring ${signal.position.toUpperCase()} signal from ${originExchangeId} to ${otherExchanges.length} other exchanges`);
        
        // TODO: Implement actual mirroring logic
        // This would require a mechanism to manually trigger trades on other exchanges
    }
    
    /**
     * Check for consensus across exchanges for the same symbol
     * @param {string} symbol - Trading pair symbol
     */
    checkForConsensus(symbol) {
        // Get all exchanges for this symbol
        const symbolExchanges = this.exchanges.filter(exchange => exchange.symbol === symbol);
        
        if (symbolExchanges.length < this.consensusThreshold) return;
        
        // Collect recent signals
        const signals = {};
        
        symbolExchanges.forEach(exchange => {
            if (exchange.jalgo && exchange.jalgo.lastSignal) {
                const position = exchange.jalgo.lastSignal.position;
                if (!signals[position]) signals[position] = [];
                signals[position].push(exchange.id);
            }
        });
        
        // Check for consensus
        Object.entries(signals).forEach(([position, exchanges]) => {
            if (exchanges.length >= this.consensusThreshold) {
                console.log(`Consensus reached: ${position.toUpperCase()} on ${symbol} across ${exchanges.length} exchanges`);
                console.log(`Exchanges in consensus: ${exchanges.join(', ')}`);
                
                // TODO: Implement consensus action
                // This would trigger trades on exchanges that don't already have this position
            }
        });
    }
    
    /**
     * Handle position opened event
     * @param {string} exchangeId - Exchange identifier
     * @param {Object} position - Position information
     */
    handlePositionOpen(exchangeId, position) {
        if (this.enableDetailedLogs) {
            console.log(`[${exchangeId}] Position opened: ${position.position.toUpperCase()} @ ${position.entry}`);
        }
    }
    
    /**
     * Handle position closed event
     * @param {string} exchangeId - Exchange identifier
     * @param {Object} result - Position close result
     */
    handlePositionClosed(exchangeId, result) {
        if (this.enableDetailedLogs) {
            const profitOrLoss = result.pnl >= 0 ? `profit: +$${result.pnl.toFixed(2)}` : `loss: -$${Math.abs(result.pnl).toFixed(2)}`;
            console.log(`[${exchangeId}] Position closed with ${profitOrLoss}`);
        }
    }
    
    /**
     * Handle take profit hit event
     * @param {string} exchangeId - Exchange identifier
     * @param {Object} result - Take profit result
     */
    handleTakeProfitHit(exchangeId, result) {
        if (this.enableDetailedLogs) {
            console.log(`[${exchangeId}] Take profit hit: +$${result.pnl.toFixed(2)}`);
        }
    }
    
    /**
     * Handle error event
     * @param {string} exchangeId - Exchange identifier
     * @param {Error} error - Error object
     */
    handleError(exchangeId, error) {
        console.error(`[${exchangeId}] Error:`, error);
    }
    
    /**
     * Get consolidated performance statistics across all exchanges
     * @returns {Object} - Consolidated statistics
     */
    getConsolidatedStats() {
        if (!this.initialized || this.exchanges.length === 0) {
            return { error: 'No exchanges initialized' };
        }
        
        // Aggregate statistics by exchange
        const statsByExchange = this.exchanges.map(exchange => {
            const stats = exchange.getStats();
            return {
                id: exchange.id,
                provider: stats.provider,
                symbol: stats.symbol,
                market: exchange.market,
                totalTrades: stats.totalTrades,
                winRate: stats.overallWinRate,
                pnl: stats.totalProfitLoss,
                capital: stats.currentCapital
            };
        });
        
        // Calculate total stats
        const totalStats = statsByExchange.reduce((total, exchange) => {
            total.totalTrades += exchange.totalTrades;
            total.totalPnl += exchange.pnl;
            total.totalCapital += exchange.capital;
            return total;
        }, { totalTrades: 0, totalPnl: 0, totalCapital: 0 });
        
        // Add other aggregated metrics
        return {
            exchanges: statsByExchange,
            totalExchanges: this.exchanges.length,
            totalTrades: totalStats.totalTrades,
            totalPnl: parseFloat(totalStats.totalPnl.toFixed(2)),
            totalCapital: parseFloat(totalStats.totalCapital.toFixed(2)),
            timestamp: new Date().toISOString()
        };
    }
    
    /**
     * Log all active positions across exchanges
     */
    logAllActivePositions() {
        console.log('\n========== ACTIVE POSITIONS ACROSS EXCHANGES ==========');
        
        let hasActivePositions = false;
        
        this.exchanges.forEach(exchange => {
            if (exchange.jalgo) {
                const positions = exchange.jalgo.getCurrentPositions();
                
                if (positions.inLongTrade || positions.inShortTrade) {
                    hasActivePositions = true;
                    exchange.logActivePosition();
                }
            }
        });
        
        if (!hasActivePositions) {
            console.log('No active positions on any exchange');
        }
        
        console.log('========================================================\n');
    }
    
    /**
     * Start the multi-exchange engine (placeholder for future functionality)
     */
    start() {
        // Exchanges are automatically started when instantiated
        console.log('Multi-Exchange Engine started!');
    }
    
    /**
     * Stop the multi-exchange engine and close all connections
     */
    stop() {
        console.log('Stopping Multi-Exchange Engine...');
        
        // Close all exchange connections
        this.exchanges.forEach(exchange => {
            try {
                if (typeof exchange.close === 'function') {
                    exchange.close();
                }
            } catch (error) {
                console.error(`Error closing exchange ${exchange.id}:`, error);
            }
        });
        
        console.log('Multi-Exchange Engine stopped!');
    }
}

export default MultiExchangeEngine;