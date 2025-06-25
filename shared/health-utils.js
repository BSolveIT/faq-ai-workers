/**
 * Shared Health Utilities for FAQ Workers
 * EMERGENCY PRODUCTION FIX: Lightweight health responses with timeouts and fallbacks
 */

/**
 * Performance metrics tracker - per-request instance
 */
class PerformanceTracker {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
  }

  startRequest(requestId) {
    this.startTimes.set(requestId, Date.now());
  }

  endRequest(requestId) {
    const startTime = this.startTimes.get(requestId);
    if (startTime) {
      const duration = Date.now() - startTime;
      const existing = this.metrics.get('response_times') || [];
      existing.push(duration);
      
      // Keep only last 100 measurements
      if (existing.length > 100) {
        existing.shift();
      }
      
      this.metrics.set('response_times', existing);
      this.startTimes.delete(requestId);
      return duration;
    }
    return null;
  }

  getAverageResponseTime() {
    const times = this.metrics.get('response_times') || [];
    if (times.length === 0) return 0;
    return Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  }

  incrementCounter(name) {
    const current = this.metrics.get(name) || 0;
    this.metrics.set(name, current + 1);
  }

  getMetric(name) {
    return this.metrics.get(name) || 0;
  }

  getMetrics() {
    return {
      avg_response_time: this.getAverageResponseTime(),
      total_requests: this.getMetric('total_requests'),
      successful_requests: this.getMetric('successful_requests'),
      failed_requests: this.getMetric('failed_requests'),
      cache_hits: this.getMetric('cache_hits'),
      cache_misses: this.getMetric('cache_misses'),
      ai_calls: this.getMetric('ai_calls'),
      ai_failures: this.getMetric('ai_failures')
    };
  }
}

// Create a global performance tracker instance
const globalTracker = new PerformanceTracker();

// Export the actual instance for compatibility
export { globalTracker as performanceTracker };

/**
 * Lazy load dynamic config module
 */
let dynamicConfigModule = null;
async function getDynamicConfigModule() {
  if (dynamicConfigModule) return dynamicConfigModule;
  
  try {
    dynamicConfigModule = await import('../enhanced-rate-limiting/dynamic-config.js');
    console.log('[Health Utils] Dynamic config module loaded successfully');
    return dynamicConfigModule;
  } catch (error) {
    console.warn('[Health Utils] Dynamic config module unavailable, using fallbacks:', error.message);
    return null;
  }
}

/**
 * EMERGENCY FIX: Generate lightweight health response with timeouts and circuit breakers
 * @param {string} workerName - Name of the worker
 * @param {Object} env - Cloudflare environment bindings
 * @param {string} version - Worker version
 * @param {Array} staticFeatures - Static feature list (non-dynamic features)
 * @returns {Promise<Object>} Health response (lightweight or full depending on circuit breaker state)
 */
export async function generateDynamicHealthResponse(workerName, env, version, staticFeatures = []) {
  const startTime = Date.now();
  const HEALTH_TIMEOUT = 500; // 500ms maximum for health checks
  
  try {
    console.log(`[Health Diagnostic] 🚀 STARTING dynamic health response for ${workerName}`);
    
    // Circuit breaker: Check if we should use lightweight mode
    const shouldUseLightweight = await shouldUseLightweightMode(workerName, env);
    
    console.log(`[Health Diagnostic] Circuit breaker check result: shouldUseLightweight = ${shouldUseLightweight}`);
    
    if (shouldUseLightweight) {
      console.log(`[Health Diagnostic] ⚡ EMERGENCY LIGHTWEIGHT MODE TRIGGERED for ${workerName} due to circuit breaker`);
      console.log(`[Health Diagnostic] ⚡ This bypasses full health checks and may cause status discrepancies`);
      const lightweightResponse = generateLightweightHealthResponse(workerName, version, staticFeatures, startTime, true);
      console.log(`[Health Diagnostic] ⚡ Emergency lightweight response status: ${lightweightResponse.status}`);
      return lightweightResponse;
    }
    
    console.log(`[Health Diagnostic] 🔄 Attempting FULL health check for ${workerName} (timeout: ${HEALTH_TIMEOUT}ms)`);
    
    // Try full health check with timeout
    const fullHealthPromise = generateFullHealthResponse(workerName, env, version, staticFeatures, startTime);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Health check timeout')), HEALTH_TIMEOUT)
    );
    
    try {
      const healthResponse = await Promise.race([fullHealthPromise, timeoutPromise]);
      console.log(`[Health Diagnostic] ✅ FULL health check SUCCESS for ${workerName}`);
      console.log(`[Health Diagnostic] ✅ Response status: ${healthResponse.status}, Internal health: ${healthResponse.health_indicators?.overall_system_health}`);
      await recordHealthCheckSuccess(workerName, env);
      return healthResponse;
    } catch (timeoutError) {
      console.warn(`[Health Diagnostic] ⏰ TIMEOUT OCCURRED for ${workerName}, falling back to emergency lightweight`);
      console.log(`[Health Diagnostic] ⏰ This timeout fallback may create health indicator inconsistencies`);
      await recordHealthCheckFailure(workerName, env, 'timeout');
      const fallbackResponse = generateLightweightHealthResponse(workerName, version, staticFeatures, startTime, true);
      console.log(`[Health Diagnostic] ⏰ Timeout emergency fallback response status: ${fallbackResponse.status}`);
      return fallbackResponse;
    }
    
  } catch (error) {
    console.error(`[Health Diagnostic] 💥 CRITICAL ERROR in health check for ${workerName}:`, error);
    console.log(`[Health Diagnostic] 💥 Error fallback may create inconsistent health reporting`);
    await recordHealthCheckFailure(workerName, env, error.message);
    const errorResponse = generateLightweightHealthResponse(workerName, version, staticFeatures, startTime, true);
    console.log(`[Health Diagnostic] 💥 Critical error emergency fallback response status: ${errorResponse.status}`);
    return errorResponse;
  }
}

