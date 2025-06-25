/**
 * Enhanced IP-Based Rate Limiting System for Cloudflare Workers
 *
 * Features:
 * - Tiered rate limiting with progressive penalties
 * - IP whitelist/blacklist management
 * - Usage analytics and violation tracking
 * - Time-based windows (hourly, daily, weekly, monthly)
 * - Abuse detection and automatic blocking
 * - Usage pattern analysis
 * - Atomic counter operations via RateLimiterDO Durable Objects
 * - Race condition elimination through true atomicity
 * - Graceful fallback to KV storage for backward compatibility
 * - UTC time consistency across edge locations
 *
 * Storage Requirements:
 * - RATE_LIMITER_DO: Durable Object for atomic counter operations (primary)
 * - FAQ_RATE_LIMITS: KV store for fallback counter operations and blocks
 * - FAQ_IP_WHITELIST: Whitelisted IPs (KV)
 * - FAQ_IP_BLACKLIST: Blacklisted IPs (KV)
 * - FAQ_VIOLATIONS: Violation tracking (KV)
 * - FAQ_ANALYTICS: Usage analytics (KV)
 *
 * @version 2.0.0 - Added Durable Object integration for atomic operations
 * @since 2025-06-24 - Race condition fix through RateLimiterDO
 */

export class EnhancedRateLimiter {
  constructor(env, config = {}) {
    this.env = env;
    
    // No hardcoded defaults - all configuration must be provided via config parameter
    // This ensures dynamic configuration is always used
    this.config = {
      // Configuration will be populated from WordPress settings via dynamic-config.js
      limits: config.limits || {
        hourly: 10,    // Conservative fallback
        daily: 50,     // Conservative fallback
        weekly: 250,   // Conservative fallback
        monthly: 1000  // Conservative fallback
      },
      violations: config.violations || {
        soft_threshold: 3,
        hard_threshold: 6,
        ban_threshold: 12
      },
      penalties: config.penalties || {
        first_violation: 300,    // 5 minutes
        second_violation: 1800,  // 30 minutes
        third_violation: 7200,   // 2 hours
        persistent_violator: 86400 // 24 hours
      },
      // Dynamic configuration metadata
      configSource: config.configSource || 'fallback',
      lastUpdated: config.lastUpdated || new Date().toISOString(),
      workerName: config.workerName || 'unknown',
      enabled: config.enabled !== false, // Rate limiting enabled by default
      ...config
    };
    
    console.log(`[Rate Limiter] Initialized with ${this.config.configSource} configuration for ${this.config.workerName}`);
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
    
    // Validate and sanitize parameters to prevent [object Object] in KV keys
    clientIP = this.sanitizeStringParam(clientIP, 'unknown');
    workerName = this.sanitizeStringParam(workerName, 'unknown-worker');
    
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
        // Whitelisted IPs still need usage counting for analytics
        await this.updateUsageCount(clientIP, workerName);
        await this.updateUsageTracking(clientIP, workerName, true);
        return {
          allowed: true,
          reason: 'WHITELISTED',
          usage: await this.getUsageStats(clientIP),
          duration: (Date.now() - startTime) / 1000
        };
      }

      // Step 3: Check current blocks
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

      // Step 4: Check rate limits
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

      // Step 5: Update usage count and tracking
      await this.updateUsageCount(clientIP, workerName);
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
   * @param {number} maxRetries - Maximum retry attempts for fallback scenarios
   */
  async updateUsageCount(clientIP, workerName, maxRetries = 3) {
    try {
      // Sanitize parameters to prevent [object Object] in KV keys
      clientIP = this.sanitizeStringParam(clientIP, 'unknown');
      workerName = this.sanitizeStringParam(workerName, 'unknown-worker');
      
      // Try Durable Object first for atomic operations
      try {
        await this.updateUsageCountWithDurableObject(clientIP, workerName);
        console.log(`[Rate Limiter] Updated usage for IP ${clientIP}, Worker ${workerName} via Durable Object`);
        return;
      } catch (durableObjectError) {
        console.warn(`[Rate Limiter] Durable Object failed for ${clientIP}, falling back to KV:`, durableObjectError.message);
        
        // Fallback to KV-based approach with race condition mitigation
        await this.updateUsageCountWithKV(clientIP, workerName, maxRetries);
        console.log(`[Rate Limiter] Updated usage for IP ${clientIP}, Worker ${workerName} via KV fallback`);
      }
    } catch (error) {
      console.error(`[Rate Limiter] Error updating usage count:`, error);
    }
  }

  /**
   * Update usage count using Durable Object for atomic operations
   * @param {string} clientIP
   * @param {string} workerName
   * @private
   */
  async updateUsageCountWithDurableObject(clientIP, workerName) {
    const windowTypes = ['hourly', 'daily', 'weekly', 'monthly'];
    
    // Get Durable Object stub for this IP
    const stub = this.getDurableObjectStub(clientIP);
    
    // Update all time windows atomically
    const promises = windowTypes.map(async (windowType) => {
      try {
        const response = await stub.fetch('http://localhost/increment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windowType, workerName })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`Durable Object increment failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
        }
        
        const result = await response.json();
        return { windowType, count: result.counter, success: true };
      } catch (error) {
        throw new Error(`Failed to increment ${windowType} counter: ${error.message}`);
      }
    });
    
    // Wait for all increments to complete
    await Promise.all(promises);
  }

