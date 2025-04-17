import { restClient } from './client.js'

async function getTradingStats(symbol = 'BTCUSDT') {
    try {
      // Get Position Info
      const positionRes = await restClient.getPositionInfo({
        category: 'linear',
        symbol,
      });
  
      const position = positionRes.result.list[0]; // for the given symbol
  
      return {
        positionStats: {
          symbol: position.symbol,
          side: position.side,
          
          size: position.size,
          entryPrice: position.entryPrice,
          takeProfit: position.takeProfit,

          leverage: position.leverage,
          liqPrice: position.liqPrice,
        }
      };
  
    } catch (err) {
      console.error('❌ Failed to fetch position stats:', err);
      throw err;
    }
  }
  
  export {
    getTradingStats
  }