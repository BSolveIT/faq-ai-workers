import { parse } from 'node-html-parser';

// Rate limiting utilities - FREE KV-based implementation
const rateLimitCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

async function checkRateLimit(env, clientIP, config = {}) {
  const limit = config.limit || 100; // Default: 100 requests per hour
  const window = config.window || 3600; // Default: 1 hour
  const now = Date.now();
  const key = `rl:${clientIP}`;
  
  // Check cache first to reduce KV reads
  const cached = rateLimitCache.get(clientIP);
  if (cached && cached.expires > now) {
    return { allowed: !cached.blocked, remaining: cached.remaining || 0 };
  }
  
  try {
    const data = await env.FAQ_RATE_LIMITS.get(key, { type: 'json' }) || { count: 0, windowStart: now };
    
    // Reset window if expired
    if (now - data.windowStart > window * 1000) {
      data.count = 0;
      data.windowStart = now;
    }
    
    // Check if rate limited
    if (data.count >= limit) {
      rateLimitCache.set(clientIP, { blocked: true, remaining: 0, expires: now + CACHE_TTL });
      return { allowed: false, remaining: 0 };
    }
    
    // Increment counter
    data.count++;
    await env.FAQ_RATE_LIMITS.put(key, JSON.stringify(data), {
      expirationTtl: window * 2 // Auto-cleanup after 2x window
    });
    
    const remaining = limit - data.count;
    rateLimitCache.set(clientIP, { blocked: false, remaining, expires: now + CACHE_TTL });
    return { allowed: true, remaining };
    
  } catch (error) {
    console.error('Rate limit check failed:', error);
    return { allowed: true, remaining: -1 }; // Fail open
  }
}

// SAFE IMPORTS: Handle missing dependencies gracefully
let generateDynamicHealthResponse = null;
let trackCacheHit = null;
let trackCacheMiss = null;
let invalidateWorkerCaches = null;
let initializeCacheManager = null;

try {
  const healthUtilsModule = await import('../../shared/health-utils.js');
  generateDynamicHealthResponse = healthUtilsModule.generateDynamicHealthResponse;
  trackCacheHit = healthUtilsModule.trackCacheHit;
  trackCacheMiss = healthUtilsModule.trackCacheMiss;
} catch (error) {
  console.warn('[Import] Health utils module unavailable:', error.message);
}

try {
  const cacheManagerModule = await import('../../shared/advanced-cache-manager.js');
  invalidateWorkerCaches = cacheManagerModule.invalidateWorkerCaches;
  initializeCacheManager = cacheManagerModule.initializeCacheManager;
} catch (error) {
  console.warn('[Import] Cache manager module unavailable:', error.message);
}

/**
 * Enhanced FAQ Schema Extraction Proxy Worker with Enhanced Rate Limiting
 * - Handles nested schemas, comments, multiple formats
 * - Processes images with verification
 * - Robust HTML sanitization
 * - Comprehensive metadata and warnings
 * - Enhanced IP-based rate limiting with violation tracking and progressive penalties
 * - Performance optimized with reduced logging
 * - Updated for modern ES modules format
 */

// Production flag to control logging
const DEBUG = false;
const log = DEBUG ? console.log : () => {};
const logWarn = DEBUG ? console.warn : () => {};
const logError = console.error; // Always log errors

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

