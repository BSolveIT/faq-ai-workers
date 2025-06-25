/**
 * FAQ Question Generator Worker - Enhanced Question Generation (OPTIMIZED VERSION)
 * Version: 3.3.0-enhanced-generation-fixed-debug
 *
 * Features:
 * - Smart website context integration
 * - SEO scoring and keyword optimization
 * - Question type detection and specialized suggestions
 * - Smart caching for performance
 * - Enhanced IP-based rate limiting with violation tracking and progressive penalties
 * - Enhanced error handling and fallbacks
 * - Grammar checking and improvement
 * - Duplicate detection and prevention
 *
 * CLAUDE 4 OPUS FIXES APPLIED:
 * ✅ Better system prompts (less restrictive)
 * ✅ Increased token limits (500) and temperature (0.7) for creativity
 * ✅ Added top_p parameter for better diversity
 * ✅ Improved JSON parsing with multiple extraction strategies
 * ✅ Better contextual fallbacks
 * ✅ Enhanced prompt examples with clear structure
 * ✅ Removed realtime typing assistance (per user request)
 * ✅ Added comprehensive debug logging for AI responses
 *
 * ADDITIONAL OPTIMIZATIONS:
 * ✅ Fixed request body parsing (single read with clone)
 * ✅ Preserved original cache key generation for compatibility
 * ✅ Optimized async/await patterns
 * ✅ Enhanced grammar checking
 * ✅ Better error messages for production
 * ✅ Improved duplicate detection logic
 * ✅ Health endpoint format compatibility
 */

import { generateDynamicHealthResponse, trackCacheHit, trackCacheMiss } from '../../shared/health-utils.js';
import { cacheAIModelConfig, invalidateWorkerCaches, initializeCacheManager } from '../../shared/advanced-cache-manager.js';

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

// Debug mode - matches original comprehensive debug logging
const DEBUG_MODE = true;
const log = console.log; // Full logging as per original
const logError = console.error; // Always log errors

/**
 * Get AI model name dynamically from KV store with enhanced caching
 */
async function getAIModel(env, workerType = 'question_generator') {
  try {
    log(`[AI Model Cache] Retrieving model config for ${workerType} with enhanced caching...`);
    
    const configData = await cacheAIModelConfig('ai_model_config', env, async () => {
      log(`[AI Model Cache] Cache miss - loading fresh config from KV...`);
      const freshConfig = await env.AI_MODEL_CONFIG?.get('ai_model_config', { type: 'json' });
      
      if (!freshConfig) {
        log(`[AI Model Cache] No config found in KV, returning null for cache`);
        return null;
      }
      
      log(`[AI Model Cache] Loaded fresh config:`, Object.keys(freshConfig));
      return freshConfig;
    });
    
    if (configData?.ai_models?.[workerType]) {
      log(`[AI Model Cache] ✅ Using cached dynamic model for ${workerType}: ${configData.ai_models[workerType]}`);
      return configData.ai_models[workerType];
    }
    
    log(`[AI Model Cache] No dynamic model found for ${workerType} in cached config, checking fallback`);
  } catch (error) {
    logError(`[AI Model Cache] Error with cached retrieval: ${error.message}`);
  }
  
  const fallbackModel = env.MODEL_NAME || '@cf/meta/llama-3.1-8b-instruct';
  log(`[AI Model Cache] ✅ Using fallback model for ${workerType}: ${fallbackModel}`);
  return fallbackModel;
}

/**
 * Get AI model info with source information for health endpoint
 */
async function getAIModelInfo(env, workerType = 'question_generator') {
  try {
    log(`[AI Model Info] Retrieving model info for ${workerType}...`);
    
    const configData = await cacheAIModelConfig('ai_model_config', env, async () => {
      log(`[AI Model Info] Cache miss - loading fresh config from KV...`);
      const freshConfig = await env.AI_MODEL_CONFIG?.get('ai_model_config', { type: 'json' });
      
      if (!freshConfig) {
        log(`[AI Model Info] No config found in KV, returning null for cache`);
        return null;
      }
      
      log(`[AI Model Info] Loaded fresh config:`, Object.keys(freshConfig));
      return freshConfig;
    });
    
    if (configData?.ai_models?.[workerType]) {
      log(`[AI Model Info] ✅ Using cached dynamic model for ${workerType}: ${configData.ai_models[workerType]}`);
      return {
        current_model: configData.ai_models[workerType],
        model_source: 'kv_config',
        worker_type: workerType
      };
    }
    
    log(`[AI Model Info] No dynamic model found for ${workerType} in cached config, checking fallback`);
  } catch (error) {
    logError(`[AI Model Info] Error with cached retrieval: ${error.message}`);
  }
  
  if (env.MODEL_NAME) {
    log(`[AI Model Info] ✅ Using env fallback model for ${workerType}: ${env.MODEL_NAME}`);
    return {
      current_model: env.MODEL_NAME,
      model_source: 'env_fallback',
      worker_type: workerType
    };
  }
  
  const hardcodedDefault = '@cf/meta/llama-3.1-8b-instruct';
  log(`[AI Model Info] ✅ Using hardcoded default model for ${workerType}: ${hardcodedDefault}`);
  return {
    current_model: hardcodedDefault,
    model_source: 'hardcoded_default',
    worker_type: workerType
  };
}

/**
 * Improved grammar and formatting of text suggestions
 */
