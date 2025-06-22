/**
 * Enhanced IP-Based Rate Limiting System for Cloudflare Workers
 * 
 * Features:
 * - Tiered rate limiting with progressive penalties
 * - IP whitelist/blacklist management
 * - Usage analytics and violation tracking
 * - Geographic restrictions (optional)
 * - Time-based windows (hourly, daily, weekly)
 * - Abuse detection and automatic blocking
 * - Usage pattern analysis
 * 
 * KV Stores Required:
 * - FAQ_RATE_LIMITS: Main rate limiting data
 * - FAQ_IP_WHITELIST: Whitelisted IPs
 * - FAQ_IP_BLACKLIST: Blacklisted IPs
 * - FAQ_VIOLATIONS: Violation tracking
 * - FAQ_ANALYTICS: Usage analytics
 */

export class EnhancedRateLimiter {
  constructor(env, config = {}) {
    this.env = env;
    this.config = {
      // Default rate limits (can be overridden per worker)
      limits: {
        hourly: 50,
        daily: 200,
        weekly: 1000,
        monthly: 4000
      },
      // Violation thresholds
      violations: {
        soft_threshold: 3,    // Warning after 3 violations
        hard_threshold: 5,    // Block after 5 violations
        ban_threshold: 10     // Permanent ban after 10 violations
      },
      // Block durations (in seconds)
      penalties: {
        first_violation: 300,    // 5 minutes
        second_violation: 1800,  // 30 minutes
        third_violation: 7200,   // 2 hours
        persistent_violator: 86400 // 24 hours
      },
      ...config
    };
  }

  /**
   * Check if request should be allowed
   * @param {string} clientIP - Client IP address
   * @param {Request} request - Original request object
   * @param {string} workerName - Name of the worker (for analytics)
   * @returns {Promise<Object>} Rate limit result
   */
  async checkRateLimit(clientIP, request, workerName) {
    const startTime = Date.now();
    console.log(`[Rate Limiter] Checking limits for IP: ${clientIP}, Worker: ${workerName}`);

    try {
      // Step 1: Check blacklist
      const blacklistResult = await this.checkBlacklist(clientIP);
      if (blacklistResult.blocked) {
        await this.logViolation(clientIP, 'blacklist_access', workerName, request);
        return {
          allowed: false,
          reason: 'IP_BLACKLISTED',
          block_expires: null, // Permanent
          usage: null,
          duration: (Date.now() - startTime) / 1000
        };
      }

      // Step 2: Check whitelist
      const whitelistResult = await this.checkWhitelist(clientIP);
      if (whitelistResult.whitelisted) {
        await this.updateUsageTracking(clientIP, workerName, true);
        return {
          allowed: true,
          reason: 'WHITELISTED',
          usage: await this.getUsageStats(clientIP),
          duration: (Date.now() - startTime) / 1000
        };
      }


      // Step 4: Check current blocks
      const blockResult = await this.checkCurrentBlocks(clientIP);
      if (blockResult.blocked) {
        await this.logViolation(clientIP, 'blocked_access_attempt', workerName, request);
        return {
          allowed: false,
          reason: 'TEMPORARILY_BLOCKED',
          block_expires: blockResult.expires,
          remaining_time: blockResult.remaining,
          usage: null,
          duration: (Date.now() - startTime) / 1000
        };
      }

      // Step 5: Check rate limits
      const rateLimitResult = await this.checkRateLimits(clientIP, workerName);
      if (!rateLimitResult.allowed) {
        // Rate limit exceeded - apply penalty
        await this.applyPenalty(clientIP, 'rate_limit_exceeded', workerName);
        await this.logViolation(clientIP, 'rate_limit_exceeded', workerName, request, rateLimitResult);
        
        return {
          allowed: false,
          reason: 'RATE_LIMIT_EXCEEDED',
          usage: rateLimitResult.usage,
          limits: this.config.limits,
          reset_times: rateLimitResult.reset_times,
          duration: (Date.now() - startTime) / 1000
        };
      }

      // Step 6: Update usage tracking
      await this.updateUsageTracking(clientIP, workerName, false);

      // Request allowed
      return {
        allowed: true,
        reason: 'WITHIN_LIMITS',
        usage: rateLimitResult.usage,
        limits: this.config.limits,
        reset_times: rateLimitResult.reset_times,
        duration: (Date.now() - startTime) / 1000
      };

    } catch (error) {
      console.error(`[Rate Limiter] Error checking rate limit:`, error);
      // Fail open - allow request but log error
      return {
        allowed: true,
        reason: 'ERROR_FALLBACK',
        error: error.message,
        duration: (Date.now() - startTime) / 1000
      };
    }
  }

