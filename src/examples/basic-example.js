/**
 * Basic Example of Trend Sniper Usage
 * 
 * This example demonstrates how to use the Trend Sniper indicator
 * with historical data in batch processing mode (non-real-time).
 */

const { TrendSniper } = require('../core/trend-sniper');
const fs = require('fs');
const path = require('path');

/**
 * Helper function to create sample data
 * @param {string} filePath - Path to save the CSV file
 */
async function createSampleData(filePath) {
  console.log(`Creating sample data file at ${filePath}...`);
  
  // Header row
  let csv = 'date,open,high,low,close,volume\n';
  
  // Generate sample price data (simulating a trending market)
  const startDate = new Date('2023-01-01');
  const numDays = 200;
  let price = 50000.0;
  
  for (let i = 0; i < numDays; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Generate random price movement with trend
    let trend = (i < numDays / 2) ? 0.1 : -0.1; // Up trend first half, down trend second half
    let daily_change = trend + (Math.random() * 2 - 1) * 0.5;
    
    // Calculate OHLC based on previous close
    price = price * (1 + daily_change / 100);
    const open = price;
    const high = open * (1 + Math.random() * 0.5 / 100);
    const low = open * (1 - Math.random() * 0.5 / 100);
    const close = low + Math.random() * (high - low);
    const volume = Math.floor(Math.random() * 10000 + 5000);
    
    // Add row to CSV
    csv += `${dateStr},${open.toFixed(4)},${high.toFixed(4)},${low.toFixed(4)},${close.toFixed(4)},${volume}\n`;
  }
  
  // Write to file
  await fs.promises.writeFile(filePath, csv);
  console.log(`Sample data created with ${numDays} days of OHLC data.`);
}

/**
 * Run Trend Sniper with different configurations
 */
async function runExample() {
  // Load configuration
  const configPath = path.join(__dirname, '../../config/default-config.json');
  let config;
  
  try {
    config = JSON.parse(await fs.promises.readFile(configPath, 'utf8'));
    console.log('Loaded configuration from default-config.json');
  } catch (error) {
    console.error(`Error loading configuration: ${error.message}`);
    console.log('Using default configuration');
    config = {
      indicatorConfig: {
        ATRPeriod: 16,
        ATRMultip: 9,
        ATRMultip_fast: 5.1,
        fastLen: 6,
        useScalpMode: false,
        scalpPeriod: 21,
        rewardMultiple: 1.5,
        initialCapital: 1000,
        riskPerTrade: 2.0,
        useLeverage: false,
        leverageAmount: 2.0
      }
    };
  }
  
  // Create sample data file path
  const dataPath = path.join(__dirname, '../data/sample_data.csv');
  
  // Make sure data directory exists
  const dataDir = path.dirname(dataPath);
  if (!fs.existsSync(dataDir)) {
    await fs.promises.mkdir(dataDir, { recursive: true });
  }
  
  // Create sample data if it doesn't exist
  if (!fs.existsSync(dataPath)) {
    await createSampleData(dataPath);
  }
  
  console.log('\n===== RUNNING TREND SNIPER WITH DEFAULT SETTINGS =====');
  
  // Create indicator with default settings
  const trendSniper = new TrendSniper(config.indicatorConfig);
  
  // Load data and run the indicator
  await trendSniper.loadCSV(dataPath);
  trendSniper.run();
  
  console.log('\n===== RUNNING TREND SNIPER WITH SCALP MODE =====');
  
  // Create indicator with scalp mode enabled
  const scalpModeConfig = {
    ...config.indicatorConfig,
    useScalpMode: true,
    riskPerTrade: 1.5,
    rewardMultiple: 2.0
  };
  
  const trendSniperScalp = new TrendSniper(scalpModeConfig);
  await trendSniperScalp.loadCSV(dataPath);
  trendSniperScalp.run();
  
  console.log('\n===== RUNNING TREND SNIPER WITH LEVERAGE =====');
  
  // Create indicator with leverage enabled
  const leverageConfig = {
    ...config.indicatorConfig,
    useLeverage: true,
    leverageAmount: 3.0,
    riskPerTrade: 1.0 // Reduce risk per trade since we're using leverage
  };
  
  const trendSniperLeverage = new TrendSniper(leverageConfig);
  await trendSniperLeverage.loadCSV(dataPath);
  trendSniperLeverage.run();
}

// Run the example
runExample().catch(err => {
  console.error('Error running Trend Sniper example:', err);
});
