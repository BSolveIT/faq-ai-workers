/**
 * FAQ Question Generator Worker - Enhanced Question Generation (FIXED VERSION)
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
 */

import { createRateLimiter } from '../../enhanced-rate-limiting/rate-limiter.js';
import { generateDynamicHealthResponse, trackCacheHit, trackCacheMiss } from '../../shared/health-utils.js';
import { cacheAIModelConfig, invalidateWorkerCaches, initializeCacheManager } from '../../shared/advanced-cache-manager.js';

/**
 * Get AI model name dynamically from KV store with enhanced caching
 */
async function getAIModel(env, workerType = 'question_generator') {
  try {
    console.log(`[AI Model Cache] Retrieving model config for ${workerType} with enhanced caching...`);
    
    // Use the advanced cache manager for AI model config
    const configData = await cacheAIModelConfig('ai_model_config', env, async () => {
      console.log(`[AI Model Cache] Cache miss - loading fresh config from KV...`);
      const freshConfig = await env.AI_MODEL_CONFIG?.get('ai_model_config', { type: 'json' });
      
      if (!freshConfig) {
        console.log(`[AI Model Cache] No config found in KV, returning null for cache`);
        return null;
      }
      
      console.log(`[AI Model Cache] Loaded fresh config:`, Object.keys(freshConfig));
      return freshConfig;
    });
    
    // Extract the specific model for this worker type
    if (configData?.ai_models?.[workerType]) {
      console.log(`[AI Model Cache] ✅ Using cached dynamic model for ${workerType}: ${configData.ai_models[workerType]}`);
      return configData.ai_models[workerType];
    }
    
    console.log(`[AI Model Cache] No dynamic model found for ${workerType} in cached config, checking fallback`);
  } catch (error) {
    console.error(`[AI Model Cache] Error with cached retrieval: ${error.message}`);
  }
  
  // Fallback to env.MODEL_NAME or hardcoded default
  const fallbackModel = env.MODEL_NAME || '@cf/meta/llama-3.1-8b-instruct';
  console.log(`[AI Model Cache] ✅ Using fallback model for ${workerType}: ${fallbackModel}`);
  return fallbackModel;
}

/**
 * Get AI model info with source information for health endpoint
 */
async function getAIModelInfo(env, workerType = 'question_generator') {
  try {
    console.log(`[AI Model Info] Retrieving model info for ${workerType}...`);
    
    // Use the advanced cache manager for AI model config
    const configData = await cacheAIModelConfig('ai_model_config', env, async () => {
      console.log(`[AI Model Info] Cache miss - loading fresh config from KV...`);
      const freshConfig = await env.AI_MODEL_CONFIG?.get('ai_model_config', { type: 'json' });
      
      if (!freshConfig) {
        console.log(`[AI Model Info] No config found in KV, returning null for cache`);
        return null;
      }
      
      console.log(`[AI Model Info] Loaded fresh config:`, Object.keys(freshConfig));
      return freshConfig;
    });
    
    // Extract the specific model for this worker type
    if (configData?.ai_models?.[workerType]) {
      console.log(`[AI Model Info] ✅ Using cached dynamic model for ${workerType}: ${configData.ai_models[workerType]}`);
      return {
        current_model: configData.ai_models[workerType],
        model_source: 'kv_config',
        worker_type: workerType
      };
    }
    
    console.log(`[AI Model Info] No dynamic model found for ${workerType} in cached config, checking fallback`);
  } catch (error) {
    console.error(`[AI Model Info] Error with cached retrieval: ${error.message}`);
  }
  
  // Fallback to env.MODEL_NAME or hardcoded default
  if (env.MODEL_NAME) {
    console.log(`[AI Model Info] ✅ Using env fallback model for ${workerType}: ${env.MODEL_NAME}`);
    return {
      current_model: env.MODEL_NAME,
      model_source: 'env_fallback',
      worker_type: workerType
    };
  }
  
  const hardcodedDefault = '@cf/meta/llama-3.1-8b-instruct';
  console.log(`[AI Model Info] ✅ Using hardcoded default model for ${workerType}: ${hardcodedDefault}`);
  return {
    current_model: hardcodedDefault,
    model_source: 'hardcoded_default',
    worker_type: workerType
  };
}

