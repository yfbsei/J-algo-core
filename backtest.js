import fetch from 'node-fetch';
import jAlgo from './jalgo.js';

/**
 * Fetch historical klines (candlestick) data from Binance
 * 
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {string} interval - Kline interval (e.g., '1h', '4h', '1d')
 * @param {number} limit - Number of candles to fetch (max 1000 per request)
 * @param {boolean} isFutures - Whether to fetch from futures or spot market
 * @returns {Array} - Array of formatted OHLC data
 */
async function fetchBinanceData(symbol, interval, limit = 1000, isFutures = false) {
  try {
    // Choose the appropriate API endpoint
    const baseUrl = isFutures 
      ? 'https://fapi.binance.com/fapi/v1/klines'
      : 'https://api.binance.com/api/v3/klines';
    
    // Construct the URL with parameters
    const url = `${baseUrl}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    // Fetch data
    const response = await fetch(url);
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error(`Failed to fetch data: ${JSON.stringify(data)}`);
    }
    
    // Format the data
    return data.map(d => ({
      openTime: d[0],
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
      closeTime: d[6]
    }));
  } catch (error) {
    console.error('Error fetching data from Binance:', error);
    throw error;
  }
}

/**
 * Fetch a large amount of historical data by making multiple requests
 * 
 * @param {string} symbol - Trading pair (e.g., 'BTCUSDT')
 * @param {string} interval - Kline interval (e.g., '1h', '4h', '1d')
 * @param {number} totalCandles - Total number of candles to fetch
 * @param {boolean} isFutures - Whether to fetch from futures or spot market
 * @returns {Array} - Array of formatted OHLC data
 */
async function fetchLargeHistoricalData(symbol, interval, totalCandles = 6000, isFutures = false) {
  // Binance allows max 1000 candles per request
  const maxCandlesPerRequest = 1000;
  const requests = Math.ceil(totalCandles / maxCandlesPerRequest);
  let allData = [];
  
  try {
    // Start with the most recent candles
    let firstBatch = await fetchBinanceData(symbol, interval, maxCandlesPerRequest, isFutures);
    allData = [...firstBatch];
    
    // If we need more data, make additional requests
    if (requests > 1) {
      for (let i = 1; i < requests; i++) {
        // Use the open time of the oldest candle as endTime for the next request
        const endTime = allData[0].openTime - 1;
        
        // Choose the appropriate API endpoint
        const baseUrl = isFutures 
          ? 'https://fapi.binance.com/fapi/v1/klines'
          : 'https://api.binance.com/api/v3/klines';
        
        // Construct the URL with parameters including endTime
        const url = `${baseUrl}?symbol=${symbol}&interval=${interval}&limit=${maxCandlesPerRequest}&endTime=${endTime}`;
        
        // Fetch older data
        const response = await fetch(url);
        const data = await response.json();
        
        if (!Array.isArray(data)) {
          throw new Error(`Failed to fetch additional data: ${JSON.stringify(data)}`);
        }
        
        // Format and add to our dataset
        const formattedData = data.map(d => ({
          openTime: d[0],
          open: parseFloat(d[1]),
          high: parseFloat(d[2]),
          low: parseFloat(d[3]),
          close: parseFloat(d[4]),
          volume: parseFloat(d[5]),
          closeTime: d[6]
        }));
        
        // Add to the beginning of our array (oldest data first)
        allData = [...formattedData, ...allData];
        
        // If we didn't get a full batch, we've reached the limit of available data
        if (data.length < maxCandlesPerRequest) {
          console.log(`Reached the limit of available data at ${allData.length} candles`);
          break;
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Trim to requested size
    return allData.slice(-totalCandles);
  } catch (error) {
    console.error('Error fetching large historical data:', error);
    throw error;
  }
}

/**
 * Run backtest with jAlgo
 * 
 * @param {Array} candleData - Array of candle data objects
 * @param {Object} config - Configuration for jAlgo
 * @returns {Object} - Backtest results
 */
function runBacktest(candleData, config) {
  // Format data for jAlgo
  const priceData = {
    open: candleData.map(d => d.open),
    high: candleData.map(d => d.high),
    low: candleData.map(d => d.low),
    close: candleData.map(d => d.close)
  };
  
  // Process all data
  let state = null;
  let result;
  let prevResult = null;
  const signals = [];
  const tradeLog = [];
  
  // Create a trade log file stream
  console.log("\nDETAILED TRADE LOG:");
  console.log("===================");
  console.log("DATE,ACTION,POSITION,PRICE,TARGET,STOP,REASON,P/L,RISKED,CAPITAL");
  
  // We need enough data for indicator calculation before we start tracking signals
  // Using 100 as a safe starting point (depends on indicator periods)
  const warmupPeriod = 100;
  
  // Track active trades for logging purposes
  let activeLongTrade = null;
  let activeShortTrade = null;
  
  for (let i = warmupPeriod; i < priceData.close.length; i++) {
    // Create a data slice up to the current bar
    const currentData = {
      open: priceData.open.slice(0, i + 1),
      high: priceData.high.slice(0, i + 1),
      low: priceData.low.slice(0, i + 1),
      close: priceData.close.slice(0, i + 1)
    };
    
    // Get current bar values
    const currentClose = priceData.close[i];
    const currentHigh = priceData.high[i];
    const currentLow = priceData.low[i];
    const currentDate = new Date(candleData[i].closeTime).toLocaleString();
    
    // Process the data
    result = jAlgo(currentData, state, config);
    
    // Check for trade closures by comparing previous state to current state
    if (prevResult && prevResult.state) {
      const prev = prevResult.state;
      const curr = result.state;
      
      // Check if a long trade was closed
      if (prev.inLongTrade && !curr.inLongTrade) {
        let exitReason = "Unknown";
        let profitLoss = 0;
        
        // Determine if it was closed by target hit or new signal
        if (currentHigh >= prev.longTargetLevel) {
          exitReason = "Target Hit";
          profitLoss = prev.riskAmount * config.rewardMultiple * (config.useLeverage ? config.leverageAmount : 1);
        } else if (result.signal && result.signal.position === 'short') {
          exitReason = "New Signal (Short)";
          
          // Calculate partial P/L based on how far price moved
          const longPL = currentClose - prev.longEntryPrice;
          const longRisk = prev.longEntryPrice - prev.longStopReference;
          
          if (longPL > 0) {
            // In profit but didn't hit target
            const targetDistance = prev.longTargetLevel - prev.longEntryPrice;
            const actualDistance = longPL;
            const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
            profitLoss = percentageToTarget * prev.riskAmount * config.rewardMultiple * (config.useLeverage ? config.leverageAmount : 1);
          } else {
            // In loss
            const percentageLoss = Math.min(Math.abs(longPL) / Math.abs(longRisk), 1.0);
            profitLoss = -percentageLoss * prev.riskAmount * (config.useLeverage ? config.leverageAmount : 1);
          }
        }
        
        // Log the trade closure
        console.log(`${currentDate},EXIT,LONG,${currentClose.toFixed(2)},${prev.longTargetLevel.toFixed(2)},${prev.longStopReference.toFixed(2)},${exitReason},${profitLoss.toFixed(2)},${prev.riskAmount.toFixed(2)},${curr.currentCapital.toFixed(2)}`);
        
        // Add to trade log
        tradeLog.push({
          entryDate: activeLongTrade ? activeLongTrade.date : "Unknown",
          exitDate: currentDate,
          position: "LONG",
          entryPrice: prev.longEntryPrice,
          exitPrice: currentClose,
          targetPrice: prev.longTargetLevel,
          stopReference: prev.longStopReference,
          exitReason: exitReason,
          profitLoss: profitLoss,
          risked: prev.riskAmount,
          capital: curr.currentCapital
        });
        
        activeLongTrade = null;
      }
      
      // Check if a short trade was closed
      if (prev.inShortTrade && !curr.inShortTrade) {
        let exitReason = "Unknown";
        let profitLoss = 0;
        
        // Determine if it was closed by target hit or new signal
        if (currentLow <= prev.shortTargetLevel) {
          exitReason = "Target Hit";
          profitLoss = prev.riskAmount * config.rewardMultiple * (config.useLeverage ? config.leverageAmount : 1);
        } else if (result.signal && result.signal.position === 'long') {
          exitReason = "New Signal (Long)";
          
          // Calculate partial P/L based on how far price moved
          const shortPL = prev.shortEntryPrice - currentClose;
          const shortRisk = prev.shortStopReference - prev.shortEntryPrice;
          
          if (shortPL > 0) {
            // In profit but didn't hit target
            const targetDistance = prev.shortEntryPrice - prev.shortTargetLevel;
            const actualDistance = shortPL;
            const percentageToTarget = Math.min(actualDistance / targetDistance, 1.0);
            profitLoss = percentageToTarget * prev.riskAmount * config.rewardMultiple * (config.useLeverage ? config.leverageAmount : 1);
          } else {
            // In loss
            const percentageLoss = Math.min(Math.abs(shortPL) / Math.abs(shortRisk), 1.0);
            profitLoss = -percentageLoss * prev.riskAmount * (config.useLeverage ? config.leverageAmount : 1);
          }
        }
        
        // Log the trade closure
        console.log(`${currentDate},EXIT,SHORT,${currentClose.toFixed(2)},${prev.shortTargetLevel.toFixed(2)},${prev.shortStopReference.toFixed(2)},${exitReason},${profitLoss.toFixed(2)},${prev.riskAmount.toFixed(2)},${curr.currentCapital.toFixed(2)}`);
        
        // Add to trade log
        tradeLog.push({
          entryDate: activeShortTrade ? activeShortTrade.date : "Unknown",
          exitDate: currentDate,
          position: "SHORT",
          entryPrice: prev.shortEntryPrice,
          exitPrice: currentClose,
          targetPrice: prev.shortTargetLevel,
          stopReference: prev.shortStopReference,
          exitReason: exitReason,
          profitLoss: profitLoss,
          risked: prev.riskAmount,
          capital: curr.currentCapital
        });
        
        activeShortTrade = null;
      }
    }
    
    // Check for new entries based on current result
    if (result.signal) {
      signals.push({
        index: i,
        date: currentDate,
        type: result.signal.position,
        price: result.signal.location
      });
      
      // Log the new signal entry
      if (result.signal.position === 'long') {
        console.log(`${currentDate},ENTER,LONG,${currentClose.toFixed(2)},${result.state.longTargetLevel ? result.state.longTargetLevel.toFixed(2) : 'N/A'},${result.state.longStopReference ? result.state.longStopReference.toFixed(2) : 'N/A'},New Signal,0.00,${result.state.riskAmount ? result.state.riskAmount.toFixed(2) : '0.00'},${result.state.currentCapital.toFixed(2)}`);
        
        // Track this trade for later reference
        activeLongTrade = {
          date: currentDate,
          price: currentClose
        };
      } else if (result.signal.position === 'short') {
        console.log(`${currentDate},ENTER,SHORT,${currentClose.toFixed(2)},${result.state.shortTargetLevel ? result.state.shortTargetLevel.toFixed(2) : 'N/A'},${result.state.shortStopReference ? result.state.shortStopReference.toFixed(2) : 'N/A'},New Signal,0.00,${result.state.riskAmount ? result.state.riskAmount.toFixed(2) : '0.00'},${result.state.currentCapital.toFixed(2)}`);
        
        // Track this trade for later reference
        activeShortTrade = {
          date: currentDate,
          price: currentClose
        };
      }
    }
    
    // Check specifically for target hits without signal changes
    // This helps debug if target detection is working correctly
    if (!result.signal && prevResult && prevResult.state) {
      // Check for long target hit
      if (prevResult.state.inLongTrade && result.state.inLongTrade) {
        if (currentHigh >= prevResult.state.longTargetLevel) {
          console.log(`${currentDate},TARGET-CHECK,LONG,${currentClose.toFixed(2)},HIGH:${currentHigh.toFixed(2)},TARGET:${prevResult.state.longTargetLevel.toFixed(2)},SHOULD HIT,${(prevResult.state.riskAmount * config.rewardMultiple * (config.useLeverage ? config.leverageAmount : 1)).toFixed(2)},${prevResult.state.riskAmount.toFixed(2)},${result.state.currentCapital.toFixed(2)}`);
        }
      }
      
      // Check for short target hit
      if (prevResult.state.inShortTrade && result.state.inShortTrade) {
        if (currentLow <= prevResult.state.shortTargetLevel) {
          console.log(`${currentDate},TARGET-CHECK,SHORT,${currentClose.toFixed(2)},LOW:${currentLow.toFixed(2)},TARGET:${prevResult.state.shortTargetLevel.toFixed(2)},SHOULD HIT,${(prevResult.state.riskAmount * config.rewardMultiple * (config.useLeverage ? config.leverageAmount : 1)).toFixed(2)},${prevResult.state.riskAmount.toFixed(2)},${result.state.currentCapital.toFixed(2)}`);
        }
      }
    }
    
    // Update state for next iteration
    state = result.state;
    prevResult = result;
  }
  
  console.log("===================\n");
  
  return {
    finalState: result.state,
    stats: result.stats,
    signals,
    tradeLog,
    config
  };
}

/**
 * Format and print backtest results
 * 
 * @param {Object} results - Backtest results
 * @param {string} symbol - Trading pair
 * @param {string} interval - Timeframe
 */
function printBacktestResults(results, symbol, interval) {
  const { finalState, stats, signals, tradeLog, config } = results;
  
  console.log('======================================================');
  console.log(`BACKTEST RESULTS: ${symbol} ${interval}`);
  console.log('======================================================');
  console.log(`Total candles processed: ${signals.length > 0 ? signals[0].index : 0} to ${signals.length > 0 ? signals[signals.length - 1].index : 0}`);
  console.log('\nCONFIGURATION:');
  console.log(`Initial Capital: ${config.initialCapital}`);
  console.log(`Risk Per Trade: ${config.riskPerTrade}%`);
  console.log(`Reward Multiple: ${config.rewardMultiple}`);
  console.log(`Leverage: ${config.useLeverage ? config.leverageAmount + 'x' : 'OFF'}`);
  console.log(`Scalp Line Period: ${config.scalpPeriod}`);
  
  console.log('\nPERFORMANCE:');
  console.log(`Final Capital: ${finalState.currentCapital.toFixed(2)}`);
  console.log(`Total P/L: ${finalState.totalProfitLoss.toFixed(2)} (${((finalState.totalProfitLoss / config.initialCapital) * 100).toFixed(2)}%)`);
  console.log(`Total Profit: ${finalState.totalProfit.toFixed(2)}`);
  console.log(`Total Loss: ${finalState.totalLoss.toFixed(2)}`);
  
  console.log('\nTRADES:');
  console.log(`Long Signals: ${stats.totalLongTrades}`);
  console.log(`Short Signals: ${stats.totalShortTrades}`);
  console.log(`Total Trades: ${stats.totalLongTrades + stats.totalShortTrades}`);
  console.log(`Long Wins: ${finalState.longWins} / Long Losses: ${finalState.longLosses}`);
  console.log(`Short Wins: ${finalState.shortWins} / Short Losses: ${finalState.shortLosses}`);
  console.log(`Long Target Hits: ${finalState.longTargetHits}`);
  console.log(`Short Target Hits: ${finalState.shortTargetHits}`);
  
  console.log('\nSTATISTICS:');
  console.log(`Overall Win Rate: ${stats.overallWinRate.toFixed(2)}%`);
  console.log(`Long Win Rate: ${stats.longWinRate.toFixed(2)}%`);
  console.log(`Short Win Rate: ${stats.shortWinRate.toFixed(2)}%`);
  console.log(`Efficiency: ${stats.efficiency.toFixed(2)}%`);
  
  // Calculate and display target hit percentages
  const longTargetHitPercent = stats.totalLongTrades > 0 
    ? (finalState.longTargetHits / stats.totalLongTrades * 100).toFixed(2) 
    : '0.00';
  const shortTargetHitPercent = stats.totalShortTrades > 0 
    ? (finalState.shortTargetHits / stats.totalShortTrades * 100).toFixed(2) 
    : '0.00';
  
  console.log(`Long Target Hit %: ${longTargetHitPercent}%`);
  console.log(`Short Target Hit %: ${shortTargetHitPercent}%`);
  
  // Calculate average profit per trade
  const avgProfit = finalState.totalProfit / (finalState.longWins + finalState.shortWins);
  const avgLoss = finalState.totalLoss / (finalState.longLosses + finalState.shortLosses);
  
  console.log('\nPROFIT METRICS:');
  console.log(`Average Profit per Winning Trade: ${isNaN(avgProfit) ? '0.00' : avgProfit.toFixed(2)}`);
  console.log(`Average Loss per Losing Trade: ${isNaN(avgLoss) ? '0.00' : avgLoss.toFixed(2)}`);
  
  // Display profit factor
  const profitFactor = finalState.totalLoss > 0 ? (finalState.totalProfit / finalState.totalLoss).toFixed(2) : 'Infinity';
  console.log(`Profit Factor: ${profitFactor}`);
  
  console.log('\nLAST 5 SIGNALS:');
  const lastSignals = signals.slice(-5);
  lastSignals.forEach(signal => {
    console.log(`${signal.date} - ${signal.type.toUpperCase()} @ ${signal.price.toFixed(2)}`);
  });
  
  // Display info about target hit detection
  if (tradeLog && tradeLog.length > 0) {
    // Calculate how many trades were closed by target hit vs new signal
    const targetHits = tradeLog.filter(t => t.exitReason.includes('Target Hit')).length;
    const signalExits = tradeLog.filter(t => t.exitReason.includes('New Signal')).length;
    
    console.log('\nTRADE EXIT ANALYSIS:');
    console.log(`Trades Closed by Target Hit: ${targetHits} (${((targetHits / tradeLog.length) * 100).toFixed(2)}%)`);
    console.log(`Trades Closed by New Signal: ${signalExits} (${((signalExits / tradeLog.length) * 100).toFixed(2)}%)`);
    
    // Display the most profitable trades
    const sortedByProfit = [...tradeLog].sort((a, b) => b.profitLoss - a.profitLoss);
    
    console.log('\nTOP 3 MOST PROFITABLE TRADES:');
    sortedByProfit.slice(0, 3).forEach((trade, i) => {
      console.log(`${i+1}. ${trade.position} ${trade.entryDate} to ${trade.exitDate}: ${trade.profitLoss.toFixed(2)} (${trade.exitReason})`);
    });
    
    // Display the most losing trades
    const sortedByLoss = [...tradeLog].sort((a, b) => a.profitLoss - b.profitLoss);
    
    console.log('\nTOP 3 BIGGEST LOSING TRADES:');
    sortedByLoss.slice(0, 3).forEach((trade, i) => {
      console.log(`${i+1}. ${trade.position} ${trade.entryDate} to ${trade.exitDate}: ${trade.profitLoss.toFixed(2)} (${trade.exitReason})`);
    });
  }
  
  console.log('======================================================');
}

/**
 * Main function to run the backtest
 */
async function main() {
  try {
    // Configuration
    const symbol = process.argv[2] || 'BTCUSDT';
    const interval = process.argv[3] || '4h';
    const isFutures = (process.argv[4] === 'futures');
    const candlesToFetch = process.argv[5] ? parseInt(process.argv[5]) : 6000;
    
    // Algorithm configuration
    const config = {
      // Core indicator parameters
      fastLength: 6,           // Fast Length for Variable MA
      ATRPeriod: 16,           // Period for ATR
      ATRMultiplier: 9,        // Multiplier for main ATR
      ATRMultiplierFast: 5.1,  // Multiplier for fast ATR
      
      // Scalp mode parameter
      scalpPeriod: 21,         // Scalp Line Period for SMA
      
      // Risk-reward parameters
      rewardMultiple: 1.5,     // Target = Risk × Multiple
      initialCapital: 100,    // Initial Capital in $
      riskPerTrade: 10,         // Risk Per Trade in %
      
      // Leverage parameters
      useLeverage: true,       // Whether to use leverage
      leverageAmount: 2.0      // Leverage amount (2x)
    };
    
    console.log(`Fetching data for ${symbol} ${interval} (${isFutures ? 'Futures' : 'Spot'})...`);
    
    // Fetch historical data
    const candleData = await fetchLargeHistoricalData(symbol, interval, candlesToFetch, isFutures);
    console.log(`Fetched ${candleData.length} candles from ${new Date(candleData[0].openTime).toLocaleString()} to ${new Date(candleData[candleData.length - 1].closeTime).toLocaleString()}`);
    
    // Run backtest
    console.log('Running backtest...');
    const results = runBacktest(candleData, config);
    
    // Print results
    printBacktestResults(results, symbol, interval);
    
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Run the main function
main();

/**
 * Usage:
 * node backtest.js BTCUSDT 4h spot 6000
 * node backtest.js ETHUSDT 1d futures 2000
 * 
 * Arguments:
 * 1. Symbol (default: BTCUSDT)
 * 2. Interval (default: 4h) - Valid intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
 * 3. Market type (default: spot) - Valid values: spot, futures
 * 4. Number of candles to fetch (default: 6000)
 */