/**
 * Dynamic Rate Limit Configuration System
 * Allows WordPress admin to configure rate limits via KV storage
 */

/**
 * Default rate limit configurations for each worker
 */
export const DEFAULT_RATE_LIMITS = {
  'faq-answer-generator-worker': {
    hourlyLimit: 20,
    dailyLimit: 100,
    weeklyLimit: 500,
    monthlyLimit: 2000,
    violationThresholds: {
      soft: 3,
      hard: 6,
      ban: 12
    }
  },
  'faq-realtime-assistant-worker': {
    hourlyLimit: 30,
    dailyLimit: 200,
    weeklyLimit: 1000,
    monthlyLimit: 4000,
    violationThresholds: {
      soft: 3,
      hard: 6,
      ban: 12
    }
  },
  'faq-enhancement-worker': {
    hourlyLimit: 15,
    dailyLimit: 50,
    weeklyLimit: 250,
    monthlyLimit: 1000,
    violationThresholds: {
      soft: 2,
      hard: 5,
      ban: 10
    }
  },
  'faq-seo-analyzer-worker': {
    hourlyLimit: 10,
    dailyLimit: 30,
    weeklyLimit: 150,
    monthlyLimit: 600,
    violationThresholds: {
      soft: 2,
      hard: 4,
      ban: 8
    }
  },
  'faq-proxy-fetch': {
    hourlyLimit: 25,
    dailyLimit: 100,
    weeklyLimit: 500,
    monthlyLimit: 2000,
    violationThresholds: {
      soft: 2,
      hard: 4,
      ban: 8
    }
  },
  'url-to-faq-generator-worker': {
    hourlyLimit: 5,
    dailyLimit: 15,
    weeklyLimit: 75,
    monthlyLimit: 300,
    violationThresholds: {
      soft: 2,
      hard: 4,
      ban: 8
    }
  }
};

/**
 * Global rate limiting settings
 */
export const DEFAULT_GLOBAL_SETTINGS = {
  enableRateLimiting: true,
  enableIPWhitelist: true,
  enableIPBlacklist: true,
  enableViolationTracking: true,
  enableAnalytics: true,
  adminNotificationEmail: '',
  notifyOnViolations: true,
  violationNotificationThreshold: 5
};

/**
 * Load rate limit configuration for a specific worker
 * @param {Object} env - Cloudflare environment
 * @param {string} workerName - Name of the worker
 * @returns {Object} Rate limit configuration
 */
export async function loadWorkerConfig(env, workerName) {
  try {
    // Try to load custom configuration from KV storage
    const configKey = `rate_limit_config:${workerName}`;
    const customConfig = await env.FAQ_RATE_LIMITS?.get(configKey, { type: 'json' });
    
    if (customConfig && customConfig.enabled !== false) {
      // Merge custom config with defaults
      const defaultConfig = DEFAULT_RATE_LIMITS[workerName] || DEFAULT_RATE_LIMITS['faq-answer-generator-worker'];
      return {
        ...defaultConfig,
        ...customConfig,
        lastUpdated: customConfig.lastUpdated || new Date().toISOString(),
        source: 'custom'
      };
    }
  } catch (error) {
    console.warn(`Failed to load custom config for ${workerName}:`, error.message);
  }
  
  // Fallback to default configuration
  const defaultConfig = DEFAULT_RATE_LIMITS[workerName] || DEFAULT_RATE_LIMITS['faq-answer-generator-worker'];
  return {
    ...defaultConfig,
    lastUpdated: new Date().toISOString(),
    source: 'default'
  };
}

/**
 * Load global rate limiting settings
 * @param {Object} env - Cloudflare environment
 * @returns {Object} Global settings
 */
export async function loadGlobalSettings(env) {
  try {
    const globalConfig = await env.FAQ_RATE_LIMITS?.get('rate_limit_global_settings', { type: 'json' });
    
    if (globalConfig) {
      return {
        ...DEFAULT_GLOBAL_SETTINGS,
        ...globalConfig,
        lastUpdated: globalConfig.lastUpdated || new Date().toISOString(),
        source: 'custom'
      };
    }
  } catch (error) {
    console.warn('Failed to load global settings:', error.message);
  }
  
  return {
    ...DEFAULT_GLOBAL_SETTINGS,
    lastUpdated: new Date().toISOString(),
    source: 'default'
  };
}

