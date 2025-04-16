/**
 * Bybit WebSocket Diagnostics 
 * Tools for diagnosing WebSocket connection issues
 */

import WebSocket from 'ws';
import dns from 'dns';
import { promisify } from 'util';
import http from 'http';
import https from 'https';

// Convert DNS functions to promise-based
const lookup = promisify(dns.lookup);
const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

/**
 * Class for diagnosing WebSocket connection issues
 */
class WebSocketDiagnostics {
  /**
   * Create a new diagnostics instance
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = {
      timeout: 10000,
      retries: 3,
      ...options
    };
  }

  /**
   * Run a complete diagnostics suite
   * @param {string} url - WebSocket URL to test
   * @returns {Object} - Diagnostics results
   */
  async runDiagnostics(url) {
    console.log(`=== WEBSOCKET DIAGNOSTICS FOR ${url} ===`);
    
    const results = {
      url,
      timestamp: new Date().toISOString(),
      dns: await this.checkDNS(url),
      http: await this.checkHTTP(url),
      websocket: await this.checkWebSocket(url),
      environment: this.getEnvironmentInfo()
    };
    
    // Print summary
    console.log(`\nDiagnostics Summary for ${url}:`);
    console.log(`- DNS Resolution: ${results.dns.success ? '✅ Success' : '❌ Failed'}`);
    console.log(`- HTTP Endpoint: ${results.http.success ? '✅ Success' : '❌ Failed'}`);
    console.log(`- WebSocket Connection: ${results.websocket.success ? '✅ Success' : '❌ Failed'}`);
    console.log(`- Environment: Node.js ${process.version}`);
    
    if (!results.dns.success) {
      console.log(`\nDNS Issue: ${results.dns.error}`);
      console.log(`Recommendation: Check network connectivity and DNS servers`);
    }
    
    if (!results.http.success) {
      console.log(`\nHTTP Issue: ${results.http.error}`);
      console.log(`Recommendation: Check firewalls, proxies, or network restrictions`);
    }
    
    if (!results.websocket.success) {
      console.log(`\nWebSocket Issue: ${results.websocket.error}`);
      console.log(`Recommendation: ${this.getRecommendation(results)}`);
    }
    
    console.log('\n=== END OF DIAGNOSTICS ===');
    
    return results;
  }
  