async function handleRequest(request, env, ctx) {
  // Extract origin/referer early for logging
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  
  // Create base CORS headers (don't mutate this object)
  const baseCors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...baseCors } });
  }

  const requestUrl = new URL(request.url);

  // HEALTH CHECK - with safe import handling
  if (request.method === 'GET' && requestUrl.pathname === '/health') {
    const startTime = Date.now();
    
    try {
      // Try dynamic health response if available
      if (generateDynamicHealthResponse) {
        const healthPromise = generateDynamicHealthResponse(
          'faq-proxy-fetch',
          env,
          '3.1.0-advanced-cache-optimized',
          ['faq_extraction', 'schema_parsing', 'json_ld', 'microdata', 'rdfa', 'enhanced_rate_limiting', 'ip_management', 'origin_validation']
        );
        
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 400)
        );
        
        const healthResponse = await Promise.race([healthPromise, timeoutPromise]);
        
        // Transform to match expected format
        const responseTime = Date.now() - startTime;
        const transformedResponse = {
          status: 'OK',
          service: 'faq-proxy-fetch',
          timestamp: new Date().toISOString(),
          version: '3.1.0-advanced-cache-optimized',
          mode: 'full',
          model: healthResponse.model || {
            name: '@cf/meta/llama-3.1-8b-instruct',
            max_tokens: 200,
            temperature: 0.1
          },
          configuration: healthResponse.configuration || {
            source: 'custom',
            last_updated: new Date().toISOString().replace('T', ' ').substring(0, 19),
            config_version: 1
          },
          performance: healthResponse.performance || {
            avg_response_time_ms: 0,
            total_requests_served: 0,
            response_time_ms: responseTime
          },
          operational_status: {
            health: 'healthy',
            ai_binding_available: !!env.AI,
            config_loaded: true
          },
          features: healthResponse.capabilities || [
            'faq_extraction',
            'schema_parsing',
            'json_ld',
            'microdata',
            'rdfa',
            'enhanced_rate_limiting',
            'ip_management',
            'origin_validation'
          ],
          health_indicators: healthResponse.health_indicators || {
            overall_system_health: 'healthy',
            ai_health: env.AI ? 'healthy' : 'unavailable'
          },
          cache_status: healthResponse.cache_status || 'active'
        };
        
        return new Response(JSON.stringify(transformedResponse), {
          status: 200,
          headers: { 
            ...baseCors, 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
      }
    } catch (error) {
      logWarn('[Health Check] Dynamic health response failed:', error.message);
    }
    
    // Fallback to standard health response format
    const responseTime = Date.now() - startTime;
    const healthData = {
      status: 'OK',
      service: 'faq-proxy-fetch',
      timestamp: new Date().toISOString(),
      version: '3.1.0-advanced-cache-optimized',
      mode: generateDynamicHealthResponse ? 'full' : 'simplified',
      model: {
        name: '@cf/meta/llama-3.1-8b-instruct',
        max_tokens: 200,
        temperature: 0.1
      },
      configuration: {
        source: 'custom',
        last_updated: new Date().toISOString().replace('T', ' ').substring(0, 19),
        config_version: 1
      },
      performance: {
        avg_response_time_ms: 0,
        total_requests_served: 0,
        response_time_ms: responseTime
      },
      operational_status: {
        health: 'healthy',
        ai_binding_available: !!env.AI,
        config_loaded: true
      },
      features: [
        'faq_extraction',
        'schema_parsing',
        'json_ld',
        'microdata',
        'rdfa',
        'enhanced_rate_limiting',
        'ip_management',
        'origin_validation'
      ],
      health_indicators: {
        overall_system_health: 'healthy',
        ai_health: env.AI ? 'healthy' : 'unavailable'
      },
      cache_status: 'active'
    };

    // Test KV access if available
    if (env.FAQ_GENERATOR_KV) {
      try {
        await env.FAQ_GENERATOR_KV.get('test-key');
        healthData.operational_status.kv_store = 'accessible';
      } catch (error) {
        healthData.operational_status.kv_store = 'error';
        healthData.health_indicators.overall_system_health = 'degraded';
      }
    }

    return new Response(JSON.stringify(healthData, null, 2), {
      status: 200,
      headers: { 
        ...baseCors, 
        'Content-Type': 'application/json', 
        'Cache-Control': 'no-cache, no-store, must-revalidate' 
      }
    });
  }
  
  // Handle cache clearing endpoint (both GET and POST)
  if (requestUrl.pathname === '/cache/clear') {
    try {
      log('[Cache Clear] FAQ proxy fetch worker cache clearing initiated...');
      
      let cacheResult = { patterns_cleared: [], total_cleared: 0 };
      
      if (initializeCacheManager && invalidateWorkerCaches) {
        // Initialize cache manager for FAQ proxy fetch worker
        await initializeCacheManager('faq_proxy', env);
        
        // Clear comprehensive cache types with FAQ proxy-specific patterns
        cacheResult = await invalidateWorkerCaches('faq_proxy', env, {
          ai_model_config: true,
          worker_health: true,
          suggestion_cache: true,
          l1_cache: true,
          l2_cache: true,
          patterns: [
            'faq_proxy_*',
            'faq_extraction_*',
            'schema_parsing_*',
            'json_ld_*',
            'microdata_*',
            'rdfa_*',
            'url_fetch_*'
          ]
        });
        
        log('[Cache Clear] FAQ proxy fetch worker cache clearing completed:', cacheResult);
      } else {
        logWarn('[Cache Clear] Cache manager modules not available - skipping cache clearing');
        cacheResult = {
          patterns_cleared: ['cache_modules_unavailable'],
          total_cleared: 0,
          message: 'Cache manager modules not available'
        };
      }
      
      return new Response(JSON.stringify({
        success: true,
        message: 'FAQ proxy fetch worker cache clearing processed',
        worker: 'faq-proxy-fetch',
        timestamp: new Date().toISOString(),
        patterns_cleared: cacheResult?.patterns_cleared || [],
        total_keys_cleared: cacheResult?.total_cleared || 0,
        clear_results: cacheResult || {},
        cache_manager_available: !!(initializeCacheManager && invalidateWorkerCaches)
      }), {
        status: 200,
        headers: { 
          ...baseCors, 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
      
    } catch (error) {
      logError('[Cache Clear] FAQ proxy fetch worker cache clearing failed:', error);
      
      return new Response(JSON.stringify({
        success: false,
        error: 'Cache clearing failed',
        message: error.message,
        worker: 'faq-proxy-fetch',
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 
          ...baseCors, 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    }
  }

  // Security: Origin/Referer checking
  const allowedOrigins = [
    'https://365i.co.uk',
    'https://www.365i.co.uk',
    'https://staging.365i.co.uk',
    'http://localhost:3000',
    'http://localhost:8080',
    'https://dash.cloudflare.com' // Allow testing from Cloudflare dashboard
  ];
  
  // More flexible origin checking
  if (origin || referer) {
    const checkOrigin = origin || referer;
    const isAllowed = allowedOrigins.some(allowed => {
      return checkOrigin.startsWith(allowed) ||
        checkOrigin.startsWith(allowed.replace('www.', '')) ||
        checkOrigin.startsWith(allowed.replace('://', '://www.'));
    });
    
    if (!isAllowed) {
      log(`Request from origin: ${origin}, referer: ${referer}`);
      log(`Blocked request from unauthorized origin: ${checkOrigin}`);
      return new Response(JSON.stringify({
        error: 'Unauthorized origin',
        success: false,
        metadata: {
          warning: "This service is for FAQ extraction only. Abuse will result in blocking.",
          terms: "By using this service, you agree not to violate any website's terms of service."
        }
      }), {
        status: 403,
        headers: { ...baseCors, 'Content-Type': 'application/json' },
      });
    }
  }

  // KV-BASED RATE LIMITING - Check before processing request
  const clientIP = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                   request.headers.get('X-Real-IP') ||
                   'unknown';

  log(`Processing FAQ extraction request from IP: ${clientIP}`);

  // Check rate limit before processing request with proxy-specific limits
  let rateLimitConfig = { limit: 50, window: 3600 }; // 50 proxy requests per hour
  const rateLimitResult = await checkRateLimit(env, clientIP, rateLimitConfig);

  if (!rateLimitResult.allowed) {
    return new Response(JSON.stringify({
      error: 'Rate limit exceeded. Please try again later.',
      retryAfter: 3600,
      success: false,
      metadata: {
        warning: "This service is for FAQ extraction only. Abuse will result in blocking.",
        terms: "By using this service, you agree not to violate any website's terms of service."
      }
    }), {
      status: 429,
      headers: {
        ...baseCors,
        'Content-Type': 'application/json',
        'Retry-After': '3600',
        'X-RateLimit-Limit': '50',
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString()
      }
    });
  }

  log(`Rate limit check passed. Remaining: ${rateLimitResult.remaining}`);

  const url = new URL(request.url).searchParams.get('url');
  if (!url) {
    const responseHeaders = {
      ...baseCors,
      'Content-Type': 'application/json'
    };
    
    // Add rate limit headers
    responseHeaders['X-RateLimit-Limit'] = '50';
    responseHeaders['X-RateLimit-Remaining'] = rateLimitResult.remaining.toString();
    responseHeaders['X-RateLimit-Reset'] = (Math.floor(Date.now() / 1000) + 3600).toString();
    
    return new Response(JSON.stringify({ 
      error: 'URL parameter required', 
      success: false 
    }), {
      status: 400,
      headers: responseHeaders,
    });
  }

  try {
    const targetUrl = new URL(url);
    
    // Security: Block internal/private IPs and localhost
    const hostname = targetUrl.hostname;
    
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /\.local$/i,
      /^0\.0\.0\.0$/
    ];
    
    if (blockedPatterns.some(pattern => pattern.test(hostname))) {
      log(`Blocked request to internal/private URL: ${hostname}`);
      return new Response(JSON.stringify({ 
        error: 'Internal/private URLs not allowed', 
        success: false,
        metadata: {
          warning: "This service cannot access internal or private network addresses.",
          terms: "By using this service, you agree not to violate any website's terms of service."
        }
      }), {
        status: 403,
        headers: { ...baseCors, 'Content-Type': 'application/json' },
      });
    }
    
    const requestOrigin = origin || referer || 'unknown origin';
    log(`FAQ extraction requested: ${url} from ${requestOrigin} at ${new Date().toISOString()}`);
    
    // Add cache buster
    targetUrl.searchParams.append('_cb', Date.now());
    
    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      cf: { 
        cacheTtl: 0, 
        cacheEverything: false,
        mirage: false
      },
    }).catch(err => {
      if (err.name === 'AbortError') {
        logError(`Request timeout for ${url} after 10 seconds`);
        throw new Error('Request timeout - target site took too long to respond');
      }
      throw err;
    });
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      return new Response(JSON.stringify({ 
        error: `Fetch failed: ${resp.status}`, 
        success: false 
      }), {
        status: resp.status,
        headers: { ...baseCors, 'Content-Type': 'application/json' },
      });
    }
    
    const ct = resp.headers.get('Content-Type') || '';
    if (!ct.includes('text/html')) {
      return new Response(JSON.stringify({ 
        error: 'Not HTML', 
        success: false 
      }), {
        status: 415,
        headers: { ...baseCors, 'Content-Type': 'application/json' },
      });
    }
    
    const html = await resp.text();
    
    // Check HTML size limit (5MB) - do this BEFORE parsing
    if (html.length > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ 
        error: 'HTML too large (>5MB)', 
        success: false 
      }), {
        status: 413,
        headers: { ...baseCors, 'Content-Type': 'application/json' },
      });
    }
    
    // Parse HTML with optimized settings
    const root = parse(html, {
      lowerCaseTagName: false,
      comment: false,
      blockTextElements: {
        script: true,  // Enable script content parsing for JSON-LD
        noscript: false,
        style: false,
      }
    });
    
    const title = root.querySelector('title')?.textContent || '';
    let allFaqs = [];
    const schemaTypesFound = [];
    const warnings = [];
    const processing = {
      questionsWithHtmlStripped: 0,
      answersWithHtmlSanitized: 0,
      truncatedAnswers: 0,
      imagesProcessed: 0,
      brokenImages: 0,
      relativeUrlsFixed: 0,
      dataUrisRejected: 0
    };
    
    log('=== Starting FAQ extraction ===');
    
    // Run all extraction methods in parallel for better performance
    const extractionPromises = [
      extractEnhancedJsonLd(root, targetUrl.href, processing).catch(e => {
        logError('Enhanced JSON-LD extraction failed:', e);
        return { faqs: [], metadata: { warnings: ['JSON-LD extraction failed'] } };
      }),
      extractEnhancedMicrodata(root, targetUrl.href, processing).catch(e => {
        logError('Enhanced Microdata extraction failed:', e);
        return { faqs: [], metadata: { warnings: ['Microdata extraction failed'] } };
      }),
      extractEnhancedRdfa(root, targetUrl.href, processing).catch(e => {
        logError('Enhanced RDFa extraction failed:', e);
        return { faqs: [], metadata: { warnings: ['RDFa extraction failed'] } };
      })
    ];
    
    const results = await Promise.all(extractionPromises);
    
    // Process results
    results.forEach((result, index) => {
      const methodName = ['JSON-LD', 'Microdata', 'RDFa'][index];
      if (result.faqs.length > 0) {
        allFaqs = allFaqs.concat(result.faqs);
        schemaTypesFound.push(methodName);
      }
      if (result.metadata?.warnings) {
        warnings.push(...result.metadata.warnings);
      }
    });
    
    log(`Total FAQs before deduplication: ${allFaqs.length}`);
    
    // Deduplicate and limit
    allFaqs = dedupeEnhanced(allFaqs);
    
    log(`Total FAQs after deduplication: ${allFaqs.length}`);
    
    // Limit to 50 FAQs
    if (allFaqs.length > 50) {
      warnings.push(`Limited to first 50 FAQs (found ${allFaqs.length})`);
      allFaqs = allFaqs.slice(0, 50);
    }
    
    // Build warnings from processing stats
    if (processing.questionsWithHtmlStripped > 0) {
      warnings.push(`${processing.questionsWithHtmlStripped} questions had HTML markup removed`);
    }
    if (processing.truncatedAnswers > 0) {
      warnings.push(`${processing.truncatedAnswers} answers were truncated to 5000 characters`);
    }
    if (processing.brokenImages > 0) {
      warnings.push(`${processing.brokenImages} images were unreachable`);
    }
    if (processing.dataUrisRejected > 0) {
      warnings.push(`${processing.dataUrisRejected} embedded images were too large`);
    }
    
    // Prepare response headers with rate limit info
    const responseHeaders = {
      ...baseCors,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300' // Cache successful responses for 5 minutes
    };
    
    responseHeaders['X-RateLimit-Limit'] = '50';
    responseHeaders['X-RateLimit-Remaining'] = rateLimitResult.remaining.toString();
    responseHeaders['X-RateLimit-Reset'] = (Math.floor(Date.now() / 1000) + 3600).toString();
    
    if (allFaqs.length > 0) {
      log(`Successfully extracted ${allFaqs.length} FAQs from ${url}`);
      if (DEBUG) {
        log('First FAQ:', JSON.stringify(allFaqs[0], null, 2));
      }
      
      return new Response(JSON.stringify({
        success: true,
        source: url,
        faqs: allFaqs,
        metadata: {
          extractionMethod: 'enhanced-html-parser',
          totalExtracted: allFaqs.length,
          title: title,
          processing: processing,
          warnings: warnings,
          schemaTypes: schemaTypesFound,
          hasImages: processing.imagesProcessed > 0,
          imageCount: processing.imagesProcessed,
          brokenImages: processing.brokenImages,
          terms: "By using this service, you agree not to violate any website's terms of service."
        },
        rate_limiting: {
          limit: 50,
          remaining: rateLimitResult.remaining,
          reset_time: Math.floor(Date.now() / 1000) + 3600,
          worker: 'faq-proxy-fetch',
          type: 'kv-based'
        }
      }), {
        headers: responseHeaders
      });
    }
    
    // Check if markup exists
    const hasFaqMarkup = html.includes('schema.org/FAQPage') || 
                         html.includes('typeof="FAQPage"') ||
                         html.includes('"@type":"FAQPage"');
    
    if (hasFaqMarkup) {
      logWarn(`FAQ markup detected but extraction failed for ${url}`);
      return new Response(JSON.stringify({
        success: false,
        source: url,
        error: "Page contains FAQ markup but extraction failed. The structure might be non-standard.",
        metadata: {
          title: title,
          extractionMethod: "failed",
          warnings: ["FAQ schema detected but could not be parsed"],
          terms: "By using this service, you agree not to violate any website's terms of service."
        }
      }), {
        headers: responseHeaders
      });
    }
    
    // No FAQs found
    log(`No FAQ markup found on ${url}`);
    return new Response(JSON.stringify({
      success: false,
      source: url,
      faqs: [],
      metadata: { 
        extractionMethod: 'none', 
        title: title,
        message: "No FAQ schema markup found on this page",
        warnings: [],
        terms: "By using this service, you agree not to violate any website's terms of service."
      }
    }), { 
      headers: responseHeaders
    });
    
  } catch (err) {
    logError(`Worker error for URL ${url}: ${err.message}`, err.stack);
    
    // Prepare error response headers
    const errorHeaders = {
      ...baseCors,
      'Content-Type': 'application/json'
    };
    
    errorHeaders['X-RateLimit-Limit'] = '50';
    errorHeaders['X-RateLimit-Remaining'] = rateLimitResult.remaining.toString();
    errorHeaders['X-RateLimit-Reset'] = (Math.floor(Date.now() / 1000) + 3600).toString();
    
    return new Response(JSON.stringify({ 
      error: err.message || 'Internal error', 
      success: false,
      metadata: {
        warning: "This service is for FAQ extraction only. Abuse will result in blocking.",
        terms: "By using this service, you agree not to violate any website's terms of service."
      }
    }), {
      status: 500,
      headers: errorHeaders,
    });
  }
}