  /**
   * Update usage count after successful request
   * @param {string} clientIP 
   * @param {string} workerName 
   */
  async updateUsageCount(clientIP, workerName) {
    try {
      const now = new Date();
      const keys = {
        hourly: `usage:${clientIP}:${workerName}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}:${String(now.getHours()).padStart(2, '0')}`,
        daily: `usage:${clientIP}:${workerName}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
        weekly: `usage:${clientIP}:${workerName}:${now.getFullYear()}-W${this.getWeekNumber(now)}`,
        monthly: `usage:${clientIP}:${workerName}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      };

      // Update all time windows
      for (const [window, key] of Object.entries(keys)) {
        const current = await this.env.FAQ_RATE_LIMITS.get(key);
        const count = current ? parseInt(current) + 1 : 1;
        
        // Set TTL based on window
        let ttl;
        switch (window) {
          case 'hourly':
            ttl = 3600; // 1 hour
            break;
          case 'daily':
            ttl = 86400; // 24 hours
            break;
          case 'weekly':
            ttl = 604800; // 7 days
            break;
          case 'monthly':
            ttl = 2592000; // 30 days
            break;
        }

        await this.env.FAQ_RATE_LIMITS.put(key, count.toString(), { expirationTtl: ttl });
      }

      console.log(`[Rate Limiter] Updated usage for IP ${clientIP}, Worker ${workerName}`);
    } catch (error) {
      console.error(`[Rate Limiter] Error updating usage count:`, error);
    }
  }

  /**
   * Check if IP is blacklisted
   */
  async checkBlacklist(clientIP) {
    try {
      const blacklistData = await this.env.FAQ_IP_BLACKLIST.get(clientIP, { type: 'json' });
      if (blacklistData) {
        return {
          blocked: true,
          reason: blacklistData.reason || 'Blacklisted',
          added_at: blacklistData.added_at,
          added_by: blacklistData.added_by
        };
      }
      return { blocked: false };
    } catch (error) {
      console.error(`[Rate Limiter] Error checking blacklist:`, error);
      return { blocked: false };
    }
  }

  /**
   * Check if IP is whitelisted
   */
  async checkWhitelist(clientIP) {
    try {
      const whitelistData = await this.env.FAQ_IP_WHITELIST.get(clientIP, { type: 'json' });
      if (whitelistData && whitelistData.active !== false) {
        return {
          whitelisted: true,
          reason: whitelistData.reason || 'Whitelisted',
          added_at: whitelistData.added_at,
          added_by: whitelistData.added_by
        };
      }
      return { whitelisted: false };
    } catch (error) {
      console.error(`[Rate Limiter] Error checking whitelist:`, error);
      return { whitelisted: false };
    }
  }


  /**
   * Check if IP is currently blocked
   */
  async checkCurrentBlocks(clientIP) {
    try {
      const blockData = await this.env.FAQ_RATE_LIMITS.get(`block:${clientIP}`, { type: 'json' });
      if (blockData && blockData.expires > Date.now()) {
        return {
          blocked: true,
          expires: blockData.expires,
          remaining: Math.ceil((blockData.expires - Date.now()) / 1000),
          reason: blockData.reason
        };
      }
      return { blocked: false };
    } catch (error) {
      console.error(`[Rate Limiter] Error checking blocks:`, error);
      return { blocked: false };
    }
  }

