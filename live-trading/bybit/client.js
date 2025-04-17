import { RestClientV5 } from 'bybit-api';
import crypto from 'crypto';
import { round } from 'mathjs';

  // Create the Bybit REST restClient
  const restClient = new RestClientV5({
    key: "Kz10q3ZbhOqEoPbVg8",
    secret: "L20xiFdQoADEp1GfoYE7blDV1LrFyudukdM8",
    testnet: false, // Always use mainnet (even for demo trading)
    recv_window: 10000, // 10 seconds
    enable_time_sync: true, // Auto-sync time
    strict_param_validation: true,
    disable_brackets_parsing: false,
    parseAPIRateLimits: true,
    // Enable demo trading mode if configured
    demoTrading: true,
    // Add custom crypto provider for Node.js environment for faster HMAC signing
    customSignMessageFn: async (message, secret) => {
      return crypto.createHmac('sha256', secret).update(message).digest('hex');
    }
  });


  async function getWalletBalance() {
    const response = await restClient.getWalletBalance({accountType: 'UNIFIED', coin: 'USDT'});
    return round(response.result.list[0].coin[0].walletBalance, 4);
}

async function closePosition(symbol = 'BTCUSDT') {
    try {
      // Step 1: Get your open position for this symbol
      const { result } = await restClient.getPositionInfo({category: 'linear', symbol});
  
      const position = result.list.find(p => parseFloat(p.size) > 0);
      if (!position) {
        console.log('✅ No open position found on', symbol);
        return;
      }
  
      const oppositeSide = position.side === 'Buy' ? 'Sell' : 'Buy';
  
      // Step 2: Submit market order in opposite direction
      await restClient.submitOrder({
        category: 'linear',
        symbol: symbol,
        side: oppositeSide,                 // opposite of your current position
        orderType: 'Market',
        qty: '0',                     // AUTO-size based on your current position
        reduceOnly: true,
        closeOnTrigger: true,
      });      
  
      console.log(`✅ Close position order sent: ${JSON.stringify(order, null, 2)}`);
    } catch (err) {
      console.error('❌ Error closing position:', err);
    }
  }

  async function calculateQty({ symbol = 'BTCUSDT', usdtAmount = 100 }) {
    const { result } = await restClient.getTickers({ category: 'linear', symbol });
    const price = parseFloat(result.list[0].lastPrice);
  
    const qty = (usdtAmount / price).toFixed(6); // adjust decimal places based on symbol's min qty
    return qty;
  }

/**
 * Submit a leveraged market order with Take Profit (no SL)
 *
 * @param {Object} params
 * @param {string} params.symbol - Trading pair, e.g. 'BTCUSDT'
 * @param {string} params.side - 'Buy' or 'Sell'
 * @param {string} params.qty - Order quantity in base coin (e.g. BTC)
 * @param {string} params.takeProfit - TP price
 * @param {number|string} params.leverage - Leverage to set before trade
 */
async function submitTradeWithTP({ symbol = 'BTCUSDT', side = 'Buy', qty = '0.01', takeProfit = '0', leverage = 10 }) {
    try {

    // 1. Set leverage
    await restClient.setLeverage({
        category: 'linear',
        symbol,
        buyLeverage: side === 'Buy' ? leverage.toString() : '1',
        sellLeverage: side === 'Sell' ? leverage.toString() : '1',
      });
  
      console.log(`⚙️ Leverage set to ${leverage}x for ${side} side`);
  
      // 2. Submit market order with TP
      const order = await restClient.submitOrder({
        category: 'linear',
        symbol,
        side,
        orderType: 'Market',
        qty,
        takeProfit,            // Set TP
        tpTriggerBy: 'LastPrice', // You can also use 'MarkPrice' or 'IndexPrice'
      });
  
      console.log(`✅ Trade submitted: ${side} ${qty} ${symbol} with TP at ${takeProfit}`);
      return order.result;
    } catch (err) {
      console.error('❌ Error submitting trade with TP:', err);
      throw err;
    }
  }

export {
    restClient,
    getWalletBalance,
    closePosition,
    calculateQty,
    submitTradeWithTP,
}