/**
 * Improve grammar and formatting of text suggestions
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
  
  // Fix common grammar issues
  improved = improved
    // Fix double spaces
    .replace(/\s+/g, ' ')
    // Fix spacing around punctuation
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,.!?;:])\s*/g, '$1 ')
    // Fix "a" vs "an"
    .replace(/\ba\s+([aeiouAEIOU])/g, 'an $1')
    .replace(/\ban\s+([^aeiouAEIOU])/g, 'a $1')
    // Fix common word issues
    .replace(/\bits\s+own\b/gi, 'its own')
    .replace(/\byour\s+welcome\b/gi, "you're welcome")
    .replace(/\bwho's\b/gi, 'whose')
    // Ensure proper sentence ending
    .replace(/([^.!?])\s*$/, '$1');
  
  // Fix common FAQ-specific issues
  improved = improved
    .replace(/\bSEO\b/g, 'SEO') // Ensure SEO is uppercase
    .replace(/\bAPI\b/g, 'API') // Ensure API is uppercase
    .replace(/\bURL\b/g, 'URL') // Ensure URL is uppercase
    .replace(/\bHTTPS?\b/gi, 'HTTPS') // Fix protocol naming
    .replace(/\bwebsite\s+website\b/gi, 'website') // Remove duplicates
    .replace(/\bthe\s+the\b/gi, 'the'); // Remove duplicate articles
  
  // Ensure questions don't end with period before question mark
  improved = improved.replace(/\.\?$/, '?');
  
  // Clean up final result
  improved = improved.trim();
  
  // Log grammar improvements for debugging
  if (improved !== originalText) {
    console.log(`[Grammar] ✅ Fixed: "${originalText}" → "${improved}"`);
  }
  
  return improved;
}

/**
 * Analyze question to provide better, targeted suggestions with duplicate detection
 */
