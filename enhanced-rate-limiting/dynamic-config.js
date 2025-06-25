/**
 * Dynamic Rate Limit Configuration System
 * Simplified version that connects to WordPress settings via KV storage
 * Allows WordPress admin to configure rate limits dynamically
 *
 * @version 3.0.0 - Simplified for WordPress Integration
 * @since 2025-06-25
 */

// Simplified timeout for KV operations
const KV_TIMEOUT_MS = 5000; // 5 seconds maximum for KV operations

/**
 * Execute KV operation with basic timeout protection
 */
async function safeKVOperation(kvBinding, operation, operationName = 'KV Operation') {
  if (!kvBinding) {
    throw new Error('KV binding not available');
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${operationName} timeout after ${KV_TIMEOUT_MS}ms`)), KV_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([operation(), timeoutPromise]);
    return result;
  } catch (error) {
    console.warn(`[Safe KV] ${operationName} failed:`, error.message);
    throw error;
  }
}

/**
 * Fallback configurations used when WordPress settings are not available
 * These are conservative defaults to prevent abuse
 */
const FALLBACK_LIMITS = {
  hourlyLimit: 10,
  dailyLimit: 50,
  weeklyLimit: 250,
  monthlyLimit: 1000,
  aiModel: '@cf/meta/llama-3.1-8b-instruct',
  maxTokens: 300,
  temperature: 0.2,
  violationThresholds: {
    soft: 3,
    hard: 6,
    ban: 12
  }
};

/**
 * Default global settings for fallback
 */
const DEFAULT_GLOBAL_SETTINGS = {
  enableRateLimiting: true,
  requestsPerHour: 100,
  timeWindowSeconds: 3600,
  blockDurationSeconds: 3600,
  violationThresholds: {
    soft: 3,
    hard: 6,
    ban: 12
  }
};

/**
 * Load rate limit configuration for a specific worker from WordPress settings
 * @param {string} workerName - Name of the worker
 * @param {Object} env - Cloudflare environment
 * @returns {Object} Rate limit configuration
 */
export async function loadWorkerConfig(workerName, env) {
  console.log(`[Dynamic Config] Loading configuration for ${workerName}`);
  
  try {
    // First try to load WordPress settings from KV
    const wordpressConfig = await loadWordPressSettings(env);
    
    if (wordpressConfig && wordpressConfig.enableRateLimiting) {
      // Use WordPress settings
      const config = {
        hourlyLimit: wordpressConfig.requestsPerHour || 100,
        dailyLimit: (wordpressConfig.requestsPerHour || 100) * 24,
        weeklyLimit: (wordpressConfig.requestsPerHour || 100) * 24 * 7,
        monthlyLimit: (wordpressConfig.requestsPerHour || 100) * 24 * 30,
        timeWindow: wordpressConfig.timeWindowSeconds || 3600,
        blockDuration: wordpressConfig.blockDurationSeconds || 3600,
        violationThresholds: {
          soft: wordpressConfig.violationThresholds?.soft || 3,
          hard: wordpressConfig.violationThresholds?.hard || 6,
          ban: wordpressConfig.violationThresholds?.ban || 12
        },
        enabled: wordpressConfig.enableRateLimiting,
        source: 'wordpress',
        lastUpdated: wordpressConfig.lastUpdated || new Date().toISOString(),
        workerName
      };
      
      console.log(`[Dynamic Config] Loaded WordPress settings for ${workerName}:`, {
        hourly: config.hourlyLimit,
        enabled: config.enabled,
        source: config.source
      });
      
      return config;
    }
    
    // Fall back to worker-specific config in KV
    const configKey = `worker_config:${workerName}`;
    let workerConfig = null;
    
    try {
      workerConfig = await safeKVOperation(
        env.FAQ_RATE_LIMITS,
        () => env.FAQ_RATE_LIMITS?.get(configKey, { type: 'json' }),
        `Load Worker Config ${workerName}`
      );
    } catch (kvError) {
      console.warn(`[Dynamic Config] Worker config load failed for ${workerName}:`, kvError.message);
    }
    
    if (workerConfig) {
      console.log(`[Dynamic Config] Loaded worker-specific config for ${workerName}`);
      return {
        ...FALLBACK_LIMITS,
        ...workerConfig,
        source: 'worker_specific',
        workerName
      };
    }
    
    // Final fallback to default limits
    console.log(`[Dynamic Config] Using fallback configuration for ${workerName}`);
    return {
      ...FALLBACK_LIMITS,
      source: 'fallback',
      lastUpdated: new Date().toISOString(),
      workerName
    };
    
  } catch (error) {
    console.error(`[Dynamic Config] Error loading config for ${workerName}:`, error.message);
    
    return {
      ...FALLBACK_LIMITS,
      source: 'error_fallback',
      error: error.message,
      lastUpdated: new Date().toISOString(),
      workerName
    };
  }
}

/**
 * Load global rate limiting settings
 * @param {Object} env - Cloudflare environment
 * @returns {Object} Global settings
 */
export async function loadGlobalSettings(env) {
  try {
    // Load WordPress settings first
    const wordpressConfig = await loadWordPressSettings(env);
    
    if (wordpressConfig) {
      console.log('[Dynamic Config] Loaded WordPress global settings');
      return {
        ...DEFAULT_GLOBAL_SETTINGS,
        ...wordpressConfig,
        source: 'wordpress',
        lastUpdated: wordpressConfig.lastUpdated || new Date().toISOString()
      };
    }
    
    // Fallback to stored global settings
    let globalConfig = null;
    try {
      globalConfig = await safeKVOperation(
        env.FAQ_RATE_LIMITS,
        () => env.FAQ_RATE_LIMITS?.get('global_rate_settings', { type: 'json' }),
        'Load Global Settings'
      );
    } catch (kvError) {
      console.warn('[Dynamic Config] Global settings load failed:', kvError.message);
    }
    
    if (globalConfig) {
      console.log('[Dynamic Config] Loaded stored global settings');
      return {
        ...DEFAULT_GLOBAL_SETTINGS,
        ...globalConfig,
        source: 'stored',
        lastUpdated: globalConfig.lastUpdated || new Date().toISOString()
      };
    }
    
    // Use defaults
    console.log('[Dynamic Config] Using default global settings');
    return {
      ...DEFAULT_GLOBAL_SETTINGS,
      source: 'default',
      lastUpdated: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('[Dynamic Config] Error loading global settings:', error.message);
    
    return {
      ...DEFAULT_GLOBAL_SETTINGS,
      source: 'error_fallback',
      error: error.message,
      lastUpdated: new Date().toISOString()
    };
  }
}

/**
 * Load WordPress rate limiting settings from KV storage
 * These settings are synced from WordPress admin panel
 * @param {Object} env - Cloudflare environment
 * @returns {Object|null} WordPress settings or null if not found
 */
async function loadWordPressSettings(env) {
  try {
    const settings = await safeKVOperation(
      env.FAQ_RATE_LIMITS,
      () => env.FAQ_RATE_LIMITS?.get('wordpress_rate_settings', { type: 'json' }),
      'Load WordPress Settings'
    );
    
    if (settings && settings.enableRateLimiting !== undefined) {
      console.log('[Dynamic Config] Found WordPress rate limiting settings');
      return settings;
    }
    
    console.log('[Dynamic Config] No WordPress settings found in KV');
    return null;
    
  } catch (error) {
    console.warn('[Dynamic Config] Failed to load WordPress settings:', error.message);
    return null;
  }
}

/**
 * Save worker configuration to KV storage
 * @param {Object} env - Cloudflare environment
 * @param {string} workerName - Name of the worker
 * @param {Object} config - Configuration object
 * @param {string} updatedBy - Admin user who made the update
 * @returns {boolean} Success status
 */
export async function saveWorkerConfig(env, workerName, config, updatedBy = 'admin') {
  try {
    const configKey = `worker_config:${workerName}`;
    const configWithMetadata = {
      ...config,
      lastUpdated: new Date().toISOString(),
      updatedBy: updatedBy,
      version: (config.version || 0) + 1
    };
    
    await safeKVOperation(
      env.FAQ_RATE_LIMITS,
      () => env.FAQ_RATE_LIMITS.put(configKey, JSON.stringify(configWithMetadata), {
        expirationTtl: 31536000 // 1 year
      }),
      `Save Worker Config ${workerName}`
    );
    
    console.log(`[Dynamic Config] Saved config for ${workerName} by ${updatedBy}`);
    return true;
  } catch (error) {
    console.error(`Failed to save config for ${workerName}:`, error.message);
    return false;
  }
}

/**
 * Save global rate limiting settings
 * @param {Object} env - Cloudflare environment
 * @param {Object} settings - Global settings object
 * @param {string} updatedBy - Admin user who made the update
 * @returns {boolean} Success status
 */
export async function saveGlobalSettings(env, settings, updatedBy = 'admin') {
  try {
    const settingsWithMetadata = {
      ...settings,
      lastUpdated: new Date().toISOString(),
      updatedBy: updatedBy,
      version: (settings.version || 0) + 1
    };
    
    await safeKVOperation(
      env.FAQ_RATE_LIMITS,
      () => env.FAQ_RATE_LIMITS.put('global_rate_settings', JSON.stringify(settingsWithMetadata), {
        expirationTtl: 31536000 // 1 year
      }),
      'Save Global Settings'
    );
    
    console.log(`[Dynamic Config] Saved global settings by ${updatedBy}`);
    return true;
  } catch (error) {
    console.error('Failed to save global settings:', error.message);
    return false;
  }
}

/**
 * Save WordPress settings to KV storage
 * This is called by WordPress when rate limiting settings are updated
 * @param {Object} env - Cloudflare environment
 * @param {Object} settings - WordPress rate limiting settings
 * @returns {boolean} Success status
 */
export async function saveWordPressSettings(env, settings) {
  try {
    const settingsWithMetadata = {
      ...settings,
      lastUpdated: new Date().toISOString(),
      source: 'wordpress',
      syncedAt: new Date().toISOString()
    };
    
    await safeKVOperation(
      env.FAQ_RATE_LIMITS,
      () => env.FAQ_RATE_LIMITS.put('wordpress_rate_settings', JSON.stringify(settingsWithMetadata), {
        expirationTtl: 31536000 // 1 year
      }),
      'Save WordPress Settings'
    );
    
    console.log('[Dynamic Config] Saved WordPress rate limiting settings');
    return true;
  } catch (error) {
    console.error('Failed to save WordPress settings:', error.message);
    return false;
  }
}

/**
 * Validate rate limit configuration
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result
 */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  
  // Check required fields
  if (!config.requestsPerHour || config.requestsPerHour < 1) {
    errors.push('Requests per hour must be at least 1');
  }
  if (config.requestsPerHour > 1000) {
    warnings.push('High hourly limit may impact costs');
  }
  
  // Check time window
  if (!config.timeWindowSeconds || config.timeWindowSeconds < 60) {
    errors.push('Time window must be at least 60 seconds');
  }
  
  // Check block duration
  if (!config.blockDurationSeconds || config.blockDurationSeconds < 60) {
    errors.push('Block duration must be at least 60 seconds');
  }
  
  // Check violation thresholds
  if (config.violationThresholds) {
    const { soft, hard, ban } = config.violationThresholds;
    if (soft >= hard) {
      errors.push('Soft violation threshold must be less than hard threshold');
    }
    if (hard >= ban) {
      errors.push('Hard violation threshold must be less than ban threshold');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get basic health status of the configuration system
 * @param {Object} env - Cloudflare environment
 * @returns {Object} Health check results
 */
export async function getConfigHealth(env) {
  const results = {
    timestamp: new Date().toISOString(),
    kvStoreAccess: false,
    wordpressSettings: false,
    globalSettings: false,
    overallHealth: 'unknown'
  };
  
  try {
    // Test KV store access
    const testKey = `health_check_${Date.now()}`;
    await safeKVOperation(
      env.FAQ_RATE_LIMITS,
      () => env.FAQ_RATE_LIMITS.put(testKey, 'test', { expirationTtl: 60 }),
      'Health Check Write'
    );
    await safeKVOperation(
      env.FAQ_RATE_LIMITS,
      () => env.FAQ_RATE_LIMITS.delete(testKey),
      'Health Check Cleanup'
    );
    results.kvStoreAccess = true;
    
    // Check if WordPress settings exist
    const wordpressSettings = await loadWordPressSettings(env);
    results.wordpressSettings = !!wordpressSettings;
    
    // Check if global settings exist
    const globalSettings = await loadGlobalSettings(env);
    results.globalSettings = !!globalSettings;
    
    results.overallHealth = results.kvStoreAccess ? 'healthy' : 'degraded';
    
  } catch (error) {
    console.error('[Dynamic Config] Health check failed:', error.message);
    results.overallHealth = 'unhealthy';
    results.error = error.message;
  }
  
  return results;
}