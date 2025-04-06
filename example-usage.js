// Example usage of jalgo
import jalgo from './src/jAlgo.js';

// Example price data (you would replace this with your actual data)
const priceData = {
  open: [100, 102, 103, 101, 104, 105, 106, 105, 107, 108, 109, 110, 108, 107, 109, 111, 112, 110, 109, 112, 114, 115, 113, 114, 116],
  high: [102, 104, 105, 102, 106, 107, 108, 107, 108, 110, 111, 112, 111, 108, 110, 114, 115, 114, 110, 115, 116, 118, 115, 116, 118],
  low: [99, 101, 102, 100, 102, 104, 105, 103, 106, 107, 108, 108, 106, 106, 107, 110, 111, 109, 107, 110, 112, 113, 111, 113, 114],
  close: [102, 103, 101, 104, 105, 106, 105, 107, 108, 109, 110, 108, 107, 109, 111, 112, 110, 109, 112, 114, 115, 113, 114, 116, 117]
};

// Configure options for jalgo
const options = {
  // Main parameters
  length: 6,
  period: 16,
  multiplier: 9,
  fast_multiplier: 5.1,
  
  // Scalp mode parameters
  useScalpMode: true,
  scalpPeriod: 21,
  
  // Risk-reward parameters
  rewardMultiple: 0.5,
  initialCapital: 100,
  riskPerTrade: 10,
  
  // Leverage parameters
  useLeverage: true,
  leverageAmount: 2.0,
};

// Run the indicator
const result = jalgo(priceData, options);

// Display the results
console.log('J-Trend Sniper V3 Results:');
console.log('---------------------------');

// Check if a trading signal was generated
if (result.signal) {
  console.log('Signal Generated:');
  console.log(`  Direction: ${result.signal.position}`);
  console.log(`  Entry Price: ${result.signal.location}`);
  console.log(`  Stop Level: ${result.signal.stopLevel}`);
  console.log(`  Target Level: ${result.signal.targetLevel}`);
  console.log(`  Risk Amount: $${result.signal.riskAmount.toFixed(2)}`);
  console.log(`  Reward Amount: $${result.signal.rewardAmount.toFixed(2)}`);
  
  if (result.signal.liquidationLevel) {
    console.log(`  Liquidation Level: ${result.signal.liquidationLevel}`);
  }
  
  // Example of simulating trade execution with a future price
  const futurePriceExample = result.signal.position === 'long' 
    ? result.signal.targetLevel  // Example: Price reaches target
    : result.signal.location * 1.01;  // Example: Price moves 1% from entry
  
  console.log('\nSimulated Trade Execution:');
  console.log(`  Future Price: ${futurePriceExample}`);
  
  const tradeResult = result.executeTrade(result.signal, futurePriceExample);
  
  console.log(`  P&L: $${tradeResult.pnl.toFixed(2)}`);
  console.log(`  Outcome: ${tradeResult.isWin ? 'Win' : 'Loss'}`);
  console.log(`  Target Hit: ${tradeResult.isTargetHit ? 'Yes' : 'No'}`);
  
  // Get updated statistics
  const stats = result.calculateStats();
  
  console.log('\nTrading Statistics:');
  console.log(`  Total Trades: ${stats.totalTrades}`);
  console.log(`  Win Rate: ${stats.overallWinRate.toFixed(2)}%`);
  console.log(`  Current Capital: $${stats.currentCapital.toFixed(2)}`);
  console.log(`  Total P&L: $${stats.totalProfitLoss.toFixed(2)}`);
  console.log(`  Efficiency: ${stats.efficiency.toFixed(2)}%`);
} else {
  console.log('No trading signal generated in this update.');
}

// Demonstrate backtesting multiple periods
function backtest(priceData, options) {
  const results = [];
  let trades = [];
  let activePosition = null;
  let lastStats = null;
  
  // Create a sliding window of data to simulate real-time updates
  // Start with enough data to calculate indicators (at least options.period)
  const minDataPoints = Math.max(options.period * 2, 30);
  
  for (let i = minDataPoints; i < priceData.close.length; i++) {
    // Create a window of data from the beginning to the current index
    const windowData = {
      open: priceData.open.slice(0, i + 1),
      high: priceData.high.slice(0, i + 1),
      low: priceData.low.slice(0, i + 1),
      close: priceData.close.slice(0, i + 1)
    };
    
    // Run the indicator on the current window
    const result = jalgo(windowData, options);
    results.push(result);
    
    // If we have a signal and no active position, enter a new position
    if (result.signal && !activePosition) {
      activePosition = result.signal;
      console.log(`Bar ${i}: New ${activePosition.position} position at ${activePosition.location}`);
    }
    
    // If we have an active position, check for exit conditions
    if (activePosition) {
      const currentPrice = priceData.close[i];
      
      // Check if we hit target or stop
      let shouldExit = false;
      
      if (activePosition.position === 'long') {
        const high = priceData.high[i];
        // Exit if high reached target or close dropped below stop
        shouldExit = (high >= activePosition.targetLevel) || (currentPrice <= activePosition.stopLevel);
      } else if (activePosition.position === 'short') {
        const low = priceData.low[i];
        // Exit if low reached target or close rose above stop
        shouldExit = (low <= activePosition.targetLevel) || (currentPrice >= activePosition.stopLevel);
      }
      
      // If exit conditions met, close the trade
      if (shouldExit) {
        const tradeResult = result.executeTrade(activePosition, currentPrice);
        trades.push(tradeResult);
        
        console.log(`Bar ${i}: Closed ${activePosition.position} position at ${currentPrice}`);
        console.log(`  P&L: $${tradeResult.pnl.toFixed(2)} (${tradeResult.isWin ? 'Win' : 'Loss'})`);
        
        activePosition = null;
        lastStats = result.calculateStats();
      }
    }
  }
  
  // Return the backtest results
  return {
    trades,
    lastStats,
    results
  };
}

// Uncomment to run a backtest

// console.log('\nRunning Backtest...');
// const backtestResults = backtest(priceData, options);
// console.log(`Backtest completed with ${backtestResults.trades.length} trades`);

// if (backtestResults.lastStats) {
//   console.log('\nBacktest Statistics:');
//   console.log(`  Total Trades: ${backtestResults.lastStats.totalTrades}`);
//   console.log(`  Win Rate: ${backtestResults.lastStats.overallWinRate.toFixed(2)}%`);
//   console.log(`  Final Capital: $${backtestResults.lastStats.currentCapital.toFixed(2)}`);
//   console.log(`  Total P&L: $${backtestResults.lastStats.totalProfitLoss.toFixed(2)}`);
//   console.log(`  Total Profit: $${backtestResults.lastStats.totalProfit.toFixed(2)}`);
//   console.log(`  Total Loss: $${backtestResults.lastStats.totalLoss.toFixed(2)}`);
// }

