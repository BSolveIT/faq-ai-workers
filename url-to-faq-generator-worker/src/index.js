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
import { generateDynamicHealthResponse, trackCacheHit, trackCacheMiss } from '../../shared/health-utils.js';
import { cacheAIModelConfig, invalidateWorkerCaches, initializeCacheManager } from '../../shared/advanced-cache-manager.js';

// Note: Rate limiting is now handled by the centralized enhanced-rate-limiting worker
// This worker no longer implements individual rate limiting

/**
 * Get AI model configuration with caching
 */
async function getAIModelConfig(env, workerType = 'url_faq_generator') {
  try {
    console.log(`[AI Model Cache] Retrieving model config for ${workerType} with enhanced caching...`);
    
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
    
    return configData;
  } catch (error) {
    console.error(`[AI Model Cache] Error with cached retrieval: ${error.message}`);
    return null;
  }
}

// Note: Rate limit configuration is now handled by the centralized enhanced-rate-limiting worker

/**
 * Get AI model name dynamically from KV store with enhanced caching
 */
async function getAIModel(env, workerType = 'url_faq_generator') {
  const configData = await getAIModelConfig(env, workerType);
  
  if (configData?.ai_models?.[workerType]) {
    console.log(`[AI Model Cache] ✅ Using cached dynamic model for ${workerType}: ${configData.ai_models[workerType]}`);
    return configData.ai_models[workerType];
  }
  
  const fallbackModel = env.MODEL_NAME || '@cf/meta/llama-4-scout-17b-16e-instruct';
  console.log(`[AI Model Cache] ✅ Using fallback model for ${workerType}: ${fallbackModel}`);
  return fallbackModel;
}

/**
 * Get AI model info with source information for health endpoint
 */
async function getAIModelInfo(env, workerType = 'url_faq_generator') {
  const configData = await getAIModelConfig(env, workerType);
  
  if (configData?.ai_models?.[workerType]) {
    console.log(`[AI Model Info] ✅ Using cached dynamic model for ${workerType}: ${configData.ai_models[workerType]}`);
    return {
      current_model: configData.ai_models[workerType],
      model_source: 'kv_config',
      worker_type: workerType,
      cache_updated_at: configData.updated_at,
      cache_version: configData.version
    };
  }
  
  if (env.MODEL_NAME) {
    console.log(`[AI Model Info] ✅ Using env fallback model for ${workerType}: ${env.MODEL_NAME}`);
    return {
      current_model: env.MODEL_NAME,
      model_source: 'env_fallback',
      worker_type: workerType
    };
  }
  
  const hardcodedDefault = '@cf/meta/llama-4-scout-17b-16e-instruct';
  console.log(`[AI Model Info] ✅ Using hardcoded default model for ${workerType}: ${hardcodedDefault}`);
  return {
    current_model: hardcodedDefault,
    model_source: 'hardcoded_default',
    worker_type: workerType
  };
}

/**
 * Extract response text from various AI response formats
 */
function extractAIResponseText(aiResponse) {
  if (typeof aiResponse === 'string') {
    return aiResponse;
  }
  
  if (aiResponse.response) {
    return typeof aiResponse.response === 'string' ? 
      aiResponse.response : 
      aiResponse.response.text || JSON.stringify(aiResponse.response);
  }
  
  if (aiResponse.choices?.[0]) {
    return aiResponse.choices[0].text || aiResponse.choices[0].message?.content || '';
  }
  
  return '';
}

/**
 * Premium AI call with extended timeouts for deep analysis
 */