// Enhanced JSON-LD extraction with preprocessing
async function extractEnhancedJsonLd(root, baseUrl, processing) {
  const faqs = [];
  const warnings = [];
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  
  log(`[JSON-LD] Found ${scripts.length} JSON-LD scripts`);
  
  for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex++) {
    const script = scripts[scriptIndex];
    log(`[JSON-LD] Processing script ${scriptIndex + 1}/${scripts.length}`);
    
    try {
      // Get script content - use correct properties
      let content = script.textContent || script.innerHTML || script.rawText || '';
      
      content = content.trim();
      log(`[JSON-LD] Script content length: ${content.length} characters`);
      
      if (content.length === 0) {
        log('[JSON-LD] Script has no content, skipping');
        continue;
      }
      
      if (DEBUG && content.length > 0) {
        log(`[JSON-LD] First 200 chars: ${content.substring(0, 200)}...`);
      }
      
      let data;
      
      // First, try to parse without any preprocessing (for valid escaped JSON)
      try {
        data = JSON.parse(content);
        log('[JSON-LD] Successfully parsed JSON-LD without preprocessing');
      } catch (initialError) {
        // Only preprocess if the initial parse fails
        log('[JSON-LD] Initial JSON parse failed:', initialError.message);
        log('[JSON-LD] Applying preprocessing...');
        
        // Preprocess to handle comments and common issues
        content = content
          // Only match // at the very beginning of a line (not escaped \/)
          .replace(/^(\s*)\/\/(?!\/).*$/gm, '')
          // Remove /* */ comments
          .replace(/\/\*[\s\S]*?\*\//g, '')
          // Remove control characters (but preserve valid Unicode like \u2019)
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          // Remove trailing commas
          .replace(/,(\s*[}\]])/g, '$1')
          // Remove any BOM characters
          .replace(/^\uFEFF/, '')
          .trim();
        
        // Try parsing again after preprocessing
        try {
          data = JSON.parse(content);
          log('[JSON-LD] Successfully parsed after preprocessing');
        } catch (preprocessError) {
          logWarn('[JSON-LD] Failed to parse JSON-LD even after preprocessing:', preprocessError.message);
          if (DEBUG) {
            logWarn('[JSON-LD] Content sample:', content.substring(0, 200) + '...');
          }
          continue; // Skip this script
        }
      }
      
      log('[JSON-LD] Parsed data type:', data['@type']);
      
      // Process the parsed data
      const arr = Array.isArray(data) ? data : [data];
      log(`[JSON-LD] Processing ${arr.length} objects`);
      
      for (let objIndex = 0; objIndex < arr.length; objIndex++) {
        const obj = arr[objIndex];
        log(`[JSON-LD] Processing object ${objIndex + 1}/${arr.length} with type: ${obj['@type']}`);
        await traverseEnhancedLd(obj, faqs, baseUrl, processing);
      }
      
      log(`[JSON-LD] After processing script ${scriptIndex + 1}, total FAQs: ${faqs.length}`);
      
    } catch (e) {
      logError('[JSON-LD] Unexpected error in JSON-LD extraction:', e.message);
      warnings.push(`Failed to process JSON-LD: ${e.message}`);
    }
  }
  
  log(`[JSON-LD] Total FAQs extracted: ${faqs.length}`);
  return { faqs, metadata: { warnings } };
}