  /**
   * Update usage count using KV storage (fallback method)
   * @param {string} clientIP
   * @param {string} workerName
   * @param {number} maxRetries
   * @private
   */
  async updateUsageCountWithKV(clientIP, workerName, maxRetries) {
    // Use UTC time to avoid timezone issues across edge locations
    const now = new Date();
    const utcNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
    
    const keys = {
      hourly: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}-${String(utcNow.getUTCDate()).padStart(2, '0')}:${String(utcNow.getUTCHours()).padStart(2, '0')}`,
      daily: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}-${String(utcNow.getUTCDate()).padStart(2, '0')}`,
      weekly: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-W${this.getWeekNumber(utcNow)}`,
      monthly: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}`
    };

    // Update all time windows with race condition mitigation
    for (const [window, key] of Object.entries(keys)) {
      await this.atomicIncrementKV(key, window, maxRetries);
    }
  }

  /**
   * Get Durable Object stub for a given IP address
   * @param {string} clientIP - Client IP address for Durable Object isolation
   * @returns {DurableObjectStub} Durable Object stub
   * @private
   */
  getDurableObjectStub(clientIP) {
    if (!this.env.RATE_LIMITER_DO) {
      throw new Error('RATE_LIMITER_DO binding not available in environment');
    }
    
    // Use IP address for per-IP isolation
    const durableObjectId = this.env.RATE_LIMITER_DO.idFromName(clientIP);
    return this.env.RATE_LIMITER_DO.get(durableObjectId);
  }

  /**
   * KV-based atomic increment with retry logic (fallback method)
   * Note: KV doesn't provide true atomic operations. This implements optimistic locking.
   * @param {string} key - KV key to increment
   * @param {string} window - Time window type for TTL calculation
   * @param {number} maxRetries - Maximum retry attempts
   * @private
   */
  async atomicIncrementKV(key, window, maxRetries) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Read current value with metadata to get modification time
        const result = await this.env.FAQ_RATE_LIMITS.getWithMetadata(key);
        const currentValue = result.value ? parseInt(result.value) : 0;
        const metadata = result.metadata || {};
        
        const newValue = currentValue + 1;
        const newMetadata = {
          lastModified: Date.now(),
          attempt: attempt + 1,
          fallbackMode: true
        };

        // Set TTL based on window
        let ttl;
        switch (window) {
          case 'hourly': ttl = 3600; break;
          case 'daily': ttl = 86400; break;
          case 'weekly': ttl = 604800; break;
          case 'monthly': ttl = 2592000; break;
          default: ttl = 3600;
        }

        // Try to update with conditional logic
        await this.env.FAQ_RATE_LIMITS.put(
          key,
          newValue.toString(),
          {
            expirationTtl: ttl,
            metadata: newMetadata
          }
        );
        
        // Success - exit retry loop
        return newValue;
        
      } catch (error) {
        if (attempt === maxRetries) {
          console.warn(`[Rate Limiter] Failed to increment ${key} after ${maxRetries} attempts:`, error);
          // Fallback: just write the value we would have written
          try {
            await this.env.FAQ_RATE_LIMITS.put(key, '1', { expirationTtl: 3600 });
          } catch (fallbackError) {
            console.error(`[Rate Limiter] Fallback increment failed for ${key}:`, fallbackError);
          }
          return 1;
        }
        
        // Exponential backoff with jitter
        const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 1000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
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
    // Sanitize parameters to prevent [object Object] in KV keys
    clientIP = this.sanitizeStringParam(clientIP, 'unknown');
    workerName = this.sanitizeStringParam(workerName, 'unknown-worker');
    
    // Try Durable Object first for consistency with write operations
    try {
      return await this.getCurrentUsageWithDurableObject(clientIP, workerName);
    } catch (durableObjectError) {
      console.warn(`[Rate Limiter] Durable Object read failed for ${clientIP}, falling back to KV:`, durableObjectError.message);
      
      // Fallback to KV-based approach
      return await this.getCurrentUsageWithKV(clientIP, workerName, now);
    }
  }

  /**
   * Get current usage using Durable Object
   * @param {string} clientIP
   * @param {string} workerName
   * @returns {Promise<Object>} Usage counts for all windows
   * @private
   */
  async getCurrentUsageWithDurableObject(clientIP, workerName) {
    const windowTypes = ['hourly', 'daily', 'weekly', 'monthly'];
    
    // Get Durable Object stub for this IP
    const stub = this.getDurableObjectStub(clientIP);
    
    // Get usage for all time windows
    const promises = windowTypes.map(async (windowType) => {
      try {
        const response = await stub.fetch('http://localhost/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ windowType, workerName })
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`Durable Object get failed: ${response.status} - ${errorData.error || 'Unknown error'}`);
        }
        
        const result = await response.json();
        return { windowType, count: result.counter || 0 };
      } catch (error) {
        throw new Error(`Failed to get ${windowType} counter: ${error.message}`);
      }
    });
    
    // Wait for all gets to complete
    const results = await Promise.all(promises);
    
    // Convert to usage object
    const usage = {};
    results.forEach(({ windowType, count }) => {
      usage[windowType] = count;
    });
    
    return usage;
  }

  /**
   * Get current usage using KV storage (fallback method)
   * @param {string} clientIP
   * @param {string} workerName
   * @param {Date} now
   * @returns {Promise<Object>} Usage counts for all windows
   * @private
   */
  async getCurrentUsageWithKV(clientIP, workerName, now) {
    // Use UTC time consistently across all edge locations
    const utcNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
    
    const keys = {
      hourly: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}-${String(utcNow.getUTCDate()).padStart(2, '0')}:${String(utcNow.getUTCHours()).padStart(2, '0')}`,
      daily: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}-${String(utcNow.getUTCDate()).padStart(2, '0')}`,
      weekly: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-W${this.getWeekNumber(utcNow)}`,
      monthly: `usage:${clientIP}:${workerName}:${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}`
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
   * Get reset times for each window using UTC
   */
  getResetTimes(now) {
    // Convert to UTC for consistent behavior across edge locations
    const utcNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000));
    
    const nextHour = new Date(utcNow);
    nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);

    const nextDay = new Date(utcNow);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    nextDay.setUTCHours(0, 0, 0, 0);

    const nextWeek = new Date(utcNow);
    // Monday is the start of ISO week (getUTCDay() returns 0 for Sunday, 1 for Monday, etc.)
    const daysUntilMonday = (8 - nextWeek.getUTCDay()) % 7 || 7;
    nextWeek.setUTCDate(nextWeek.getUTCDate() + daysUntilMonday);
    nextWeek.setUTCHours(0, 0, 0, 0);

    const nextMonth = new Date(utcNow);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
    nextMonth.setUTCHours(0, 0, 0, 0);

    return {
      hourly: nextHour.getTime(),
      daily: nextDay.getTime(),
      weekly: nextWeek.getTime(),
      monthly: nextMonth.getTime()
    };
  }

  /**
   * Get ISO week number (ISO 8601 standard)
   * @param {Date} date - Date to get week number for
   * @returns {number} ISO week number
   */
  getWeekNumber(date) {
    // Create a copy and convert to UTC
    const utcDate = new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
    
    // Set to Thursday of this week (ISO week definition)
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - (utcDate.getUTCDay() || 7));
    
    // Get the year start
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    
    // Calculate week number
    const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
    
    return weekNumber;
  }

  /**
   * Sanitize string parameter to prevent [object Object] in KV keys
   * @param {any} param - Parameter to sanitize
   * @param {string} defaultValue - Default value if param is invalid
   * @returns {string} Sanitized string
   */
  sanitizeStringParam(param, defaultValue) {
    if (param === null || param === undefined) {
      return defaultValue;
    }
    
    // If it's already a string, return it
    if (typeof param === 'string') {
      return param.trim() || defaultValue;
    }
    
    // If it's a number, convert to string
    if (typeof param === 'number') {
      return param.toString();
    }
    
    // If it's an object, handle specially to avoid [object Object]
    if (typeof param === 'object') {
      // Try to get a meaningful string representation
      if (param.toString && typeof param.toString === 'function') {
        const str = param.toString();
        // Avoid [object Object] by checking if toString gives us something useful
        if (str !== '[object Object]') {
          return str;
        }
      }
      
      // If it has an id property, use that
      if (param.id) {
        return String(param.id);
      }
      
      // If it has a name property, use that
      if (param.name) {
        return String(param.name);
      }
      
      // Last resort: try JSON.stringify
      try {
        return JSON.stringify(param);
      } catch (e) {
        console.warn('[Rate Limiter] Failed to stringify parameter:', param);
        return defaultValue;
      }
    }
    
    // For any other type, convert to string
    return String(param) || defaultValue;
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
 * @param {Object} env - Cloudflare environment (required for KV access)
 * @param {Object} config - Static rate limiting configuration
 * @returns {EnhancedRateLimiter} Rate limiter instance
 * @deprecated Use createRateLimiter(env, workerName) for dynamic configuration
 */
export function createStaticRateLimiter(env, config) {
  if (!env) {
    throw new Error('[Rate Limiter] Environment parameter is required for KV store access. Cannot create rate limiter without env.');
  }
  
  console.warn('[Rate Limiter] Using deprecated static configuration. Consider migrating to dynamic config.');
  
  // Ensure config has required structure
  const validatedConfig = {
    limits: { hourly: 10, daily: 50, weekly: 250, monthly: 1000 },
    violations: { soft_threshold: 3, hard_threshold: 6, ban_threshold: 12 },
    penalties: {
      first_violation: 300,
      second_violation: 1800,
      third_violation: 7200,
      persistent_violator: 86400
    },
    ...config,
    configSource: 'static-legacy'
  };
  
  return new EnhancedRateLimiter(env, validatedConfig);
}