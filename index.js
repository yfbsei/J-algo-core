/**
 * J-Algo Trading System
 * Main entry point for the trading algorithm
 */

import Jalgo from './src/jalgo.js';

/**
 * Initialize the trading system with configuration
 * @param {Object} config - Configuration options
 * @returns {Jalgo} - Configured Jalgo instance
 */
export const initJalgo = (config = {}) => {
    const defaultConfig = {
        symbol: "BTCUSDT",
        timeframe: "5m",
        market: "futures",
        riskOptions: {
            initialCapital: 1000,
            riskPerTrade: 2.0,
            rewardMultiple: 1.5,
            useLeverage: false,
            leverageAmount: 1.0,
            useScalpMode: false
        },
        onSignal: (signal) => console.log("New signal:", signal),
        onTakeProfitHit: (result) => console.log("Take profit hit:", result),
        onError: (error) => console.error("Error:", error)
    };

    // Merge user config with defaults
    const mergedConfig = {
        ...defaultConfig,
        ...config,
        riskOptions: {
            ...defaultConfig.riskOptions,
            ...(config.riskOptions || {})
        }
    };

    return new Jalgo(mergedConfig);
};


export default Jalgo;