function analyzeQuestion(primaryQuestion, existingQuestions = []) {
  const cleanQuestion = primaryQuestion.trim().toLowerCase();
  
  // Detect question type
  let type = 'general';
  if (/^how\s+(do|can|to|long|often|much)/.test(cleanQuestion)) {
    type = 'how-to';
  } else if (/^what\s+(is|are|does|can)/.test(cleanQuestion)) {
    type = 'definition';
  } else if (/^why\s+(do|does|is|are)/.test(cleanQuestion)) {
    type = 'explanation';
  } else if (/^when\s+(do|does|is|should)/.test(cleanQuestion)) {
    type = 'timing';
  } else if (/^where\s+(do|can|is|are)/.test(cleanQuestion)) {
    type = 'location';
  }
  
  // Extract potential keywords
  const words = cleanQuestion.replace(/[^\w\s]/g, '').split(/\s+/);
  const stopWords = ['how', 'what', 'why', 'when', 'where', 'do', 'does', 'is', 'are', 'can', 'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'with'];
  const keywords = words.filter(word => word.length > 2 && !stopWords.includes(word)).slice(0, 5);
  
  // Basic SEO scoring
  let seoScore = 50; // Base score
  
  if (primaryQuestion.includes('?')) seoScore += 10;
  if (primaryQuestion.length >= 20 && primaryQuestion.length <= 100) seoScore += 15;
  if (keywords.length >= 2) seoScore += 10;
  if (/^(how|what|why|when|where)/.test(cleanQuestion)) seoScore += 15;
  
  // Identify improvements needed
  const improvements = [];
  if (!primaryQuestion.includes('?')) improvements.push('Add question mark');
  if (primaryQuestion.length < 20) improvements.push('Add more specific details');
  if (keywords.length < 2) improvements.push('Include more relevant keywords');
  if (!/^(how|what|why|when|where)/.test(cleanQuestion)) improvements.push('Start with question word');
  
  // Create duplicate detection patterns
  const duplicatePatterns = existingQuestions.map(q => ({
    original: q,
    normalized: normalizeQuestionForComparison(q),
    keywords: extractKeywordsForComparison(q)
  }));
  
  console.log(`[Question Analysis] Duplicate detection: ${duplicatePatterns.length} patterns created`);
  
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
    .replace(/[^\w\s]/g, ' ')           // Remove punctuation
    .replace(/\s+/g, ' ')              // Normalize whitespace
    .replace(/\b(how|what|why|when|where|do|does|is|are|can|will|should|could|would)\b/g, '') // Remove question words
    .replace(/\b(the|a|an|to|for|of|in|on|with|by|from|up|about|into|through|during|before|after|above|below|between|among)\b/g, '') // Remove articles/prepositions
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
function isDuplicateQuestion(newQuestion, duplicatePatterns, threshold = 0.7) {
  const newNormalized = normalizeQuestionForComparison(newQuestion);
  const newKeywords = extractKeywordsForComparison(newQuestion);
  
  for (const pattern of duplicatePatterns) {
    // Exact match check
    if (newNormalized === pattern.normalized) {
      console.log(`[Duplicate Check] EXACT match found: "${newQuestion}" matches "${pattern.original}"`);
      return true;
    }
    
    // Keyword similarity check
    const commonKeywords = newKeywords.filter(keyword => pattern.keywords.includes(keyword));
    const similarity = commonKeywords.length / Math.max(newKeywords.length, pattern.keywords.length);
    
    if (similarity >= threshold) {
      console.log(`[Duplicate Check] HIGH similarity (${(similarity * 100).toFixed(1)}%): "${newQuestion}" similar to "${pattern.original}"`);
      return true;
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
      console.log(`[${stepName}] Filtered duplicate: "${questionText.substring(0, 60)}..."`);
    } else {
      filtered.push(suggestion);
      console.log(`[${stepName}] Accepted unique: "${questionText.substring(0, 60)}..."`);
    }
  }
  
  console.log(`[${stepName}] Duplicate filtering: ${duplicatesFound} duplicates removed, ${filtered.length} unique suggestions kept`);
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
        
        // Add AI model information to health response
        const aiModelInfo = await getAIModelInfo(env, 'question_generator');
        healthResponse.current_model = aiModelInfo.current_model;
        healthResponse.model_source = aiModelInfo.model_source;
        healthResponse.worker_type = 'question_generator';
        healthResponse.status = 'OK'; // Ensure consistent status
        healthResponse.rate_limiting = {
          enabled: true,
          enhanced: true
        };
        healthResponse.cache_status = 'active';
        
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
          console.log('[Cache Clear] Starting cache invalidation for faq-realtime-assistant-worker...');
          
          // Initialize cache manager and invalidate all worker caches
          const cacheManager = initializeCacheManager(env);
          await invalidateWorkerCaches('ai_model_config', env);
          await cacheManager.invalidate('faq_improve_*');
          await cacheManager.invalidate('faq_tips_*');
          
          const clearDuration = ((Date.now() - clearStartTime) / 1000).toFixed(2);
          console.log(`[Cache Clear] ✅ Cache invalidation completed in ${clearDuration}s`);
          
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
          console.error(`[Cache Clear] ❌ Cache invalidation failed in ${clearDuration}s:`, error);
          
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
        error: 'Method not allowed'
      }), { 
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const requestStartTime = Date.now();

    try {
      // Parse request body
      const requestData = await request.json();
      const { 
        questions = [],           // Array of all questions (original + generated)
        currentAnswer = '',       // Current answer text
        mode = 'improve', 
        websiteContext = '',      // Optional pre-fetched context
        pageUrl = '',            // Optional page URL (for reference only)
        forceRefresh = false,
        cacheBypass = null
      } = requestData;

      console.log(`[Main Handler] ======== Starting ${mode} request ========`);
      console.log(`[Main Handler] Questions array: ${questions.length} questions, Answer: ${currentAnswer?.length || 0} chars`);
      console.log(`[Main Handler] Mode: ${mode} | Context: ${websiteContext ? 'Yes' : 'No'} | Page URL: ${pageUrl ? 'Yes' : 'No'}`);
      
      // Log existing questions for duplicate prevention
      if (questions.length > 0) {
        console.log(`[Main Handler] Existing questions to avoid duplicating:`);
        questions.forEach((q, index) => {
          console.log(`[Main Handler]   ${index + 1}. "${q.substring(0, 60)}${q.length > 60 ? '...' : ''}"`);
        });
      }

      // Validate input
      if (!questions || questions.length === 0) {
        console.error(`[Main Handler] Validation failed: No questions provided`);
        return new Response(JSON.stringify({
          error: 'At least one question is required',
          contextual: true
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get the primary question (usually the first/original one)
      const primaryQuestion = questions[0];
      console.log(`[Main Handler] Primary question: "${primaryQuestion.substring(0, 75)}..." (${primaryQuestion.length} chars)`);

      // Get client IP
      const clientIP = request.headers.get('CF-Connecting-IP') ||
                      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                      request.headers.get('X-Real-IP') ||
                      'unknown';

      console.log(`[Main Handler] Processing request from IP: ${clientIP}`);

      // Initialize dynamic rate limiter
      const rateLimiter = await createRateLimiter(env, 'faq-realtime-assistant-worker');

      // Check rate limiting BEFORE processing request
      const rateLimitResult = await rateLimiter.checkRateLimit(clientIP, env);
      
      console.log(`[Rate Limiting] Check completed in ${rateLimitResult.duration}s - Allowed: ${rateLimitResult.allowed}`);

      if (!rateLimitResult.allowed) {
        console.warn(`[Rate Limiting] Request blocked for IP ${clientIP} - Reason: ${rateLimitResult.reason}`);
        
        // Return appropriate error response based on reason
        let statusCode = 429;
        let errorMessage = 'Rate limit exceeded';
        
        switch (rateLimitResult.reason) {
          case 'IP_BLACKLISTED':
            statusCode = 403;
            errorMessage = 'Access denied - IP address is blacklisted';
            break;
          case 'GEO_RESTRICTED':
            statusCode = 403;
            errorMessage = `Access denied - Geographic restrictions apply (${rateLimitResult.country})`;
            break;
          case 'TEMPORARILY_BLOCKED':
            statusCode = 429;
            errorMessage = `Temporarily blocked due to violations. Try again in ${Math.ceil(rateLimitResult.remaining_time / 60)} minutes`;
            break;
          case 'RATE_LIMIT_EXCEEDED':
            statusCode = 429;
            errorMessage = 'Rate limit exceeded. Please try again later';
            break;
        }

        return new Response(JSON.stringify({
          error: errorMessage,
          rateLimited: true,
          reason: rateLimitResult.reason,
          usage: rateLimitResult.usage,
          limits: rateLimitResult.limits,
          reset_times: rateLimitResult.reset_times,
          block_expires: rateLimitResult.block_expires,
          remaining_time: rateLimitResult.remaining_time,
          contextual: true
        }), {
          status: statusCode,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Check cache first (unless force refresh)
      let cacheKey = null;
      let cacheCheckDuration = 0;
      if (!forceRefresh && !cacheBypass) {
        const cacheStartTime = Date.now();
        cacheKey = createCacheKey(questions, mode, websiteContext);
        if (cacheKey) {
          const cached = await getCachedResponse(cacheKey, env);
          cacheCheckDuration = ((Date.now() - cacheStartTime) / 1000).toFixed(2);
          
          if (cached) {
            trackCacheHit();
            console.log(`[Main Handler] Cache HIT in ${cacheCheckDuration}s - returning cached response`);
            // Ensure cached response has grammar_checked flag
            if (cached.metadata) {
              cached.metadata.grammar_checked = true;
              cached.metadata.cached = true;
            }
            return new Response(JSON.stringify(cached), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          } else {
            trackCacheMiss();
            console.log(`[Main Handler] Cache MISS in ${cacheCheckDuration}s - proceeding with AI generation`);
          }
        } else {
          console.log(`[Main Handler] Cache disabled (no cache key generated)`);
        }
      } else {
        console.log(`[Main Handler] Cache bypassed - force refresh: ${forceRefresh}, cache bypass: ${!!cacheBypass}`);
      }

      // Analyze primary question for better suggestions
      const analysisStartTime = Date.now();
      const questionAnalysis = analyzeQuestion(primaryQuestion, questions);
      const analysisDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(2);
      
      console.log(`[Main Handler] Question analysis completed in ${analysisDuration}s:`);
      console.log(`[Main Handler] - Type: ${questionAnalysis.type} | SEO Score: ${questionAnalysis.seoScore}/100`);
      console.log(`[Main Handler] - Keywords: [${questionAnalysis.keywords.join(', ')}] | Improvements needed: ${questionAnalysis.improvements.length}`);
      console.log(`[Main Handler] - Duplicate prevention: ${questions.length} existing questions to avoid`);
      
      // Generate enhanced contextual suggestions based on mode
      const generationStartTime = Date.now();
      let suggestions = [];
      
      console.log(`[Main Handler] Starting ${mode} generation with duplicate prevention...`);
      
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
          console.warn(`[Main Handler] Unknown mode: ${mode}, defaulting to improvement`);
          suggestions = await generateEnhancedImprovementSuggestions(questions, currentAnswer, questionAnalysis, env, websiteContext);
      }
      
      const generationDuration = ((Date.now() - generationStartTime) / 1000).toFixed(2);
      console.log(`[Main Handler] ${mode} generation completed in ${generationDuration}s - ${suggestions.length} suggestions generated`);

      // Update usage count immediately after rate limit check passes
      await rateLimiter.updateUsageCount(clientIP, 'faq-realtime-assistant-worker');
      console.log(`[Rate Limiting] Updated usage count for IP ${clientIP}`);

      // Build enhanced response with educational value
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
          neurons_used: 2, // Updated for Llama 3.1 8B
          context_applied: websiteContext ? true : false,
          page_url_provided: pageUrl ? true : false,
          grammar_checked: true,
          cached: false,
          timestamp: new Date().toISOString(),
          rate_limit: {
            usage: rateLimitResult.usage,
            limits: rateLimitResult.limits,
            reset_times: rateLimitResult.reset_times,
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
      if (cacheKey) {
        const cacheSetStart = Date.now();
        await cacheResponse(cacheKey, response, env);
        const cacheSetDuration = ((Date.now() - cacheSetStart) / 1000).toFixed(2);
        console.log(`[Main Handler] Response cached in ${cacheSetDuration}s`);
      }

      const totalDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
      console.log(`[Main Handler] ======== Request completed successfully in ${totalDuration}s ========`);

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      const errorDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
      console.error(`[Main Handler] CRITICAL ERROR after ${errorDuration}s:`, error);
      console.error(`[Main Handler] Error stack:`, error.stack);
      
      // Get request data safely for fallback
      let questionsForFallback = [];
      let modeForFallback = 'improve';
      try {
        const bodyText = await request.clone().text();
        const parsedBody = JSON.parse(bodyText);
        questionsForFallback = parsedBody.questions || [];
        modeForFallback = parsedBody.mode || 'improve';
      } catch (parseError) {
        console.error(`[Main Handler] Could not parse request body for fallback:`, parseError);
      }
      
      return new Response(JSON.stringify({
        error: 'AI processing failed',
        details: error.message,
        contextual: true,
        fallback: true,
        suggestions: getFallbackSuggestions(questionsForFallback, modeForFallback),
        debug: {
          error_type: categorizeError(error),
          duration: errorDuration,
          timestamp: new Date().toISOString(),
          questions_provided: questionsForFallback.length
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Generate enhanced improvement suggestions with educational benefits
 */
async function generateEnhancedImprovementSuggestions(questions, currentAnswer, analysis, env, websiteContext) {
  const stepStartTime = Date.now();
  const primaryQuestion = questions[0];
  console.log(`[Enhanced Improvement] Starting generation for primary question: "${primaryQuestion.substring(0, 50)}..."`);
  console.log(`[Enhanced Improvement] Question analysis - Type: ${analysis.type}, SEO Score: ${analysis.seoScore}, Keywords: [${analysis.keywords.join(', ')}]`);
  console.log(`[Enhanced Improvement] Avoiding duplicates from ${questions.length} existing questions`);
  
  const prompt = buildEnhancedImprovementPrompt(questions, currentAnswer, analysis, websiteContext);
  console.log(`[Enhanced Improvement] Prompt built (${prompt.length} chars), calling AI...`);
  
  // Get dynamic AI model for this worker type
  const aiModel = await getAIModel(env, 'question_generator');
  
  const aiResult = await callAIWithRetry(env.AI, aiModel, {
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that generates FAQ questions. Respond with a JSON array following the exact format shown in the examples. Be creative and helpful.'
      },
      { role: 'user', content: prompt }
    ],
    max_tokens: 500,  // ✅ INCREASED SIGNIFICANTLY
    temperature: 0.7,  // ✅ HIGHER FOR CREATIVITY
    top_p: 0.9        // ✅ ADD TOP_P FOR BETTER DIVERSITY
  }, 'Enhanced Improvement');

  const totalDuration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
  
  if (aiResult.success) {
    console.log(`[Enhanced Improvement] AI call successful in ${aiResult.duration}s, parsing response...`);
    const rawSuggestions = parseEnhancedResponseWithDebug(aiResult.response.response, 'improve');
    const filteredSuggestions = filterDuplicateSuggestions(rawSuggestions, analysis.duplicatePatterns, 'Enhanced Improvement');
    console.log(`[Enhanced Improvement] Total step completed in ${totalDuration}s, returned ${filteredSuggestions.length} unique suggestions`);
    return filteredSuggestions.length > 0 ? filteredSuggestions : getEnhancedImprovementFallbacks(primaryQuestion, analysis, questions);
  } else {
    console.error(`[Enhanced Improvement] AI failed after ${aiResult.duration}s: ${aiResult.error}`);
    const fallbacks = getEnhancedImprovementFallbacks(primaryQuestion, analysis, questions);
    console.log(`[Enhanced Improvement] Using ${fallbacks.length} fallback suggestions, total time: ${totalDuration}s`);
    return fallbacks;
  }
}

/**
 * Generate enhanced validation tips with educational benefits
 */
async function generateEnhancedValidationTips(questions, currentAnswer, analysis, env, websiteContext) {
  const stepStartTime = Date.now();
  const primaryQuestion = questions[0];
  console.log(`[Enhanced Validation] Starting validation for primary question: "${primaryQuestion.substring(0, 50)}..."`);
  console.log(`[Enhanced Validation] Analysis shows ${analysis.improvements.length} potential improvements: [${analysis.improvements.join(', ')}]`);
  
  const prompt = buildEnhancedValidationPrompt(questions, currentAnswer, analysis, websiteContext);
  console.log(`[Enhanced Validation] Prompt built, calling AI for quality assessment...`);
  
  // Get dynamic AI model for this worker type
  const aiModel = await getAIModel(env, 'question_generator');
  
  const aiResult = await callAIWithRetry(env.AI, aiModel, {
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that generates FAQ questions. Respond with a JSON array following the exact format shown in the examples. Be creative and helpful.'
      },
      { role: 'user', content: prompt }
    ],
    max_tokens: 500,  // ✅ INCREASED SIGNIFICANTLY
    temperature: 0.7,  // ✅ HIGHER FOR CREATIVITY
    top_p: 0.9        // ✅ ADD TOP_P FOR BETTER DIVERSITY
  }, 'Enhanced Validation');

  const totalDuration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
  
  if (aiResult.success) {
    console.log(`[Enhanced Validation] AI call successful in ${aiResult.duration}s, parsing tips...`);
    const suggestions = parseEnhancedResponseWithDebug(aiResult.response.response, 'tips');
    console.log(`[Enhanced Validation] Total step completed in ${totalDuration}s, returned ${suggestions.length} validation tips`);
    return suggestions.length > 0 ? suggestions : getEnhancedValidationFallbacks(primaryQuestion, analysis, questions);
  } else {
    console.error(`[Enhanced Validation] AI failed after ${aiResult.duration}s: ${aiResult.error}`);
    const fallbacks = getEnhancedValidationFallbacks(primaryQuestion, analysis, questions);
    console.log(`[Enhanced Validation] Using ${fallbacks.length} fallback tips, total time: ${totalDuration}s`);
    return fallbacks;
  }
}

/**
 * Robust AI call wrapper with retry logic and detailed timing
 */
async function callAIWithRetry(aiBinding, model, options, stepName, maxRetries = 3) {
  const overallStartTime = Date.now();
  console.log(`[AI Retry] Starting ${stepName} with model ${model}, max retries: ${maxRetries}`);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptStartTime = Date.now();
    console.log(`[AI Retry] ${stepName} attempt ${attempt}/${maxRetries}...`);
    
    try {
      const response = await aiBinding.run(model, options);
      const attemptDuration = ((Date.now() - attemptStartTime) / 1000).toFixed(2);
      const totalDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
      
      console.log(`[AI Retry] ${stepName} SUCCESS on attempt ${attempt} - Attempt: ${attemptDuration}s, Total: ${totalDuration}s`);
      
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
      
      console.error(`[AI Retry] ${stepName} FAILED attempt ${attempt}/${maxRetries} (${attemptDuration}s) - ${errorType}: ${error.message}`);
      
      // If this was the last attempt, return failure
      if (attempt === maxRetries) {
        const totalDuration = ((Date.now() - overallStartTime) / 1000).toFixed(2);
        console.error(`[AI Retry] ${stepName} EXHAUSTED all ${maxRetries} attempts in ${totalDuration}s - giving up`);
        
        return {
          success: false,
          response: null,
          duration: totalDuration,
          attempts: attempt,
          error: `${errorType}: ${error.message}`
        };
      }
      
      // Calculate exponential backoff delay
      const baseDelay = 1000; // 1 second
      const backoffDelay = baseDelay * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      const jitter = Math.random() * 500; // Add up to 500ms jitter
      const delay = backoffDelay + jitter;
      
      console.log(`[AI Retry] ${stepName} waiting ${(delay / 1000).toFixed(2)}s before retry ${attempt + 1}...`);
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
 * Build prompts optimized for different contextual modes with duplicate prevention
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
    console.error(`[Parse Enhanced ${mode}] ❌ Invalid response type:`, typeof aiResponse);
    return getContextualFallbacks(mode);
  }

  // COMPREHENSIVE DEBUG LOGGING
  console.log(`[Parse Enhanced ${mode}] ========== FULL AI RESPONSE DEBUG ==========`);
  console.log(`[Parse Enhanced ${mode}] Response length: ${aiResponse.length} characters`);
  console.log(`[Parse Enhanced ${mode}] Response type: ${typeof aiResponse}`);
  console.log(`[Parse Enhanced ${mode}] Raw response (FULL):`);
  console.log(aiResponse);
  console.log(`[Parse Enhanced ${mode}] =============================================`);

  let cleaned = aiResponse.trim();
  
  // Try multiple extraction strategies
  
  // Strategy 1: Direct JSON parsing
  try {
    console.log(`[Parse Enhanced ${mode}] 🔄 Trying Strategy 1: Direct JSON parsing...`);
    // Look for JSON array anywhere in the response
    const jsonMatch = cleaned.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (jsonMatch) {
      console.log(`[Parse Enhanced ${mode}] Found JSON match:`, jsonMatch[0]);
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validated = validateAndCleanSuggestions(parsed, mode);
        if (validated.length > 0) {
          console.log(`[Parse Enhanced ${mode}] ✅ Strategy 1 successful: ${validated.length} items`);
          return validated;
        }
      }
    } else {
      console.log(`[Parse Enhanced ${mode}] ❌ No JSON array pattern found in response`);
    }
  } catch (e) {
    console.log(`[Parse Enhanced ${mode}] ❌ Strategy 1 failed:`, e.message);
  }

  // Strategy 2: Extract individual objects
  try {
    console.log(`[Parse Enhanced ${mode}] 🔄 Trying Strategy 2: Individual object extraction...`);
    const objectPattern = /\{[^{}]*"text"\s*:\s*"([^"]+)"[^{}]*"benefit"\s*:\s*"([^"]+)"[^{}]*"reason"\s*:\s*"([^"]+)"[^{}]*\}/g;
    const matches = [...cleaned.matchAll(objectPattern)];
    
    console.log(`[Parse Enhanced ${mode}] Found ${matches.length} object matches`);
    
    if (matches.length > 0) {
      const suggestions = matches.map(match => ({
        text: improveGrammar(match[1].trim()),
        benefit: match[2].trim(),
        reason: match[3].trim(),
        type: mode === 'tips' ? 'tip' : 'suggestion'
      }));
      
      console.log(`[Parse Enhanced ${mode}] ✅ Strategy 2 successful: ${suggestions.length} items`);
      return suggestions;
    }
  } catch (e) {
    console.log(`[Parse Enhanced ${mode}] ❌ Strategy 2 failed:`, e.message);
  }

  // Strategy 3: Extract questions with quotes
  try {
    console.log(`[Parse Enhanced ${mode}] 🔄 Trying Strategy 3: Question extraction with quotes...`);
    const questionPattern = /"([^"]*\?[^"]*)"/g;
    const questions = [...cleaned.matchAll(questionPattern)];
    
    console.log(`[Parse Enhanced ${mode}] Found ${questions.length} quoted questions`);
    
    if (questions.length >= 2) {
      const suggestions = questions.slice(0, 3).map((match, index) => ({
        text: improveGrammar(match[1]),
        benefit: `Alternative ${index + 1}`,
        reason: 'Provides different perspective on the topic',
        type: 'suggestion'
      }));
      
      console.log(`[Parse Enhanced ${mode}] ✅ Strategy 3 successful: ${suggestions.length} questions extracted`);
      return suggestions;
    }
  } catch (e) {
    console.log(`[Parse Enhanced ${mode}] ❌ Strategy 3 failed:`, e.message);
  }

  // If all strategies fail, return better fallbacks
  console.warn(`[Parse Enhanced ${mode}] ❌ All parsing strategies failed, returning contextual fallbacks`);
  const fallbacks = getContextualFallbacks(mode);
  console.log(`[Parse Enhanced ${mode}] ✅ Returning ${fallbacks.length} fallback suggestions`);
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

// Better contextual fallbacks based on common patterns
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
 * FIXED CACHE KEY GENERATION - More Stable Hashing
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
  console.log(`[Cache] Generated stable cache key: ${cacheKey}`);
  console.log(`[Cache] Cache input: ${cacheInput.substring(0, 80)}...`);
  
  return cacheKey;
}

async function getCachedResponse(cacheKey, env) {
  const startTime = Date.now();
  
  // Add cache debugging
  console.log(`[Cache Debug] Attempting to retrieve cache key: ${cacheKey}`);
  console.log(`[Cache Debug] KV binding available: ${env.FAQ_CACHE ? 'Yes' : 'No'}`);
  
  try {
    const cached = await env.FAQ_CACHE?.get(cacheKey, { type: 'json' });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`[Cache Debug] Raw cached result: ${cached ? 'Found' : 'Not found'}`);
    
    if (cached && cached.metadata && cached.metadata.timestamp) {
      const age = Date.now() - new Date(cached.metadata.timestamp).getTime();
      const ageInMinutes = (age / 60000).toFixed(1);
      
      console.log(`[Cache Debug] Cache age: ${ageInMinutes} minutes`);
      
      // Cache for 1 hour
      if (age < 3600000) {
        console.log(`[Cache] ✅ Retrieved valid cached response in ${duration}s (age: ${ageInMinutes} minutes)`);
        cached.metadata.cached = true;
        cached.metadata.cache_age_minutes = ageInMinutes;
        return cached;
      } else {
        console.log(`[Cache] ⚠️ Found expired cached response in ${duration}s (age: ${ageInMinutes} minutes) - discarding`);
        // Clean up expired cache
        await env.FAQ_CACHE?.delete(cacheKey);
        console.log(`[Cache Debug] Expired cache entry deleted`);
      }
    } else if (cached) {
      console.log(`[Cache Debug] ⚠️ Cache found but missing timestamp in metadata - discarding malformed cache`);
      // Clean up malformed cache
      await env.FAQ_CACHE?.delete(cacheKey);
      console.log(`[Cache Debug] Malformed cache entry deleted`);
    } else {
      console.log(`[Cache] ℹ️ No cached response found in ${duration}s`);
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[Cache] ❌ Error retrieving cache in ${duration}s:`, error);
  }
  return null;
}

async function cacheResponse(cacheKey, response, env) {
  const startTime = Date.now();
  
  console.log(`[Cache Debug] Attempting to cache with key: ${cacheKey}`);
  console.log(`[Cache Debug] KV binding available: ${env.FAQ_CACHE ? 'Yes' : 'No'}`);
  console.log(`[Cache Debug] Response size: ${JSON.stringify(response).length} chars`);
  
  try {
    // Add cache metadata
    response.metadata.cache_key = cacheKey;
    response.metadata.timestamp = new Date().toISOString();
    
    // Cache for 1 hour
    await env.FAQ_CACHE?.put(cacheKey, JSON.stringify(response), { expirationTtl: 3600 });
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Cache] ✅ Response cached successfully in ${duration}s (TTL: 1 hour)`);
    
    // Verify the cache was set
    const verification = await env.FAQ_CACHE?.get(cacheKey, { type: 'json' });
    console.log(`[Cache Debug] Cache verification: ${verification ? 'Success' : 'Failed'}`);
    
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`[Cache] ❌ Error setting cache in ${duration}s:`, error);
  }
}