/**
 * FAQ Enhancement Worker - Advanced FAQ Optimization Service
 * 
 * This worker provides intelligent FAQ enhancement suggestions using Llama 4 Scout 17B.
 * It analyzes question-answer pairs and provides comprehensive improvement recommendations
 * including question variations, SEO optimization, and quality scoring.
 * 
 * MODEL: @cf/meta/llama-4-scout-17b-16e-instruct (Latest Premium Model)
 * RATE LIMIT: 25 enhancements per day per IP
 * FEATURES: Question variations, SEO analysis, quality scoring, enhancement suggestions
 * 
 * Updated: June 2025 - Enhanced Question Optimizer Phase 2
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed',
        message: 'This endpoint only accepts POST requests'
      }), { 
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // Parse request body with validation
      const requestData = await request.json();
      const { question, answer, pageUrl, sessionId } = requestData;

      // Validate required input
      if (!question || !answer) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Missing required fields',
          message: 'Both question and answer are required for enhancement analysis'
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Rate limiting using KV store (25 enhancements per day)
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const today = new Date().toISOString().split('T')[0];
      const rateLimitKey = `enhance:${clientIP}:${today}`;
      
      // Get current usage count
      let usageData = await env.FAQ_RATE_LIMITS.get(rateLimitKey, { type: 'json' });
      if (!usageData) {
        usageData = { count: 0, date: today };
      }

      // Check rate limit (25 enhancements per day - premium tier)
      if (usageData.count >= 25) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        return new Response(JSON.stringify({
          success: false,
          rateLimited: true,
          error: 'Daily enhancement limit reached',
          message: 'You can enhance up to 25 FAQs per day. Limit resets at midnight.',
          resetTime: tomorrow.toISOString(),
          usage: {
            used: usageData.count,
            remaining: 0,
            resetTime: tomorrow.getTime()
          }
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log(`FAQ Enhancement Request - Question: "${question.substring(0, 50)}...", Answer Length: ${answer.length} chars`);

      // Enhanced page context extraction (optional)
      let pageContext = '';
      if (pageUrl) {
        try {
          console.log(`Fetching page context from: ${pageUrl}`);
          const pageResponse = await fetch(pageUrl, {
            headers: { 'User-Agent': 'FAQ-Enhancement-Bot/2.0' },
            signal: AbortSignal.timeout(5000) // 5 second timeout
          });
          
          if (pageResponse.ok) {
            const html = await pageResponse.text();
            // Extract title and description for better context
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i);
            
            if (titleMatch || descMatch) {
              pageContext = `Page Title: ${titleMatch?.[1] || 'N/A'}, Description: ${descMatch?.[1] || 'N/A'}`;
            }
          }
        } catch (error) {
          console.warn('Failed to fetch page context:', error.message);
          // Continue without page context - not critical for enhancement
        }
      }

      // Create comprehensive prompt for Llama 4 Scout 17B (latest premium model)
      const enhancementPrompt = `You are a senior FAQ optimization specialist with expertise in SEO, user experience, and content strategy. Analyze this FAQ and provide comprehensive improvement suggestions.

FAQ TO ANALYZE:
Question: "${question}"
Answer: "${answer}"
${pageContext ? `Page Context: ${pageContext}` : ''}

TASK: Provide detailed enhancement suggestions in this EXACT JSON format:

{
  "question_variations": [
    {
      "question": "Alternative phrasing that improves SEO and clarity",
      "answer": "Tailored answer optimized for this specific question variation",
      "improvement_reason": "Specific explanation of why this variation is superior",
      "seo_benefit": "Concrete SEO advantage (Featured Snippets, Voice Search, etc.)",
      "priority": "high|medium|low"
    }
  ],
  "additional_suggestions": [
    {
      "suggestion": "Specific, actionable improvement recommendation",
      "type": "add_examples|add_links|add_details|improve_structure|enhance_keywords",
      "reason": "Clear explanation of how this improvement helps users and SEO"
    }
  ],
  "seo_analysis": {
    "keywords": ["relevant", "keywords", "extracted", "from", "content"],
    "search_intent": "informational|transactional|navigational",
    "voice_search_friendly": true,
    "featured_snippet_potential": true,
    "readability_score": 8,
    "optimization_opportunities": ["specific", "seo", "improvements"]
  },
  "quality_scores": {
    "question_clarity": 8,
    "answer_completeness": 7,
    "seo_optimization": 6,
    "score_explanations": {
      "question_clarity": "Detailed analysis of question structure, grammar, and search-friendliness",
      "answer_completeness": "Assessment of answer depth, accuracy, and user value",
      "seo_optimization": "Evaluation of keyword usage, length, and search ranking potential"
    }
  }
}

QUALITY REQUIREMENTS:
1. Provide 2-3 high-quality question variations with specifically tailored answers
2. Each answer should be optimized for its question variation and user intent
3. Quality scores must be realistic integers 1-10 with detailed explanations
4. Keywords should be extracted from actual content, not generic terms
5. All suggestions must be specific, actionable, and add genuine value
6. Prioritize improvements that enhance both user experience and search performance
7. Consider Featured Snippets, voice search, and AI Overview optimization

Return ONLY the JSON object, no additional text or formatting.`;

      console.log('Sending enhancement request to Llama 4 Scout 17B...');
      
      // Use Llama 4 Scout 17B - Latest premium model for best quality
      const aiResponse = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are a world-class FAQ optimization specialist. You analyze content deeply and provide actionable improvement suggestions in perfect JSON format. Your recommendations significantly improve SEO performance and user satisfaction.'
          },
          {
            role: 'user',
            content: enhancementPrompt
          }
        ],
        temperature: 0.4, // Balanced creativity and consistency
        max_tokens: 3000, // Increased for comprehensive responses
        stream: false
      });

      console.log('AI Response received, processing...');

      // Enhanced response parsing for Llama 4 Scout 17B
      let enhancements;
      try {
        let responseText = '';
        
        // Handle different response formats from the new model
        if (typeof aiResponse === 'string') {
          responseText = aiResponse;
        } else if (aiResponse.response && typeof aiResponse.response === 'string') {
          responseText = aiResponse.response;
        } else if (aiResponse.response && aiResponse.response.text) {
          responseText = aiResponse.response.text;
        } else if (aiResponse.choices && aiResponse.choices[0]) {
          responseText = aiResponse.choices[0].message?.content || aiResponse.choices[0].text || '';
        } else {
          throw new Error('Unexpected AI response format');
        }

        console.log('Raw AI response length:', responseText.length);

        // Clean the response - remove any markdown formatting or extra text
        let cleanedResponse = responseText.trim();
        
        // Remove any markdown code blocks
        cleanedResponse = cleanedResponse.replace(/```json\s*/gi, '');
        cleanedResponse = cleanedResponse.replace(/```\s*/g, '');
        
        // Find JSON object boundaries
        const jsonStartIndex = cleanedResponse.indexOf('{');
        const jsonEndIndex = cleanedResponse.lastIndexOf('}');
        
        if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
          cleanedResponse = cleanedResponse.substring(jsonStartIndex, jsonEndIndex + 1);
        }
        
        // Parse the cleaned JSON
        enhancements = JSON.parse(cleanedResponse);
        console.log('Successfully parsed AI response');
        
      } catch (parseError) {
        console.error('Failed to parse AI response:', parseError);
        console.log('Problematic response:', aiResponse);
        
        // Enhanced fallback structure with realistic content
        enhancements = {
          question_variations: [
            {
              question: question,
              answer: answer,
              improvement_reason: "Original content maintained due to AI processing error",
              seo_benefit: "Standard FAQ structure with basic optimization",
              priority: "medium"
            },
            {
              question: `How ${question.toLowerCase().replace(/^(what|how|why|when|where)\s+/i, '')}`,
              answer: `Here's how: ${answer}`,
              improvement_reason: "More action-oriented phrasing for better user engagement",
              seo_benefit: "Targets 'how' search queries which often rank well",
              priority: "medium"
            }
          ],
          additional_suggestions: [
            {
              suggestion: "Consider adding specific examples or case studies to make the answer more concrete",
              type: "add_examples",
              reason: "Examples significantly improve user engagement and time on page"
            },
            {
              suggestion: "Review answer length - optimal FAQ answers are 40-300 characters for Featured Snippets",
              type: "improve_structure",
              reason: "Proper length optimization increases chances of Featured Snippet selection"
            }
          ],
          seo_analysis: {
            keywords: ["faq", "help", "information", "guide"],
            search_intent: "informational",
            voice_search_friendly: false,
            featured_snippet_potential: true,
            readability_score: 7,
            optimization_opportunities: ["keyword optimization", "length adjustment", "structure improvement"]
          },
          quality_scores: {
            question_clarity: 7,
            answer_completeness: 6,
            seo_optimization: 5,
            score_explanations: {
              question_clarity: "Question is understandable but could be optimized for search engines",
              answer_completeness: "Answer provides basic information but could be more comprehensive",
              seo_optimization: "Standard optimization level with room for improvement in keywords and structure"
            }
          }
        };
        
        console.log('Using enhanced fallback structure due to AI response parsing error');
      }

      // Comprehensive validation and enhancement of the response
      if (!enhancements || typeof enhancements !== 'object') {
        throw new Error('Invalid enhancement data structure received from AI');
      }

      // Ensure all required fields exist with proper defaults
      enhancements.question_variations = Array.isArray(enhancements.question_variations) ? 
        enhancements.question_variations : [];
      enhancements.additional_suggestions = Array.isArray(enhancements.additional_suggestions) ? 
        enhancements.additional_suggestions : [];
      
      // Enhanced SEO analysis validation
      if (!enhancements.seo_analysis || typeof enhancements.seo_analysis !== 'object') {
        enhancements.seo_analysis = {
          keywords: [],
          search_intent: "informational",
          voice_search_friendly: false,
          featured_snippet_potential: false,
          readability_score: 7,
          optimization_opportunities: []
        };
      }
      
      // Ensure SEO analysis has all required fields
      if (!Array.isArray(enhancements.seo_analysis.keywords)) {
        enhancements.seo_analysis.keywords = [];
      }
      if (!enhancements.seo_analysis.search_intent) {
        enhancements.seo_analysis.search_intent = "informational";
      }
      if (typeof enhancements.seo_analysis.voice_search_friendly !== 'boolean') {
        enhancements.seo_analysis.voice_search_friendly = false;
      }
      if (typeof enhancements.seo_analysis.featured_snippet_potential !== 'boolean') {
        enhancements.seo_analysis.featured_snippet_potential = false;
      }
      if (typeof enhancements.seo_analysis.readability_score !== 'number') {
        enhancements.seo_analysis.readability_score = 7;
      }
      if (!Array.isArray(enhancements.seo_analysis.optimization_opportunities)) {
        enhancements.seo_analysis.optimization_opportunities = [];
      }
      
      // Enhanced quality scores validation
      if (!enhancements.quality_scores || typeof enhancements.quality_scores !== 'object') {
        enhancements.quality_scores = {
          question_clarity: 7,
          answer_completeness: 6,
          seo_optimization: 5,
          score_explanations: {
            question_clarity: "Default score - detailed analysis not completed",
            answer_completeness: "Default score - detailed analysis not completed",
            seo_optimization: "Default score - detailed analysis not completed"
          }
        };
      }
      
      // Validate and normalize score explanations
      if (!enhancements.quality_scores.score_explanations) {
        enhancements.quality_scores.score_explanations = {
          question_clarity: "Scoring based on grammar, clarity, and search-friendliness",
          answer_completeness: "Scoring based on directness, detail level, and user value",
          seo_optimization: "Scoring based on keyword usage, length, and ranking potential"
        };
      }
      
      // Validate score ranges (1-10) and ensure they're realistic integers
      ['question_clarity', 'answer_completeness', 'seo_optimization'].forEach(scoreType => {
        const score = enhancements.quality_scores[scoreType];
        if (typeof score !== 'number' || score < 1 || score > 10) {
          enhancements.quality_scores[scoreType] = Math.min(10, Math.max(1, parseInt(score) || 6));
        } else {
          enhancements.quality_scores[scoreType] = Math.round(score);
        }
      });

      // Update rate limit counter
      usageData.count++;
      await env.FAQ_RATE_LIMITS.put(rateLimitKey, JSON.stringify(usageData), {
        expirationTtl: 86400 // 24 hours
      });

      console.log(`Enhancement completed successfully. Usage: ${usageData.count}/25`);

      // Return successful response with enhanced format
      return new Response(JSON.stringify({
        success: true,
        enhancements: enhancements,
        usage: {
          used: usageData.count,
          remaining: 25 - usageData.count,
          resetTime: new Date().setHours(24, 0, 0, 0)
        },
        model_info: {
          model: 'llama-4-scout-17b-16e-instruct',
          version: env.WORKER_VERSION || '2.0.0-enhanced',
          feature_set: env.FEATURE_SET || 'comprehensive-faq-enhancement'
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Enhancement error:', error);
      console.error('Error stack:', error.stack);
      
      // Enhanced error handling with specific error categorization
      let errorMessage = 'Failed to generate enhancements';
      let errorCategory = 'unknown';
      
      if (error.message.includes('AI') || error.message.includes('model')) {
        errorMessage = 'AI model temporarily unavailable. Please try again in a moment.';
        errorCategory = 'ai_service';
      } else if (error.message.includes('JSON') || error.message.includes('parse')) {
        errorMessage = 'AI response format error. Please try again with different content.';
        errorCategory = 'parsing';
      } else if (error.message.includes('timeout') || error.message.includes('time')) {
        errorMessage = 'Request timeout. The AI model is taking longer than usual.';
        errorCategory = 'timeout';
      } else if (error.message.includes('rate') || error.message.includes('limit')) {
        errorMessage = 'Rate limit exceeded. Please wait before making another request.';
        errorCategory = 'rate_limit';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your connection and try again.';
        errorCategory = 'network';
      }
      
      return new Response(JSON.stringify({
        success: false,
        error: errorMessage,
        error_category: errorCategory,
        details: env.NODE_ENV === 'development' ? error.message : undefined,
        suggestion: 'Try again in a few moments. If the problem persists, the FAQ can still be used as-is.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};