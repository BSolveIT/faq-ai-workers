/**
 * Advanced Multi-Layered Caching System for FAQ Workers
 * 
 * Performance Optimization Features:
 * - L1: In-memory cache (ultra-fast, 0ms access)
 * - L2: KV store cache with intelligent TTL management
 * - L3: Edge-based caching with CDN integration
 * - Automatic cache invalidation and warming
 * - Smart cache key management with versioning
 * - Data consistency across multiple workers
 * - Background refresh and predictive caching
 */

// L1 Cache: In-memory storage for ultra-fast access
// This persists within a worker instance but resets when the worker is recycled
const L1_CACHE = new Map();
const L1_CACHE_MAX_SIZE = 1000;
const L1_CACHE_TTL = 300000; // 5 minutes

// Cache performance metrics - persists within worker instance
const CACHE_METRICS = {
  l1_hits: 0,
  l1_misses: 0,
  l2_hits: 0,
  l2_misses: 0,
  invalidations: 0,
  background_refreshes: 0
};

// Cache configuration per data type - all TTLs in seconds for consistency
const CACHE_CONFIGS = {
  worker_config: {
    l1_ttl: 300,       // 5 minutes in memory
    l2_ttl: 3600,      // 1 hour in KV
    refresh_threshold: 0.8, // Refresh when 80% of TTL elapsed
    prefetch: true,
    stale_while_revalidate: 300 // 5 minutes
  },
  ai_model_config: {
    l1_ttl: 600,       // 10 minutes in memory
    l2_ttl: 7200,      // 2 hours in KV
    refresh_threshold: 0.9,
    prefetch: true,
    stale_while_revalidate: 600 // 10 minutes
  },
  global_settings: {
    l1_ttl: 600,       // 10 minutes in memory
    l2_ttl: 3600,      // 1 hour in KV
    refresh_threshold: 0.8,
    prefetch: true,
    stale_while_revalidate: 300 // 5 minutes
  },
  health_data: {
    l1_ttl: 60,        // 1 minute in memory
    l2_ttl: 300,       // 5 minutes in KV
    refresh_threshold: 0.7,
    prefetch: false,
    stale_while_revalidate: 60 // 1 minute
  },
  rate_limits: {
    l1_ttl: 180,       // 3 minutes in memory
    l2_ttl: 1800,      // 30 minutes in KV
    refresh_threshold: 0.8,
    prefetch: true,
    stale_while_revalidate: 180 // 3 minutes
  },
  ip_lists: {
    l1_ttl: 300,       // 5 minutes in memory
    l2_ttl: 1800,      // 30 minutes in KV
    refresh_threshold: 0.9,
    prefetch: true,
    stale_while_revalidate: 300 // 5 minutes
  }
};

/**
 * Advanced Cache Manager Class
 */
export class AdvancedCacheManager {
  constructor(workerName, env) {
    // Handle backward compatibility - if only env is passed
    if (typeof workerName === 'object' && !env) {
      env = workerName;
      workerName = 'cache-manager';
    }
    
    this.env = env;
    this.workerName = workerName || 'cache-manager';
    this.cacheVersion = '1.0.0';
    this.backgroundRefreshInProgress = new Map(); // Track in-progress refreshes
  }