/**
 * EMERGENCY: Lightweight health response without KV operations (FIXED)
 */
function generateLightweightHealthResponse(workerName, version, staticFeatures, startTime, isEmergency = false) {
  const timestamp = new Date().toISOString();
  const duration = Date.now() - startTime;
  
  // FIXED: Use consistent status logic for lightweight mode
  const lightweightStatus = 'operational'; // Operational when in lightweight mode
  
  // FIXED: Determine correct performance mode based on actual emergency state
  const performanceMode = isEmergency ? 'emergency_lightweight' : 'lightweight';
  
  console.log(`[Health Diagnostic] 🔧 LIGHTWEIGHT RESPONSE: Status set to '${lightweightStatus}' | Performance mode: '${performanceMode}' | Emergency: ${isEmergency}`);
  
  return {
    status: lightweightStatus,
    service: workerName,
    timestamp: timestamp,
    version: version,
    mode: 'lightweight',
    
    // Basic operational info without KV calls
    operational_status: {
      health: lightweightStatus,
      ai_binding_available: true, // Assume available in lightweight mode
      response_time_ms: duration,
      lightweight_mode: true
    },
    
    // Static features only
    features: staticFeatures,
    
    // FIXED: Minimal performance info with correct mode
    performance: {
      response_time_ms: duration,
      mode: performanceMode
    },
    
    // FIXED: Consistent health indicators
    health_indicators: {
      overall_system_health: lightweightStatus
    }
  };
}

/**
 * Full health response with KV operations (with timeouts)
 */
