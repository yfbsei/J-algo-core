/**
 * Utility functions for fetching and processing market data from Bybit
 * https://bybit-exchange.github.io/docs/v5/market/kline
 */

/**
 * Maximum retry attempts for API calls
 * @type {number}
 */
const MAX_RETRIES = 3;

/**
 * Fetches candlestick data from Bybit API
 * @param {string} market - Market type: "spot" or "futures"
 * @param {string} symbol - Trading pair symbol e.g. "BTCUSDT"
 * @param {string} interval - Candlestick interval e.g. "5m"
 * @param {number} limit - Number of candles to fetch
 * @returns {Promise<Object>} - Promise resolving to OHLCV data object
 */
const bybit_candles = async (market = "spot", symbol = "BTCUSDT", interval = "5m", limit = 400) => {
    // Validate parameters
    if (market !== "spot" && market !== "futures") {
        throw new Error('Market must be either "spot" or "futures"');
    }
    
    if (!symbol || !interval) {
        throw new Error("Symbol and interval are required parameters");
    }
    
    // Initialize retry counter
    let retries = 0;
    let lastError = null;
    
    // Convert interval to Bybit format
    const bybitInterval = convertToBybitInterval(interval);
    
    // Determine category based on market type
    const category = market === "spot" ? "spot" : "linear";
    
    while (retries < MAX_RETRIES) {
        try {
            // Make API request
            const response = await fetch(
                `https://api.bybit.com/v5/market/kline?category=${category}&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`,
                {
                    headers: {
                        'User-Agent': 'J-Trading-Algo/1.0.0'
                    },
                    timeout: 10000 // 10 second timeout
                }
            );
            
            // Check for HTTP errors
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Bybit API error: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            // Parse response data
            const responseData = await response.json();
            
            // Check for API errors
            if (responseData.retCode !== 0) {
                throw new Error(`Bybit API error: ${responseData.retCode} - ${responseData.retMsg}`);
            }
            
            // Get the list of klines
            const data = responseData.result?.list || [];
            
            // Validate response data
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error("Invalid or empty response from Bybit API");
            }
            
            // Check if we have enough data
            if (data.length === 0) {
                console.warn(`No candles returned for ${symbol}/${interval}`);
                return {open:[], high:[], low:[], close:[], volume:[]};
            }
            
            // Process candle data into OHLCV format (Bybit returns newest first, so reverse the array)
            const reversedData = [...data].reverse();
            
            return reversedData.reduce((total, val, i) => {
                // Safely parse float values with fallbacks for invalid data
                // Bybit format: [timestamp, open, high, low, close, volume, ...]
                total.open[i] = parseFloat(val[1]) || 0;
                total.high[i] = parseFloat(val[2]) || 0; 
                total.low[i] = parseFloat(val[3]) || 0;
                total.close[i] = parseFloat(val[4]) || 0;
                total.volume[i] = parseFloat(val[5]) || 0;
                return total;
            }, {open:[], high:[], low:[], close:[], volume:[]} );
            
        } catch (error) {
            // Track the error
            lastError = error;
            console.error(`Attempt ${retries + 1}/${MAX_RETRIES} failed:`, error);
            
            // Implement exponential backoff for retries
            retries++;
            if (retries < MAX_RETRIES) {
                const backoffTime = 1000 * Math.pow(2, retries); // Exponential backoff: 2s, 4s, 8s...
                console.log(`Retrying in ${backoffTime/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
            }
        }
    }
    
    // If we've exhausted retries, throw the last error
    throw lastError || new Error("Failed to fetch candle data after multiple attempts");
}

/**
 * Converts common timeframe intervals to Bybit format
 * @param {string} interval - Standard interval (e.g. "1m", "5m", "1h", "1d")
 * @returns {string} - Bybit interval format
 */
function convertToBybitInterval(interval) {
    // Map of standard intervals to Bybit intervals
    const intervalMap = {
        "1m": "1",
        "3m": "3",
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "1h": "60",
        "2h": "120",
        "4h": "240",
        "6h": "360",
        "12h": "720",
        "1d": "D",
        "1w": "W",
        "1M": "M"
    };
    
    return intervalMap[interval] || "5"; // Default to 5m if not found
}

export default bybit_candles;