/**
 * Dynamic Rate Limiter Worker - WordPress Integration
 *
 * Uses dynamic configuration from WordPress admin settings
 * Designed to stay within Cloudflare free tier limits
 *
 * Features:
 * - Dynamic configuration from WordPress settings
 * - Sliding window rate limiting
 * - Batched writes to conserve KV write quota
 * - In-memory cache to reduce KV reads
 * - Fail-open behavior for reliability
 *
 * @author 365i AI FAQ Generator System
 * @version 4.0.0 - WordPress Dynamic Configuration
 * @since 2025-06-25
 */

import { loadWordPressSettings, loadGlobalSettings } from './dynamic-config.js';

// In-memory cache to reduce KV reads (resets when worker restarts)
const rateLimitCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

// Batch write queue to conserve KV writes
const writeQueue = new Map();
let writeTimer = null;

// Configuration cache to avoid loading settings on every request
let configCache = null;
let configCacheTime = 0;
const CONFIG_CACHE_TTL = 300000; // 5 minutes

export default {
  async fetch(request, env, ctx) {
    try {
      // Extract client IP
      const clientIP = request.headers.get('CF-Connecting-IP') ||
                      request.headers.get('X-Forwarded-For')?.split(',')[0] ||
                      '127.0.0.1';
      
      // Load dynamic configuration
      const config = await loadDynamicConfig(env);
      
      // Check if rate limiting is enabled
      if (!config.enabled) {
        console.log('[Rate Limiter] Rate limiting disabled, allowing request');
        return new Response(JSON.stringify({
          message: 'Rate limiting disabled - request allowed',
          enabled: false
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Check rate limit
      const rateLimitResult = await checkRateLimit(env, clientIP, config);
      
      if (!rateLimitResult.allowed) {
        return new Response('Rate limit exceeded', {
          status: 429,
          headers: {
            'Retry-After': rateLimitResult.retryAfter.toString(),
            'X-RateLimit-Limit': config.limit.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimitResult.resetTime.toString(),
            'X-Config-Source': config.source || 'unknown'
          }
        });
      }
      
      // Process the actual request here
      // For this example, we'll just return success
      return new Response(JSON.stringify({
        message: 'Request allowed',
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime,
        config: {
          source: config.source,
          enabled: config.enabled,
          limit: config.limit
        }
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': config.limit.toString(),
          'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
          'X-RateLimit-Reset': rateLimitResult.resetTime.toString(),
          'X-Config-Source': config.source || 'unknown'
        }
      });
      
    } catch (error) {
      console.error('Rate limiter error:', error);
      // Fail open - don't block requests if rate limiter fails
      return new Response(JSON.stringify({
        message: 'Internal error - request allowed (fail-open)',
        error: error.message,
        allowed: true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Load dynamic configuration with caching
 * @param {Object} env - Cloudflare environment
 * @returns {Object} Rate limiting configuration
 */
async function loadDynamicConfig(env) {
  const now = Date.now();
  
  // Check if we have cached config that's still valid
  if (configCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache;
  }
  
  try {
    // Try to load WordPress settings first
    const wordpressSettings = await loadWordPressSettings(env);
    
    if (wordpressSettings && wordpressSettings.enableRateLimiting !== undefined) {
      configCache = {
        enabled: wordpressSettings.enableRateLimiting,
        limit: wordpressSettings.requestsPerHour || 100,
        window: wordpressSettings.timeWindowSeconds || 3600,
        blockDuration: wordpressSettings.blockDurationSeconds || 3600,
        source: 'wordpress',
        lastUpdated: wordpressSettings.lastUpdated
      };
      
      configCacheTime = now;
      console.log('[Rate Limiter] Loaded WordPress configuration:', {
        enabled: configCache.enabled,
        limit: configCache.limit,
        source: configCache.source
      });
      
      return configCache;
    }
    
    // Fallback to global settings
    const globalSettings = await loadGlobalSettings(env);
    
    if (globalSettings) {
      configCache = {
        enabled: globalSettings.enableRateLimiting !== false,
        limit: globalSettings.requestsPerHour || 100,
        window: globalSettings.timeWindowSeconds || 3600,
        blockDuration: globalSettings.blockDurationSeconds || 3600,
        source: globalSettings.source || 'global',
        lastUpdated: globalSettings.lastUpdated
      };
      
      configCacheTime = now;
      console.log('[Rate Limiter] Loaded global configuration:', {
        enabled: configCache.enabled,
        limit: configCache.limit,
        source: configCache.source
      });
      
      return configCache;
    }
    
    // Final fallback to safe defaults
    configCache = {
      enabled: true,
      limit: 50, // Conservative default
      window: 3600,
      blockDuration: 3600,
      source: 'fallback',
      lastUpdated: new Date().toISOString()
    };
    
    configCacheTime = now;
    console.log('[Rate Limiter] Using fallback configuration');
    
    return configCache;
    
  } catch (error) {
    console.error('[Rate Limiter] Error loading configuration:', error.message);
    
    // Emergency fallback
    configCache = {
      enabled: true,
      limit: 10, // Very conservative emergency default
      window: 3600,
      blockDuration: 3600,
      source: 'emergency',
      error: error.message
    };
    
    configCacheTime = now;
    return configCache;
  }
}

/**
 * Check rate limit for an IP with minimal KV operations using dynamic configuration
 */
async function checkRateLimit(env, clientIP, config) {
  const now = Date.now();
  const windowStart = now - (config.window * 1000);
  
  // Check in-memory cache first
  const cached = getCachedLimit(clientIP, now);
  if (cached && cached.blocked) {
    return {
      allowed: false,
      retryAfter: Math.ceil((cached.blockedUntil - now) / 1000),
      resetTime: cached.blockedUntil
    };
  }
  
  // Use batched approach - read once per window
  const key = `rl:${clientIP}`;
  let data;
  
  try {
    // This counts as 1 KV read - use FAQ_RATE_LIMITS instead of RATE_LIMITER
    const stored = await env.FAQ_RATE_LIMITS?.get(key, { type: 'json' });
    data = stored || { requests: [], blockedUntil: 0 };
  } catch (error) {
    console.error('KV read error:', error);
    // Fail open
    return { allowed: true, remaining: config.limit, resetTime: now + config.window * 1000 };
  }
  
  // Check if currently blocked
  if (data.blockedUntil > now) {
    // Update cache
    updateCache(clientIP, {
      blocked: true,
      blockedUntil: data.blockedUntil,
      count: config.limit
    });
    
    return {
      allowed: false,
      retryAfter: Math.ceil((data.blockedUntil - now) / 1000),
      resetTime: data.blockedUntil
    };
  }
  
  // Clean old requests outside current window
  data.requests = data.requests.filter(timestamp => timestamp > windowStart);
  
  // Check if limit exceeded
  if (data.requests.length >= config.limit) {
    // Block the IP
    data.blockedUntil = now + (config.blockDuration * 1000);
    data.requests = []; // Clear requests when blocking
    
    // Queue write instead of immediate write
    queueWrite(env, key, data);
    
    // Update cache
    updateCache(clientIP, {
      blocked: true,
      blockedUntil: data.blockedUntil,
      count: config.limit
    });
    
    console.log(`[Rate Limiter] Blocked IP ${clientIP} for ${config.blockDuration}s (limit: ${config.limit})`);
    
    return {
      allowed: false,
      retryAfter: config.blockDuration,
      resetTime: data.blockedUntil
    };
  }
  
  // Add current request
  data.requests.push(now);
  
  // Queue write instead of immediate write
  queueWrite(env, key, data);
  
  // Update cache
  updateCache(clientIP, {
    blocked: false,
    count: data.requests.length,
    resetTime: now + config.window * 1000
  });
  
  return {
    allowed: true,
    remaining: config.limit - data.requests.length,
    resetTime: now + config.window * 1000
  };
}

/**
 * Get cached rate limit data
 */
function getCachedLimit(clientIP, now) {
  const cached = rateLimitCache.get(clientIP);
  if (!cached) return null;
  
  // Check if cache is still valid
  if (now - cached.timestamp > CACHE_TTL) {
    rateLimitCache.delete(clientIP);
    return null;
  }
  
  return cached;
}

/**
 * Update in-memory cache
 */
function updateCache(clientIP, data) {
  rateLimitCache.set(clientIP, {
    ...data,
    timestamp: Date.now()
  });
  
  // Prevent cache from growing too large
  if (rateLimitCache.size > 10000) {
    // Remove oldest entries
    const entries = Array.from(rateLimitCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    // Remove oldest 20%
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      rateLimitCache.delete(entries[i][0]);
    }
  }
}

/**
 * Queue KV write to batch operations
 */
function queueWrite(env, key, data) {
  writeQueue.set(key, {
    data,
    timestamp: Date.now()
  });
  
  // If no timer is running, start one
  if (!writeTimer) {
    writeTimer = setTimeout(() => {
      flushWriteQueue(env);
    }, 5000); // Flush every 5 seconds
  }
  
  // Force flush if queue is getting large (to stay under memory limits)
  if (writeQueue.size >= 50) {
    clearTimeout(writeTimer);
    flushWriteQueue(env);
  }
}

/**
 * Flush batched writes to KV
 */
async function flushWriteQueue(env) {
  if (writeQueue.size === 0) {
    writeTimer = null;
    return;
  }
  
  console.log(`Flushing ${writeQueue.size} writes to KV`);
  
  // Process writes
  const writes = Array.from(writeQueue.entries());
  writeQueue.clear();
  writeTimer = null;
  
  // Batch write using Promise.all (still counts as individual writes for quota)
  const writePromises = writes.map(([key, item]) => {
    // Set expiration to clean up old data automatically
    const ttl = 7200; // 2 hours
    // Use FAQ_RATE_LIMITS instead of RATE_LIMITER
    return env.FAQ_RATE_LIMITS?.put(key, JSON.stringify(item.data), { expirationTtl: ttl });
  });
  
  try {
    await Promise.all(writePromises);
    console.log(`Successfully wrote ${writes.length} items to KV`);
  } catch (error) {
    console.error('Batch write error:', error);
    // Could implement retry logic here if needed
  }
}

/**
 * Alternative: Ultra-Low-Cost Probabilistic Rate Limiter with Dynamic Configuration
 *
 * This implementation uses even fewer KV operations by only
 * checking/updating rate limits probabilistically
 */
export async function probabilisticRateLimit(env, clientIP, config) {
  const now = Date.now();
  const key = `prl:${clientIP}`;
  
  // Only check KV storage 10% of the time (configurable)
  const checkProbability = 0.1;
  if (Math.random() > checkProbability) {
    // 90% of requests skip KV entirely!
    return { allowed: true, remaining: '~', resetTime: now + config.window * 1000 };
  }
  
  // For the 10% we do check, enforce strictly
  try {
    const data = await env.FAQ_RATE_LIMITS?.get(key, { type: 'json' });
    
    if (data && data.blockedUntil > now) {
      // Definitely blocked
      return {
        allowed: false,
        retryAfter: Math.ceil((data.blockedUntil - now) / 1000),
        resetTime: data.blockedUntil
      };
    }
    
    // Increment counter
    const count = (data?.count || 0) + 10; // Multiply by 1/probability
    
    if (count > config.limit) {
      // Block them
      await env.FAQ_RATE_LIMITS?.put(key, JSON.stringify({
        count: 0,
        blockedUntil: now + config.blockDuration * 1000
      }), { expirationTtl: config.blockDuration });
      
      console.log(`[Probabilistic Rate Limiter] Blocked IP ${clientIP} for ${config.blockDuration}s (limit: ${config.limit})`);
      
      return {
        allowed: false,
        retryAfter: config.blockDuration,
        resetTime: now + config.blockDuration * 1000
      };
    }
    
    // Update count
    await env.FAQ_RATE_LIMITS?.put(key, JSON.stringify({
      count,
      blockedUntil: 0
    }), { expirationTtl: config.window });
    
    return {
      allowed: true,
      remaining: Math.max(0, config.limit - count),
      resetTime: now + config.window * 1000
    };
    
  } catch (error) {
    console.error('Probabilistic rate limit error:', error);
    // Fail open
    return { allowed: true, remaining: '~', resetTime: now + config.window * 1000 };
  }
}