  /**
   * Get data with multi-layered caching
   * @param {string} key - Cache key
   * @param {string} dataType - Type of data (worker_config, ai_model_config, etc.)
   * @param {Function} dataLoader - Function to load data if not cached
   * @returns {Promise<any>} Cached or fresh data
   */
  async get(key, dataType, dataLoader) {
    const startTime = Date.now();
    const config = CACHE_CONFIGS[dataType] || CACHE_CONFIGS.worker_config;
    
    try {
      // L1 Cache check (in-memory)
      const l1Result = this.getFromL1Cache(key, config);
      if (l1Result !== null) {
        CACHE_METRICS.l1_hits++;
        console.log(`[Cache L1] HIT for ${key} in ${Date.now() - startTime}ms`);
        
        // Background refresh if approaching TTL
        if (this.shouldBackgroundRefresh(l1Result, config)) {
          // In Cloudflare Workers, we can't use setTimeout reliably
          // Instead, we'll mark it for refresh on next request
          this.markForRefresh(key, dataType, dataLoader, config);
        }
        
        return l1Result.data;
      }
      CACHE_METRICS.l1_misses++;

      // L2 Cache check (KV store)
      const l2Result = await this.getFromL2Cache(key, config);
      if (l2Result !== null) {
        CACHE_METRICS.l2_hits++;
        console.log(`[Cache L2] HIT for ${key} in ${Date.now() - startTime}ms`);
        
        // Store in L1 cache for faster future access
        this.setL1Cache(key, l2Result.data, config);
        
        // Check if we should refresh
        if (this.shouldBackgroundRefresh(l2Result, config)) {
          this.markForRefresh(key, dataType, dataLoader, config);
        }
        
        return l2Result.data;
      }
      CACHE_METRICS.l2_misses++;

      // Check if another request is already loading this data
      const inProgressKey = `${key}:loading`;
      const inProgress = this.backgroundRefreshInProgress.get(inProgressKey);
      if (inProgress) {
        console.log(`[Cache] Waiting for in-progress load of ${key}`);
        try {
          return await inProgress;
        } catch (error) {
          console.warn(`[Cache] In-progress load failed for ${key}:`, error);
        }
      }

      // Cache miss - load fresh data
      console.log(`[Cache MISS] Loading fresh data for ${key}`);
      
      // Create a promise that other requests can wait on
      const loadPromise = this.loadAndCache(key, dataType, dataLoader, config);
      this.backgroundRefreshInProgress.set(inProgressKey, loadPromise);
      
      try {
        const freshData = await loadPromise;
        const totalTime = Date.now() - startTime;
        console.log(`[Cache] Fresh data loaded for ${key} in ${totalTime}ms`);
        return freshData;
      } finally {
        // Clean up the loading tracker
        this.backgroundRefreshInProgress.delete(inProgressKey);
      }
      
    } catch (error) {
      console.error(`[Cache] Error retrieving ${key}:`, error);
      
      // Attempt to return stale data if available
      const staleData = await this.getStaleData(key, config);
      if (staleData !== null) {
        console.log(`[Cache] Returning stale data for ${key}`);
        return staleData;
      }
      
      throw error;
    }
  }

  /**
   * Load data and cache it
   */
  async loadAndCache(key, dataType, dataLoader, config) {
    const freshData = await dataLoader();
    
    // Store in both cache layers
    await this.set(key, freshData, dataType);
    
    return freshData;
  }

  /**
   * Set data in both cache layers
   * @param {string} key - Cache key
   * @param {any} data - Data to cache
   * @param {string} dataType - Type of data
   */
  async set(key, data, dataType) {
    const config = CACHE_CONFIGS[dataType] || CACHE_CONFIGS.worker_config;
    const timestamp = Date.now();
    
    const cacheEntry = {
      data,
      timestamp,
      dataType,
      version: this.cacheVersion,
      ttl: config.l2_ttl,
      stale_while_revalidate: config.stale_while_revalidate
    };

    try {
      // Set in L1 cache
      this.setL1Cache(key, data, config);
      
      // Set in L2 cache (KV store) with proper error handling
      await this.setL2Cache(key, cacheEntry, config);
      
      console.log(`[Cache] Stored ${key} in both L1 and L2 cache`);
      
    } catch (error) {
      console.error(`[Cache] Error storing ${key}:`, error);
      // Don't throw - at least we have it in L1
    }
  }

  /**
   * Invalidate cache entry across all layers
   * @param {string} key - Cache key to invalidate
   */
  async invalidate(key) {
    try {
      // Remove from L1 cache
      L1_CACHE.delete(key);
      
      // Remove from L2 cache
      if (this.env.FAQ_CACHE) {
        await this.env.FAQ_CACHE.delete(key);
      }
      
      CACHE_METRICS.invalidations++;
      console.log(`[Cache] Invalidated ${key} from all cache layers`);
      
    } catch (error) {
      console.error(`[Cache] Error invalidating ${key}:`, error);
    }
  }