  /**
   * Check rate limits across all time windows
   */
  async checkRateLimits(clientIP, workerName) {
    try {
      const now = new Date();
      const usage = await this.getCurrentUsage(clientIP, workerName, now);
      
      // Check each time window
      for (const [window, limit] of Object.entries(this.config.limits)) {
        if (usage[window] >= limit) {
          return {
            allowed: false,
            exceeded_window: window,
            usage,
            reset_times: this.getResetTimes(now)
          };
        }
      }

      return {
        allowed: true,
        usage,
        reset_times: this.getResetTimes(now)
      };
    } catch (error) {
      console.error(`[Rate Limiter] Error checking rate limits:`, error);
      return { allowed: true }; // Fail open
    }
  }

  /**
   * Get current usage across all time windows
   */
  async getCurrentUsage(clientIP, workerName, now) {
    const keys = {
      hourly: `usage:${clientIP}:${workerName}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}:${String(now.getHours()).padStart(2, '0')}`,
      daily: `usage:${clientIP}:${workerName}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      weekly: `usage:${clientIP}:${workerName}:${now.getFullYear()}-W${this.getWeekNumber(now)}`,
      monthly: `usage:${clientIP}:${workerName}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    };

    const usage = {};
    for (const [window, key] of Object.entries(keys)) {
      const count = await this.env.FAQ_RATE_LIMITS.get(key);
      usage[window] = count ? parseInt(count) : 0;
    }

    return usage;
  }

  /**
   * Apply penalty for violation
   */
  async applyPenalty(clientIP, violationType, workerName) {
    try {
      // Get violation history
      const violationHistory = await this.getViolationHistory(clientIP);
      const recentViolations = violationHistory.filter(v => 
        Date.now() - v.timestamp < 86400000 // Last 24 hours
      ).length;

      // Determine penalty duration
      let penaltyDuration;
      if (recentViolations === 0) {
        penaltyDuration = this.config.penalties.first_violation;
      } else if (recentViolations === 1) {
        penaltyDuration = this.config.penalties.second_violation;
      } else if (recentViolations === 2) {
        penaltyDuration = this.config.penalties.third_violation;
      } else {
        penaltyDuration = this.config.penalties.persistent_violator;
      }

      // Apply block
      const blockData = {
        expires: Date.now() + (penaltyDuration * 1000),
        reason: violationType,
        violation_count: recentViolations + 1,
        worker: workerName,
        applied_at: Date.now()
      };

      await this.env.FAQ_RATE_LIMITS.put(
        `block:${clientIP}`, 
        JSON.stringify(blockData), 
        { expirationTtl: penaltyDuration }
      );

      // Check if should add to blacklist
      if (recentViolations >= this.config.violations.ban_threshold) {
        await this.addToBlacklist(clientIP, 'Persistent violator - automatic ban', 'system');
      }

      console.log(`[Rate Limiter] Applied ${penaltyDuration}s penalty to IP ${clientIP} for ${violationType}`);
    } catch (error) {
      console.error(`[Rate Limiter] Error applying penalty:`, error);
    }
  }

  /**
   * Log violation for tracking
   */
  async logViolation(clientIP, violationType, workerName, request, additional = {}) {
    try {
      const violationData = {
        ip: clientIP,
        type: violationType,
        worker: workerName,
        timestamp: Date.now(),
        user_agent: request.headers.get('User-Agent') || '',
        country: request.cf?.country || 'XX',
        asn: request.cf?.asn || 0,
        additional_data: additional
      };

      // Store individual violation
      const violationId = `violation:${clientIP}:${Date.now()}`;
      await this.env.FAQ_VIOLATIONS.put(
        violationId, 
        JSON.stringify(violationData),
        { expirationTtl: 2592000 } // 30 days
      );

      // Update violation summary
      await this.updateViolationSummary(clientIP, violationType);
      
      console.log(`[Rate Limiter] Logged violation: ${violationType} for IP ${clientIP}`);
    } catch (error) {
      console.error(`[Rate Limiter] Error logging violation:`, error);
    }
  }

