/**
 * Rate Limiter Worker - Main Entry Point
 * 
 * This worker handles incoming HTTP requests and routes them to the appropriate
 * RateLimiterDO Durable Object instances based on client IP address.
 * 
 * Features:
 * - Automatic IP-based Durable Object instance routing
 * - Comprehensive error handling and logging
 * - Support for all RateLimiterDO operations
 * - CORS handling for cross-origin requests
 * - Request validation and sanitization
 * 
 * @author 365i AI FAQ Generator System
 * @version 1.0.0
 * @since 2025-06-24
 */

import { RateLimiterDO } from './RateLimiterDO.js';

/**
 * Main Worker Export
 * 
 * Handles incoming requests and routes them to appropriate Durable Object instances
 */
export default {
  /**
   * Handle incoming HTTP requests
   * 
   * @param {Request} request - Incoming HTTP request
   * @param {Object} env - Environment bindings including RATE_LIMITER_DO
   * @param {Object} ctx - Execution context
   * @returns {Promise<Response>} HTTP response
   */
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    
    try {
      // Handle CORS preflight requests
      if (request.method === 'OPTIONS') {
        return handleCORS();
      }
      
      // Extract client IP for Durable Object instance routing
      const clientIP = getClientIP(request);
      
      // Get the Durable Object instance for this client IP
      const durableObjectId = env.RATE_LIMITER_DO.idFromName(clientIP);
      const durableObject = env.RATE_LIMITER_DO.get(durableObjectId);
      
      // Log the request
      console.log(`[RateLimiter Worker] Request from IP: ${clientIP}, Method: ${request.method}, URL: ${request.url}`);
      
      // Forward the request to the Durable Object
      const response = await durableObject.fetch(request);
      
      // Add CORS headers to the response
      const corsResponse = addCORSHeaders(response);
      
      // Log the response
      const duration = Date.now() - startTime;
      console.log(`[RateLimiter Worker] Response sent in ${duration}ms, Status: ${corsResponse.status}`);
      
      return corsResponse;
      
    } catch (error) {
      console.error(`[RateLimiter Worker] Error processing request:`, error);
      
      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        timestamp: Date.now()
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }
  }
};

/**
 * Extract client IP address from request
 * 
 * @param {Request} request - HTTP request
 * @returns {string} Client IP address
 */
function getClientIP(request) {
  // Try multiple headers to get the real client IP
  const cfConnectingIP = request.headers.get('CF-Connecting-IP');
  const xForwardedFor = request.headers.get('X-Forwarded-For');
  const xRealIP = request.headers.get('X-Real-IP');
  
  // Use CF-Connecting-IP if available (most reliable on Cloudflare)
  if (cfConnectingIP) {
    return cfConnectingIP;
  }
  
  // Parse X-Forwarded-For header (comma-separated list, first IP is usually the client)
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    return ips[0];
  }
  
  // Use X-Real-IP if available
  if (xRealIP) {
    return xRealIP;
  }
  
  // Fallback to a default IP if none found (shouldn't happen on Cloudflare)
  return '127.0.0.1';
}

/**
 * Handle CORS preflight requests
 * 
 * @returns {Response} CORS preflight response
 */
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400' // 24 hours
    }
  });
}

/**
 * Add CORS headers to response
 * 
 * @param {Response} response - Original response
 * @returns {Response} Response with CORS headers
 */
function addCORSHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

// Export the Durable Object class for Cloudflare Workers runtime
export { RateLimiterDO };