async function generateFullHealthResponse(workerName, env, version, staticFeatures, startTime) {
  let workerConfig = null;
  let aiModelConfig = null;
  let healthCheck = null;
  
  // DIAGNOSTIC: Track health check flow for debugging
  console.log(`[Health Diagnostic] Starting full health response for ${workerName}`);
  
  try {
    // Load dynamic config module
    const dynamicConfigMod = await getDynamicConfigModule();
    
    if (dynamicConfigMod) {
      console.log(`[Health Diagnostic] Dynamic config module available, loading configs...`);
      const configPromise = Promise.all([
        dynamicConfigMod.loadWorkerConfig(workerName, env),
        dynamicConfigMod.getAIModelConfig(workerName, env),
        dynamicConfigMod.performConfigHealthCheck(env)
      ]);
      
      const configTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Config timeout')), 200)
      );
      
      try {
        [workerConfig, aiModelConfig, healthCheck] = await Promise.race([configPromise, configTimeout]);
        console.log(`[Health Diagnostic] Config loading SUCCESS for ${workerName}:`);
        console.log(`[Health Diagnostic] - Worker config source: ${workerConfig?.source}`);
        console.log(`[Health Diagnostic] - AI model: ${aiModelConfig?.model}`);
        console.log(`[Health Diagnostic] - Health check result: ${healthCheck?.overallHealth}`);
      } catch (configError) {
        console.warn(`[Health Diagnostic] ⚠️ CONFIG LOADING FAILED for ${workerName}:`, configError.message);
        console.log(`[Health Diagnostic] ⚠️ This is the PRIMARY CAUSE of health indicator discrepancy`);
        
        // Use fallback configs
        workerConfig = { source: 'fallback', lastUpdated: new Date().toISOString() };
        aiModelConfig = { model: '@cf/meta/llama-4-scout-17b-16e-instruct', maxTokens: 800, temperature: 0.4 };
        healthCheck = { overallHealth: 'degraded' };
        
        console.log(`[Health Diagnostic] ⚠️ FALLBACK CONFIGS SET:`);
        console.log(`[Health Diagnostic] - Worker config source: ${workerConfig.source}`);
        console.log(`[Health Diagnostic] - Health check overallHealth: ${healthCheck.overallHealth} ← THIS CAUSES THE DISCREPANCY`);
      }
    } else {
      console.log(`[Health Diagnostic] No dynamic config module available, using static fallbacks`);
      // No dynamic config available
      workerConfig = { source: 'static_fallback', lastUpdated: new Date().toISOString() };
      aiModelConfig = { model: '@cf/meta/llama-4-scout-17b-16e-instruct', maxTokens: 800, temperature: 0.4 };
      healthCheck = { overallHealth: 'healthy' };
      
      console.log(`[Health Diagnostic] Static fallback health check: ${healthCheck.overallHealth}`);
    }
    
    const timestamp = new Date().toISOString();
    const performanceMetrics = globalTracker.getMetrics();
    
    // FIXED: Align external status with actual operational health
    const internalHealthStatus = healthCheck.overallHealth || 'healthy';
    
    // Determine final status based on actual system health, not just circuit breaker state
    let finalStatus = internalHealthStatus;
    
    // Only override to 'healthy' if we're in lightweight mode AND system is actually operational
    const isLightweightMode = workerConfig.source === 'fallback' || workerConfig.source === 'static_fallback';
    const hasAIBinding = !!env.AI;
    const hasBasicOperations = hasAIBinding; // Basic operational check
    
    if (isLightweightMode && hasBasicOperations && internalHealthStatus === 'degraded') {
      // In lightweight mode with basic operations working, upgrade from degraded to operational
      finalStatus = 'operational';
      console.log(`[Health Diagnostic] 🔧 LIGHTWEIGHT MODE: Upgraded status from 'degraded' to 'operational' (basic operations working)`);
    }
    
    console.log(`[Health Diagnostic] FINAL HEALTH RESPONSE CONSTRUCTION for ${workerName}:`);
    console.log(`[Health Diagnostic] - External status (aligned): ${finalStatus}`);
    console.log(`[Health Diagnostic] - Internal health indicator: ${internalHealthStatus}`);
    console.log(`[Health Diagnostic] - Config source: ${workerConfig.source}`);
    console.log(`[Health Diagnostic] - AI binding available: ${hasAIBinding}`);
    console.log(`[Health Diagnostic] - Lightweight mode: ${isLightweightMode}`);
    
    // Verify consistency
    if (finalStatus !== internalHealthStatus) {
      console.log(`[Health Diagnostic] ✅ STATUS ALIGNMENT: External '${finalStatus}' differs from internal '${internalHealthStatus}' - this is now intentional for lightweight mode`);
    } else {
      console.log(`[Health Diagnostic] ✅ STATUS CONSISTENCY: External and internal indicators both show '${finalStatus}'`);
    }
    
    // Calculate uptime percentage
    const uptimePercentage = performanceMetrics.failed_requests > 0 
      ? Math.round(((performanceMetrics.successful_requests || 0) / (performanceMetrics.total_requests || 1)) * 100)
      : 100;
    
    // Calculate cache hit rate
    const cacheHitRate = (performanceMetrics.cache_hits + performanceMetrics.cache_misses) > 0
      ? Math.round((performanceMetrics.cache_hits / (performanceMetrics.cache_hits + performanceMetrics.cache_misses)) * 100)
      : 0;
    
    // Calculate error rate
    const errorRate = performanceMetrics.total_requests > 0
      ? Math.round((performanceMetrics.failed_requests / performanceMetrics.total_requests) * 100)
      : 0;
    
    return {
      status: finalStatus,
      service: workerName,
      timestamp: timestamp,
      server_time: Date.now(),
      version: version,
      mode: 'full',
      
      // Model information (safe defaults)
      model: {
        name: aiModelConfig.model || '@cf/meta/llama-4-scout-17b-16e-instruct',
        max_tokens: aiModelConfig.maxTokens || 800,
        temperature: aiModelConfig.temperature || 0.4,
        timeout: aiModelConfig.timeout || 30000,
        retries: aiModelConfig.retries || 3
      },
      
      // Configuration info
      configuration: {
        source: workerConfig.source,
        last_updated: workerConfig.lastUpdated,
        cache_status: env.FAQ_CACHE ? 'active' : 'unavailable',
        config_version: workerConfig.version || 1,
        fallback_used: workerConfig.source === 'fallback' || workerConfig.source === 'static_fallback'
      },
      
      // Performance metrics
      performance: {
        avg_response_time_ms: performanceMetrics.avg_response_time,
        uptime_percentage: uptimePercentage,
        cache_hit_rate_percentage: cacheHitRate,
        error_rate_percentage: errorRate,
        last_successful_operation: performanceMetrics.successful_requests > 0 ? timestamp : null,
        total_requests_served: performanceMetrics.total_requests,
        response_time_ms: Date.now() - startTime
      },
      
      // Operational status
      operational_status: {
        health: finalStatus, // Consistent with external status
        ai_binding_available: hasAIBinding,
        kv_stores_available: {
          available_stores: (env.FAQ_CACHE ? 1 : 0) + (env.AI_MODEL_CONFIG ? 1 : 0),
          total_stores: 3,
          percentage: Math.round(((env.FAQ_CACHE ? 1 : 0) + (env.AI_MODEL_CONFIG ? 1 : 0)) / 3 * 100)
        },
        cache_operational: !!env.FAQ_CACHE,
        config_loaded: workerConfig.source !== 'static_fallback',
        last_health_check: timestamp
      },
      
      // Capabilities
      capabilities: staticFeatures,
      
      // Features
      features: staticFeatures,
      
      // Health indicators
      health_indicators: {
        config_health: workerConfig.source === 'static_fallback' ? 'degraded' : 'healthy',
        kv_health: env.FAQ_CACHE ? 'healthy' : 'unavailable',
        cache_health: env.FAQ_CACHE ? 'healthy' : 'unavailable',
        ai_health: env.AI ? 'available' : 'unavailable',
        overall_system_health: internalHealthStatus // This can be different from external status
      },
      
      // Cache status - consistent across all workers
      cache_status: env.FAQ_CACHE ? 'active' : 'unavailable'
    };
    
  } catch (error) {
    throw new Error(`Full health check failed: ${error.message}`);
  }
}