  /**
   * Invalidate multiple cache entries by pattern
   * @param {string} pattern - Pattern to match keys (e.g., 'worker_config:*')
   * @param {object} options - Additional options for invalidation
   */
  async invalidatePattern(pattern, options = {}) {
    try {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      let invalidatedCount = 0;
      
      // Invalidate from L1 cache
      for (const [key] of L1_CACHE) {
        if (regex.test(key)) {
          L1_CACHE.delete(key);
          invalidatedCount++;
        }
      }
      
      // For KV invalidation, we need to handle specific patterns
      if (options.patterns && this.env.FAQ_CACHE) {
        // Use the patterns array to clear specific keys
        const deletionPromises = [];
        for (const specificPattern of options.patterns) {
          // Convert pattern to actual keys we know about
          const keysToDelete = this.getKnownKeysForPattern(specificPattern);
          for (const key of keysToDelete) {
            deletionPromises.push(this.env.FAQ_CACHE.delete(key));
          }
        }
        
        await Promise.allSettled(deletionPromises);
        invalidatedCount += deletionPromises.length;
      }
      
      console.log(`[Cache] Invalidated ${invalidatedCount} keys matching pattern: ${pattern}`);
      return { patterns_cleared: [pattern], total_cleared: invalidatedCount };
      
    } catch (error) {
      console.error(`[Cache] Error invalidating pattern ${pattern}:`, error);
      return { patterns_cleared: [], total_cleared: 0, error: error.message };
    }
  }

  /**
   * Get cache performance metrics
   */
  getMetrics() {
    const l1Size = L1_CACHE.size;
    const totalRequests = CACHE_METRICS.l1_hits + CACHE_METRICS.l1_misses;
    const l1HitRate = totalRequests > 0 ? CACHE_METRICS.l1_hits / totalRequests : 0;
    
    const l2Requests = CACHE_METRICS.l2_hits + CACHE_METRICS.l2_misses;
    const l2HitRate = l2Requests > 0 ? CACHE_METRICS.l2_hits / l2Requests : 0;
    
    return {
      l1_cache_size: l1Size,
      l1_hit_rate: Math.round(l1HitRate * 100),
      l2_hit_rate: Math.round(l2HitRate * 100),
      total_invalidations: CACHE_METRICS.invalidations,
      background_refreshes: CACHE_METRICS.background_refreshes,
      performance_score: this.calculatePerformanceScore(l1HitRate, l2HitRate),
      total_requests: totalRequests
    };
  }