  /**
   * Update usage tracking for analytics
   */
  async updateUsageTracking(clientIP, workerName, whitelisted) {
    try {
      const analyticsData = {
        ip: clientIP,
        worker: workerName,
        timestamp: Date.now(),
        whitelisted,
        success: true
      };

      const analyticsKey = `analytics:${clientIP}:${workerName}:${Date.now()}`;
      await this.env.FAQ_ANALYTICS.put(
        analyticsKey,
        JSON.stringify(analyticsData),
        { expirationTtl: 2592000 } // 30 days
      );
    } catch (error) {
      console.error(`[Rate Limiter] Error updating usage tracking:`, error);
    }
  }

  /**
   * Get violation history for IP
   */
  async getViolationHistory(clientIP) {
    try {
      const summaryData = await this.env.FAQ_VIOLATIONS.get(`summary:${clientIP}`, { type: 'json' });
      return summaryData?.violations || [];
    } catch (error) {
      console.error(`[Rate Limiter] Error getting violation history:`, error);
      return [];
    }
  }

  /**
   * Update violation summary
   */
  async updateViolationSummary(clientIP, violationType) {
    try {
      const summaryKey = `summary:${clientIP}`;
      const summaryData = await this.env.FAQ_VIOLATIONS.get(summaryKey, { type: 'json' }) || {
        violations: [],
        total_count: 0,
        last_violation: null
      };

      summaryData.violations.push({
        type: violationType,
        timestamp: Date.now()
      });
      summaryData.total_count++;
      summaryData.last_violation = Date.now();

      // Keep only last 50 violations
      summaryData.violations = summaryData.violations.slice(-50);

      await this.env.FAQ_VIOLATIONS.put(
        summaryKey,
        JSON.stringify(summaryData),
        { expirationTtl: 2592000 } // 30 days
      );
    } catch (error) {
      console.error(`[Rate Limiter] Error updating violation summary:`, error);
    }
  }

  /**
   * Add IP to blacklist
   */
  async addToBlacklist(clientIP, reason, addedBy) {
    try {
      const blacklistData = {
        reason,
        added_by: addedBy,
        added_at: Date.now(),
        active: true
      };

      await this.env.FAQ_IP_BLACKLIST.put(clientIP, JSON.stringify(blacklistData));
      console.log(`[Rate Limiter] Added IP ${clientIP} to blacklist: ${reason}`);
    } catch (error) {
      console.error(`[Rate Limiter] Error adding to blacklist:`, error);
    }
  }

  /**
   * Get usage statistics
   */
  async getUsageStats(clientIP) {
    try {
      const now = new Date();
      return await this.getCurrentUsage(clientIP, 'all', now);
    } catch (error) {
      console.error(`[Rate Limiter] Error getting usage stats:`, error);
      return { hourly: 0, daily: 0, weekly: 0, monthly: 0 };
    }
  }

  /**
   * Get reset times for each window
   */
  getResetTimes(now) {
    const nextHour = new Date(now);
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);