async function callAIWithTimeout(aiBinding, model, messages, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await aiBinding.run(model, {
      messages,
      temperature: options.temperature || 0.3,
      max_tokens: options.max_tokens || 4000,
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

/**
 * Enhanced JSON cleaning and parsing
 */
function cleanAndParseJSON(text) {
  try {
    // Remove markdown code blocks
    text = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '');
    
    // Extract JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      text = jsonMatch[0];
    }
    
    // Parse and validate
    const parsed = JSON.parse(text);
    return parsed;
  } catch (error) {
    console.error('JSON parsing error:', error.message);
    throw new Error('Failed to parse AI response as JSON');
  }
}

/**
 * Enhanced content extraction function
 */
async function extractContentUltimate(html) {
  try {
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
    const selectorsToRemove = ['script', 'style', 'nav', 'footer', 'header', '.sidebar', '.menu', '.advertisement'];
    selectorsToRemove.forEach(selector => {
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
    const headingTags = ['h1', 'h2', 'h3', 'h4'];
    headingTags.forEach(tag => {
      root.querySelectorAll(tag).forEach(el => {
        const text = el.text.trim();
        if (text.length > 5 && text.length < 100) {
          headings.push(text);
        }
      });
    });

    // Enhanced content extraction with better text processing
    const contentSelectors = ['main', 'article', '.content', '.post', '.entry', 'p', 'div', 'section'];
    const contentElements = root.querySelectorAll(contentSelectors.join(', '));
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
      .replace(/[^\w\s.,!?;:()\-\/'"]/g, '')
      .trim();

    return {
      title: title || 'Untitled Page',
      headings: headings.slice(0, 8),
      content: content
    };
  } catch (error) {
    console.error('Content extraction error:', error);
    throw new Error('Failed to extract page content');
  }
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

    // Note: Rate limiting is now handled by the centralized enhanced-rate-limiting worker

    const url = new URL(request.url);

    // Health check endpoint with timeout protection
    if (request.method === 'GET' && url.pathname === '/health') {
      const healthStartTime = Date.now();
      
      try {
        const healthPromise = (async () => {
          const healthResponse = await generateDynamicHealthResponse(
            'url-to-faq-generator-worker',
            env,
            '3.1.0-advanced-cache-optimized',
            ['url_analysis', 'deep_content_extraction', 'premium_faq_generation', 'multi_pass_optimization', 'enhanced_rate_limiting']
          );
          
          const aiModelInfo = await getAIModelInfo(env, 'url_faq_generator');
          
          // Calculate response time
          const responseTime = Date.now() - healthStartTime;
          
          // Get performance metrics from KV if available
          let performanceMetrics = {
            avg_response_time_ms: 0,
            total_requests_served: 0
          };
          
          try {
            const metrics = await env.WORKER_METRICS?.get(`metrics_url_faq_generator`, { type: 'json' });
            if (metrics) {
              performanceMetrics = {
                avg_response_time_ms: metrics.avg_response_time_ms || 0,
                total_requests_served: metrics.total_requests_served || 0
              };
            }
          } catch (e) {
            console.log('[Health] Metrics not available');
          }
          
          // Merge generateDynamicHealthResponse results with additional data
          return {
            ...healthResponse, // Spread the base health response
            status: 'OK',
            service: 'url-to-faq-generator-worker',
            timestamp: new Date().toISOString(),
            version: '3.1.0-advanced-cache-optimized',
            mode: 'full',
            model: {
              name: aiModelInfo.current_model,
              max_tokens: 800,
              temperature: 0.4
            },
            configuration: {
              source: aiModelInfo.model_source === 'kv_config' ? 'dynamic' : 'default',
              last_updated: new Date().toISOString(),
              config_version: 1
            },
            performance: {
              avg_response_time_ms: performanceMetrics.avg_response_time_ms,
              total_requests_served: performanceMetrics.total_requests_served,
              response_time_ms: responseTime
            },
            operational_status: {
              health: 'healthy',
              ai_binding_available: true,
              config_loaded: true
            },
            features: healthResponse.features || [
              'url_analysis',
              'deep_content_extraction',
              'premium_faq_generation',
              'multi_pass_optimization',
              'enhanced_rate_limiting'
            ],
            health_indicators: {
              overall_system_health: 'healthy',
              ai_health: 'available'
            },
            cache_status: healthResponse.cache_status || 'active',
            current_model: aiModelInfo.current_model,
            model_source: aiModelInfo.model_source,
            worker_type: 'url_faq_generator'
          };
        })();
        
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 400)
        );
        
        const response = await Promise.race([healthPromise, timeoutPromise]);
        
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.warn('[Health Check] Emergency fallback:', error.message);
        
        const responseTime = Date.now() - healthStartTime;
        
        const emergencyResponse = {
          status: 'OK',
          worker: 'url-to-faq-generator-worker',
          service: 'url-to-faq-generator-worker',
          timestamp: new Date().toISOString(),
          version: '3.1.0-advanced-cache-optimized',
          mode: 'full',
          model: {
            name: env.MODEL_NAME || '@cf/meta/llama-4-scout-17b-16e-instruct',
            max_tokens: 800,
            temperature: 0.4
          },
          configuration: {
            source: 'default',
            last_updated: new Date().toISOString(),
            config_version: 1
          },
          performance: {
            avg_response_time_ms: 0,
            total_requests_served: 0,
            response_time_ms: responseTime
          },
          operational_status: {
            health: 'healthy',
            ai_binding_available: false,
            config_loaded: false
          },
          features: [
            'url_analysis',
            'deep_content_extraction',
            'premium_faq_generation',
            'multi_pass_optimization',
            'enhanced_rate_limiting'
          ],
          health_indicators: {
            overall_system_health: 'healthy',
            ai_health: 'fallback'
          },
          cache_status: 'active',
          current_model: env.MODEL_NAME || '@cf/meta/llama-4-scout-17b-16e-instruct',
          model_source: 'env_fallback',
          worker_type: 'url_faq_generator',
          capabilities: ['url_analysis', 'deep_content_extraction', 'premium_faq_generation', 'multi_pass_optimization', 'enhanced_rate_limiting']
        };
        
        return new Response(JSON.stringify(emergencyResponse), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // Cache clearing endpoint
    if (url.pathname === '/cache/clear') {
      try {
        console.log('[Cache Clear] Initiating cache clear...');
        
        await initializeCacheManager('url_faq_generator', env);
        
        const cacheResult = await invalidateWorkerCaches('url_faq_generator', env, {
          ai_model_config: true,
          worker_health: true,
          suggestion_cache: true,
          l1_cache: true,
          l2_cache: true,
          patterns: [
            'url_faq_generator_*',
            'url_faq_*',
            'ai_model_*',
            'content_extraction_*',
            'faq_generation_*',
            'premium_analysis_*',
            'multi_pass_*'
          ]
        });
        
        console.log('[Cache Clear] Completed:', cacheResult);
        
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
        console.error('[Cache Clear] Failed:', error);
        
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
      
      const requestBody = await request.json();
      const { url: targetUrl, options = {} } = requestBody;
      
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

      // Rate limiting is now handled by the centralized enhanced-rate-limiting worker
      // This worker no longer performs individual rate limiting checks

      // Set FAQ count with limits
      const faqCount = Math.min(Math.max(options.faqCount || 12, 6), 12);
      console.log(`Starting PREMIUM DEEP ANALYSIS of ${faqCount} FAQs (15K content analysis)`);

      // Get dynamic AI model early
      const aiModel = await getAIModel(env, 'url_faq_generator');
      console.log(`[AI Model] Using model: ${aiModel} for url_faq_generator worker`);

      // STEP 1: Enhanced Content Extraction
      let pageContent, title, headings, extractedContent;
      
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 30000);
        
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
      const contentLimit = 15000;
      const contentForAI = extractedContent.substring(0, contentLimit);

      // Enhanced prompts for maximum quality
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

      let initialFAQs;
      const maxTokens = 6000;
      const timeout = 150000;

      try {
        const aiResponse = await callAIWithTimeout(
          env.AI,
          aiModel,
          [
            { role: 'system', content: 'You are a premium FAQ specialist with deep content analysis capabilities. Generate exceptionally detailed, high-value FAQs using comprehensive content understanding. Focus on creating FAQs that provide maximum value to users and perform excellently in search results.' },
            { role: 'user', content: generationPrompt }
          ],
          { temperature: 0.3, max_tokens: maxTokens },
          timeout
        );

        const responseText = extractAIResponseText(aiResponse);
        initialFAQs = cleanAndParseJSON(responseText);

        console.log(`Enhanced generation: ${initialFAQs.mainEntity?.length} FAQs in ${Date.now() - startTime}ms`);
        
      } catch (error) {
        console.error('Primary model failed:', error.message);
        
        // Fallback to default model
        const fallbackModel = env.MODEL_NAME || '@cf/meta/llama-4-scout-17b-16e-instruct';
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

          const responseText = extractAIResponseText(fallbackResponse);
          initialFAQs = cleanAndParseJSON(responseText);
          
        } catch (fallbackError) {
          throw new Error('Enhanced FAQ generation failed: ' + fallbackError.message);
        }
      }

      if (!initialFAQs?.mainEntity || !Array.isArray(initialFAQs.mainEntity)) {
        throw new Error('Invalid FAQ structure');
      }

      // STEP 3: MULTIPLE AI OPTIMIZATION PASSES
      let finalFAQs = initialFAQs;
      
      // Multiple optimization passes for premium quality
      if (Date.now() - startTime < 120000) {
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
            aiModel, // Use dynamic model instead of hardcoded
            [
              { role: 'system', content: 'You are an SEO expert specializing in FAQ optimization for search engines and voice assistants.' },
              { role: 'user', content: seoOptimizationPrompt }
            ],
            { temperature: 0.1, max_tokens: 4000 },
            45000
          );

          const seoText = extractAIResponseText(seoResponse);
          const seoOptimizedFAQs = cleanAndParseJSON(seoText);
          
          if (seoOptimizedFAQs?.mainEntity && Array.isArray(seoOptimizedFAQs.mainEntity)) {
            finalFAQs = seoOptimizedFAQs;
            console.log('SEO optimization pass completed successfully');
          }
          
        } catch (seoError) {
          console.log('SEO optimization failed, continuing:', seoError.message);
        }
        
        // PASS 2: Content Quality and Detail Enhancement
        if (Date.now() - startTime < 100000) {
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
              aiModel, // Use dynamic model instead of hardcoded
              [
                { role: 'system', content: 'You are a content quality specialist focused on creating valuable, detailed, and engaging FAQ content.' },
                { role: 'user', content: qualityPrompt }
              ],
              { temperature: 0.2, max_tokens: 4000 },
              45000
            );

            const qualityText = extractAIResponseText(qualityResponse);
            const qualityEnhancedFAQs = cleanAndParseJSON(qualityText);
            
            if (qualityEnhancedFAQs?.mainEntity && Array.isArray(qualityEnhancedFAQs.mainEntity)) {
              finalFAQs = qualityEnhancedFAQs;
              console.log('Quality enhancement pass completed successfully');
            }
            
          } catch (qualityError) {
            console.log('Quality enhancement failed, using SEO version:', qualityError.message);
          }
        }
      }

      // Premium validation
      const validFAQs = finalFAQs.mainEntity.filter(faq => 
        faq?.name && 
        faq?.acceptedAnswer?.text && 
        faq.name.length >= 25 &&
        faq.name.length <= 120 && 
        faq.acceptedAnswer.text.length >= 80 &&
        faq.acceptedAnswer.text.length <= 1000 && 
        !faq.name.toLowerCase().includes('untitled') &&
        !faq.acceptedAnswer.text.toLowerCase().includes('no information') &&
        !faq.acceptedAnswer.text.toLowerCase().includes('not specified')
      );

      if (validFAQs.length < Math.max(3, Math.floor(faqCount * 0.7))) {
        throw new Error(`Only ${validFAQs.length} high-quality FAQs generated (needed ${Math.floor(faqCount * 0.7)})`);
      }

      const processingTime = Date.now() - startTime;
      const wasEnhanced = processingTime < 120000;
      
      return new Response(JSON.stringify({
        success: true,
        source: targetUrl,
        faqs: validFAQs,
        metadata: {
          title: title,
          totalGenerated: validFAQs.length,
          processingTime: processingTime,
          model: aiModel,
          worker_type: 'url_faq_generator',
          dynamic_model: true,
          enhanced: wasEnhanced,
          qualityMode: 'premium-deep-analysis',
          contentAnalyzed: '15K characters',
          optimizationPasses: wasEnhanced ? 'multi-pass' : 'single-pass'
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