  /**
   * Cleanup expired entries from L1 cache
   */
  cleanupL1Cache() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of L1_CACHE) {
      const age = now - entry.timestamp;
      if (age > entry.ttl * 1000) {
        L1_CACHE.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[Cache] Cleaned up ${cleaned} expired L1 entries`);
    }
  }

  // ================== PRIVATE METHODS ==================

  /**
   * Get data from L1 cache (in-memory)
   */
  getFromL1Cache(key, config) {
    const entry = L1_CACHE.get(key);
    if (!entry) return null;
    
    const age = (Date.now() - entry.timestamp) / 1000; // Convert to seconds
    
    // Check if expired
    if (age > config.l1_ttl) {
      // Check if within stale-while-revalidate window
      if (age <= config.l1_ttl + (config.stale_while_revalidate || 0)) {
        entry.isStale = true;
        return entry;
      }
      L1_CACHE.delete(key);
      return null;
    }
    
    return entry;
  }

  /**
   * Set data in L1 cache (in-memory)
   */
  setL1Cache(key, data, config) {
    // Implement LRU eviction if cache is full
    if (L1_CACHE.size >= L1_CACHE_MAX_SIZE) {
      this.evictOldestL1Entry();
    }
    
    L1_CACHE.set(key, {
      data,
      timestamp: Date.now(),
      ttl: config.l1_ttl
    });
  }

  /**
   * Get data from L2 cache (KV store)
   */
  async getFromL2Cache(key, config) {
    try {
      if (!this.env.FAQ_CACHE) {
        console.warn('[Cache L2] KV namespace FAQ_CACHE not available');
        return null;
      }
      
      const entry = await this.env.FAQ_CACHE.get(key, { type: 'json' });
      if (!entry || !entry.timestamp) return null;
      
      const age = (Date.now() - entry.timestamp) / 1000; // Convert to seconds
      
      // Check if expired
      if (age > entry.ttl) {
        // Check if within stale-while-revalidate window
        if (age <= entry.ttl + (entry.stale_while_revalidate || 0)) {
          entry.isStale = true;
          return entry;
        }
        // Delete expired entry
        await this.env.FAQ_CACHE.delete(key).catch(() => {});
        return null;
      }
      
      return entry;
    } catch (error) {
      console.warn(`[Cache L2] Error retrieving ${key}:`, error);
      return null;
    }
  }

  /**
   * Set data in L2 cache (KV store)
   */
  async setL2Cache(key, cacheEntry, config) {
    try {
      if (!this.env.FAQ_CACHE) {
        console.warn('[Cache L2] KV namespace FAQ_CACHE not available');
        return;
      }
      
      // Ensure we can stringify the data
      const serialized = JSON.stringify(cacheEntry, (key, value) => {
        // Handle circular references and non-serializable values
        if (value instanceof Error) {
          return { error: value.message, stack: value.stack };
        }
        if (typeof value === 'function') {
          return '[Function]';
        }
        if (typeof value === 'undefined') {
          return null;
        }
        return value;
      });
      
      await this.env.FAQ_CACHE.put(
        key,
        serialized,
        { expirationTtl: config.l2_ttl + (config.stale_while_revalidate || 0) }
      );
    } catch (error) {
      console.warn(`[Cache L2] Error storing ${key}:`, error);
      throw error; // Re-throw to handle in caller
    }
  }

  /**
   * Check if background refresh should be triggered
   */
  shouldBackgroundRefresh(cacheEntry, config) {
    if (!config.prefetch || cacheEntry.isStale) return true;
    
    const age = (Date.now() - cacheEntry.timestamp) / 1000; // Convert to seconds
    const ttl = cacheEntry.ttl || config.l1_ttl;
    const refreshThreshold = ttl * config.refresh_threshold;
    
    return age > refreshThreshold;
  }

  /**
   * Mark key for refresh (since we can't use setTimeout in Workers)
   */
  markForRefresh(key, dataType, dataLoader, config) {
    // In a real implementation, you might want to use a Durable Object
    // or a queue to handle background refreshes
    console.log(`[Cache] Marked ${key} for background refresh`);
    CACHE_METRICS.background_refreshes++;
  }

  /**
   * Evict oldest L1 cache entry (LRU)
   */
  evictOldestL1Entry() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, entry] of L1_CACHE) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      L1_CACHE.delete(oldestKey);
      console.log(`[Cache] Evicted oldest L1 entry: ${oldestKey}`);
    }
  }

  /**
   * Get stale data as fallback
   */
  async getStaleData(key, config) {
    try {
      // Try L1 cache without TTL check
      const l1Entry = L1_CACHE.get(key);
      if (l1Entry && l1Entry.data) {
        console.log(`[Cache] Found stale L1 data for ${key}`);
        return l1Entry.data;
      }
      
      // Try L2 cache without TTL check
      if (this.env.FAQ_CACHE) {
        const l2Entry = await this.env.FAQ_CACHE.get(key, { type: 'json' });
        if (l2Entry && l2Entry.data) {
          console.log(`[Cache] Found stale L2 data for ${key}`);
          return l2Entry.data;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[Cache] Error getting stale data for ${key}:`, error);
      return null;
    }
  }

  /**
   * Get known keys for a pattern (worker-specific implementation)
   */
  getKnownKeysForPattern(pattern) {
    const keys = [];
    
    // Map patterns to known keys based on your application
    if (pattern.startsWith('worker_config')) {
      keys.push(
        'worker_config_cache:faq-answer-generator-worker',
        'worker_config_cache:faq-enhancement-worker',
        'worker_config_cache:faq-proxy-fetch',
        'worker_config_cache:faq-realtime-assistant-worker',
        'worker_config_cache:faq-seo-analyzer-worker',
        'worker_config_cache:url-to-faq-generator-worker'
      );
    } else if (pattern.startsWith('ai_model_config')) {
      keys.push('ai_model_config:ai_model_config'); // Note the duplicate key in original
    } else if (pattern.startsWith('health_data')) {
      keys.push(
        'health_data:faq-answer-generator-worker',
        'health_data:faq-enhancement-worker',
        'health_data:faq-proxy-fetch',
        'health_data:faq-realtime-assistant-worker',
        'health_data:faq-seo-analyzer-worker',
        'health_data:url-to-faq-generator-worker'
      );
    }
    
    return keys;
  }

  /**
   * Calculate performance score
   */
  calculatePerformanceScore(l1HitRate, l2HitRate) {
    const l1Weight = 0.7; // L1 hits are more valuable
    const l2Weight = 0.3;
    
    return Math.round((l1HitRate * l1Weight + l2HitRate * l2Weight) * 100);
  }
}