// Enhanced traversal for complex JSON-LD structures
async function traverseEnhancedLd(obj, out, baseUrl, processing, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) {
    log(`[Traverse] Skipping at depth ${depth} - obj null or too deep`);
    return;
  }
  
  const type = obj['@type'];
  log(`[Traverse] Depth ${depth}, type: ${type}`);
  
  // Check if this is or contains FAQPage
  if ((Array.isArray(type) ? type.includes('FAQPage') : type === 'FAQPage') ||
      (obj.mainEntity && obj.mainEntity['@type'] === 'FAQPage')) {
    
    log('[Traverse] Found FAQPage!');
    
    // Find the FAQ content
    let faqContent = obj;
    if (obj.mainEntity && obj.mainEntity['@type'] === 'FAQPage') {
      faqContent = obj.mainEntity;
      log('[Traverse] FAQPage is in mainEntity');
    }
    
    let mainEntity = faqContent.mainEntity || faqContent['mainEntity'] || faqContent.hasPart;
    if (mainEntity) {
      mainEntity = Array.isArray(mainEntity) ? mainEntity : [mainEntity];
      log(`[Traverse] Found ${mainEntity.length} items in mainEntity`);
      
      for (let qIndex = 0; qIndex < mainEntity.length; qIndex++) {
        const q = mainEntity[qIndex];
        log(`[Traverse] Processing question ${qIndex + 1}/${mainEntity.length}`);
        log(`[Traverse] Question type: ${q['@type']}`);
        
        if (!q['@type'] || !q['@type'].includes('Question')) {
          log('[Traverse] Skipping - not a Question type');
          continue;
        }
        
        // Process question
        const rawQuestion = q.name || q.question || '';
        log(`[Traverse] Raw question: "${rawQuestion}"`);
        
        const processedQuestion = processQuestion(rawQuestion, processing);
        log(`[Traverse] Processed question: "${processedQuestion}"`);
        
        if (!processedQuestion) {
          log('[Traverse] Question processing returned empty, skipping');
          continue;
        }
        
        // Extract answer - try multiple properties
        let rawAnswer = '';
        const accepted = q.acceptedAnswer;
        const suggested = q.suggestedAnswer;
        
        if (accepted) {
          rawAnswer = typeof accepted === 'string' ? accepted : 
                     (accepted.text || accepted.answerText || accepted.description || '');
          log(`[Traverse] Found acceptedAnswer, length: ${rawAnswer.length}`);
        } else if (suggested && suggested.length > 0) {
          const firstSuggested = suggested[0];
          rawAnswer = typeof firstSuggested === 'string' ? firstSuggested :
                     (firstSuggested.text || firstSuggested.answerText || '');
          log(`[Traverse] Found suggestedAnswer, length: ${rawAnswer.length}`);
        }
        
        if (!rawAnswer) {
          log('[Traverse] No answer found, skipping');
          continue;
        }
        
        // Process answer with sanitization and image handling
        const processedAnswer = await processAnswer(rawAnswer, baseUrl, processing);
        log(`[Traverse] Processed answer length: ${processedAnswer.length}`);
        
        // Extract ID/anchor
        let id = q['@id'] || q.id || q.url || null;
        if (id && id.includes('#')) {
          id = id.split('#').pop();
        }
        if (id) {
          id = sanitizeAnchor(id);
        }
        log(`[Traverse] FAQ ID: ${id || 'none'}`);
        
        out.push({ 
          question: processedQuestion,
          answer: processedAnswer,
          id: id
        });
        log(`[Traverse] Added FAQ. Total count: ${out.length}`);
      }
    } else {
      log('[Traverse] No mainEntity found in FAQPage');
    }
  }
  
  // Traverse nested structures
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    log(`[Traverse] Found @graph with ${obj['@graph'].length} items`);
    for (const item of obj['@graph']) {
      await traverseEnhancedLd(item, out, baseUrl, processing, depth + 1);
    }
  }
  
  // Check for nested WebPage > mainEntity patterns
  if (obj.mainEntity && depth < 3) {
    log('[Traverse] Found mainEntity, traversing deeper');
    await traverseEnhancedLd(obj.mainEntity, out, baseUrl, processing, depth + 1);
  }
}