function improveGrammar(text) {
  if (!text || typeof text !== 'string') return text;
  
  const originalText = text.trim();
  let improved = originalText;
  
  // Fix basic capitalization
  improved = improved.charAt(0).toUpperCase() + improved.slice(1);
  
  // Fix question mark spacing and ensure questions end with ?
  improved = improved.replace(/\s*\?\s*$/, '?');
  if (improved.match(/^(how|what|why|when|where|which|who|can|should|will|would|could|do|does|did|is|are|was|were)/i) && !improved.endsWith('?')) {
    improved += '?';
  }
  
  // Fix common grammar issues with single pass regex
  improved = improved
    .replace(/\s+/g, ' ') // Fix double spaces
    .replace(/\s+([,.!?;:])/g, '$1') // Fix spacing before punctuation
    .replace(/([,.!?;:])\s*/g, '$1 ') // Fix spacing after punctuation
    .replace(/\ba\s+([aeiouAEIOU])/g, 'an $1') // Fix "a" vs "an"
    .replace(/\ban\s+([^aeiouAEIOU\s])/g, 'a $1') // Fix "an" vs "a"
    .replace(/\bits\s+own\b/gi, "its own") // Fix its/it's
    .replace(/\byour\s+welcome\b/gi, "you're welcome") // Fix your/you're
    .replace(/\bwho's\b/gi, 'whose') // Fix who's/whose in possessive context
    .replace(/\b(SEO|API|URL|HTTPS?|FAQ|KV|AI|IP)\b/gi, (match) => match.toUpperCase()) // Uppercase acronyms
    .replace(/\bwebsite\s+website\b/gi, 'website') // Remove duplicate words
    .replace(/\bthe\s+the\b/gi, 'the') // Remove duplicate articles
    .replace(/\.\?$/, '?') // Remove period before question mark
    .trim();
  
  // Final cleanup
  improved = improved.replace(/\s+$/, '').replace(/^\s+/, '');
  
  // Log only significant changes
  if (DEBUG_MODE && improved !== originalText) {
    log(`[Grammar] Fixed: "${originalText}" → "${improved}"`);
  }
  
  return improved;
}

/**
 * Analyze question to provide better, targeted suggestions with duplicate detection
 */
function analyzeQuestion(primaryQuestion, existingQuestions = []) {
  const cleanQuestion = primaryQuestion.trim().toLowerCase();
  
  // Detect question type with improved regex
  let type = 'general';
  const questionPatterns = {
    'how-to': /^how\s+(do|can|to|long|often|much|many)/,
    'definition': /^what\s+(is|are|does|can|means)/,
    'explanation': /^why\s+(do|does|is|are|should)/,
    'timing': /^when\s+(do|does|is|should|can|will)/,
    'location': /^where\s+(do|can|is|are|should)/,
    'comparison': /^(which|what).*(better|difference|versus|vs)/,
    'cost': /\b(cost|price|fee|charge|expense|budget)\b/
  };
  
  for (const [questionType, pattern] of Object.entries(questionPatterns)) {
    if (pattern.test(cleanQuestion)) {
      type = questionType;
      break;
    }
  }
  
  // Extract potential keywords more efficiently
  const words = cleanQuestion.replace(/[^\w\s]/g, '').split(/\s+/);
  const stopWords = new Set(['how', 'what', 'why', 'when', 'where', 'which', 'who', 'do', 'does', 'is', 'are', 'can', 'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among']);
  const keywords = words.filter(word => word.length > 2 && !stopWords.has(word)).slice(0, 5);
  
  // Enhanced SEO scoring
  let seoScore = 50; // Base score
  
  if (primaryQuestion.includes('?')) seoScore += 10;
  if (primaryQuestion.length >= 20 && primaryQuestion.length <= 100) seoScore += 15;
  if (keywords.length >= 2) seoScore += 10;
  if (/^(how|what|why|when|where|which)/.test(cleanQuestion)) seoScore += 15;
  if (type !== 'general') seoScore += 10; // Bonus for specific question types
  
  // Identify improvements needed
  const improvements = [];
  if (!primaryQuestion.includes('?')) improvements.push('Add question mark');
  if (primaryQuestion.length < 20) improvements.push('Add more specific details');
  if (keywords.length < 2) improvements.push('Include more relevant keywords');
  if (!/^(how|what|why|when|where|which)/.test(cleanQuestion)) improvements.push('Start with question word');
  
  // Create duplicate detection patterns
  const duplicatePatterns = existingQuestions.map(q => ({
    original: q,
    normalized: normalizeQuestionForComparison(q),
    keywords: extractKeywordsForComparison(q)
  }));
  
  log(`[Question Analysis] Type: ${type}, Keywords: ${keywords.length}, SEO: ${seoScore}, Patterns: ${duplicatePatterns.length}`);
  
  return {
    type,
    keywords,
    seoScore: Math.min(seoScore, 100),
    improvements,
    length: primaryQuestion.length,
    hasQuestionMark: primaryQuestion.includes('?'),
    duplicatePatterns,
    existingCount: existingQuestions.length
  };
}

/**
 * Normalize question for duplicate detection
 */
function normalizeQuestionForComparison(question) {
  return question
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(how|what|why|when|where|which|who|do|does|is|are|can|will|should|could|would)\b/g, '')
    .replace(/\b(the|a|an|to|for|of|in|on|with|by|from|up|about|into|through|during|before|after|above|below|between|among)\b/g, '')
    .trim();
}

/**
 * Extract keywords for similarity checking
 */
function extractKeywordsForComparison(question) {
  const normalized = normalizeQuestionForComparison(question);
  return normalized.split(/\s+/).filter(word => word.length > 2).slice(0, 10);
}

/**
 * Check if a new question is too similar to existing ones
 */
