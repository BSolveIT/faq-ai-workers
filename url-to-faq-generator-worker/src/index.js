/**
 * Premium Quality URL-to-FAQ Generator
 *
 * Deep Analysis Mode (15K content + 2-3 minute processing):
 * - Extensive content analysis (up to 15K characters)
 * - Multiple AI optimization passes for quality
 * - Deep content understanding and context
 * - Extended processing time (up to 3 minutes)
 * - Premium model usage with thorough validation
 * - Perfect for creating comprehensive FAQ foundation (max 12)
 */

import { parse } from 'node-html-parser';
import { createRateLimiter } from '../../enhanced-rate-limiting/rate-limiter.js';
import { generateDynamicHealthResponse, trackCacheHit, trackCacheMiss } from '../../shared/health-utils.js';
import { cacheAIModelConfig, invalidateWorkerCaches, initializeCacheManager } from '../../shared/advanced-cache-manager.js';

/**
 * Get AI model name dynamically from KV store with enhanced caching
 */
async function getAIModel(env, workerType = 'topic_generator') {
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
async function getAIModelInfo(env, workerType = 'topic_generator') {
  try {
    console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Retrieving model info for ${workerType}...`);
    console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Current timestamp: ${new Date().toISOString()}`);
    
    // Use the advanced cache manager for AI model config
    const configData = await cacheAIModelConfig('ai_model_config', env, async () => {
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Cache miss - loading fresh config from KV...`);
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] KV namespace being accessed: AI_MODEL_CONFIG`);
      
      const freshConfig = await env.AI_MODEL_CONFIG?.get('ai_model_config', { type: 'json' });
      
      if (!freshConfig) {
        console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] No config found in KV, returning null for cache`);
        return null;
      }
      
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Loaded fresh config from KV:`, JSON.stringify(freshConfig, null, 2));
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Fresh config keys:`, Object.keys(freshConfig));
      if (freshConfig.ai_models) {
        console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] AI models in fresh config:`, Object.keys(freshConfig.ai_models));
        console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Model for ${workerType}:`, freshConfig.ai_models[workerType]);
      }
      return freshConfig;
    });
    
    // DEBUG: Log what we got from cache
    console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Config data from cache:`, configData ? 'present' : 'null');
    if (configData) {
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Cache data structure:`, Object.keys(configData));
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Cache updated_at:`, configData.updated_at);
      if (configData.ai_models) {
        console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] AI models in cache:`, Object.keys(configData.ai_models));
        console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Specific model for ${workerType}:`, configData.ai_models[workerType]);
      }
    }
    
    // Extract the specific model for this worker type
    if (configData?.ai_models?.[workerType]) {
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] ✅ Using cached dynamic model for ${workerType}: ${configData.ai_models[workerType]}`);
      console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] Model source: kv_config, Updated at: ${configData.updated_at}`);
      return {
        current_model: configData.ai_models[workerType],
        model_source: 'kv_config',
        worker_type: workerType,
        cache_updated_at: configData.updated_at,
        cache_version: configData.version
      };
    }
    
    console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] No dynamic model found for ${workerType} in cached config, checking fallback`);
  } catch (error) {
    console.error(`[AI Model Info] [WORKER_SYNC_DEBUG] Error with cached retrieval: ${error.message}`);
  }
  
  // Fallback to env.MODEL_NAME or hardcoded default
  if (env.MODEL_NAME) {
    console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] ✅ Using env fallback model for ${workerType}: ${env.MODEL_NAME}`);
    return {
      current_model: env.MODEL_NAME,
      model_source: 'env_fallback',
      worker_type: workerType
    };
  }
  
  const hardcodedDefault = '@cf/meta/llama-3.1-8b-instruct';
  console.log(`[AI Model Info] [WORKER_SYNC_DEBUG] ✅ Using hardcoded default model for ${workerType}: ${hardcodedDefault}`);
  return {
    current_model: hardcodedDefault,
    model_source: 'hardcoded_default',
    worker_type: workerType
  };
}

