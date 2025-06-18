/**
 * Integration Example: Enhanced Rate Limiting in FAQ Answer Generator Worker
 * 
 * This shows how to integrate the enhanced rate limiting system into any worker
 */

import { createRateLimiter } from './rate-limiter.js';

export default {
  async fetch(request, env, ctx) {
    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
      'Access-Control-Max-Age': '86400'
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check endpoint
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'faq-answer-generator-worker',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          model: '@cf/meta/llama-3.1-8b-instruct',
          features: ['answer_generation', 'enhanced_rate_limiting', 'ip_management'],
          rate_limits: {
            hourly: 20,
            daily: 100,
            weekly: 500,
            monthly: 2000
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Only accept POST requests for main functionality
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), { 
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const requestStartTime = Date.now();

    try {
      // Get client IP
      const clientIP = request.headers.get('CF-Connecting-IP') || 
                      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 
                      request.headers.get('X-Real-IP') || 
                      'unknown';

      console.log(`[Main Handler] Processing request from IP: ${clientIP}`);

      // Initialize enhanced rate limiter with worker-specific config
      const rateLimiter = createRateLimiter(env, 'faq-answer-generator', {
        limits: {
          hourly: 20,    // 20 AI requests per hour
          daily: 100,    // 100 AI requests per day  
          weekly: 500,   // 500 AI requests per week
          monthly: 2000  // 2000 AI requests per month
        },
        violations: {
          soft_threshold: 2,    // Warning after 2 violations
          hard_threshold: 4,    // Block after 4 violations
          ban_threshold: 8      // Permanent ban after 8 violations
        }
      });

      // Check rate limiting BEFORE processing request
      const rateLimitResult = await rateLimiter.checkRateLimit(clientIP, request, 'faq-answer-generator');
      
      console.log(`[Rate Limiting] Check completed in ${rateLimitResult.duration}s - Allowed: ${rateLimitResult.allowed}`);

      if (!rateLimitResult.allowed) {
        console.warn(`[Rate Limiting] Request blocked for IP ${clientIP} - Reason: ${rateLimitResult.reason}`);
        
        // Return appropriate error response based on reason
        let statusCode = 429;
        let errorMessage = 'Rate limit exceeded';
        
        switch (rateLimitResult.reason) {
          case 'IP_BLACKLISTED':
            statusCode = 403;
            errorMessage = 'Access denied - IP address is blacklisted';
            break;
          case 'GEO_RESTRICTED':
            statusCode = 403;
            errorMessage = `Access denied - Geographic restrictions apply (${rateLimitResult.country})`;
            break;
          case 'TEMPORARILY_BLOCKED':
            statusCode = 429;
            errorMessage = `Temporarily blocked due to violations. Try again in ${Math.ceil(rateLimitResult.remaining_time / 60)} minutes`;
            break;
          case 'RATE_LIMIT_EXCEEDED':
            statusCode = 429;
            errorMessage = 'Rate limit exceeded. Please try again later';
            break;
        }

        return new Response(JSON.stringify({
          error: errorMessage,
          rateLimited: true,
          reason: rateLimitResult.reason,
          usage: rateLimitResult.usage,
          limits: rateLimitResult.limits,
          reset_times: rateLimitResult.reset_times,
          block_expires: rateLimitResult.block_expires,
          remaining_time: rateLimitResult.remaining_time
        }), {
          status: statusCode,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Parse request body
      const requestData = await request.json();
      const { 
        question,
        answers = [],
        mode = 'generate',
        tone = 'professional',
        websiteContext = '',
        pageUrl = '',
        forceRefresh = false,
        cacheBypass = null
      } = requestData;

      console.log(`[Main Handler] Starting ${mode} request for question: "${question?.substring(0, 50)}..."`);

      // Validate input
      if (!question || typeof question !== 'string') {
        console.error(`[Main Handler] Validation failed: No question provided`);
        return new Response(JSON.stringify({
          error: 'Question is required for answer generation',
          contextual: true
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Process the AI request here...
      // [AI processing code would go here]
      
      // For demonstration, we'll simulate AI processing
      const aiProcessingStartTime = Date.now();
      
      // Simulate AI call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const mockResponse = {
        success: true,
        mode: mode,
        contextual: true,
        suggestions: [
          {
            text: `Generated answer for: ${question}`,
            benefit: 'AI-powered response',
            reason: 'Provides comprehensive information',
            type: 'generated'
          }
        ],
        metadata: {
          model: '@cf/meta/llama-3.1-8b-instruct',
          neurons_used: 2,
          context_applied: websiteContext ? true : false,
          page_url_provided: pageUrl ? true : false,
          grammar_checked: true,
          cached: false,
          timestamp: new Date().toISOString(),
          rate_limit: {
            used: (rateLimitResult.usage?.daily || 0) + 1,
            limits: rateLimitResult.limits,
            remaining: rateLimitResult.limits?.daily - (rateLimitResult.usage?.daily || 0) - 1
          },
          performance: {
            total_duration: ((Date.now() - requestStartTime) / 1000).toFixed(2),
            rate_limit_check: rateLimitResult.duration,
            ai_processing: ((Date.now() - aiProcessingStartTime) / 1000).toFixed(2)
          }
        }
      };

      // Update usage count AFTER successful AI processing
      await rateLimiter.updateUsageCount(clientIP, 'faq-answer-generator');
      console.log(`[Rate Limiting] Updated usage count for IP ${clientIP}`);

      const totalDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
      console.log(`[Main Handler] Request completed successfully in ${totalDuration}s`);

      return new Response(JSON.stringify(mockResponse), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      const errorDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
      console.error(`[Main Handler] CRITICAL ERROR after ${errorDuration}s:`, error);
      
      return new Response(JSON.stringify({
        error: 'AI processing failed',
        details: error.message,
        contextual: true,
        fallback: true,
        debug: {
          error_type: 'PROCESSING_ERROR',
          duration: errorDuration,
          timestamp: new Date().toISOString()
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Admin endpoint for managing rate limits
 * Usage: POST to /admin with admin_key in headers
 */
export async function handleAdminRequest(request, env) {
  // Verify admin key
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { action, ip, reason, added_by } = await request.json();
  const rateLimiter = createRateLimiter(env, 'admin');

  switch (action) {
    case 'whitelist_add':
      const whitelistResult = await rateLimiter.addToWhitelist(ip, reason, added_by);
      return new Response(JSON.stringify(whitelistResult), {
        headers: { 'Content-Type': 'application/json' }
      });

    case 'blacklist_remove':
      const blacklistResult = await rateLimiter.removeFromBlacklist(ip);
      return new Response(JSON.stringify(blacklistResult), {
        headers: { 'Content-Type': 'application/json' }
      });

    case 'clear_blocks':
      const clearResult = await rateLimiter.clearBlocks(ip);
      return new Response(JSON.stringify(clearResult), {
        headers: { 'Content-Type': 'application/json' }
      });

    case 'get_analytics':
      const analytics = await rateLimiter.getAnalytics('daily');
      return new Response(JSON.stringify(analytics), {
        headers: { 'Content-Type': 'application/json' }
      });

    default:
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
  }
}