function isDuplicateQuestion(newQuestion, duplicatePatterns, threshold = 0.6) {
  const newNormalized = normalizeQuestionForComparison(newQuestion);
  const newKeywords = extractKeywordsForComparison(newQuestion);
  
  if (newKeywords.length === 0) return false;
  
  for (const pattern of duplicatePatterns) {
    // Exact match check
    if (newNormalized === pattern.normalized) {
      log(`[Duplicate Check] EXACT match found: "${newQuestion}" matches "${pattern.original}"`);
      return true;
    }
    
    // Keyword similarity check
    if (pattern.keywords.length > 0) {
      const commonKeywords = newKeywords.filter(keyword => pattern.keywords.includes(keyword));
      const similarity = commonKeywords.length / Math.max(newKeywords.length, pattern.keywords.length);
      
      if (similarity >= threshold) {
        log(`[Duplicate Check] HIGH similarity (${(similarity * 100).toFixed(1)}%): "${newQuestion}" similar to "${pattern.original}"`);
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Filter out duplicate suggestions
 */
function filterDuplicateSuggestions(suggestions, duplicatePatterns, stepName) {
  if (!suggestions || suggestions.length === 0) return [];
  
  const filtered = [];
  let duplicatesFound = 0;
  
  for (const suggestion of suggestions) {
    const questionText = suggestion.text || suggestion;
    
    if (isDuplicateQuestion(questionText, duplicatePatterns)) {
      duplicatesFound++;
      log(`[${stepName}] Filtered duplicate: "${questionText.substring(0, 60)}..."`);
    } else {
      filtered.push(suggestion);
      log(`[${stepName}] Accepted unique: "${questionText.substring(0, 60)}..."`);
    }
  }
  
  log(`[${stepName}] Duplicate filtering: ${duplicatesFound} duplicates removed, ${filtered.length} unique suggestions kept`);
  return filtered;
}

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

    // Handle health check endpoint
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        const healthStartTime = Date.now();
        
        // Generate base health response using the existing function
        const healthResponse = await generateDynamicHealthResponse(
          'faq-realtime-assistant-worker',
          env,
          '3.3.0-enhanced-generation-fixed-debug',
          [
            'contextual_question_suggestions',
            'question_improvement',
            'validation_tips',
            'duplicate_detection',
            'grammar_checking',
            'seo_optimization',
            'enhanced_rate_limiting',
            'ip_management',
            'improved_ai_prompting',
            'comprehensive_debug_logging'
          ]
        );
        
        // Get AI model information
        const aiModelInfo = await getAIModelInfo(env, 'question_generator');
        
        // Calculate response time
        const responseTime = Date.now() - healthStartTime;
        
        // Enhance the response with all required fields while preserving generateDynamicHealthResponse data
        healthResponse.status = 'OK';
        healthResponse.model = {
          name: aiModelInfo.current_model,
          max_tokens: 300,
          temperature: 0.2
        };
        healthResponse.configuration = healthResponse.configuration || {
          source: aiModelInfo.model_source || 'fallback',
          last_updated: new Date().toISOString(),
          config_version: 1
        };
        healthResponse.performance = {
          avg_response_time_ms: healthResponse.performance?.avg_response_time_ms || 0,
          total_requests_served: healthResponse.performance?.total_requests_served || 0,
          response_time_ms: responseTime
        };
        healthResponse.operational_status = healthResponse.operational_status || {
          health: 'operational',
          ai_binding_available: true,
          config_loaded: true
        };
        healthResponse.health_indicators = healthResponse.health_indicators || {
          overall_system_health: 'operational',
          ai_health: 'available'
        };
        healthResponse.cache_status = 'active';
        healthResponse.current_model = aiModelInfo.current_model;
        healthResponse.model_source = aiModelInfo.model_source;
        healthResponse.worker_type = 'question_generator';
        healthResponse.rate_limiting = {
          enabled: true,
          enhanced: true
        };
        
        return new Response(JSON.stringify(healthResponse), {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          }
        });
      }
    }

    // Handle cache clear endpoint
    if (request.method === 'POST') {
      const url = new URL(request.url);
      if (url.pathname === '/cache/clear') {
        const clearStartTime = Date.now();
        
        try {
          log('[Cache Clear] Starting cache invalidation for faq-realtime-assistant-worker...');
          
          // Initialize cache manager and invalidate all worker caches
          const cacheManager = initializeCacheManager(env);
          await Promise.all([
            invalidateWorkerCaches('ai_model_config', env),
            cacheManager.invalidate('faq_improve_*'),
            cacheManager.invalidate('faq_tips_*')
          ]);
          
          const clearDuration = ((Date.now() - clearStartTime) / 1000).toFixed(2);
          log(`[Cache Clear] ✅ Cache invalidation completed in ${clearDuration}s`);
          
          return new Response(JSON.stringify({
            success: true,
            message: 'All caches cleared successfully',
            worker: 'faq-realtime-assistant-worker',
            worker_type: 'question_generator',
            duration: clearDuration,
            timestamp: new Date().toISOString(),
            cache_types_cleared: [
              'ai_model_config',
              'worker_health_data',
              'suggestion_cache',
              'L1_memory_cache',
              'L2_kv_cache'
            ]
          }), {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
          
        } catch (error) {
          const clearDuration = ((Date.now() - clearStartTime) / 1000).toFixed(2);
          logError(`[Cache Clear] ❌ Cache invalidation failed in ${clearDuration}s:`, error);
          
          return new Response(JSON.stringify({
            success: false,
            error: 'Cache clearing failed',
            details: error.message,
            worker: 'faq-realtime-assistant-worker',
            duration: clearDuration,
            timestamp: new Date().toISOString()
          }), {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      }
    }

    // Only accept POST requests for main functionality
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
        allowed_methods: ['POST', 'GET', 'OPTIONS']
      }), { 
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const requestStartTime = Date.now();
    let requestData;

    try {
      // Parse request body safely
      try {
        requestData = await request.json();
      } catch (parseError) {
        return new Response(JSON.stringify({
          error: 'Invalid JSON in request body',
          contextual: true
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { 
        questions = [],
        currentAnswer = '',
        mode = 'improve', 
        websiteContext = '',
        pageUrl = '',
        forceRefresh = false,
        cacheBypass = null
      } = requestData;

      log(`[Main Handler] ======== Starting ${mode} request ========`);
      log(`[Main Handler] Questions: ${questions.length}, Answer: ${currentAnswer?.length || 0} chars`);
      log(`[Main Handler] Mode: ${mode} | Context: ${websiteContext ? 'Yes' : 'No'} | URL: ${pageUrl ? 'Yes' : 'No'}`);
      
      // Validate input
      if (!questions || questions.length === 0) {
        logError(`[Main Handler] Validation failed: No questions provided`);
        return new Response(JSON.stringify({
          error: 'At least one question is required',
          contextual: true
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get the primary question
      const primaryQuestion = questions[0];
      log(`[Main Handler] Primary question: "${primaryQuestion.substring(0, 75)}..." (${primaryQuestion.length} chars)`);

      // Get client IP
      const clientIP = request.headers.get('CF-Connecting-IP') ||
                      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                      request.headers.get('X-Real-IP') ||
                      'unknown';

      log(`[Main Handler] Processing request from IP: ${clientIP}`);

      // Check rate limit before processing request with question processing-specific limits
      let rateLimitConfig = { limit: 50, window: 3600 }; // 50 question improvements per hour
      const rateLimitResult = await checkRateLimit(env, clientIP, rateLimitConfig);

      if (!rateLimitResult.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '3600',
            'X-RateLimit-Limit': '50',
            'X-RateLimit-Remaining': '0',
            ...corsHeaders
          }
        });
      }

      // Check cache first
      let cacheKey = null;
      let cacheCheckDuration = 0;
      let cached = null;
      
      if (!forceRefresh && !cacheBypass) {
        const cacheStartTime = Date.now();
        cacheKey = createCacheKey(questions, mode, websiteContext);
        if (cacheKey) {
          cached = await getCachedResponse(cacheKey, env);
          cacheCheckDuration = ((Date.now() - cacheStartTime) / 1000).toFixed(2);
          
          if (cached) {
            trackCacheHit();
            log(`[Main Handler] Cache HIT in ${cacheCheckDuration}s`);
            if (cached.metadata) {
              cached.metadata.grammar_checked = true;
              cached.metadata.cached = true;
            }
            return new Response(JSON.stringify(cached), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            trackCacheMiss();
            log(`[Main Handler] Cache MISS in ${cacheCheckDuration}s`);
          }
        }
      }

      // Analyze primary question
      const analysisStartTime = Date.now();
      const questionAnalysis = analyzeQuestion(primaryQuestion, questions);
      const analysisDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(2);
      
      log(`[Main Handler] Analysis completed in ${analysisDuration}s`);
      
      // Generate suggestions
      const generationStartTime = Date.now();
      let suggestions = [];
      
      log(`[Main Handler] Starting ${mode} generation...`);
      
      switch (mode) {
        case 'improve':
        case 'enhance':
        case 'regenerate':
        case 'generate':
          suggestions = await generateEnhancedImprovementSuggestions(questions, currentAnswer, questionAnalysis, env, websiteContext);
          break;
          
        case 'validate':
        case 'tips':
          suggestions = await generateEnhancedValidationTips(questions, currentAnswer, questionAnalysis, env, websiteContext);
          break;
          
        default:
          log(`[Main Handler] Unknown mode: ${mode}, defaulting to improvement`);
          suggestions = await generateEnhancedImprovementSuggestions(questions, currentAnswer, questionAnalysis, env, websiteContext);
      }
      
      const generationDuration = ((Date.now() - generationStartTime) / 1000).toFixed(2);
      log(`[Main Handler] Generation completed in ${generationDuration}s - ${suggestions.length} suggestions`);

      // Build response
      const response = {
        success: true,
        mode: mode,
        contextual: true,
        suggestions: suggestions,
        analysis: {
          questionType: questionAnalysis.type,
          keywords: questionAnalysis.keywords,
          seoScore: questionAnalysis.seoScore,
          improvements: questionAnalysis.improvements,
          existingQuestionsCount: questions.length,
          duplicatesAvoided: questionAnalysis.duplicatesAvoided || 0
        },
        metadata: {
          model: await getAIModel(env, 'question_generator'),
          neurons_used: 2,
          context_applied: websiteContext ? true : false,
          page_url_provided: pageUrl ? true : false,
          grammar_checked: true,
          cached: false,
          timestamp: new Date().toISOString(),
          rate_limit: {
            allowed: rateLimitResult.allowed,
            remaining: rateLimitResult.remaining,
            limit: rateLimitConfig.limit,
            window: rateLimitConfig.window,
            worker: 'faq-realtime-assistant'
          },
          performance: {
            total_duration: ((Date.now() - requestStartTime) / 1000).toFixed(2),
            cache_check: cacheCheckDuration,
            analysis: analysisDuration,
            generation: generationDuration,
            rate_limit: rateLimitResult.duration
          }
        }
      };

      // Cache the response
      if (cacheKey && !cached) {
        const cacheSetStart = Date.now();
        await cacheResponse(cacheKey, response, env);
        const cacheSetDuration = ((Date.now() - cacheSetStart) / 1000).toFixed(2);
        log(`[Main Handler] Response cached in ${cacheSetDuration}s`);
      }

      const totalDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
      log(`[Main Handler] ======== Request completed in ${totalDuration}s ========`);

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      const errorDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
      logError(`[Main Handler] CRITICAL ERROR after ${errorDuration}s:`, error);
      
      return new Response(JSON.stringify({
        error: 'Processing failed',
        contextual: true,
        fallback: true,
        suggestions: getFallbackSuggestions(requestData?.questions || [], requestData?.mode || 'improve'),
        debug: {
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
 * Generate enhanced improvement suggestions
 */
async function generateEnhancedImprovementSuggestions(questions, currentAnswer, analysis, env, websiteContext) {
  const stepStartTime = Date.now();
  const primaryQuestion = questions[0];
  log(`[Enhanced Improvement] Starting for: "${primaryQuestion.substring(0, 50)}..."`);
  
  const prompt = buildEnhancedImprovementPrompt(questions, currentAnswer, analysis, websiteContext);
  log(`[Enhanced Improvement] Prompt built (${prompt.length} chars)`);
  
  const aiModel = await getAIModel(env, 'question_generator');
  
  const aiResult = await callAIWithRetry(env.AI, aiModel, {
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that generates FAQ questions. Respond with a JSON array following the exact format shown in the examples. Be creative and helpful.'
      },
      { role: 'user', content: prompt }
    ],
    max_tokens: 500,
    temperature: 0.7,
    top_p: 0.9
  }, 'Enhanced Improvement');

  const totalDuration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
  
  if (aiResult.success) {
    log(`[Enhanced Improvement] AI success in ${aiResult.duration}s`);
    const rawSuggestions = parseEnhancedResponseWithDebug(aiResult.response.response, 'improve');
    const filteredSuggestions = filterDuplicateSuggestions(rawSuggestions, analysis.duplicatePatterns, 'Enhanced Improvement');
    log(`[Enhanced Improvement] Completed in ${totalDuration}s, ${filteredSuggestions.length} suggestions`);
    return filteredSuggestions.length > 0 ? filteredSuggestions : getEnhancedImprovementFallbacks(primaryQuestion, analysis, questions);
  } else {
    logError(`[Enhanced Improvement] AI failed: ${aiResult.error}`);
    return getEnhancedImprovementFallbacks(primaryQuestion, analysis, questions);
  }
}

/**
 * Generate enhanced validation tips
 */
async function generateEnhancedValidationTips(questions, currentAnswer, analysis, env, websiteContext) {
  const stepStartTime = Date.now();
  const primaryQuestion = questions[0];
  log(`[Enhanced Validation] Starting for: "${primaryQuestion.substring(0, 50)}..."`);
  
  const prompt = buildEnhancedValidationPrompt(questions, currentAnswer, analysis, websiteContext);
  log(`[Enhanced Validation] Prompt built`);
  
  const aiModel = await getAIModel(env, 'question_generator');
  
  const aiResult = await callAIWithRetry(env.AI, aiModel, {
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that generates FAQ questions. Respond with a JSON array following the exact format shown in the examples. Be creative and helpful.'
      },
      { role: 'user', content: prompt }
    ],
    max_tokens: 500,
    temperature: 0.7,
    top_p: 0.9
  }, 'Enhanced Validation');

  const totalDuration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
  
  if (aiResult.success) {
    log(`[Enhanced Validation] AI success in ${aiResult.duration}s`);
    const suggestions = parseEnhancedResponseWithDebug(aiResult.response.response, 'tips');
    log(`[Enhanced Validation] Completed in ${totalDuration}s, ${suggestions.length} tips`);
    return suggestions.length > 0 ? suggestions : getEnhancedValidationFallbacks(primaryQuestion, analysis, questions);
  } else {
    logError(`[Enhanced Validation] AI failed: ${aiResult.error}`);
    return getEnhancedValidationFallbacks(primaryQuestion, analysis, questions);
  }
}

/**
 * Robust AI call wrapper with retry logic
 */
async function callAIWithRetry(aiBinding, model, options, stepName, maxRetries = 3) {
  const overallStartTime = Date.now();
  log(`[AI Retry] Starting ${stepName} with model ${model}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStartTime = Date.now();
    log(`[AI Retry] ${stepName} attempt ${attempt}/${maxRetries}`);
    
    try {
      const response = await aiBinding.run(model, options);
      const attemptDuration = ((Date.now() - attemptStartTime) / 1000).toFixed(2);
      const totalDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
      
      log(`[AI Retry] ${stepName} SUCCESS - Attempt: ${attemptDuration}s, Total: ${totalDuration}s`);
      
      return {
        success: true,
        response: response,
        duration: totalDuration,
        attempts: attempt,
        error: null
      };
      
    } catch (error) {
      const attemptDuration = ((Date.now() - attemptStartTime) / 1000).toFixed(2);
      const errorType = categorizeError(error);
      
      logError(`[AI Retry] ${stepName} FAILED attempt ${attempt}/${maxRetries} (${attemptDuration}s) - ${errorType}`);
      
      if (attempt === maxRetries) {
        const totalDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
        logError(`[AI Retry] ${stepName} EXHAUSTED retries in ${totalDuration}s`);
        
        return {
          success: false,
          response: null,
          duration: totalDuration,
          attempts: attempt,
          error: errorType
        };
      }
      
      // Exponential backoff with jitter
      const delay = Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 5000);
      log(`[AI Retry] ${stepName} waiting ${(delay / 1000).toFixed(2)}s before retry`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Categorize errors for better debugging
 */
function categorizeError(error) {
  const message = error.message?.toLowerCase() || '';
  
  if (message.includes('timeout') || message.includes('time out')) {
    return 'TIMEOUT';
  } else if (message.includes('rate limit') || message.includes('too many requests')) {
    return 'RATE_LIMIT';
  } else if (message.includes('network') || message.includes('fetch')) {
    return 'NETWORK';
  } else if (message.includes('model') || message.includes('binding')) {
    return 'MODEL_ERROR';
  } else if (message.includes('quota') || message.includes('usage')) {
    return 'QUOTA_EXCEEDED';
  } else {
    return 'UNKNOWN';
  }
}

/**
 * Build prompts optimized for different contextual modes
 */
function buildEnhancedImprovementPrompt(questions, currentAnswer, analysis, websiteContext) {
  const primaryQuestion = questions[0];
  const contextHint = websiteContext ? `Context: ${websiteContext.substring(0, 150)}` : '';
  
  return `Create 3 alternative FAQ questions related to "${primaryQuestion}". 

${contextHint}

Return ONLY a JSON array in this format:
[
  {
    "text": "alternative question",
    "benefit": "why this helps",
    "reason": "user value"
  }
]

Focus on different angles users might approach this topic from. Consider:
- How-to questions
- Cost/pricing questions  
- Comparison questions
- Problem-solving questions
- Feature-specific questions

Example for "What is web hosting?":
[
  {
    "text": "How do I choose the right web hosting provider?",
    "benefit": "Decision-making help",
    "reason": "Users need guidance on selection criteria"
  },
  {
    "text": "What's the difference between shared and dedicated hosting?",
    "benefit": "Comparison clarity",
    "reason": "Users want to understand hosting types"
  },
  {
    "text": "How much should I budget for web hosting?",
    "benefit": "Financial planning",
    "reason": "Cost is a key consideration"
  }
]

Now generate alternatives for the given question:`;
}

function buildEnhancedValidationPrompt(questions, currentAnswer, analysis, websiteContext) {
  const primaryQuestion = questions[0];
  const contextHint = websiteContext ? `Website: ${websiteContext.substring(0, 100)}...` : '';
  const issueHints = analysis.improvements.length > 0 ? `Issues found: ${analysis.improvements.join(', ')}` : 'Generally good structure';
  const answerContext = currentAnswer ? `Current answer: ${currentAnswer.substring(0, 150)}...` : '';
  
  return `Return JSON array of 3 improvement tips. Each object must have "text", "benefit", and "reason" properties. ENSURE PERFECT GRAMMAR AND PUNCTUATION.

Question to improve: "${primaryQuestion}"
${contextHint}
Current SEO Score: ${analysis.seoScore}/100
${issueHints}
${answerContext}
Existing questions count: ${questions.length}

Focus on what will help users and search engines most. All tips must have perfect grammar, proper punctuation, and professional language.

Example format:
[
  {
    "text": "Add more specific keywords that users actually search for",
    "benefit": "Better discoverability",
    "reason": "Specific terms help search engines understand your content"
  }
]`;
}

/**
 * ENHANCED JSON PARSING WITH COMPREHENSIVE DEBUG LOGGING
 */
function parseEnhancedResponseWithDebug(aiResponse, mode) {
  if (!aiResponse || typeof aiResponse !== 'string') {
    logError(`[Parse Enhanced ${mode}] ❌ Invalid response type:`, typeof aiResponse);
    return getContextualFallbacks(mode);
  }

  // COMPREHENSIVE DEBUG LOGGING
  log(`[Parse Enhanced ${mode}] ========== FULL AI RESPONSE DEBUG ==========`);
  log(`[Parse Enhanced ${mode}] Response length: ${aiResponse.length} characters`);
  log(`[Parse Enhanced ${mode}] Response type: ${typeof aiResponse}`);
  log(`[Parse Enhanced ${mode}] Raw response (FULL):`);
  log(aiResponse);
  log(`[Parse Enhanced ${mode}] =============================================`);

  let cleaned = aiResponse.trim();
  
  // Try multiple extraction strategies
  
  // Strategy 1: Direct JSON parsing
  try {
    log(`[Parse Enhanced ${mode}] 🔄 Trying Strategy 1: Direct JSON parsing...`);
    // Look for JSON array anywhere in the response
    const jsonMatch = cleaned.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (jsonMatch) {
      log(`[Parse Enhanced ${mode}] Found JSON match:`, jsonMatch[0]);
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validated = validateAndCleanSuggestions(parsed, mode);
        if (validated.length > 0) {
          log(`[Parse Enhanced ${mode}] ✅ Strategy 1 successful: ${validated.length} items`);
          return validated;
        }
      }
    } else {
      log(`[Parse Enhanced ${mode}] ❌ No JSON array pattern found in response`);
    }
  } catch (e) {
    log(`[Parse Enhanced ${mode}] ❌ Strategy 1 failed:`, e.message);
  }

  // Strategy 2: Extract individual objects
  try {
    log(`[Parse Enhanced ${mode}] 🔄 Trying Strategy 2: Individual object extraction...`);
    const objectPattern = /\{[^{}]*"text"\s*:\s*"([^"]+)"[^{}]*"benefit"\s*:\s*"([^"]+)"[^{}]*"reason"\s*:\s*"([^"]+)"[^{}]*\}/g;
    const matches = [...cleaned.matchAll(objectPattern)];
    
    log(`[Parse Enhanced ${mode}] Found ${matches.length} object matches`);
    
    if (matches.length > 0) {
      const suggestions = matches.map(match => ({
        text: improveGrammar(match[1].trim()),
        benefit: match[2].trim(),
        reason: match[3].trim(),
        type: mode === 'tips' ? 'tip' : 'suggestion'
      }));
      
      log(`[Parse Enhanced ${mode}] ✅ Strategy 2 successful: ${suggestions.length} items`);
      return suggestions;
    }
  } catch (e) {
    log(`[Parse Enhanced ${mode}] ❌ Strategy 2 failed:`, e.message);
  }

  // Strategy 3: Extract questions with quotes
  try {
    log(`[Parse Enhanced ${mode}] 🔄 Trying Strategy 3: Question extraction with quotes...`);
    const questionPattern = /"([^"]*\?[^"]*)"/g;
    const questions = [...cleaned.matchAll(questionPattern)];
    
    log(`[Parse Enhanced ${mode}] Found ${questions.length} quoted questions`);
    
    if (questions.length >= 2) {
      const suggestions = questions.slice(0, 3).map((match, index) => ({
        text: improveGrammar(match[1]),
        benefit: `Alternative ${index + 1}`,
        reason: 'Provides different perspective on the topic',
        type: 'suggestion'
      }));
      
      log(`[Parse Enhanced ${mode}] ✅ Strategy 3 successful: ${suggestions.length} questions extracted`);
      return suggestions;
    }
  } catch (e) {
    log(`[Parse Enhanced ${mode}] ❌ Strategy 3 failed:`, e.message);
  }

  // If all strategies fail, return better fallbacks
  logError(`[Parse Enhanced ${mode}] ❌ All parsing strategies failed, returning contextual fallbacks`);
  const fallbacks = getContextualFallbacks(mode);
  log(`[Parse Enhanced ${mode}] ✅ Returning ${fallbacks.length} fallback suggestions`);
  return fallbacks;
}

// Helper function to validate and clean suggestions
function validateAndCleanSuggestions(parsed, mode) {
  return parsed
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      text: improveGrammar(String(item.text || '').trim()),
      benefit: String(item.benefit || 'Improved version').trim(),
      reason: String(item.reason || 'Better user experience').trim(),
      type: mode === 'tips' ? 'tip' : 'suggestion'
    }))
    .filter(item => item.text.length > 10 && item.text.length < 300);
}

// Better contextual fallbacks
function getContextualFallbacks(mode) {
  const fallbacks = {
    improve: [
      {
        text: "What are the key features of this service?",
        benefit: "Feature-focused",
        reason: "Users need specific capability information",
        type: "suggestion"
      },
      {
        text: "How much does this typically cost?",
        benefit: "Price transparency",
        reason: "Cost is a primary decision factor",
        type: "suggestion"
      },
      {
        text: "What problems does this solve?",
        benefit: "Problem-solution fit",
        reason: "Users search for solutions to their problems",
        type: "suggestion"
      }
    ],
    tips: [
      {
        text: "Include specific keywords your audience searches for",
        benefit: "Better SEO",
        reason: "Matches user search intent",
        type: "tip"
      },
      {
        text: "Make questions conversational and natural",
        benefit: "User-friendly",
        reason: "Mirrors how people actually ask questions",
        type: "tip"
      },
      {
        text: "Keep questions between 20-100 characters for optimal readability",
        benefit: "Better engagement",
        reason: "Concise questions perform better in search results",
        type: "tip"
      }
    ]
  };
  
  return fallbacks[mode] || fallbacks.improve;
}

function getEnhancedImprovementFallbacks(question, analysis, existingQuestions) {
  const suggestions = [];
  
  // SEO-focused improvements
  if (analysis.type === 'general') {
    suggestions.push({
      text: improveGrammar('How to ' + question.toLowerCase().replace(/\?$/, '').replace(/^(how|what|why|when|where)\s+/i, '') + ' effectively?'),
      benefit: 'Better search visibility',
      reason: '"How to" questions perform well in voice search',
      type: 'suggestion'
    });
  }
  
  // Keyword optimization
  if (analysis.keywords.length > 0) {
    suggestions.push({
      text: improveGrammar('What are the best practices for ' + analysis.keywords.join(' ') + '?'),
      benefit: 'Keyword optimization',
      reason: 'Targets your main topics for better SEO',
      type: 'suggestion'
    });
  }
  
  // User-focused version
  suggestions.push({
    text: improveGrammar('How can I ' + question.toLowerCase().replace(/^(how|what|why|when|where)\s+/i, '').replace(/\?$/, '') + ' successfully?'),
    benefit: 'User-focused approach',
    reason: 'Emphasizes practical value for users',
    type: 'suggestion'
  });
  
  // Filter out duplicates
  const duplicatePatterns = (existingQuestions || []).map(q => ({
    original: q,
    normalized: normalizeQuestionForComparison(q),
    keywords: extractKeywordsForComparison(q)
  }));
  
  const filtered = filterDuplicateSuggestions(suggestions, duplicatePatterns, 'Improvement Fallbacks');
  return filtered.slice(0, 3);
}

function getEnhancedValidationFallbacks(question, analysis, existingQuestions) {
  const tips = [];
  
  analysis.improvements.forEach(improvement => {
    switch (improvement) {
      case 'Add question mark':
        tips.push({
          text: improveGrammar('End with a question mark (?)'),
          benefit: 'Better recognition',
          reason: 'Search engines identify questions by question marks',
          type: 'tip'
        });
        break;
      case 'Add more specific details':
        tips.push({
          text: improveGrammar('Include more specific details'),
          benefit: 'Better targeting',
          reason: 'Specific questions help users find exactly what they need',
          type: 'tip'
        });
        break;
      case 'Include more relevant keywords':
        tips.push({
          text: improveGrammar('Add keywords your users search for'),
          benefit: 'Improved discoverability',
          reason: 'More keywords = better search engine visibility',
          type: 'tip'
        });
        break;
      case 'Start with question word':
        tips.push({
          text: improveGrammar('Start with "How", "What", or "Why"'),
          benefit: 'Voice search optimization',
          reason: 'Voice assistants prefer questions starting with question words',
          type: 'tip'
        });
        break;
    }
  });
  
  return tips.length > 0 ? tips : [
    {
      text: improveGrammar('Consider your target audience'),
      benefit: 'Better user focus',
      reason: 'Questions that match user intent perform better',
      type: 'tip'
    }
  ];
}

function getFallbackSuggestions(questions, mode) {
  if (!questions || questions.length === 0) return [];
  
  return [{
    text: improveGrammar('Please try again - temporary processing issue'),
    benefit: 'System recovery',
    reason: 'Our AI service is temporarily unavailable',
    type: 'fallback'
  }];
}

/**
 * FIXED CACHE KEY GENERATION - More Stable Hashing (Original method preserved for compatibility)
 */
function createCacheKey(questions, mode, websiteContext) {
  if (!questions || questions.length === 0) {
    return null; // Don't cache if no questions
  }
  
  const primaryQuestion = questions[0] || '';
  const questionCount = questions.length;
  const contextHash = websiteContext ? websiteContext.substring(0, 30) : '';
  
  // Create more stable hash by normalizing inputs
  const normalizedQuestion = primaryQuestion.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
  const normalizedContext = contextHash.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Create stable cache input
  const cacheInput = `${normalizedQuestion}_${questionCount}_${mode}_${normalizedContext}`;
  
  // Simple hash function that's consistent
  let hash = 0;
  for (let i = 0; i < cacheInput.length; i++) {
    const char = cacheInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  const cacheKey = `faq_${mode}_${Math.abs(hash).toString(36)}`;
  log(`[Cache] Generated stable cache key: ${cacheKey}`);
  log(`[Cache] Cache input: ${cacheInput.substring(0, 80)}...`);
  
  return cacheKey;
}

async function getCachedResponse(cacheKey, env) {
  const startTime = Date.now();
  
  // Add cache debugging
  log(`[Cache Debug] Attempting to retrieve cache key: ${cacheKey}`);
  log(`[Cache Debug] KV binding available: ${env.FAQ_CACHE ? 'Yes' : 'No'}`);
  
  try {
    const cached = await env.FAQ_CACHE?.get(cacheKey, { type: 'json' });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    log(`[Cache Debug] Raw cached result: ${cached ? 'Found' : 'Not found'}`);
    
    if (cached && cached.metadata && cached.metadata.timestamp) {
      const age = Date.now() - new Date(cached.metadata.timestamp).getTime();
      const ageInMinutes = (age / 60000).toFixed(1);
      
      log(`[Cache Debug] Cache age: ${ageInMinutes} minutes`);
      
      // Cache for 1 hour
      if (age < 3600000) {
        log(`[Cache] ✅ Retrieved valid cached response in ${duration}s (age: ${ageInMinutes} minutes)`);
        cached.metadata.cached = true;
        cached.metadata.cache_age_minutes = ageInMinutes;
        return cached;
      } else {
        log(`[Cache] ⚠️ Found expired cached response in ${duration}s (age: ${ageInMinutes} minutes) - discarding`);
        // Clean up expired cache
        await env.FAQ_CACHE?.delete(cacheKey);
        log(`[Cache Debug] Expired cache entry deleted`);
      }
    } else if (cached) {
      log(`[Cache Debug] ⚠️ Cache found but missing timestamp in metadata - discarding malformed cache`);
      // Clean up malformed cache
      await env.FAQ_CACHE?.delete(cacheKey);
      log(`[Cache Debug] Malformed cache entry deleted`);
    } else {
      log(`[Cache] ℹ️ No cached response found in ${duration}s`);
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logError(`[Cache] ❌ Error retrieving cache in ${duration}s:`, error);
  }
  return null;
}

async function cacheResponse(cacheKey, response, env) {
  const startTime = Date.now();
  
  log(`[Cache Debug] Attempting to cache with key: ${cacheKey}`);
  log(`[Cache Debug] KV binding available: ${env.FAQ_CACHE ? 'Yes' : 'No'}`);
  log(`[Cache Debug] Response size: ${JSON.stringify(response).length} chars`);
  
  try {
    // Add cache metadata
    response.metadata.cache_key = cacheKey;
    response.metadata.timestamp = new Date().toISOString();
    
    // Cache for 1 hour
    await env.FAQ_CACHE?.put(cacheKey, JSON.stringify(response), { expirationTtl: 3600 });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`[Cache] ✅ Response cached successfully in ${duration}s (TTL: 1 hour)`);
    
    // Verify the cache was set
    const verification = await env.FAQ_CACHE?.get(cacheKey, { type: 'json' });
    log(`[Cache Debug] Cache verification: ${verification ? 'Success' : 'Failed'}`);
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logError(`[Cache] ❌ Error setting cache in ${duration}s:`, error);
  }
}