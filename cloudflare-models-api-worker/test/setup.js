/**
 * Test setup file for Cloudflare Models API Worker
 * 
 * Sets up the test environment with proper mocks and configurations
 * 
 * @version 1.0.0
 * @author 365i Development Team
 */

// Set up environment variables for testing
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
process.env.CLOUDFLARE_API_TOKEN = 'test-api-token';
process.env.WORKER_VERSION = '1.0.0';
process.env.CACHE_TTL = '300';

// Global test configuration
global.console = {
  ...console,
  // Mock console.error to avoid cluttering test output
  error: () => {},
  log: console.log,
  warn: console.warn,
  info: console.info
};

// Mock fetch globally for consistent testing
if (!global.fetch) {
  global.fetch = async (url, options) => {
    // Default mock response
    return new Response(JSON.stringify({
      success: true,
      result: []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}