/**
 * Save rate limit configuration for a specific worker
 * @param {Object} env - Cloudflare environment
 * @param {string} workerName - Name of the worker
 * @param {Object} config - Configuration object
 * @param {string} updatedBy - Admin user who made the update
 * @returns {boolean} Success status
 */
export async function saveWorkerConfig(env, workerName, config, updatedBy = 'admin') {
  try {
    const configKey = `rate_limit_config:${workerName}`;
    const configWithMetadata = {
      ...config,
      lastUpdated: new Date().toISOString(),
      updatedBy: updatedBy,
      version: (config.version || 0) + 1
    };
    
    await env.FAQ_RATE_LIMITS.put(configKey, JSON.stringify(configWithMetadata), {
      expirationTtl: 31536000 // 1 year
    });
    
    // Log the configuration change
    await logConfigChange(env, workerName, 'worker_config_updated', configWithMetadata, updatedBy);
    
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
    
    await env.FAQ_RATE_LIMITS.put('rate_limit_global_settings', JSON.stringify(settingsWithMetadata), {
      expirationTtl: 31536000 // 1 year
    });
    
    // Log the settings change
    await logConfigChange(env, 'global', 'global_settings_updated', settingsWithMetadata, updatedBy);
    
    return true;
  } catch (error) {
    console.error('Failed to save global settings:', error.message);
    return false;
  }
}

/**
 * Get all worker configurations for admin dashboard
 * @param {Object} env - Cloudflare environment
 * @returns {Object} All worker configurations
 */
export async function getAllWorkerConfigs(env) {
  const configs = {};
  
  for (const workerName of Object.keys(DEFAULT_RATE_LIMITS)) {
    configs[workerName] = await loadWorkerConfig(env, workerName);
  }
  
  return configs;
}

/**
 * Reset worker configuration to defaults
 * @param {Object} env - Cloudflare environment
 * @param {string} workerName - Name of the worker
 * @param {string} updatedBy - Admin user who made the reset
 * @returns {boolean} Success status
 */
export async function resetWorkerConfig(env, workerName, updatedBy = 'admin') {
  try {
    const configKey = `rate_limit_config:${workerName}`;
    await env.FAQ_RATE_LIMITS.delete(configKey);
    
    // Log the reset
    await logConfigChange(env, workerName, 'worker_config_reset', { resetTo: 'defaults' }, updatedBy);
    
    return true;
  } catch (error) {
    console.error(`Failed to reset config for ${workerName}:`, error.message);
    return false;
  }
}

/**
 * Log configuration changes for audit trail
 * @param {Object} env - Cloudflare environment
 * @param {string} target - Target of the change (worker name or 'global')
 * @param {string} action - Action performed
 * @param {Object} data - Change data
 * @param {string} updatedBy - Admin user who made the change
 */
async function logConfigChange(env, target, action, data, updatedBy) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      target: target,
      action: action,
      data: data,
      updatedBy: updatedBy,
      userAgent: 'WordPress-Admin'
    };
    
    const logKey = `config_log:${Date.now()}:${target}`;
    await env.FAQ_ANALYTICS?.put(logKey, JSON.stringify(logEntry), {
      expirationTtl: 7776000 // 90 days
    });
  } catch (error) {
    console.warn('Failed to log configuration change:', error.message);
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
  if (!config.hourlyLimit || config.hourlyLimit < 1) {
    errors.push('Hourly limit must be at least 1');
  }
  if (!config.dailyLimit || config.dailyLimit < config.hourlyLimit) {
    errors.push('Daily limit must be greater than or equal to hourly limit');
  }
  if (!config.weeklyLimit || config.weeklyLimit < config.dailyLimit) {
    errors.push('Weekly limit must be greater than or equal to daily limit');
  }
  if (!config.monthlyLimit || config.monthlyLimit < config.weeklyLimit) {
    errors.push('Monthly limit must be greater than or equal to weekly limit');
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
  
  // Performance warnings
  if (config.hourlyLimit > 100) {
    warnings.push('High hourly limit may impact AI costs');
  }
  if (config.violationThresholds?.soft > 5) {
    warnings.push('High soft violation threshold may not effectively prevent abuse');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}