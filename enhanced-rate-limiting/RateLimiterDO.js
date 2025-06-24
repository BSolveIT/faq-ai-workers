/**
 * RateLimiterDO - Durable Object for Atomic Rate Limit Counter Operations
 * 
 * This Durable Object class provides atomic counter operations for rate limiting
 * across different time windows, fixing race conditions present in KV-based
 * implementations. Each IP gets its own Durable Object instance for isolation.
 * 
 * Features:
 * - Atomic counter operations using Durable Object transactional storage
 * - Multiple time windows (hourly, daily, weekly, monthly)
 * - Automatic window rotation and cleanup
 * - Per-IP isolation using idFromName(clientIP)
 * - UTC time consistency across edge locations
 * - Comprehensive error handling and logging
 * - Integration with centralized logging system
 * - Backwards compatibility with existing data formats
 * 
 * Key Fixes:
 * - Stores data as objects instead of using non-existent metadata parameter
 * - Corrected UTC time handling without double adjustment
 * - Simplified counter retrieval with direct storage access
 * - Fixed cleanup to work with object-stored expiration data
 * - Maintains atomic transaction behavior
 * 
 * Integration:
 * - Bound to workers via RATE_LIMITER_DO binding in wrangler.toml
 * - Works with existing EnhancedRateLimiter public API
 * - Follows same time window calculation logic as current implementation
 * 
 * @author 365i AI FAQ Generator System
 * @version 2.0.0
 * @since 2025-06-24
 */

export class RateLimiterDO {
  /**
   * Durable Object constructor
   * 
   * @param {DurableObjectState} state - Durable Object state
   * @param {Object} env - Cloudflare environment bindings
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
    
    // Configuration for cleanup and logging
    this.config = {
      cleanupIntervalMs: 3600000, // 1 hour
      maxRetentionDays: 31,
      logPrefix: '[RateLimiterDO]'
    };
    
    // Schedule periodic cleanup on construction
    this.scheduleCleanup();
  }

  /**
   * Fetch handler for Durable Object HTTP requests
   * 
   * @param {Request} request - HTTP request
   * @returns {Promise<Response>} HTTP response
   */
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split('/')[1];
    
