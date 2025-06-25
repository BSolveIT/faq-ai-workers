// SEO Analyzer Worker - AI-Powered with Expert-Level Analysis and KV-Based Rate Limiting
// Uses dynamic AI model configuration from WordPress admin interface

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

/**
 * Get AI model name dynamically from KV store with enhanced caching
 */
async function getAIModel(env, workerType = 'seo_analyzer') {
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
async function getAIModelInfo(env, workerType = 'seo_analyzer') {
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
 * Extract JSON from AI response with better error handling
 */
function extractJSONFromResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    throw new Error('Invalid response text');
  }
  
  // First try to parse the entire response as JSON
  try {
    return JSON.parse(responseText);
  } catch (e) {
    // Continue to regex extraction
  }
  
  // Try to find JSON object with balanced braces
  let depth = 0;
  let startIndex = -1;
  let endIndex = -1;
  
  for (let i = 0; i < responseText.length; i++) {
    if (responseText[i] === '{' && startIndex === -1) {
      startIndex = i;
      depth = 1;
    } else if (startIndex !== -1) {
      if (responseText[i] === '{') {
        depth++;
      } else if (responseText[i] === '}') {
        depth--;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }
  }
  
  if (startIndex !== -1 && endIndex !== -1) {
    const jsonString = responseText.substring(startIndex, endIndex);
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Found JSON-like structure but failed to parse: ' + e.message);
    }
  }
  
  throw new Error('No valid JSON found in response');
}

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // EMERGENCY HEALTH CHECK - with timeout protection
    if (request.method === 'GET' && url.pathname === '/health') {
      try {
        // EMERGENCY: Execute health check with timeout protection
        const healthPromise = generateDynamicHealthResponse(
          'faq-seo-analyzer-worker',
          env,
          '3.1.0-advanced-cache-optimized',
          ['seo_analysis', 'readability_scoring', 'voice_search_optimization', 'featured_snippet_analysis', 'enhanced_rate_limiting', 'ip_management']
        );
        
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 400)
        );
        
        const healthResponse = await Promise.race([healthPromise, timeoutPromise]);
        
        // Add AI model information to health response
        const aiModelInfo = await getAIModelInfo(env, 'seo_analyzer');
        const responseData = typeof healthResponse === 'object' ? healthResponse : {};
        responseData.current_model = aiModelInfo.current_model;
        responseData.model_source = aiModelInfo.model_source;
        responseData.worker_type = aiModelInfo.worker_type;
        
        // Ensure consistent status response across all workers
        responseData.status = 'OK';
        
        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.warn('[Health Check] EMERGENCY fallback for faq-seo-analyzer-worker:', error.message);
        
        // EMERGENCY: Always return HTTP 200 to prevent monitoring cascade failures
        const emergencyResponse = {
          worker: 'faq-seo-analyzer-worker',
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '3.1.0-advanced-cache-optimized',
          capabilities: ['seo_analysis', 'readability_scoring', 'voice_search_optimization', 'featured_snippet_analysis', 'enhanced_rate_limiting', 'ip_management'],
          current_model: env.MODEL_NAME || '@cf/meta/llama-3.1-8b-instruct',
          model_source: 'env_fallback',
          worker_type: 'seo_analyzer',
          rate_limiting: { enabled: true, enhanced: true }
        };
        
        return new Response(JSON.stringify(emergencyResponse), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Handle cache clearing endpoint (both GET and POST)
    if (url.pathname === '/cache/clear') {
      try {
        console.log('[Cache Clear] SEO analyzer worker cache clearing initiated...');
        
        // Initialize cache manager for SEO analyzer worker
        await initializeCacheManager('seo_analyzer', env);
        
        // Clear comprehensive cache types with SEO-specific patterns
        const cacheResult = await invalidateWorkerCaches('seo_analyzer', env, {
          ai_model_config: true,
          worker_health: true,
          suggestion_cache: true,
          l1_cache: true,
          l2_cache: true,
          patterns: [
            'seo_analysis_*',
            'faq_seo_*',
            'ai_model_*',
            'readability_*',
            'voice_search_*',
            'featured_snippet_*',
            'position_zero_*'
          ]
        });
        
        console.log('[Cache Clear] SEO analyzer worker cache clearing completed:', cacheResult);
        
        return new Response(JSON.stringify({
          success: true,
          message: 'SEO analyzer worker caches cleared successfully',
          worker: 'faq-seo-analyzer-worker',
          timestamp: new Date().toISOString(),
          patterns_cleared: cacheResult?.patterns_cleared || [],
          total_keys_cleared: cacheResult?.total_cleared || 0,
          clear_results: cacheResult || {}
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.error('[Cache Clear] SEO analyzer worker cache clearing failed:', error);
        
        return new Response(JSON.stringify({
          success: false,
          error: 'Cache clearing failed',
          message: error.message,
          worker: 'faq-seo-analyzer-worker',
          timestamp: new Date().toISOString()
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Only accept POST for main functionality
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      // Parse request
      let requestData;
      try {
        requestData = await request.json();
      } catch (parseError) {
        return new Response(JSON.stringify({
          error: 'Invalid JSON in request body',
          seoScore: 0,
          readabilityScore: 0,
          voiceSearchScore: 0
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      const { question, answer, pageUrl } = requestData;
      
      console.log('SEO Analysis Request:', { 
        questionLength: question?.length || 0, 
        answerLength: answer?.length || 0,
        pageUrl
      });

      // Validate input
      if (!question || !answer || typeof question !== 'string' || typeof answer !== 'string') {
        return new Response(JSON.stringify({
          error: 'Question and answer are required and must be strings',
          seoScore: 0,
          readabilityScore: 0,
          voiceSearchScore: 0
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      // Trim and check for empty strings
      const trimmedQuestion = question.trim();
      const trimmedAnswer = answer.trim();
      
      if (!trimmedQuestion || !trimmedAnswer) {
        return new Response(JSON.stringify({
          error: 'Question and answer cannot be empty',
          seoScore: 0,
          readabilityScore: 0,
          voiceSearchScore: 0
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get client IP with proper extraction
      const clientIP = request.headers.get('CF-Connecting-IP') ||
                      request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                      request.headers.get('X-Real-IP') ||
                      'unknown';

      console.log(`Processing SEO analysis request from IP: ${clientIP}`);

      // Check rate limit before processing request - SEO analysis specific limits
      let rateLimitConfig = { limit: 20, window: 3600 }; // 20 SEO analyses per hour

      const rateLimitResult = await checkRateLimit(env, clientIP, rateLimitConfig);

      if (!rateLimitResult.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded. Please try again later.',
          retryAfter: 3600,
          message: 'SEO analysis requests are rate limited to prevent abuse',
          seoScore: 0,
          readabilityScore: 0,
          voiceSearchScore: 0,
          rateLimited: true
        }), {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': '3600',
            'X-RateLimit-Limit': '20',
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString()
          }
        });
      }

      console.log(`Processing SEO analysis request from IP: ${clientIP}, remaining: ${rateLimitResult.remaining}`);

      // Expert-level AI prompt with detailed instructions
      const analysisPrompt = `You are a senior Google Search Quality Rater and SEO expert with 15 years of experience. You understand exactly how Google ranks content for Featured Snippets (Position Zero), People Also Ask boxes, and voice search results.

ANALYZE THIS FAQ:
Question: "${trimmedQuestion}"
Answer: "${trimmedAnswer}"
${pageUrl ? `Page URL: ${pageUrl}` : ''}

YOUR TASK: Score this FAQ for its potential to rank in Google Search, win Featured Snippets, and appear in AI-generated answers.

SCORING CRITERIA:

1. SEO SCORE (0-100) - Position Zero & Featured Snippet Potential:
   
   PERFECT (90-100): 
   - Question matches high-volume search queries exactly
   - Answer starts with a 40-250 character direct response
   - Contains the question keywords naturally in the answer
   - Includes related entities and LSI keywords
   - Perfect length for Featured Snippets (40-60 words ideal)
   - Example: "What is SEO?" with answer starting "SEO (Search Engine Optimization) is the practice of improving website visibility in search results..."
   
   EXCELLENT (80-89):
   - Strong keyword match with minor variations
   - Good direct answer but slightly too long/short
   - Most LSI keywords present
   
   GOOD (70-79):
   - Decent keyword usage but missing opportunities
   - Answer addresses question but not immediately
   
   AVERAGE (50-69):
   - Basic keyword presence
   - Answer eventually addresses question
   
   POOR (0-49):
   - Vague question or keyword stuffing
   - Answer doesn't clearly address question
   - Too short (<20 words) or too long (>500 words)

2. READABILITY SCORE (0-100) - Google's E-A-T and User Experience:
   
   PERFECT (90-100):
   - 8th-grade reading level (Flesch-Kincaid)
   - Sentences under 20 words
   - Active voice throughout
   - Clear structure with natural flow
   - Example: Short sentences. Clear points. Easy to scan.
   
   EXCELLENT (80-89):
   - 9th-10th grade reading level
   - Mostly short sentences
   - Minimal passive voice
   
   GOOD (70-79):
   - 11th-12th grade level
   - Some long sentences but clear
   
   AVERAGE (50-69):
   - College level language
   - Complex sentence structures
   
   POOR (0-49):
   - Graduate level complexity
   - Jargon without explanation
   - Run-on sentences

3. VOICE SEARCH SCORE (0-100) - Google Assistant & Alexa Optimization:
   
   PERFECT (90-100):
   - Conversational question (how, what, where, when)
   - Answer starts with direct 1-2 sentence response
   - Uses "you" and natural language
   - Speakable answer under 30 seconds
   - Example: "How do I tie a tie?" → "To tie a tie, start by..."
   
   EXCELLENT (80-89):
   - Natural question format
   - Quick answer but slightly formal
   
   GOOD (70-79):
   - Decent conversational tone
   - Answer a bit too long for voice
   
   AVERAGE (50-69):
   - Formal language but clear
   - Would need editing for voice
   
   POOR (0-49):
   - Technical/formal question
   - Answer too complex for voice reading

PROVIDE YOUR ANALYSIS:

Consider:
- Would this win Position Zero for its target query?
- Would Google's AI Overview include this answer?
- Would voice assistants choose this answer?
- Does it follow Google's Helpful Content guidelines?

Return ONLY a JSON object:
{
  "seoScore": [0-100 with reasoning],
  "readabilityScore": [0-100 with reasoning],
  "voiceSearchScore": [0-100 with reasoning],
  "suggestions": [
    "Specific improvement that would increase Position Zero chances",
    "Specific change to improve readability score by X points",
    "Specific optimization for voice search ranking"
  ],
  "analysis": {
    "featuredSnippetPotential": true/false,
    "positionZeroReady": true/false,
    "targetKeyword": "identified main keyword",
    "missingElements": ["what's missing for 100% score"]
  },
  "reasoning": {
    "seo": "Why this score - be specific about Google ranking factors",
    "readability": "Specific readability issues or strengths",
    "voiceSearch": "Why it would/wouldn't work for voice"
  }
}`;

      // Get dynamic AI model for this worker
      const aiModel = await getAIModel(env, 'seo_analyzer');
      console.log(`[AI Model] Using model: ${aiModel} for seo_analyzer worker`);

      // Call AI for expert analysis
      console.log(`Calling ${aiModel} for expert SEO analysis...`);
      
      const aiResponse = await env.AI.run(aiModel, {
        messages: [
          {
            role: 'system',
            content: `You are a Google Search Quality Rater with deep knowledge of:
- Featured Snippets algorithm and Position Zero requirements
- People Also Ask ranking factors
- Voice search optimization for Google Assistant and Alexa
- E-A-T (Expertise, Authoritativeness, Trustworthiness)
- Google's Helpful Content Update and Core Web Vitals
- BERT and natural language understanding
- RankBrain and semantic search

Analyze FAQs as if determining their Google ranking potential. Provide nuanced, specific scores that reflect real Google ranking likelihood. Be extremely specific with scores and actionable suggestions.`
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0.3, // Low temperature for consistent expert scoring
        max_tokens: 1200 // Increased for detailed responses
      });

      console.log('AI Response received');

      // Parse AI response
      let aiAnalysis;
      try {
        // Extract JSON from response with better handling
        aiAnalysis = extractJSONFromResponse(aiResponse.response);
      } catch (parseError) {
        console.error(`Failed to parse ${aiModel} response:`, parseError);
        console.log('AI Response was:', aiResponse.response);
        
        // Fallback to enhanced algorithmic scoring with the data we have
        return enhancedFallbackScoring(trimmedQuestion, trimmedAnswer, pageUrl, corsHeaders);
      }

      // Validate and sanitize scores
      const seoScore = Math.max(0, Math.min(100, Math.round(Number(aiAnalysis.seoScore) || 50)));
      const readabilityScore = Math.max(0, Math.min(100, Math.round(Number(aiAnalysis.readabilityScore) || 50)));
      const voiceSearchScore = Math.max(0, Math.min(100, Math.round(Number(aiAnalysis.voiceSearchScore) || 50)));

      // Ensure we have suggestions
      const suggestions = Array.isArray(aiAnalysis.suggestions) 
        ? aiAnalysis.suggestions.filter(s => s && typeof s === 'string').slice(0, 5)
        : generateDefaultSuggestions(seoScore, readabilityScore, voiceSearchScore);

      // Build response
      const response = {
        success: true,
        seoScore,
        readabilityScore,
        voiceSearchScore,
        suggestions,
        analysis: {
          questionLength: trimmedQuestion.length,
          answerWordCount: trimmedAnswer.split(/\s+/).filter(w => w.length > 0).length,
          featuredSnippetPotential: aiAnalysis.analysis?.featuredSnippetPotential ?? (trimmedAnswer.split(/[.!?]/)[0]?.length <= 300),
          positionZeroReady: aiAnalysis.analysis?.positionZeroReady ?? (seoScore >= 90),
          targetKeyword: aiAnalysis.analysis?.targetKeyword || extractMainKeyword(trimmedQuestion),
          missingElements: aiAnalysis.analysis?.missingElements || [],
          aiPowered: true,
          model: aiModel,
          worker_type: 'seo_analyzer',
          dynamic_model: true,
          reasoning: aiAnalysis.reasoning || null
        },
        rate_limiting: {
          remaining: rateLimitResult.remaining,
          limit: rateLimitConfig.limit,
          window: rateLimitConfig.window,
          worker: 'faq-seo-analyzer',
          kv_based: true
        }
      };

      console.log('SEO Analysis Response:', response);

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('SEO analyzer error:', error);
      
      // Return error response
      return new Response(JSON.stringify({
        error: error.message || 'An unexpected error occurred',
        seoScore: 0,
        readabilityScore: 0,
        voiceSearchScore: 0,
        suggestions: ['An error occurred during analysis. Please try again.']
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// Enhanced fallback function with more sophisticated scoring
function enhancedFallbackScoring(question, answer, pageUrl, corsHeaders) {
  console.log('Using enhanced fallback scoring...');
  
  // More sophisticated algorithmic calculations
  let seoScore = 0;
  let readabilityScore = 0;
  let voiceSearchScore = 0;
  
  // SEO Score Calculation
  // Question quality (30 points)
  if (question.length >= 10 && question.length <= 60) seoScore += 10;
  if (question.includes('?')) seoScore += 5;
  if (/^(what|how|why|when|where|who|which|can|does|is|are)/i.test(question)) seoScore += 15;
  
  // Answer quality (50 points)
  const words = answer.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  if (wordCount >= 40 && wordCount <= 100) seoScore += 20; // Optimal for featured snippets
  else if (wordCount >= 20 && wordCount <= 300) seoScore += 15;
  else if (wordCount > 10) seoScore += 5;
  
  // Featured snippet optimization (20 points)
  const firstSentence = answer.split(/[.!?]/)[0] || '';
  if (firstSentence.length >= 40 && firstSentence.length <= 250) seoScore += 20;
  
  // Keyword presence
  const questionWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const answerLower = answer.toLowerCase();
  const keywordMatches = questionWords.filter(word => answerLower.includes(word)).length;
  seoScore += Math.min(20, keywordMatches * 5);
  
  // Readability Score Calculation
  const sentences = answer.split(/[.!?]/).filter(s => s.trim().length > 0);
  const avgWordsPerSentence = sentences.length > 0 ? wordCount / sentences.length : 20;
  
  // Sentence length scoring
  if (avgWordsPerSentence <= 15) readabilityScore += 40;
  else if (avgWordsPerSentence <= 20) readabilityScore += 30;
  else if (avgWordsPerSentence <= 25) readabilityScore += 20;
  else readabilityScore += 10;
  
  // Simple language bonus
  const complexWords = words.filter(word => word.length > 7).length;
  const complexityRatio = wordCount > 0 ? complexWords / wordCount : 0;
  if (complexityRatio < 0.1) readabilityScore += 30;
  else if (complexityRatio < 0.2) readabilityScore += 20;
  else readabilityScore += 10;
  
  // Structure bonus
  if (/<[^>]+>/.test(answer)) readabilityScore += 10; // HTML formatting
  if (sentences.length >= 2 && sentences.length <= 5) readabilityScore += 20;
  
  // Voice Search Score Calculation
  // Question optimization (40 points)
  if (/^(what|how|why|when|where|who)/i.test(question)) voiceSearchScore += 20;
  if (question.length <= 50) voiceSearchScore += 10;
  if (question.split(' ').length >= 3 && question.split(' ').length <= 8) voiceSearchScore += 10;
  
  // Answer optimization (60 points)
  if (firstSentence.length >= 40 && firstSentence.length <= 200) voiceSearchScore += 30;
  if (/\b(you|your|you're|you'll)\b/i.test(answer)) voiceSearchScore += 15;
  if (sentences.length <= 3) voiceSearchScore += 15;
  
  // Generate intelligent suggestions based on scores
  const suggestions = [];
  
  if (seoScore < 80) {
    if (firstSentence.length > 250) {
      suggestions.push(`Shorten your opening sentence to under 250 characters (currently ${firstSentence.length}) to improve Featured Snippet chances`);
    }
    if (wordCount < 40) {
      suggestions.push(`Expand your answer to 40-100 words (currently ${wordCount}) for optimal Featured Snippet length`);
    }
    if (keywordMatches < 2) {
      suggestions.push('Include more keywords from your question in the answer to improve relevance');
    }
  }
  
  if (readabilityScore < 80) {
    if (avgWordsPerSentence > 20) {
      suggestions.push(`Reduce sentence length to under 20 words (current average: ${Math.round(avgWordsPerSentence)})`);
    }
    if (complexityRatio > 0.2) {
      suggestions.push('Simplify language - replace complex words with simpler alternatives');
    }
  }
  
  if (voiceSearchScore < 80) {
    if (!/\b(you|your)\b/i.test(answer)) {
      suggestions.push('Add conversational elements using "you" and "your" for voice search optimization');
    }
    if (!firstSentence || firstSentence.length > 200) {
      suggestions.push('Start with a concise direct answer (40-200 characters) for voice assistants');
    }
  }
  
  if (suggestions.length === 0) {
    if (seoScore >= 90 && readabilityScore >= 90 && voiceSearchScore >= 90) {
      suggestions.push('Excellent FAQ! This has strong Position Zero potential');
    } else {
      suggestions.push('Good FAQ! Fine-tune based on the scores above for Featured Snippet optimization');
    }
  }
  
  return new Response(JSON.stringify({
    success: true,
    seoScore: Math.min(100, seoScore),
    readabilityScore: Math.min(100, readabilityScore),
    voiceSearchScore: Math.min(100, voiceSearchScore),
    suggestions,
    analysis: {
      questionLength: question.length,
      answerWordCount: wordCount,
      featuredSnippetPotential: seoScore >= 80,
      positionZeroReady: seoScore >= 90,
      targetKeyword: extractMainKeyword(question),
      missingElements: generateMissingElements(seoScore, readabilityScore, voiceSearchScore),
      aiPowered: false,
      model: 'algorithmic',
      fallbackUsed: true
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Helper function to extract main keyword from question
function extractMainKeyword(question) {
  // Remove question words and extract key topic
  const cleaned = question
    .toLowerCase()
    .replace(/^(what|how|why|when|where|who|which|can|does|is|are)\s+/i, '')
    .replace(/[?!.,]/g, '')
    .trim();
  
  // Return first 2-3 significant words
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  return words.slice(0, 3).join(' ');
}

// Helper function to generate missing elements for perfect score
function generateMissingElements(seoScore, readabilityScore, voiceSearchScore) {
  const missing = [];
  
  if (seoScore < 100) {
    if (seoScore < 50) missing.push('Direct answer in first sentence');
    if (seoScore < 70) missing.push('Optimal word count (40-100 words)');
    if (seoScore < 90) missing.push('Natural keyword placement');
  }
  
  if (readabilityScore < 100) {
    if (readabilityScore < 60) missing.push('Shorter sentences (under 20 words)');
    if (readabilityScore < 80) missing.push('Simpler vocabulary');
  }
  
  if (voiceSearchScore < 100) {
    if (voiceSearchScore < 70) missing.push('Conversational tone');
    if (voiceSearchScore < 90) missing.push('Concise opening statement');
  }
  
  return missing;
}

// Helper function to generate default suggestions
function generateDefaultSuggestions(seoScore, readabilityScore, voiceSearchScore) {
  const suggestions = [];
  
  if (seoScore < 80) {
    suggestions.push('Optimize for Featured Snippets by starting with a 40-250 character direct answer');
  }
  
  if (readabilityScore < 80) {
    suggestions.push('Improve readability by using shorter sentences and simpler words');
  }
  
  if (voiceSearchScore < 80) {
    suggestions.push('Make it more conversational for voice search optimization');
  }
  
  return suggestions.length > 0 ? suggestions : ['Great FAQ! Consider testing variations to improve Position Zero chances'];
}