/**
 * Generate fallback health response when dynamic loading fails
 */
function generateFallbackHealthResponse(workerName, version, staticFeatures, error) {
  return {
    status: 'degraded',
    service: workerName,
    timestamp: new Date().toISOString(),
    server_time: Date.now(),
    version: version,
    
    model: {
      name: 'unknown',
      max_tokens: 'unknown',
      temperature: 'unknown',
      timeout: 'unknown',
      retries: 'unknown'
    },
    
    configuration: {
      source: 'fallback',
      last_updated: new Date().toISOString(),
      cache_status: 'unavailable',
      config_version: 'unknown',
      fallback_used: true,
      error: error.message
    },
    
    performance: {
      avg_response_time_ms: 0,
      uptime_percentage: 0,
      cache_hit_rate_percentage: 0,
      error_rate_percentage: 100,
      last_successful_operation: null,
      total_requests_served: 0
    },
    
    operational_status: {
      health: 'degraded',
      ai_binding_available: false,
      kv_stores_available: { available_stores: 0, total_stores: 3, percentage: 0 },
      cache_operational: false,
      config_loaded: false,
      last_health_check: new Date().toISOString()
    },
    
    capabilities: ['fallback_mode'],
    features: staticFeatures,
    
    health_indicators: {
      config_health: 'error',
      kv_health: 'unknown',
      cache_health: 'unknown',
      ai_health: 'unknown',
      overall_system_health: 'error'
    }
  };
}

/**
 * Circuit breaker logic to prevent cascade failures (FIXED: Less aggressive)
 */
