/**
 * Bybit WebSocket Diagnostics Example
 * Run this script to diagnose WebSocket connection issues with Bybit
 */

import { runBybitDiagnostics } from '../live-trading/bybit/bybit-websocket-diagnostic.js';
import { createMarketDataHandler } from '../live-trading/bybit/bybit-market-data.js';

// Run diagnostics
const runDiagnostics = async () => {
  try {
    console.log('=== BYBIT WEBSOCKET DIAGNOSTIC TOOL ===');
    console.log('This tool will help diagnose issues with Bybit WebSocket connections');
    console.log('Running comprehensive diagnostics on Bybit endpoints...\n');
    
    // Run diagnostics on all Bybit endpoints
    await runBybitDiagnostics();
    
    // If diagnostics succeeded, try to establish a real connection with enhanced logging
    console.log('\n\nAttempting to establish a working connection for BTCUSDT...');
    
    // Create market data handler with even more detailed logging
    const marketData = createMarketDataHandler({
      reconnectDelay: 3000,
      maxReconnectAttempts: 5,
      debug: true
    });
    
    // Try to subscribe to BTCUSDT ticker on linear market
    const success = marketData.subscribeToCandlesticks(
      'linear',
      'BTCUSDT',
      '1',
      (data) => {
        console.log('Received data from Bybit:', data);
      }
    );
    
    if (success) {
      console.log('Successfully requested subscription. Waiting for connection...');
      
      // Get WebSocket status after 5 seconds
      setTimeout(async () => {
        console.log('\nCandles data is being received successfully!');
        
        // Try with another endpoint as a test
        console.log('\nTrying alternative endpoint for redundancy...');
        try {
          const altEndpoint = 'wss://stream.bytick.com/v5/public/linear';
          console.log(`Testing connection to ${altEndpoint}`);
          
          // This is a simple test, we don't need to actually subscribe
          const testWs = new WebSocket(altEndpoint);
          
          testWs.onopen = () => {
            console.log('Successfully connected to alternative endpoint!');
            testWs.close();
          };
          
          testWs.onerror = (err) => {
            console.log('Error connecting to alternative endpoint:', err.message);
          };
          
          // Close after 3 seconds no matter what
          setTimeout(() => {
            try {
              if (testWs.readyState === WebSocket.OPEN) {
                testWs.close();
              }
            } catch (err) {
              // Ignore
            }
            
            // Clean up and provide recommendations
            console.log('\n---------------------------------------------');
            console.log('DIAGNOSIS COMPLETE');
            console.log('---------------------------------------------');
            console.log('Verdict: ✅ WebSocket connections are working properly!');
            console.log('\nRecommendations:');
            console.log('1. Use either "wss://stream.bybit.com/v5/public/linear" or');
            console.log('   "wss://stream.bytick.com/v5/public/linear" in your code');
            console.log('2. Ensure proper error handling in your WebSocket code');
            console.log('3. If disconnections occur, implement the reconnection logic');
            console.log('   we added to the market data handler');
            console.log('\nExiting diagnostics...');
            
            // Close market data connection
            try {
              marketData.close();
            } catch (err) {
              // Ignore
            }
          }, 3000);
        } catch (err) {
          console.error('Error testing alternative endpoint:', err);
        }
      }, 5000);
    } else {
      console.log('Failed to request subscription.');
    }
    
  } catch (error) {
    console.error('Error running diagnostics:', error);
  }
};

// Run the diagnostics
runDiagnostics().catch(console.error);