    try {
      switch (action) {
        case 'increment':
          return await this.handleIncrement(request);
        case 'get':
          return await this.handleGet(request);
        case 'windows':
          return await this.handleGetWindows(request);
        case 'cleanup':
          return await this.handleCleanup(request);
        default:
          return new Response(JSON.stringify({
            error: 'Unknown action',
            available_actions: ['increment', 'get', 'windows', 'cleanup']
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
      }
    } catch (error) {
      this.log('error', `Fetch handler error for action ${action}:`, error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * Handle increment counter request
   * 
   * @param {Request} request - HTTP request with windowType and workerName
   * @returns {Promise<Response>} Response with new counter value
   * @private
   */
  async handleIncrement(request) {
    const { windowType, workerName } = await request.json();
    
    if (!this.isValidWindowType(windowType)) {
      return new Response(JSON.stringify({
        error: 'Invalid window type',
        valid_types: ['hourly', 'daily', 'weekly', 'monthly']
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const result = await this.incrementCounter(windowType, workerName);
    
    return new Response(JSON.stringify({
      success: true,
      counter: result.count,
      window: result.window,
      timestamp: result.timestamp
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle get counter request
   * 
   * @param {Request} request - HTTP request with windowType and workerName
   * @returns {Promise<Response>} Response with current counter value
   * @private
   */
  async handleGet(request) {
    const { windowType, workerName } = await request.json();
    
    if (!this.isValidWindowType(windowType)) {
      return new Response(JSON.stringify({
        error: 'Invalid window type',
        valid_types: ['hourly', 'daily', 'weekly', 'monthly']
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const result = await this.getCounter(windowType, workerName);
    
    return new Response(JSON.stringify({
      success: true,
      counter: result.count,
      window: result.window,
      timestamp: result.timestamp
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle get current windows request
   * 
   * @param {Request} request - HTTP request
   * @returns {Promise<Response>} Response with current window identifiers
   * @private
   */
  async handleGetWindows(request) {
    const windows = await this.getCurrentWindows();
    
    return new Response(JSON.stringify({
      success: true,
      windows,
      timestamp: Date.now()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle cleanup request
   * 
   * @param {Request} request - HTTP request
   * @returns {Promise<Response>} Response with cleanup results
   * @private
   */
  async handleCleanup(request) {
    const result = await this.cleanup();
    
    return new Response(JSON.stringify({
      success: true,
      cleaned_keys: result.cleanedKeys,
      errors: result.errors,
      timestamp: Date.now()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Atomically increment counter for specified window and worker
   * 
   * @param {string} windowType - Type of time window (hourly, daily, weekly, monthly)
   * @param {string} workerName - Name of the worker service
   * @returns {Promise<Object>} Result with counter value and window info
   */
  async incrementCounter(windowType, workerName) {
    const startTime = Date.now();
    
    // Sanitize parameters
    windowType = this.sanitizeStringParam(windowType, 'hourly');
    workerName = this.sanitizeStringParam(workerName, 'unknown-worker');
    
    this.log('debug', `Incrementing counter for window: ${windowType}, worker: ${workerName}`);
    
    try {
      // Generate window key
      const windowInfo = this.generateWindowKey(windowType);
      const storageKey = `counter:${windowType}:${windowInfo.window}:${workerName}`;
      
      // Use atomic transaction for true atomicity
      const result = await this.storage.transaction(async (txn) => {
        // Get current data (backwards compatible)
        const currentData = await txn.get(storageKey);
        let newCount = 1;
        
        if (currentData !== undefined) {
          // Handle backwards compatibility - old format was just a number
          if (typeof currentData === 'number') {
            newCount = currentData + 1;
          } else if (typeof currentData === 'object' && currentData.count !== undefined) {
            newCount = currentData.count + 1;
          }
        }
        
        // Store new data as object with all metadata
        const dataToStore = {
          count: newCount,
          windowType,
          workerName,
          window: windowInfo.window,
          lastIncrement: Date.now(),
          expiresAt: windowInfo.expiresAt
        };
        
        await txn.put(storageKey, dataToStore);
        
        return {
          count: newCount,
          window: windowInfo.window,
          timestamp: Date.now(),
          expiresAt: windowInfo.expiresAt
        };
      });
      
      this.log('info', `Counter incremented for ${windowType}:${windowInfo.window}:${workerName} - New value: ${result.count}`);
      
      return result;
      
    } catch (error) {
      this.log('error', `Failed to increment counter for ${windowType}:${workerName}:`, error);
      throw new Error(`Counter increment failed: ${error.message}`);
    }
  }

  /**
   * Get current counter value without incrementing
   * 
   * @param {string} windowType - Type of time window (hourly, daily, weekly, monthly)
   * @param {string} workerName - Name of the worker service
   * @returns {Promise<Object>} Result with counter value and window info
   */
  async getCounter(windowType, workerName) {
    // Sanitize parameters
    windowType = this.sanitizeStringParam(windowType, 'hourly');
    workerName = this.sanitizeStringParam(workerName, 'unknown-worker');
    
    this.log('debug', `Getting counter for window: ${windowType}, worker: ${workerName}`);
    
    try {
      // Generate window key
      const windowInfo = this.generateWindowKey(windowType);
      const storageKey = `counter:${windowType}:${windowInfo.window}:${workerName}`;
      
      // Direct storage access - much simpler than list operations
      const data = await this.storage.get(storageKey);
      let count = 0;
      let metadata = {};
      
      if (data !== undefined) {
        // Handle backwards compatibility
        if (typeof data === 'number') {
          count = data;
          metadata = { legacyFormat: true };
        } else if (typeof data === 'object' && data.count !== undefined) {
          count = data.count;
          metadata = {
            windowType: data.windowType,
            workerName: data.workerName,
            lastIncrement: data.lastIncrement,
            expiresAt: data.expiresAt
          };
        }
      }
      
      return {
        count,
        window: windowInfo.window,
        timestamp: Date.now(),
        expiresAt: windowInfo.expiresAt,
        metadata
      };
      
    } catch (error) {
      this.log('error', `Failed to get counter for ${windowType}:${workerName}:`, error);
      throw new Error(`Counter retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get current window identifiers for all time periods
   * 
   * @returns {Promise<Object>} Object with current window identifiers
   */
  async getCurrentWindows() {
    this.log('debug', 'Getting current windows for all time periods');
    
    try {
      const windows = {};
      const windowTypes = ['hourly', 'daily', 'weekly', 'monthly'];
      
      for (const windowType of windowTypes) {
        const windowInfo = this.generateWindowKey(windowType);
        windows[windowType] = {
          window: windowInfo.window,
          expiresAt: windowInfo.expiresAt,
          resetTime: windowInfo.resetTime
        };
      }
      
      return windows;
      
    } catch (error) {
      this.log('error', 'Failed to get current windows:', error);
      throw new Error(`Failed to get current windows: ${error.message}`);
    }
  }

  /**
   * Remove expired window data (call periodically)
   * 
   * @returns {Promise<Object>} Cleanup results
   */
  async cleanup() {
    this.log('info', 'Starting cleanup of expired window data');
    
    const startTime = Date.now();
    const cleanedKeys = [];
    const errors = [];
    const cutoffTime = Date.now() - (this.config.maxRetentionDays * 24 * 60 * 60 * 1000);
    
    try {
      // Get all keys from storage
      const allKeys = await this.storage.list();
      
      for (const [key, value] of allKeys) {
        try {
          // Check if key is a counter key
          if (key.startsWith('counter:')) {
            let shouldDelete = false;
            
            // Handle different data formats
            if (typeof value === 'object' && value.expiresAt) {
              // New format with expiration data
              shouldDelete = value.expiresAt < Date.now() || 
                           (value.lastIncrement && value.lastIncrement < cutoffTime);
            } else if (typeof value === 'number') {
              // Legacy format - use key pattern to determine if it's old
              // Extract timestamp from key pattern if possible
              const keyParts = key.split(':');
              if (keyParts.length >= 3) {
                const windowPart = keyParts[2];
                // Try to parse window part to determine age
                const windowAge = this.getWindowAge(windowPart, keyParts[1]);
                if (windowAge && windowAge < cutoffTime) {
                  shouldDelete = true;
                }
              }
            }
            
            if (shouldDelete) {
              await this.storage.delete(key);
              cleanedKeys.push(key);
              this.log('debug', `Cleaned up expired key: ${key}`);
            }
          }
        } catch (keyError) {
          this.log('warn', `Error processing key ${key} during cleanup:`, keyError);
          errors.push({ key, error: keyError.message });
        }
      }
      
      const duration = Date.now() - startTime;
      this.log('info', `Cleanup completed: ${cleanedKeys.length} keys cleaned, ${errors.length} errors, ${duration}ms`);
      
      return {
        cleanedKeys,
        errors,
        duration,
        timestamp: Date.now()
      };
      
    } catch (error) {
      this.log('error', 'Cleanup failed:', error);
      throw new Error(`Cleanup failed: ${error.message}`);
    }
  }

  /**
   * Estimate age of a window based on its identifier
   * 
   * @param {string} windowId - Window identifier (e.g., "2025-06-24-14" for hourly)
   * @param {string} windowType - Type of window (hourly, daily, weekly, monthly)
   * @returns {number|null} Estimated timestamp or null if unable to parse
   * @private
   */
  getWindowAge(windowId, windowType) {
    try {
      switch (windowType) {
        case 'hourly':
          // Format: "2025-06-24-14"
          const [year, month, day, hour] = windowId.split('-').map(Number);
          return new Date(year, month - 1, day, hour).getTime();
          
        case 'daily':
          // Format: "2025-06-24"
          const [dyear, dmonth, dday] = windowId.split('-').map(Number);
          return new Date(dyear, dmonth - 1, dday).getTime();
          
        case 'weekly':
          // Format: "2025-W25" - more complex, return null for now
          return null;
          
        case 'monthly':
          // Format: "2025-06"
          const [myear, mmonth] = windowId.split('-').map(Number);
          return new Date(myear, mmonth - 1, 1).getTime();
          
        default:
          return null;
      }
    } catch (error) {
      this.log('warn', `Failed to parse window age for ${windowId}:`, error);
      return null;
    }
  }

  /**
   * Generate window key for specified time window type
   * 
   * @param {string} windowType - Type of time window
   * @returns {Object} Window information with key and expiration
   * @private
   */
  generateWindowKey(windowType) {
    // Use native UTC methods directly - no incorrect adjustment needed
    const now = new Date();
    
    let window, expiresAt, resetTime;
    
    switch (windowType) {
      case 'hourly':
        window = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}-${String(now.getUTCHours()).padStart(2, '0')}`;
        resetTime = new Date(now);
        resetTime.setUTCHours(resetTime.getUTCHours() + 1, 0, 0, 0);
        expiresAt = resetTime.getTime();
        break;
        
      case 'daily':
        window = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
        resetTime = new Date(now);
        resetTime.setUTCDate(resetTime.getUTCDate() + 1);
        resetTime.setUTCHours(0, 0, 0, 0);
        expiresAt = resetTime.getTime();
        break;
        
      case 'weekly':
        window = `${now.getUTCFullYear()}-W${this.getWeekNumber(now)}`;
        resetTime = new Date(now);
        // Monday is the start of ISO week
        const daysUntilMonday = (8 - resetTime.getUTCDay()) % 7 || 7;
        resetTime.setUTCDate(resetTime.getUTCDate() + daysUntilMonday);
        resetTime.setUTCHours(0, 0, 0, 0);
        expiresAt = resetTime.getTime();
        break;
        
      case 'monthly':
        window = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        resetTime = new Date(now);
        resetTime.setUTCMonth(resetTime.getUTCMonth() + 1, 1);
        resetTime.setUTCHours(0, 0, 0, 0);
        expiresAt = resetTime.getTime();
        break;
        
      default:
        throw new Error(`Invalid window type: ${windowType}`);
    }
    
    return { window, expiresAt, resetTime };
  }

  /**
   * Get ISO week number (ISO 8601 standard)
   * 
   * @param {Date} date - Date to get week number for
   * @returns {number} ISO week number
   * @private
   */
  getWeekNumber(date) {
    // Use the date directly - no need for timezone adjustment
    const utcDate = new Date(date.getTime());
    
    // Set to Thursday of this week (ISO week definition)
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - (utcDate.getUTCDay() || 7));
    
    // Get the year start
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    
    // Calculate week number
    const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
    
    return weekNumber;
  }

  /**
   * Validate window type parameter
   * 
   * @param {string} windowType - Window type to validate
   * @returns {boolean} True if valid
   * @private
   */
  isValidWindowType(windowType) {
    return ['hourly', 'daily', 'weekly', 'monthly'].includes(windowType);
  }

  /**
   * Sanitize string parameter to prevent invalid values
   * 
   * @param {any} param - Parameter to sanitize
   * @param {string} defaultValue - Default value if param is invalid
   * @returns {string} Sanitized string
   * @private
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
        this.log('warn', 'Failed to stringify parameter:', param);
        return defaultValue;
      }
    }
    
    // For any other type, convert to string
    return String(param) || defaultValue;
  }

  /**
   * Schedule periodic cleanup using Durable Object alarms
   * 
   * @private
   */
  scheduleCleanup() {
    // Schedule cleanup to run every hour
    this.state.storage.setAlarm(Date.now() + this.config.cleanupIntervalMs);
  }

  /**
   * Handle Durable Object alarm for periodic cleanup
   * 
   * @returns {Promise<void>}
   */
  async alarm() {
    try {
      this.log('info', 'Running scheduled cleanup via alarm');
      await this.cleanup();
      
      // Schedule next cleanup
      this.scheduleCleanup();
      
    } catch (error) {
      this.log('error', 'Scheduled cleanup failed:', error);
      
      // Still schedule next cleanup even if this one failed
      this.scheduleCleanup();
    }
  }

  /**
   * Centralized logging with consistent format
   * 
   * @param {string} level - Log level (debug, info, warn, error)
   * @param {string} message - Log message
   * @param {any} data - Additional data to log
   * @private
   */
  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      source: 'RateLimiterDO',
      message,
      ...(data && { data })
    };
    
    // Use console methods based on level
    switch (level) {
      case 'error':
        console.error(`${this.config.logPrefix} [${timestamp}] ERROR: ${message}`, data || '');
        break;
      case 'warn':
        console.warn(`${this.config.logPrefix} [${timestamp}] WARN: ${message}`, data || '');
        break;
      case 'info':
        console.log(`${this.config.logPrefix} [${timestamp}] INFO: ${message}`, data || '');
        break;
      case 'debug':
        console.log(`${this.config.logPrefix} [${timestamp}] DEBUG: ${message}`, data || '');
        break;
      default:
        console.log(`${this.config.logPrefix} [${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
    }
  }
}

/**
 * Export default for Cloudflare Workers compatibility
 * This allows the Durable Object to be bound in wrangler.toml
 */
export default RateLimiterDO;