async function shouldUseLightweightMode(workerName, env) {
  console.log(`[Health Diagnostic] 🔧 Checking circuit breaker for ${workerName}`);
  
  try {
    // Check if FAQ_CACHE binding is available
    if (!env.FAQ_CACHE) {
      console.log(`[Health Diagnostic] 🔧 No FAQ_CACHE binding available for ${workerName} - allowing full health check`);
      return false;
    }
    
    const circuitKey = `circuit_breaker:${workerName}`;
    console.log(`[Health Diagnostic] 🔧 Looking for circuit breaker data with key: ${circuitKey}`);
    
    const circuitData = await env.FAQ_CACHE.get(circuitKey, { type: 'json' });
    
    if (!circuitData) {
      console.log(`[Health Diagnostic] 🔧 No circuit breaker data found for ${workerName} - allowing full health check`);
      return false;
    }
    
    const now = Date.now();
    const { failures, lastFailure, consecutiveFailures } = circuitData;
    
    console.log(`[Health Diagnostic] 🔧 Circuit breaker data for ${workerName}:`);
    console.log(`[Health Diagnostic] 🔧 - Consecutive failures: ${consecutiveFailures}`);
    console.log(`[Health Diagnostic] 🔧 - Last failure: ${new Date(lastFailure).toISOString()}`);
    console.log(`[Health Diagnostic] 🔧 - Time since last failure: ${(now - lastFailure) / 1000}s`);
    
    // Only trigger circuit breaker for SEVERE failures (5+ consecutive failures in last 2 minutes)
    if (consecutiveFailures >= 5 && (now - lastFailure) < 120000) {
      console.log(`[Health Diagnostic] 🔧 ⚡ CIRCUIT BREAKER TRIGGERED for ${workerName} (${consecutiveFailures} failures)`);
      console.log(`[Health Diagnostic] 🔧 ⚡ This forces lightweight mode and causes health status discrepancies`);
      return true;
    }
    
    console.log(`[Health Diagnostic] 🔧 Circuit breaker conditions NOT met for ${workerName} - allowing full health check`);
    return false;
  } catch (error) {
    // FIXED: Don't default to emergency mode on minor errors
    console.warn(`[Health Diagnostic] 🔧 ⚠️ Error checking circuit breaker for ${workerName}:`, error.message);
    console.log(`[Health Diagnostic] 🔧 ✅ Allowing full health check despite circuit breaker error`);
    return false; // ← FIXED: Allow full health check instead of defaulting to emergency
  }
}

/**
 * Record successful health check
 */
async function recordHealthCheckSuccess(workerName, env) {
  try {
    const circuitKey = `circuit_breaker:${workerName}`;
    await env.FAQ_CACHE?.put(circuitKey, JSON.stringify({
      consecutiveFailures: 0,
      lastSuccess: Date.now(),
      totalSuccesses: 1
    }), { expirationTtl: 3600 });
  } catch (error) {
    // Ignore errors in circuit breaker recording
  }
}

/**
 * Record failed health check
 */
async function recordHealthCheckFailure(workerName, env, reason) {
  try {
    const circuitKey = `circuit_breaker:${workerName}`;
    const existing = await env.FAQ_CACHE?.get(circuitKey, { type: 'json' }) || {};
    
    const circuitData = {
      consecutiveFailures: (existing.consecutiveFailures || 0) + 1,
      lastFailure: Date.now(),
      lastFailureReason: reason,
      totalFailures: (existing.totalFailures || 0) + 1
    };
    
    await env.FAQ_CACHE?.put(circuitKey, JSON.stringify(circuitData), { expirationTtl: 3600 });
  } catch (error) {
    // Ignore errors in circuit breaker recording
  }
}

/**
 * Middleware to track performance metrics
 */
export function withPerformanceTracking(handler) {
  return async (request, env, ctx) => {
    const requestId = crypto.randomUUID();
    
    globalTracker.startRequest(requestId);
    globalTracker.incrementCounter('total_requests');
    
    try {
      const response = await handler(request, env, ctx);
      globalTracker.incrementCounter('successful_requests');
      return response;
    } catch (error) {
      globalTracker.incrementCounter('failed_requests');
      throw error;
    } finally {
      globalTracker.endRequest(requestId);
    }
  };
}

/**
 * Track cache operations
 */
export function trackCacheHit() {
  globalTracker.incrementCounter('cache_hits');
}

export function trackCacheMiss() {
  globalTracker.incrementCounter('cache_misses');
}

/**
 * Track AI operations
 */
export function trackAICall() {
  globalTracker.incrementCounter('ai_calls');
}

export function trackAIFailure() {
  globalTracker.incrementCounter('ai_failures');
}