  /**
   * Check DNS resolution for a WebSocket URL
   * @param {string} url - WebSocket URL to test
   * @returns {Object} - DNS check results
   */
  async checkDNS(url) {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      
      console.log(`\n[DNS] Checking hostname: ${hostname}`);
      
      // Try IPv4 resolution
      let ipv4Results;
      try {
        ipv4Results = await resolve4(hostname);
        console.log(`[DNS] IPv4 addresses: ${ipv4Results.join(', ')}`);
      } catch (error) {
        console.log(`[DNS] IPv4 resolution failed: ${error.message}`);
        ipv4Results = null;
      }
      
      // Try IPv6 resolution
      let ipv6Results;
      try {
        ipv6Results = await resolve6(hostname);
        console.log(`[DNS] IPv6 addresses: ${ipv6Results.join(', ')}`);
      } catch (error) {
        console.log(`[DNS] IPv6 resolution failed: ${error.message}`);
        ipv6Results = null;
      }
      
      // Try default lookup (system preference)
      let defaultLookup;
      try {
        defaultLookup = await lookup(hostname);
        console.log(`[DNS] Default lookup: ${defaultLookup.address} (${defaultLookup.family === 6 ? 'IPv6' : 'IPv4'})`);
      } catch (error) {
        console.log(`[DNS] Default lookup failed: ${error.message}`);
        defaultLookup = null;
      }
      
      // Check if at least one resolution method succeeded
      const success = ipv4Results !== null || ipv6Results !== null;
      
      return {
        success,
        hostname,
        ipv4: ipv4Results,
        ipv6: ipv6Results,
        default: defaultLookup,
        error: success ? null : 'Failed to resolve hostname using both IPv4 and IPv6'
      };
    } catch (error) {
      console.error(`[DNS] Error in DNS check:`, error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Check HTTP endpoint accessibility 
   * @param {string} wsUrl - WebSocket URL to test
   * @returns {Object} - HTTP check results
   */
  async checkHTTP(wsUrl) {
    try {
      // Convert WebSocket URL to HTTP(S) URL
      const httpUrl = wsUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
      const parsedUrl = new URL(httpUrl);
      
      // We'll use the hostname part to check general HTTP connectivity
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}`;
      
      console.log(`\n[HTTP] Checking HTTP connectivity to ${baseUrl}`);
      
      // Create a promise with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Request timed out after ${this.options.timeout}ms`)), this.options.timeout);
      });
      
      const requestPromise = new Promise((resolve, reject) => {
        const client = baseUrl.startsWith('https') ? https : http;
        
        client.get(baseUrl, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            console.log(`[HTTP] Response status: ${res.statusCode}`);
            
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: data.substring(0, 100) + (data.length > 100 ? '...' : '')
            });
          });
        }).on('error', (err) => {
          reject(err);
        });
      });
      
      // Race between timeout and request
      const response = await Promise.race([requestPromise, timeoutPromise]);
      
      return {
        success: true,
        url: baseUrl,
        response
      };
    } catch (error) {
      console.error(`[HTTP] Error in HTTP check:`, error.message);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Check WebSocket connectivity
   * @param {string} url - WebSocket URL to test
   * @returns {Object} - WebSocket check results
   */
  async checkWebSocket(url) {
    let attemptCount = 0;
    
    while (attemptCount < this.options.retries) {
      attemptCount++;
      console.log(`\n[WS] Attempting WebSocket connection to ${url} (attempt ${attemptCount}/${this.options.retries})`);
      
      try {
        // Create a promise with timeout for WebSocket connection
        const result = await Promise.race([
          this.attemptWebSocketConnection(url),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Connection timed out after ${this.options.timeout}ms`)), this.options.timeout);
          })
        ]);
        
        // If we get here, connection succeeded
        return {
          success: true,
          url,
          result
        };
      } catch (error) {
        console.error(`[WS] Connection attempt ${attemptCount} failed: ${error.message}`);
        
        // Wait before next attempt
        if (attemptCount < this.options.retries) {
          console.log(`[WS] Waiting 2 seconds before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    // All attempts failed
    return {
      success: false,
      url,
      error: `Failed to connect after ${this.options.retries} attempts`
    };
  }
  
  /**
   * Attempt a WebSocket connection
   * @param {string} url - WebSocket URL
   * @returns {Promise<Object>} - Connection result
   */
  attemptWebSocketConnection(url) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[WS] Creating WebSocket instance...`);
        const ws = new WebSocket(url);
        
        // Connection timeout
        const timeout = setTimeout(() => {
          console.log(`[WS] Connection timeout`);
          ws.terminate();
          reject(new Error('Connection timeout'));
        }, this.options.timeout);
        
        // Log state changes
        let initialState = ws.readyState;
        console.log(`[WS] Initial state: ${this.getReadyStateString(initialState)}`);
        
        // Track if we've received a message
        let messageReceived = false;
        
        ws.on('error', (err) => {
          clearTimeout(timeout);
          console.error(`[WS] Connection error: ${err.message}`);
          reject(err);
        });
        
        ws.on('open', () => {
          clearTimeout(timeout);
          console.log(`[WS] Connection opened successfully`);
          
          // Try sending a simple message
          try {
            console.log(`[WS] Sending ping message...`);
            ws.send(JSON.stringify({ op: 'ping' }));
          } catch (err) {
            console.error(`[WS] Error sending ping: ${err.message}`);
          }
          
          // Setup message handler
          const messageTimeout = setTimeout(() => {
            if (!messageReceived) {
              console.log(`[WS] No response received to ping`);
              ws.terminate();
              resolve({
                connected: true,
                exchanged: false,
                message: 'Connection opened but no response to ping'
              });
            }
          }, 5000);
          
          ws.on('message', (data) => {
            messageReceived = true;
            clearTimeout(messageTimeout);
            
            console.log(`[WS] Received response: ${data.toString().substring(0, 100)}`);
            
            // Close the connection after receiving a message
            ws.close();
            
            resolve({
              connected: true,
              exchanged: true,
              response: data.toString()
            });
          });
          
          // After 5 seconds, resolve even if no message received
          setTimeout(() => {
            if (!messageReceived) {
              console.log(`[WS] Closing connection after timeout`);
              try {
                ws.close();
              } catch (err) {
                console.error(`[WS] Error closing connection: ${err.message}`);
              }
            }
          }, 5000);
        });
        
        ws.on('close', (code, reason) => {
          clearTimeout(timeout);
          console.log(`[WS] Connection closed with code ${code}${reason ? ': ' + reason : ''}`);
          
          // If we closed after successful message exchange, this is fine
          if (messageReceived) return;
          
          // Otherwise, consider it a failure
          reject(new Error(`Connection closed prematurely with code ${code}`));
        });
        
      } catch (error) {
        console.error(`[WS] Error creating WebSocket: ${error.message}`);
        reject(error);
      }
    });
  }
  
  /**
   * Get a string representation of WebSocket ready state
   * @param {number} state - WebSocket ready state
   * @returns {string} - Ready state description
   */
  getReadyStateString(state) {
    const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    return states[state] || `UNKNOWN (${state})`;
  }
  
  /**
   * Get a recommendation based on diagnostic results
   * @param {Object} results - Diagnostic results
   * @returns {string} - Recommendation
   */
  getRecommendation(results) {
    if (!results.dns.success) {
      return 'Check your DNS settings or try using direct IP addresses in hosts file';
    }
    
    if (!results.http.success) {
      return 'Check if your network allows outbound WebSocket connections (port 443). Try connecting through a different network or VPN';
    }
    
    if (results.dns.ipv6 && !results.dns.ipv4) {
      return 'The server only has IPv6 addresses. Try disabling IPv6 in your network settings or forcibly using IPv4';
    }
    
    return 'Try using alternative WebSocket endpoints or check for firewall restrictions on WebSocket connections';
  }
  
  /**
   * Get information about the current environment
   * @returns {Object} - Environment information
   */
  getEnvironmentInfo() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      v8Version: process.versions.v8,
      ipPreference: dns.getDefaultResultOrder?.() || 'unknown'
    };
  }
}

/**
 * Run diagnostics on Bybit WebSocket endpoints
 */
export const runBybitDiagnostics = async () => {
  const diagnostics = new WebSocketDiagnostics();
  
  console.log('Starting Bybit WebSocket diagnostics...\n');
  
  const endpoints = [
    'wss://stream.bybit.com/v5/public/linear',
    'wss://stream-mainnet.bybit.com/v5/public/linear',
    'wss://stream.bytick.com/v5/public/linear'
  ];
  
  const results = [];
  
  for (const endpoint of endpoints) {
    console.log(`\n\n=======================================`);
    console.log(`TESTING ENDPOINT: ${endpoint}`);
    console.log(`=======================================\n`);
    
    const result = await diagnostics.runDiagnostics(endpoint);
    results.push(result);
  }
  
  // Print overall summary
  console.log('\n\n=== OVERALL DIAGNOSTICS SUMMARY ===');
  
  let successCount = 0;
  results.forEach((result, index) => {
    const endpoint = endpoints[index];
    const success = result.websocket.success;
    
    console.log(`${success ? '✅' : '❌'} ${endpoint}: ${success ? 'WORKING' : 'FAILED'}`);
    
    if (success) successCount++;
  });
  
  if (successCount === 0) {
    console.log('\n❌ All endpoints failed. This indicates a network or system configuration issue.');
    console.log('Recommendations:');
    console.log('1. Check your firewall settings for outbound WebSocket connections');
    console.log('2. Try connecting from a different network');
    console.log('3. Check if your ISP might be blocking WebSocket connections');
    console.log('4. Try setting up a host file entry with IPv4 addresses for stream.bybit.com');
  } else {
    console.log(`\n✅ ${successCount} out of ${endpoints.length} endpoints working.`);
    
    if (successCount < endpoints.length) {
      console.log('To fix failing endpoints, update the WebSocket URL in your code to use a working endpoint.');
    }
  }
  
  return results;
};

export default WebSocketDiagnostics;
        