/**
 * J-algo-core
 * Trading algorithm based on the J-Trend Sniper v3 indicator
 * 
 * @module j-algo-core
 * @author yfbsei
 * @version 1.0.0
 */

// Import the main algorithm
import jAlgo from './src/jalgo.js';

// Export the main algorithm as the default export
export default jAlgo;

// Also export any helper functions or utilities
export { 
  SATR, 
  variable_moving_average, 
  calculateScalpLine, 
  generateSignal, 
  initializeState, 
  processBar, 
  calculateStats 
} from './src/jalgo.js';

/**
 * Main entry point for the J-algo-core package
 * @typedef {Object} JAlgoResult
 * @property {Object} indicators - The calculated indicators
 * @property {boolean|Object} signal - Trading signal or false if no signal
 * @property {Object} state - Current trading state
 * @property {Object} stats - Trading statistics
 * 
 * @param {Object} source - Object containing OHLC price arrays
 * @param {Object|null} state - Previous state object (or null for initialization)
 * @param {Object} config - Configuration options
 * @returns {JAlgoResult} - Indicator values, signals, and updated state
 * 
 * @example
 * import jAlgo from 'j-algo-core';
 * 
 * // Sample price data
 * const priceData = {
 *   open: [...],
 *   high: [...],
 *   low: [...],
 *   close: [...]
 * };
 * 
 * // Configuration
 * const config = {
 *   fastLength: 6,
 *   ATRPeriod: 16, 
 *   ATRMultiplier: 9,
 *   rewardMultiple: 1.5,
 *   riskPerTrade: 2.0,
 *   initialCapital: 1000,
 *   useLeverage: false
 * };
 * 
 * // Initialize and run algorithm
 * const result = jAlgo(priceData, null, config);
 * 
 * // Check for signals
 * if (result.signal) {
 *   console.log(`New ${result.signal.position} signal at ${result.signal.location}`);
 * }
 */
