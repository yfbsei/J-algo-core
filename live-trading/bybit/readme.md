# J-Algo Bybit Live Trading Module

This module integrates J-Algo's trading algorithms with Bybit's API for live and demo trading on both spot and futures markets.

## Features

- Support for both live and demo trading on Bybit mainnet (no testnet)
- Trading on multiple symbols/timeframes simultaneously
- Support for both spot and futures markets (linear and inverse)
- Real-time market data via WebSockets
- Position and order management
- Risk management integrated with J-Algo's core algorithms
- Performance tracking and reporting

## Installation

1. Make sure you have Node.js installed (v16+ recommended)
2. Install required dependencies:

```bash
npm install bybit-api ws dotenv
```

3. Copy the module files to your project's `live-trading/bybit` directory

## Configuration

Create a `.env` file in your project root with the following variables:

```
# Bybit API credentials
BYBIT_API_KEY=your_api_key
BYBIT_API_SECRET=your_api_secret
BYBIT_DEMO=true  # true for demo/paper trading, false for live trading

# Trading parameters
BYBIT_LEVERAGE=3.0
BYBIT_INITIAL_CAPITAL=1000
BYBIT_RISK_PER_TRADE=2.0
BYBIT_REWARD_MULTIPLE=1.5
BYBIT_AUTO_TRADING=false  # Set to true to enable automated order execution
BYBIT_DEBUG=false  # Set to true for detailed debug logs
BYBIT_LOG_LEVEL=info  # debug, info, warn, error
```

## Usage

### Basic Example

```javascript
import BybitLiveTrading from './live-trading/bybit/bybit-live.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create configuration
const config = {
  apiKey: process.env.BYBIT_API_KEY,
  apiSecret: process.env.BYBIT_API_SECRET,
  isDemo: process.env.BYBIT_DEMO === 'true',
  leverage: parseFloat(process.env.BYBIT_LEVERAGE || '3.0'),
  initialCapital: parseFloat(process.env.BYBIT_INITIAL_CAPITAL || '1000'),
  riskPerTrade: parseFloat(process.env.BYBIT_RISK_PER_TRADE || '2.0'),
  rewardMultiple: parseFloat(process.env.BYBIT_REWARD_MULTIPLE || '1.5'),
  enableAutoTrading: process.env.BYBIT_AUTO_TRADING === 'true',
  enableDebug: process.env.BYBIT_DEBUG === 'true',
  logLevel: process.env.BYBIT_LOG_LEVEL || 'info'
};

// Initialize Bybit trading module
const bybitTrading = new BybitLiveTrading(config);

// Create trading instances for different symbols
const btcInstance = bybitTrading.createTradingInstance({
  symbol: 'BTCUSDT',
  timeframe: '5m',
  market: 'futures'
});

const ethInstance = bybitTrading.createTradingInstance({
  symbol: 'ETHUSDT',
  timeframe: '15m',
  market: 'futures'
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping trading system...');
  bybitTrading.stopAll();
  process.exit(0);
});

console.log('Trading system running. Press Ctrl+C to stop.');
```

### Manual Order Placement

```javascript
// Place a market order
await btcInstance.placeOrder({
  side: 'Buy',
  orderType: 'Market',
  qty: '0.001'
});

// Place a limit order
await btcInstance.placeOrder({
  side: 'Buy',
  orderType: 'Limit',
  qty: '0.001',
  price: '50000',
  timeInForce: 'GTC'
});

// Get open orders
const openOrders = await btcInstance.getOpenOrders();
console.log('Open orders:', openOrders);

// Cancel an order
await btcInstance.cancelOrder('order_id_here');
```

### Position Management

```javascript
// Get current positions
const positions = await btcInstance.getPositions();

// Set leverage
await btcInstance.setLeverage(5); // 5x leverage

// Get account balance
const accountInfo = await bybitTrading.getAccountInfo();
```

### Performance Tracking

```javascript
// Get performance statistics
const stats = bybitTrading.getPerformanceStats();
console.log('Total P&L:', stats.totalPnl);

// Log active positions
bybitTrading.logAllActivePositions();
```

## Module Structure

- `bybit-live.js` - Main entry point
- `bybit-client.js` - Bybit API client wrapper
- `bybit-order-manager.js` - Order placement and tracking
- `bybit-position-manager.js` - Position management
- `bybit-market-data.js` - Market data handling
- `bybit-account-info.js` - Account information
- `bybit-config.js` - Configuration handling
- `bybit-utils.js` - Utility functions

## Important Notes

1. This module uses the mainnet API for both live and demo trading. Demo trading is handled via API keys linked to a demo account.

2. For futures trading, make sure to understand the difference between linear (USDT-margined) and inverse (coin-margined) contracts.

3. The J-Algo core algorithms are used for signal generation, while this module handles the integration with Bybit for execution.

4. Proper risk management is crucial - use the `riskPerTrade` parameter to limit your exposure.

## License

This module is part of the J-Algo trading system. Use at your own risk.
