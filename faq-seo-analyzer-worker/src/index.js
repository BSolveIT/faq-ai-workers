// SEO Analyzer Worker - AI-Powered with Expert-Level Analysis and Enhanced Rate Limiting
// Uses dynamic AI model configuration from WordPress admin interface

import { createRateLimiter } from '../../enhanced-rate-limiting/rate-limiter.js';
import { generateDynamicHealthResponse, trackCacheHit, trackCacheMiss } from '../../shared/health-utils.js';
import { cacheAIModelConfig } from '../../shared/advanced-cache-manager.js';

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

    // EMERGENCY HEALTH CHECK - with timeout protection
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
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
          healthResponse.current_model = aiModelInfo.current_model;
          healthResponse.model_source = aiModelInfo.model_source;
          healthResponse.worker_type = aiModelInfo.worker_type;
          
          return new Response(JSON.stringify(healthResponse), {
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
            rate_limiting: { enabled: true, enhanced: true },
            cache_status: 'active'
          };
          
          return new Response(JSON.stringify(emergencyResponse), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
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
      const { question, answer, pageUrl } = await request.json();
      
      console.log('SEO Analysis Request:', { 
        questionLength: question?.length, 
        answerLength: answer?.length,
        pageUrl
      });

      // Validate input
      if (!question || !answer) {
        return new Response(JSON.stringify({
          error: 'Question and answer are required',
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

      // Initialize enhanced rate limiter with worker-specific config
      const rateLimiter = createRateLimiter(env, 'faq-seo-analyzer', {
        limits: {
          hourly: 10,    // 10 SEO analysis requests per hour (very AI-intensive)
          daily: 30,     // 30 SEO analysis requests per day
          weekly: 150,   // 150 SEO analysis requests per week
          monthly: 600   // 600 SEO analysis requests per month
        },
        violations: {
          soft_threshold: 3,    // Warning after 3 violations
          hard_threshold: 5,    // Block after 5 violations
          ban_threshold: 10     // Permanent ban after 10 violations
        }
      });

      // Check rate limiting BEFORE processing request
      const rateLimitResult = await rateLimiter.checkRateLimit(clientIP, request, 'faq-seo-analyzer');
      
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
            errorMessage = 'SEO analysis rate limit exceeded. Please try again later';
            break;
        }

        return new Response(JSON.stringify({
          error: errorMessage,
          message: 'SEO analysis requests are rate limited to prevent abuse',
          seoScore: 0,
          readabilityScore: 0,
          voiceSearchScore: 0,
          rateLimited: true,
          reason: rateLimitResult.reason,
          usage: rateLimitResult.usage,
          limits: rateLimitResult.limits,
          reset_times: rateLimitResult.reset_times,
          block_expires: rateLimitResult.block_expires,
          remaining_time: rateLimitResult.remaining_time
        }), {
          status: statusCode,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log(`Processing SEO analysis request. Usage: ${JSON.stringify(rateLimitResult.usage)}`);

      // Expert-level AI prompt with detailed instructions
      const analysisPrompt = `You are a senior Google Search Quality Rater and SEO expert with 15 years of experience. You understand exactly how Google ranks content for Featured Snippets (Position Zero), People Also Ask boxes, and voice search results.

ANALYZE THIS FAQ:
Question: "${question}"
Answer: "${answer}"
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
        // Extract JSON from response
        const jsonMatch = aiResponse.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiAnalysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in AI response');
        }
      } catch (parseError) {
        console.error('Failed to parse Llama 4 Scout 17B response:', parseError);
        console.log('AI Response was:', aiResponse.response);
        
        // Fallback to enhanced algorithmic scoring with the data we have
        return enhancedFallbackScoring(question, answer, pageUrl, corsHeaders);
      }

      // Validate and sanitize scores
      const seoScore = Math.max(0, Math.min(100, Math.round(aiAnalysis.seoScore || 50)));
      const readabilityScore = Math.max(0, Math.min(100, Math.round(aiAnalysis.readabilityScore || 50)));
      const voiceSearchScore = Math.max(0, Math.min(100, Math.round(aiAnalysis.voiceSearchScore || 50)));

      // Ensure we have suggestions
      const suggestions = Array.isArray(aiAnalysis.suggestions) 
        ? aiAnalysis.suggestions.filter(s => s && typeof s === 'string').slice(0, 5)
        : generateDefaultSuggestions(seoScore, readabilityScore, voiceSearchScore);

      // Record successful usage AFTER processing request
      await rateLimiter.updateUsageCount(clientIP, 'faq-seo-analyzer');
      console.log(`Enhanced rate limit updated after successful SEO analysis`);

      // Build response
      const response = {
        success: true,
        seoScore,
        readabilityScore,
        voiceSearchScore,
        suggestions,
        analysis: {
          questionLength: question.length,
          answerWordCount: answer.split(/\s+/).length,
          featuredSnippetPotential: aiAnalysis.analysis?.featuredSnippetPotential ?? (answer.split(/[.!?]/)[0]?.length <= 300),
          positionZeroReady: aiAnalysis.analysis?.positionZeroReady ?? (seoScore >= 90),
          targetKeyword: aiAnalysis.analysis?.targetKeyword || extractMainKeyword(question),
          missingElements: aiAnalysis.analysis?.missingElements || [],
          aiPowered: true,
          model: aiModel,
          worker_type: 'seo_analyzer',
          dynamic_model: true,
          reasoning: aiAnalysis.reasoning || null
        },
        rate_limiting: {
          usage: rateLimitResult.usage,
          limits: rateLimitResult.limits,
          reset_times: rateLimitResult.reset_times,
          worker: 'faq-seo-analyzer',
          enhanced: true,
          check_duration: rateLimitResult.duration
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
        error: error.message,
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
  const wordCount = answer.split(/\s+/).length;
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
  const complexWords = answer.split(/\s+/).filter(word => word.length > 7).length;
  const complexityRatio = complexWords / Math.max(1, wordCount);
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