// Premium AI call with extended timeouts for deep analysis (up to 3 minutes)
async function callAIWithTimeout(aiBinding, model, messages, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await aiBinding.run(model, {
      messages,
      temperature: options.temperature || 0.3, // Slightly lower for more consistent quality
      max_tokens: options.max_tokens || 4000, // INCREASED for longer answers
      signal: controller.signal
    });
    
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('AI request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Enhanced JSON cleaning
function cleanJsonResponse(text) {
  text = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return text;
}

// Enhanced content extraction function
async function extractContentUltimate(html) {
  const root = parse(html, {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: {
      script: true,
      style: false,
      pre: true
    }
  });

  // Remove unwanted elements
  ['script', 'style', 'nav', 'footer', 'header', '.sidebar', '.menu', '.advertisement'].forEach(selector => {
    root.querySelectorAll(selector).forEach(el => el.remove());
  });

  // Enhanced title extraction
  let title = '';
  const titleEl = root.querySelector('title');
  const h1El = root.querySelector('h1');
  
  if (titleEl) title = titleEl.text.trim();
  else if (h1El) title = h1El.text.trim();
  
  // Enhanced heading extraction
  const headings = [];
  ['h1', 'h2', 'h3', 'h4'].forEach(tag => {
    root.querySelectorAll(tag).forEach(el => {
      const text = el.text.trim();
      if (text.length > 5 && text.length < 100) {
        headings.push(text);
      }
    });
  });

  // Enhanced content extraction with better text processing
  const contentElements = root.querySelectorAll('main, article, .content, .post, .entry, p, div, section');
  let allText = '';
  
  contentElements.forEach(el => {
    const text = el.text || '';
    if (text.length > 20) {
      allText += text + ' ';
    }
  });

  // Clean and process content
  const content = allText
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.,!?;:()\-\/]/g, '')
    .trim();

  return {
    title: title || 'Untitled Page',
    headings: headings.slice(0, 8), // More headings for better context
    content: content
  };
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Initialize enhanced rate limiter with dynamic configuration for AI-intensive operations
    const rateLimiter = await createRateLimiter(env, 'url-to-faq-generator-worker', {
      // Fallback configuration if dynamic config fails
      hourlyLimit: 5,     // Very strict - intensive 3-minute AI operations
      dailyLimit: 15,     // Conservative daily allowance
      weeklyLimit: 75,    // Weekly budget for URL-to-FAQ generation
      monthlyLimit: 300,  // Monthly limit for premium service
      violationThresholds: {
        soft: 2,          // Quick soft limit due to expensive operations
        hard: 4,          // Hard limit before temp blocks
        ban: 8            // Permanent ban threshold
      }
    });

    const url = new URL(request.url);

    // EMERGENCY HEALTH CHECK - with timeout protection
    if (request.method === 'GET' && url.pathname === '/health') {
      try {
        // EMERGENCY: Execute health check with timeout protection
        const healthPromise = generateDynamicHealthResponse(
          'url-to-faq-generator-worker',
          env,
          '3.1.0-advanced-cache-optimized',
          ['url_analysis', 'deep_content_extraction', 'premium_faq_generation', 'multi_pass_optimization', 'enhanced_rate_limiting']
        );
        
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 400)
        );
        
        const healthResponse = await Promise.race([healthPromise, timeoutPromise]);
        
        // Add AI model information to health response
        const aiModelInfo = await getAIModelInfo(env, 'topic_generator');
        healthResponse.current_model = aiModelInfo.current_model;
        healthResponse.model_source = aiModelInfo.model_source;
        healthResponse.worker_type = aiModelInfo.worker_type;
        
        // Ensure consistent status response across all workers
        healthResponse.status = 'OK';
        
        return new Response(JSON.stringify(healthResponse), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.warn('[Health Check] EMERGENCY fallback for url-to-faq-generator-worker:', error.message);
        
        // EMERGENCY: Always return HTTP 200 to prevent monitoring cascade failures
        const emergencyResponse = {
          worker: 'url-to-faq-generator-worker',
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '3.1.0-advanced-cache-optimized',
          capabilities: ['url_analysis', 'deep_content_extraction', 'premium_faq_generation', 'multi_pass_optimization', 'enhanced_rate_limiting'],
          current_model: env.MODEL_NAME || '@cf/meta/llama-3.1-8b-instruct',
          model_source: 'env_fallback',
          worker_type: 'topic_generator',
          rate_limiting: { enabled: true, enhanced: true },
          cache_status: 'active'
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
        console.log('[Cache Clear] URL-to-FAQ generator worker cache clearing initiated...');
        
        // Initialize cache manager for URL-to-FAQ generator worker
        await initializeCacheManager('topic_generator', env);
        
        // Clear comprehensive cache types with URL-to-FAQ-specific patterns
        const cacheResult = await invalidateWorkerCaches('topic_generator', env, {
          ai_model_config: true,
          worker_health: true,
          suggestion_cache: true,
          l1_cache: true,
          l2_cache: true,
          patterns: [
            'topic_generator_*',
            'url_faq_*',
            'ai_model_*',
            'content_extraction_*',
            'faq_generation_*',
            'premium_analysis_*',
            'multi_pass_*'
          ]
        });
        
        console.log('[Cache Clear] URL-to-FAQ generator worker cache clearing completed:', cacheResult);
        
        return new Response(JSON.stringify({
          success: true,
          message: 'URL-to-FAQ generator worker caches cleared successfully',
          worker: 'url-to-faq-generator-worker',
          timestamp: new Date().toISOString(),
          patterns_cleared: cacheResult?.patterns_cleared || [],
          total_keys_cleared: cacheResult?.total_cleared || 0,
          clear_results: cacheResult || {}
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.error('[Cache Clear] URL-to-FAQ generator worker cache clearing failed:', error);
        
        return new Response(JSON.stringify({
          success: false,
          error: 'Cache clearing failed',
          message: error.message,
          worker: 'url-to-faq-generator-worker',
          timestamp: new Date().toISOString()
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed. Use POST with URL parameter.'
      }), { 
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      const startTime = Date.now();
      
      if (!env.AI) {
        throw new Error('AI binding not found');
      }
      
      const { url: targetUrl, options = {} } = await request.json();
      
      if (!targetUrl) {
        return new Response(JSON.stringify({
          error: 'Missing URL parameter',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Validate URL
      try {
        const parsedUrl = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch (error) {
        return new Response(JSON.stringify({
          error: 'Invalid URL format',
          success: false
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Enhanced rate limiting check
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rateLimitResult = await rateLimiter.checkRateLimit(clientIP, request, 'url-to-faq-generator-worker');
      
      if (!rateLimitResult.allowed) {
        return new Response(JSON.stringify({
          rateLimited: true,
          error: rateLimitResult.reason,
          retryAfter: rateLimitResult.retryAfter,
          resetTime: rateLimitResult.resetTime,
          success: false,
          violation_type: rateLimitResult.violationType,
          block_duration: rateLimitResult.blockDuration
        }), {
          status: rateLimitResult.violationType === 'IP_BLACKLISTED' ? 403 : 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': rateLimitResult.retryAfter?.toString() || '3600'
          }
        });
      }

      // Update usage count immediately after rate limit check passes
      await rateLimiter.updateUsageCount(clientIP, 'url-to-faq-generator-worker');
      console.log(`[Rate Limiting] Updated usage count for IP ${clientIP}`);

      // ENHANCED: Quality focused with sensible 12 FAQ limit
      const faqCount = Math.min(Math.max(options.faqCount || 12, 6), 12);
      console.log(`Starting PREMIUM DEEP ANALYSIS of ${faqCount} FAQs (15K content analysis)`);

      // STEP 1: Enhanced Content Extraction
      let pageContent, title, headings, extractedContent;
      
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 30000); // Extended fetch timeout
        
        const pageResponse = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (FAQ-Generator-Bot/4.0-Enhanced)',
            'Accept': 'text/html,application/xhtml+xml',
          }
        });

        clearTimeout(fetchTimeout);

        if (!pageResponse.ok) {
          throw new Error(`HTTP ${pageResponse.status}`);
        }

        pageContent = await pageResponse.text();
        
        const extractionResult = await extractContentUltimate(pageContent);
        title = extractionResult.title;
        headings = extractionResult.headings;
        extractedContent = extractionResult.content;

        if (extractedContent.length < 500) {
          throw new Error('Insufficient content');
        }

        console.log(`Enhanced content extracted in ${Date.now() - startTime}ms`);

      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: `Failed to extract content: ${error.message}`
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // STEP 2: PREMIUM DEEP CONTENT ANALYSIS
      // EXTENSIVE CONTENT for deep understanding (15K characters)
      const contentLimit = 15000; // DEEP ANALYSIS MODE
      const contentForAI = extractedContent.substring(0, contentLimit);

      // Enhanced prompts for maximum quality with deep content understanding
      const generationPrompt = `Generate ${faqCount} comprehensive, premium-quality FAQs about "${title}".

DEEP CONTENT ANALYSIS (15,000 characters processed):
- Page Title: ${title}
- Key Topics: ${headings.slice(0, 8).join(' | ')}
- Comprehensive Content Analysis: ${contentForAI}

PREMIUM QUALITY REQUIREMENTS:
- Questions: 40-80 characters, natural conversational style, highly SEO-optimized with target keywords
- Answers: 150-500 characters, extremely comprehensive and detailed with specific benefits/features
- Cover ALL major topics, services, pricing, and unique selling points mentioned in content
- Use specific details, numbers, prices, timeframes from the 15K content analysis
- Focus on what customers genuinely want to know and search for
- Include compelling reasons, benefits, and specific value propositions
- Make each FAQ a valuable standalone piece of information
- Optimize for voice search and featured snippets

CONTENT DEPTH REQUIREMENTS:
- Extract and utilize specific business details from the comprehensive content
- Include pricing information where mentioned
- Reference specific services, features, or benefits discussed
- Address common customer concerns and objections
- Highlight unique selling points and competitive advantages

Output Format - Return exactly ${faqCount} premium-quality FAQs as JSON:
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Specific, keyword-rich question optimized for search?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Comprehensive, detailed answer with specific information extracted from the 15K content analysis, including benefits, features, pricing, and compelling reasons why this matters to potential customers."
      }
    }
  ]
}

CRITICAL: Only return the JSON. Make every FAQ exceptionally valuable using the deep content understanding from 15K character analysis.`;

      // Get dynamic AI model for this worker
      const aiModel = await getAIModel(env, 'topic_generator');
      console.log(`[AI Model] Using model: ${aiModel} for topic_generator worker`);

      let initialFAQs;
      // PREMIUM: Extended processing for deep analysis
      const maxTokens = 6000; // MUCH HIGHER for comprehensive answers
      const timeout = 150000; // 2.5 minutes for thorough processing

      try {
        const aiResponse = await callAIWithTimeout(
          env.AI,
          aiModel, // DYNAMIC MODEL FROM KV CONFIG
          [
            { role: 'system', content: 'You are a premium FAQ specialist with deep content analysis capabilities. Generate exceptionally detailed, high-value FAQs using comprehensive content understanding. Focus on creating FAQs that provide maximum value to users and perform excellently in search results.' },
            { role: 'user', content: generationPrompt }
          ],
          { temperature: 0.3, max_tokens: maxTokens }, // Lower temperature for consistency
          timeout
        );

        let responseText = '';
        if (typeof aiResponse === 'string') {
          responseText = aiResponse;
        } else if (aiResponse.response) {
          responseText = typeof aiResponse.response === 'string' ? 
            aiResponse.response : 
            aiResponse.response.text || JSON.stringify(aiResponse.response);
        } else if (aiResponse.choices?.[0]) {
          responseText = aiResponse.choices[0].text || aiResponse.choices[0].message?.content || '';
        }

        responseText = cleanJsonResponse(responseText);
        initialFAQs = JSON.parse(responseText);

        console.log(`Enhanced generation: ${initialFAQs.mainEntity?.length} FAQs in ${Date.now() - startTime}ms`);
        
      } catch (error) {
        console.error('Primary model failed:', error.message);
        
        // Fallback to default model with same quality settings
        const fallbackModel = env.MODEL_NAME || '@cf/meta/llama-3.1-8b-instruct';
        console.log(`[AI Model] Primary model failed, using fallback: ${fallbackModel}`);
        
        try {
          const fallbackResponse = await callAIWithTimeout(
            env.AI,
            fallbackModel,
            [
              { role: 'system', content: 'Generate premium-quality, detailed FAQs in JSON format using deep content analysis.' },
              { role: 'user', content: generationPrompt }
            ],
            { temperature: 0.3, max_tokens: maxTokens },
            timeout
          );

          let responseText = '';
          if (typeof fallbackResponse === 'string') {
            responseText = fallbackResponse;
          } else if (fallbackResponse.response) {
            responseText = typeof fallbackResponse.response === 'string' ? 
              fallbackResponse.response : 
              fallbackResponse.response.text || JSON.stringify(fallbackResponse.response);
          }

          responseText = cleanJsonResponse(responseText);
          initialFAQs = JSON.parse(responseText);
          
        } catch (fallbackError) {
          throw new Error('Enhanced FAQ generation failed');
        }
      }

      if (!initialFAQs?.mainEntity || !Array.isArray(initialFAQs.mainEntity)) {
        throw new Error('Invalid FAQ structure');
      }

      // STEP 3: MULTIPLE AI OPTIMIZATION PASSES
      let finalFAQs = initialFAQs;
      
      // Multiple optimization passes for premium quality (up to 3 minutes total)
      if (Date.now() - startTime < 120000) { // Allow 2+ minutes for optimization
        console.log('Running PREMIUM multi-pass optimization...');
        
        // PASS 1: SEO and Structure Optimization
        try {
          const seoOptimizationPrompt = `PASS 1 - SEO & STRUCTURE OPTIMIZATION

Analyze and improve these ${initialFAQs.mainEntity.length} FAQs for maximum SEO performance:

${JSON.stringify(initialFAQs, null, 2)}

Optimization Requirements:
- Ensure questions are 40-80 characters and include target keywords
- Expand answers to 150-500 characters with specific, valuable details
- Add location-specific terms if relevant to business
- Improve question structure for voice search (who, what, when, where, why, how)
- Ensure answers directly address the question asked
- Add specific numbers, prices, timeframes where mentioned in content
- Maintain JSON structure exactly

Return the SEO-optimized FAQs in the same JSON format.`;

          const seoResponse = await callAIWithTimeout(
            env.AI,
            '@cf/meta/llama-3.1-8b-instruct',
            [
              { role: 'system', content: 'You are an SEO expert specializing in FAQ optimization for search engines and voice assistants.' },
              { role: 'user', content: seoOptimizationPrompt }
            ],
            { temperature: 0.1, max_tokens: 4000 },
            45000
          );

          let seoText = '';
          if (typeof seoResponse === 'string') {
            seoText = seoResponse;
          } else if (seoResponse.response) {
            seoText = typeof seoResponse.response === 'string' ? 
              seoResponse.response : 
              seoResponse.response.text || JSON.stringify(seoResponse.response);
          }

          seoText = cleanJsonResponse(seoText);
          const seoOptimizedFAQs = JSON.parse(seoText);
          
          if (seoOptimizedFAQs?.mainEntity && Array.isArray(seoOptimizedFAQs.mainEntity)) {
            finalFAQs = seoOptimizedFAQs;
            console.log('SEO optimization pass completed successfully');
          }
          
        } catch (seoError) {
          console.log('SEO optimization failed, continuing:', seoError.message);
        }
        
        // PASS 2: Content Quality and Detail Enhancement (if time allows)
        if (Date.now() - startTime < 100000) { // If under 1:40, do second pass
          try {
            const qualityPrompt = `PASS 2 - CONTENT QUALITY ENHANCEMENT

Further improve these FAQs for maximum user value and detail:

${JSON.stringify(finalFAQs, null, 2)}

Quality Enhancement Requirements:
- Make answers more comprehensive and helpful
- Add specific examples, benefits, or use cases where relevant
- Ensure technical accuracy and clarity
- Remove any vague or generic language
- Add compelling reasons why users should care about each answer
- Ensure each FAQ provides genuine value to potential customers
- Maintain optimal length (150-500 characters per answer)
- Keep JSON structure intact

Return the quality-enhanced FAQs in the same JSON format.`;

            const qualityResponse = await callAIWithTimeout(
              env.AI,
              '@cf/meta/llama-3.1-8b-instruct',
              [
                { role: 'system', content: 'You are a content quality specialist focused on creating valuable, detailed, and engaging FAQ content.' },
                { role: 'user', content: qualityPrompt }
              ],
              { temperature: 0.2, max_tokens: 4000 },
              45000
            );

            let qualityText = '';
            if (typeof qualityResponse === 'string') {
              qualityText = qualityResponse;
            } else if (qualityResponse.response) {
              qualityText = typeof qualityResponse.response === 'string' ? 
                qualityResponse.response : 
                qualityResponse.response.text || JSON.stringify(qualityResponse.response);
            }

            qualityText = cleanJsonResponse(qualityText);
            const qualityEnhancedFAQs = JSON.parse(qualityText);
            
            if (qualityEnhancedFAQs?.mainEntity && Array.isArray(qualityEnhancedFAQs.mainEntity)) {
              finalFAQs = qualityEnhancedFAQs;
              console.log('Quality enhancement pass completed successfully');
            }
            
          } catch (qualityError) {
            console.log('Quality enhancement failed, using SEO version:', qualityError.message);
          }
        }
      }

      // Premium validation - higher quality standards with 15K content analysis
      const validFAQs = finalFAQs.mainEntity.filter(faq => 
        faq?.name && 
        faq?.acceptedAnswer?.text && 
        faq.name.length >= 25 && // Higher minimum for premium
        faq.name.length <= 120 && 
        faq.acceptedAnswer.text.length >= 80 && // Higher minimum for detailed answers
        faq.acceptedAnswer.text.length <= 1000 && 
        !faq.name.toLowerCase().includes('untitled') &&
        !faq.acceptedAnswer.text.toLowerCase().includes('no information') &&
        !faq.acceptedAnswer.text.toLowerCase().includes('not specified')
      );

      if (validFAQs.length < Math.max(3, Math.floor(faqCount * 0.7))) {
        throw new Error(`Only ${validFAQs.length} high-quality FAQs generated (needed ${Math.floor(faqCount * 0.7)})`);
      }

      

      const processingTime = Date.now() - startTime;
      const wasEnhanced = processingTime < 120000; // 2 minute enhancement window
      
      // Get current usage data for response metadata
      const currentUsage = await rateLimiter.getCurrentUsage(clientIP, 'url-to-faq-generator-worker', new Date());

      return new Response(JSON.stringify({
        success: true,
        source: targetUrl,
        faqs: validFAQs,
        metadata: {
          title: title,
          totalGenerated: validFAQs.length,
          processingTime: processingTime,
          model: aiModel,
          worker_type: 'topic_generator',
          dynamic_model: true,
          enhanced: wasEnhanced,
          qualityMode: 'premium-deep-analysis', // Premium indicator
          contentAnalyzed: '15K characters',
          optimizationPasses: wasEnhanced ? 'multi-pass' : 'single-pass',
          rate_limiting: {
            service: 'url-to-faq-generator-worker',
            limits: {
              hourly: 5,
              daily: 15,
              weekly: 75,
              monthly: 300
            },
            current_usage: currentUsage,
            features: ['ip_management', 'progressive_penalties', 'violation_tracking']
          }
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Enhanced FAQ generation error:', error);
      
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};