    const nextDay = new Date(now);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(0, 0, 0, 0);

    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + (7 - nextWeek.getDay()));
    nextWeek.setHours(0, 0, 0, 0);

    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
    nextMonth.setHours(0, 0, 0, 0);

    return {
      hourly: nextHour.getTime(),
      daily: nextDay.getTime(),
      weekly: nextWeek.getTime(),
      monthly: nextMonth.getTime()
    };
  }

  /**
   * Get week number
   */
  getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * Administrative functions for managing rate limits
   */

  /**
   * Add IP to whitelist
   */
  async addToWhitelist(clientIP, reason, addedBy) {
    try {
      const whitelistData = {
        reason,
        added_by: addedBy,
        added_at: Date.now(),
        active: true
      };

      await this.env.FAQ_IP_WHITELIST.put(clientIP, JSON.stringify(whitelistData));
      console.log(`[Rate Limiter] Added IP ${clientIP} to whitelist: ${reason}`);
      return { success: true };
    } catch (error) {
      console.error(`[Rate Limiter] Error adding to whitelist:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove IP from blacklist
   */
  async removeFromBlacklist(clientIP) {
    try {
      await this.env.FAQ_IP_BLACKLIST.delete(clientIP);
      console.log(`[Rate Limiter] Removed IP ${clientIP} from blacklist`);
      return { success: true };
    } catch (error) {
      console.error(`[Rate Limiter] Error removing from blacklist:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove IP from whitelist
   */
  async removeFromWhitelist(clientIP) {
    try {
      await this.env.FAQ_IP_WHITELIST.delete(clientIP);
      console.log(`[Rate Limiter] Removed IP ${clientIP} from whitelist`);
      return { success: true };
    } catch (error) {
      console.error(`[Rate Limiter] Error removing from whitelist:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear all blocks for IP
   */
  async clearBlocks(clientIP) {
    try {
      await this.env.FAQ_RATE_LIMITS.delete(`block:${clientIP}`);
      console.log(`[Rate Limiter] Cleared blocks for IP ${clientIP}`);
      return { success: true };
    } catch (error) {
      console.error(`[Rate Limiter] Error clearing blocks:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get analytics data
   */
  async getAnalytics(timeframe = 'daily') {
    try {
      // This would be implemented to aggregate analytics data
      // For now, return basic structure
      return {
        timeframe,
        total_requests: 0,
        blocked_requests: 0,
        violations: 0,
        unique_ips: 0,
        top_violators: [],
        geographic_distribution: {},
        worker_usage: {}
      };
    } catch (error) {
      console.error(`[Rate Limiter] Error getting analytics:`, error);
      return null;
    }
  }
}

import { loadWorkerConfig, loadGlobalSettings } from './dynamic-config.js';

/**
 * Factory function to create rate limiter with dynamic configuration
 * @param {Object} env - Cloudflare environment
 * @param {string} workerName - Name of the worker
 * @param {Object} customConfig - Override configuration
 * @returns {Promise<EnhancedRateLimiter>} Rate limiter instance
 */
export async function createRateLimiter(env, workerName, customConfig = {}) {
  try {
    // Load dynamic configuration from KV storage with CORRECT parameter order
    const config = await loadWorkerConfig(workerName, env);
    const globalSettings = await loadGlobalSettings(env);
    
    // Convert dynamic config format to rate limiter format
    const rateLimiterConfig = {
      limits: {
        hourly: config.hourlyLimit,
        daily: config.dailyLimit,
        weekly: config.weeklyLimit,
        monthly: config.monthlyLimit
      },
      violations: {
        soft_threshold: config.violationThresholds?.soft || 3,
        hard_threshold: config.violationThresholds?.hard || 6,
        ban_threshold: config.violationThresholds?.ban || 12
      },
      // Merge any custom overrides
      ...customConfig,
      // Metadata for tracking
      workerName,
      configSource: config.source || 'default',
      configVersion: config.version || 1,
      lastUpdated: config.lastUpdated,
      globalSettings
    };
    
    console.log(`[Rate Limiter] Loaded ${config.source} config for ${workerName}:`, rateLimiterConfig.limits);
    return new EnhancedRateLimiter(env, rateLimiterConfig);
    
  } catch (error) {
    console.warn(`Failed to load dynamic config for ${workerName}, using fallback:`, error.message);
    
    // Fallback to static configuration
    const fallbackConfig = {
      limits: { hourly: 10, daily: 50, weekly: 250, monthly: 1000 },
      violations: { soft_threshold: 3, hard_threshold: 6, ban_threshold: 12 },
      ...customConfig,
      workerName,
      configSource: 'fallback',
      error: error.message
    };
    
    return new EnhancedRateLimiter(env, fallbackConfig);
  }
}

/**
 * Legacy factory function for backward compatibility
 * @param {Object} config - Static rate limiting configuration
 * @returns {EnhancedRateLimiter} Rate limiter instance
 * @deprecated Use createRateLimiter(env, workerName) for dynamic configuration
 */
export function createStaticRateLimiter(config) {
  console.warn('[Rate Limiter] Using deprecated static configuration. Consider migrating to dynamic config.');
  return new EnhancedRateLimiter(null, config);
}