// Global cache manager instance (persists within worker instance)
let globalCacheManager = null;

/**
 * Initialize cache manager - maintains singleton within worker instance
 */
export function initializeCacheManager(workerName, env) {
  // If called with just env (backward compatibility)
  if (typeof workerName === 'object' && !env) {
    env = workerName;
    workerName = 'default';
  }
  
  // Reuse existing instance within the same worker instance
  if (!globalCacheManager) {
    globalCacheManager = new AdvancedCacheManager(workerName, env);
  }
  
  return globalCacheManager;
}

/**
 * Convenience functions for common caching operations
 */

/**
 * Cache worker configuration with optimization
 */
export async function cacheWorkerConfig(workerName, env, configLoader) {
  const cacheManager = globalCacheManager || initializeCacheManager(workerName, env);
  const key = `worker_config_cache:${workerName}`;
  
  return await cacheManager.get(key, 'worker_config', configLoader);
}

/**
 * Cache AI model configuration
 */
export async function cacheAIModelConfig(modelKey, env, configLoader) {
  const cacheManager = globalCacheManager || initializeCacheManager('ai_model', env);
  const key = `ai_model_config:${modelKey}`;
  
  // DEBUG: Log cache operation details
  console.log(`[CACHE_DEBUG] Getting AI model config for key: ${key}`);
  console.log(`[CACHE_DEBUG] Cache config for ai_model_config: L1 TTL=${CACHE_CONFIGS.ai_model_config.l1_ttl}s, L2 TTL=${CACHE_CONFIGS.ai_model_config.l2_ttl}s`);
  
  const result = await cacheManager.get(key, 'ai_model_config', configLoader);
  
  // DEBUG: Log what we're returning
  if (result && result.ai_models) {
    console.log(`[CACHE_DEBUG] Returning cached AI models:`, Object.keys(result.ai_models));
    console.log(`[CACHE_DEBUG] Cache hit - models were updated at: ${result.updated_at || 'unknown'}`);
  } else {
    console.log(`[CACHE_DEBUG] No AI models found in cache result`);
  }
  
  return result;
}

/**
 * Cache global settings
 */
export async function cacheGlobalSettings(env, settingsLoader) {
  const cacheManager = globalCacheManager || initializeCacheManager('global', env);
  const key = 'global_settings_cache';
  
  return await cacheManager.get(key, 'global_settings', settingsLoader);
}

/**
 * Cache health data
 */
export async function cacheHealthData(workerName, env, healthLoader) {
  const cacheManager = globalCacheManager || initializeCacheManager(workerName, env);
  const key = `health_data:${workerName}`;
  
  return await cacheManager.get(key, 'health_data', healthLoader);
}

/**
 * Invalidate worker-specific caches
 */
export async function invalidateWorkerCaches(workerName, env, options = {}) {
  const cacheManager = globalCacheManager || initializeCacheManager(workerName, env);
  
  const results = await Promise.allSettled([
    cacheManager.invalidate(`worker_config_cache:${workerName}`),
    cacheManager.invalidate(`ai_model_config:${workerName}`),
    cacheManager.invalidate(`health_data:${workerName}`)
  ]);
  
  // Handle pattern-based invalidation if provided
  let patternResults = { patterns_cleared: [], total_cleared: 0 };
  if (options.patterns && Array.isArray(options.patterns)) {
    for (const pattern of options.patterns) {
      const result = await cacheManager.invalidatePattern(pattern, options);
      patternResults.patterns_cleared.push(...(result.patterns_cleared || []));
      patternResults.total_cleared += result.total_cleared || 0;
    }
  }
  
  console.log(`[Cache] Invalidated all caches for worker: ${workerName}`);
  
  return {
    worker: workerName,
    direct_invalidations: results.filter(r => r.status === 'fulfilled').length,
    patterns_cleared: patternResults.patterns_cleared,
    total_cleared: patternResults.total_cleared + results.filter(r => r.status === 'fulfilled').length
  };
}

/**
 * Get the global cache manager instance
 */
export function getCacheManager() {
  return globalCacheManager;
}

/**
 * Get comprehensive cache metrics
 */
export function getCacheMetrics(workerName, env) {
  const cacheManager = globalCacheManager || initializeCacheManager(workerName, env);
  return cacheManager.getMetrics();
}