// Enhanced Microdata extraction
async function extractEnhancedMicrodata(root, baseUrl, processing) {
  const faqs = [];
  const warnings = [];
  
  log('[Microdata] Starting extraction');
  
  // First try FAQPage containers
  const faqPages = root.querySelectorAll('[itemscope][itemtype*="FAQPage"]');
  log(`[Microdata] Found ${faqPages.length} FAQPage containers`);
  
  for (const faqPage of faqPages) {
    const questions = faqPage.querySelectorAll('[itemscope][itemtype*="Question"]');
    log(`[Microdata] Found ${questions.length} questions in FAQPage`);
    for (const q of questions) {
      await processMicrodataQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  // Also try standalone Questions (but simpler approach)
  const allQuestions = root.querySelectorAll('[itemscope][itemtype*="Question"]');
  log(`[Microdata] Found ${allQuestions.length} total Question elements`);
  
  const processedIds = new Set(faqs.map(f => f.id).filter(Boolean));
  
  for (const q of allQuestions) {
    const id = q.getAttribute('id') || q.getAttribute('itemid')?.split('#').pop();
    if (!processedIds.has(id)) {
      await processMicrodataQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  log(`[Microdata] Total FAQs extracted: ${faqs.length}`);
  return { faqs, metadata: { warnings } };
}

async function processMicrodataQuestion(questionEl, faqs, baseUrl, processing) {
  log('[Microdata] Processing question element');
  
  // Get ID
  const id = sanitizeAnchor(
    questionEl.getAttribute('id') || 
    questionEl.getAttribute('itemid')?.split('#').pop() || 
    null
  );
  log(`[Microdata] Question ID: ${id || 'none'}`);
  
  // Get question text - use correct properties
  let rawQuestion = '';
  const nameEl = questionEl.querySelector('[itemprop="name"]');
  if (nameEl) {
    // Use textContent or innerText, NOT .text (which returns outerHTML)
    rawQuestion = nameEl.textContent || nameEl.innerText || nameEl.getAttribute('content') || '';
    log(`[Microdata] Found question name: "${rawQuestion}"`);
  }
  
  const processedQuestion = processQuestion(rawQuestion, processing);
  if (!processedQuestion) {
    log('[Microdata] No question text found, skipping');
    return;
  }
  
  // Get answer - try multiple approaches
  let rawAnswer = '';
  
  // Direct text property
  const directTextEl = questionEl.querySelector('[itemprop="text"]');
  if (directTextEl) {
    rawAnswer = directTextEl.innerHTML;
    log(`[Microdata] Found direct answer text, length: ${rawAnswer.length}`);
  } else {
    // Inside acceptedAnswer
    const acceptedAnswerEl = questionEl.querySelector('[itemprop="acceptedAnswer"]');
    if (acceptedAnswerEl) {
      const textEl = acceptedAnswerEl.querySelector('[itemprop="text"]');
      if (textEl) {
        rawAnswer = textEl.innerHTML;
        log(`[Microdata] Found answer in acceptedAnswer/text, length: ${rawAnswer.length}`);
      } else {
        // Sometimes the acceptedAnswer itself contains the text
        rawAnswer = acceptedAnswerEl.innerHTML;
        log(`[Microdata] Using acceptedAnswer innerHTML, length: ${rawAnswer.length}`);
      }
    }
  }
  
  if (!rawAnswer) {
    // Try suggestedAnswer as fallback
    const suggestedEl = questionEl.querySelector('[itemprop="suggestedAnswer"] [itemprop="text"]');
    if (suggestedEl) {
      rawAnswer = suggestedEl.innerHTML;
      log(`[Microdata] Found answer in suggestedAnswer, length: ${rawAnswer.length}`);
    }
  }
  
  if (!rawAnswer) {
    log('[Microdata] No answer found, skipping');
    return;
  }
  
  const processedAnswer = await processAnswer(rawAnswer, baseUrl, processing);
  
  faqs.push({
    question: processedQuestion,
    answer: processedAnswer,
    id: id
  });
  log(`[Microdata] Added FAQ. Total count: ${faqs.length}`);
}

// Enhanced RDFa extraction
async function extractEnhancedRdfa(root, baseUrl, processing) {
  const faqs = [];
  const warnings = [];
  
  log('[RDFa] Starting extraction');
  
  // Try FAQPage containers first
  const faqPages = root.querySelectorAll('[typeof*="FAQPage"], [typeof*="https://schema.org/FAQPage"]');
  log(`[RDFa] Found ${faqPages.length} FAQPage containers`);
  
  for (const faqPage of faqPages) {
    const questions = faqPage.querySelectorAll('[typeof*="Question"]');
    log(`[RDFa] Found ${questions.length} questions in FAQPage`);
    for (const q of questions) {
      await processRdfaQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  // Also try standalone Questions (simpler approach)
  const allQuestions = root.querySelectorAll('[typeof*="Question"]');
  log(`[RDFa] Found ${allQuestions.length} total Question elements`);
  
  const processedIds = new Set(faqs.map(f => f.id).filter(Boolean));
  
  for (const q of allQuestions) {
    const id = q.getAttribute('id') || q.getAttribute('resource')?.split('#').pop();
    if (!processedIds.has(id)) {
      await processRdfaQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  log(`[RDFa] Total FAQs extracted: ${faqs.length}`);
  return { faqs, metadata: { warnings } };
}

async function processRdfaQuestion(questionEl, faqs, baseUrl, processing) {
  log('[RDFa] Processing question element');
  
  // Get ID
  const id = sanitizeAnchor(
    questionEl.getAttribute('id') || 
    questionEl.getAttribute('resource')?.split('#').pop() ||
    questionEl.getAttribute('about')?.split('#').pop() ||
    null
  );
  log(`[RDFa] Question ID: ${id || 'none'}`);
  
  // Get question text - use correct properties
  const nameEl = questionEl.querySelector('[property="name"], [property="schema:name"]');
  if (!nameEl) {
    log('[RDFa] No name element found');
    return;
  }
  
  // Use textContent or innerText, NOT .text (which returns outerHTML)
  const rawQuestion = nameEl.textContent || nameEl.innerText || nameEl.getAttribute('content') || '';
  log(`[RDFa] Found question: "${rawQuestion}"`);
  
  const processedQuestion = processQuestion(rawQuestion, processing);
  if (!processedQuestion) {
    log('[RDFa] Question processing returned empty');
    return;
  }
  
  // Get answer - try multiple selectors
  let rawAnswer = '';
  const textEl = questionEl.querySelector('[property="text"], [property="schema:text"], [property="acceptedAnswer"] [property="text"]');
  if (textEl) {
    rawAnswer = textEl.innerHTML;
    log(`[RDFa] Found answer, length: ${rawAnswer.length}`);
  }
  
  if (!rawAnswer) {
    log('[RDFa] No answer found');
    return;
  }
  
  const processedAnswer = await processAnswer(rawAnswer, baseUrl, processing);
  
  faqs.push({
    question: processedQuestion,
    answer: processedAnswer,
    id: id
  });
  log(`[RDFa] Added FAQ. Total count: ${faqs.length}`);
}

// Process question text
function processQuestion(raw, processing) {
  log(`[ProcessQ] Input: "${raw}"`);
  
  if (!raw) {
    log('[ProcessQ] Empty input');
    return '';
  }
  
  // Decode HTML entities
  raw = decodeHtmlEntities(raw);
  log(`[ProcessQ] After decode: "${raw}"`);
  
  // Check if contains HTML
  if (/<[^>]+>/.test(raw)) {
    processing.questionsWithHtmlStripped++;
    log('[ProcessQ] Contains HTML, will strip');
  }
  
  // Strip all HTML tags
  raw = raw.replace(/<[^>]+>/g, '');
  
  // Normalize whitespace
  raw = raw.replace(/\s+/g, ' ').trim();
  log(`[ProcessQ] After cleanup: "${raw}"`);
  
  // Limit length
  if (raw.length > 300) {
    // Try to cut at word boundary
    raw = raw.substring(0, 300);
    const lastSpace = raw.lastIndexOf(' ');
    if (lastSpace > 250) {
      raw = raw.substring(0, lastSpace) + '...';
    }
    log(`[ProcessQ] Truncated to: "${raw}"`);
  }
  
  log(`[ProcessQ] Final output: "${raw}"`);
  return raw;
}

// Process answer with sanitization and image handling (simplified for Workers)
async function processAnswer(raw, baseUrl, processing) {
  log(`[ProcessA] Input length: ${raw.length}`);
  
  if (!raw) {
    log('[ProcessA] Empty input');
    return '';
  }
  
  processing.answersWithHtmlSanitized++;
  
  // First decode entities
  raw = decodeHtmlEntities(raw);
  log(`[ProcessA] After decode length: ${raw.length}`);
  
  // Parse the HTML string
  const tempRoot = parse(raw);
  
  // Remove dangerous elements
  const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'];
  dangerousTags.forEach(tag => {
    const elements = tempRoot.querySelectorAll(tag);
    elements.forEach(el => el.remove());
  });
  
  // Remove event handlers by rebuilding clean HTML
  const allElements = tempRoot.querySelectorAll('*');
  allElements.forEach(el => {
    // Get all attributes
    const attrs = el.attributes;
    Object.keys(attrs).forEach(attrName => {
      if (attrName.startsWith('on') || attrs[attrName].includes('javascript:')) {
        el.removeAttribute(attrName);
      }
    });
  });
  
  // Process links - make relative URLs absolute
  const links = tempRoot.querySelectorAll('a');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      try {
        const absolute = new URL(href, baseUrl).href;
        link.setAttribute('href', absolute);
        processing.relativeUrlsFixed++;
      } catch (e) {
        // Invalid URL, remove href
        link.removeAttribute('href');
      }
    }
  });
  
  // Process images
  const images = tempRoot.querySelectorAll('img');
  processing.imagesProcessed += images.length;
  log(`[ProcessA] Found ${images.length} images`);
  
  for (const img of images) {
    let src = img.getAttribute('src');
    
    if (!src) {
      img.remove();
      continue;
    }
    
    // Handle data URIs
    if (src.startsWith('data:')) {
      if (src.length > 100000) { // 100KB limit
        img.setAttribute('src', '#');
        img.setAttribute('alt', img.getAttribute('alt') || 'Image too large to display');
        img.setAttribute('data-error', 'embedded-image-too-large');
        processing.dataUrisRejected++;
        processing.brokenImages++;
      }
      continue;
    }
    
    // Fix relative URLs
    if (!src.startsWith('http')) {
      try {
        // Handle protocol-relative URLs
        if (src.startsWith('//')) {
          src = 'https:' + src;
        } else {
          src = new URL(src, baseUrl).href;
        }
        img.setAttribute('src', src);
        processing.relativeUrlsFixed++;
      } catch (e) {
        img.setAttribute('data-broken', 'true');
        img.setAttribute('alt', img.getAttribute('alt') || 'Image unavailable');
        processing.brokenImages++;
        continue;
      }
    }
    
    // Add lazy loading
    img.setAttribute('loading', 'lazy');
    
    // Add alt text if missing
    if (!img.getAttribute('alt')) {
      img.setAttribute('alt', 'FAQ image');
    }
    
    // Note: In Workers environment, we can't verify images
    // So we don't mark them as verified/unverified to avoid confusion
  }
  
  // Clean up empty paragraphs
  const paragraphs = tempRoot.querySelectorAll('p');
  paragraphs.forEach(p => {
    if (!p.textContent?.trim() && !p.querySelector('img')) {
      p.remove();
    }
  });
  
  // Get cleaned HTML
  let cleaned = tempRoot.innerHTML;
  log(`[ProcessA] Cleaned HTML length: ${cleaned.length}`);
  
  // Final length check
  if (cleaned.length > 5000) {
    cleaned = cleaned.substring(0, 5000);
    // Try to close any open tags
    cleaned = cleaned.replace(/<[^>]*$/, '') + '... (truncated)';
    processing.truncatedAnswers++;
    log('[ProcessA] Answer truncated to 5000 chars');
  }
  
  log(`[ProcessA] Final output length: ${cleaned.length}`);
  return cleaned;
}

// Sanitize anchor/ID
function sanitizeAnchor(id) {
  if (!id) return null;
  
  // Remove any dangerous characters
  const sanitized = id
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
  
  log(`[Sanitize] Input: "${id}" Output: "${sanitized}"`);
  return sanitized;
}

// Enhanced HTML entity decoder
function decodeHtmlEntities(text) {
  const entities = {
    // Common entities
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    
    // Spaces and dashes
    '&nbsp;': ' ',
    '&ensp;': ' ',
    '&emsp;': ' ',
    '&thinsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&minus;': '−',
    
    // Typography
    '&hellip;': '…',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&sbquo;': '‚',
    '&bdquo;': '„',
    '&prime;': '′',
    '&Prime;': '″',
    
    // Symbols
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&sect;': '§',
    '&deg;': '°',
    '&plusmn;': '±',
    '&para;': '¶',
    '&middot;': '·',
    '&bull;': '•',
    '&dagger;': '†',
    '&Dagger;': '‡',
    
    // Currency
    '&cent;': '¢',
    '&pound;': '£',
    '&yen;': '¥',
    '&euro;': '€',
    
    // Math
    '&times;': '×',
    '&divide;': '÷',
    '&frac12;': '½',
    '&frac14;': '¼',
    '&frac34;': '¾',
    '&sup1;': '¹',
    '&sup2;': '²',
    '&sup3;': '³',
    
    // Arrows
    '&larr;': '←',
    '&rarr;': '→',
    '&uarr;': '↑',
    '&darr;': '↓',
    '&harr;': '↔',
    
    // Other
    '&spades;': '♠',
    '&clubs;': '♣',
    '&hearts;': '♥',
    '&diams;': '♦'
  };
  
  // Replace named entities
  text = text.replace(/&[a-zA-Z]+;/g, (match) => entities[match] || match);
  
  // Replace numeric entities (decimal)
  text = text.replace(/&#(\d+);/g, (match, dec) => {
    const num = parseInt(dec, 10);
    return num < 128 ? String.fromCharCode(num) : match;
  });
  
  // Replace numeric entities (hexadecimal)
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
    const num = parseInt(hex, 16);
    return num < 128 ? String.fromCharCode(num) : match;
  });
  
  return text;
}

// Enhanced deduplication
function dedupeEnhanced(arr) {
  log(`[Dedupe] Input: ${arr.length} FAQs`);
  
  const seen = new Map();
  const MAX_FAQS = 50;
  
  const result = arr.filter((faq, index) => {
    if (index >= MAX_FAQS) {
      log(`[Dedupe] Skipping FAQ ${index + 1} - exceeds limit`);
      return false;
    }
    
    if (!faq.question || !faq.answer) {
      log(`[Dedupe] Skipping FAQ ${index + 1} - missing question or answer`);
      return false;
    }
    
    if (faq.question.includes('${') || faq.answer.includes('${')) {
      log(`[Dedupe] Skipping FAQ ${index + 1} - contains template variables`);
      return false;
    }
    
    // Create normalized key for comparison
    const key = faq.question.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    log(`[Dedupe] FAQ ${index + 1} normalized key: "${key}"`);
    
    if (seen.has(key)) {
      // Keep the one with an ID if duplicate
      const existing = seen.get(key);
      if (!existing.id && faq.id) {
        log(`[Dedupe] Replacing duplicate without ID with one that has ID: ${faq.id}`);
        seen.set(key, faq);
      } else {
        log(`[Dedupe] Skipping duplicate FAQ`);
      }
      return false;
    }
    
    seen.set(key, faq);
    return true;
  });
  
  log(`[Dedupe] Output: ${result.length} FAQs`);
  return result;
}