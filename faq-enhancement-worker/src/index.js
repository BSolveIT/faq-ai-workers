// Cloudflare Worker: faq-enhancement-worker.js
// Enhanced FAQ optimization using Cloudflare Workers AI with Llama 4 Scout 17B
// Complete implementation preserving all legacy functionality

// Session-based caching for page context
const sessionContextCache = new Map();

export default {
  async fetch(request, env, ctx) {
    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      // Parse request body
      const { question, answer, pageUrl, sessionId } = await request.json();

      // Validate input
      if (!question || !answer) {
        return new Response(JSON.stringify({
          error: 'Missing question or answer'
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Rate limiting using KV store (25/day limit)
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const today = new Date().toISOString().split('T')[0];
      const rateLimitKey = `enhance:${clientIP}:${today}`;
      
      // Get current usage count
      let usageData = await env.FAQ_RATE_LIMITS.get(rateLimitKey, { type: 'json' });
      if (!usageData) {
        usageData = { count: 0, date: today };
      }

      // Check rate limit (25 enhancements per day)
      if (usageData.count >= 25) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        return new Response(JSON.stringify({
          rateLimited: true,
          error: 'Daily enhancement limit reached. You can enhance up to 25 FAQs per day.',
          resetTime: tomorrow.getTime(),
          limit: 25,
          used: usageData.count
        }), { 
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Increment usage count
      usageData.count += 1;
      await env.FAQ_RATE_LIMITS.put(rateLimitKey, JSON.stringify(usageData), {
        expirationTtl: 86400 // 24 hours
      });

      console.log(`Processing enhancement request. Usage: ${usageData.count}/25`);

      // Sanitize input to prevent JSON injection
      const sanitizedQuestion = question.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
      const sanitizedAnswer = answer.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();

      // Extract page context if pageUrl is provided (with session-based caching)
      let pageContext = '';
      if (pageUrl && pageUrl.trim()) {
        try {
          console.log('Extracting page context from:', pageUrl, 'Session:', sessionId);
          pageContext = await getPageContextWithCaching(pageUrl.trim(), sessionId);
          console.log('Page context ready, length:', pageContext.length);
        } catch (contextError) {
          console.error('Page context extraction failed:', contextError);
          // Continue without page context rather than failing the entire request
          pageContext = '';
        }
      }

      // Enhanced comprehensive prompting for Llama 4 Scout 17B
      const enhancementPrompt = `You are an expert SEO and FAQ optimization specialist with deep knowledge of search engine ranking factors, user intent, and content optimization. Analyze this FAQ and provide comprehensive enhancement suggestions.

CURRENT FAQ TO ANALYZE:
Question: "${sanitizedQuestion}"
Answer: "${sanitizedAnswer}"

${pageContext ? `WEBSITE CONTEXT FOR ADDITIONAL RELEVANCE:
${pageContext}

Use this context to ensure your suggestions are relevant to the website's topic and audience. Consider the page content, headings, and overall theme when creating variations.` : ''}

YOUR TASK: Create a comprehensive enhancement analysis with 2-3 question variations, each with 4 distinct answer styles.

ANALYSIS REQUIREMENTS:
1. QUESTION VARIATIONS: Create 2-3 improved question variations that:
   - Stay on the exact same topic as the original
   - Use different phrasing to capture various search intents
   - Optimize for different keyword combinations
   - Consider voice search patterns (how, what, why questions)
   - Address the same core user need but with different approaches

2. MATCHED ANSWER STYLES: For each question variation, provide 4 answer styles:
   - CONCISE: 50-300 characters, direct and to-the-point
   - DETAILED: Comprehensive with examples and context
   - STRUCTURED: Organized with bullet points or numbered lists
   - CONVERSATIONAL: Natural, voice-search friendly tone

3. QUALITY ANALYSIS: Score the original FAQ (1-10) on:
   - Question Clarity (grammar, structure, search-friendliness)
   - Answer Completeness (detail, helpfulness, actionability)
   - SEO Optimization (keywords, length, search intent match)

CRITICAL REQUIREMENTS:
1. Each answer must be specifically written to answer its paired question variation
2. Don't just repeat similar answers - tailor each one to the question's specific phrasing and focus
3. Provide 2-3 question variations (aim for 3 if the topic allows for meaningful variations)
4. All content must stay on the same topic as the original FAQ
5. Quality scores must be calculated based on ACTUAL analysis of the provided content
6. Use natural language and avoid keyword stuffing
7. Return ONLY valid JSON with no additional text or formatting

Return this exact JSON structure:
{
  "question_variations": [
    {
      "question": "improved version of the question about the same topic",
      "reason": "why this question variation helps SEO or user discovery",
      "type": "grammar|clarity|seo|specificity",
      "priority": "high|medium|low",
      "seo_benefit": "specific SEO advantage of this question phrasing",
      "improvement_reason": "detailed explanation of the improvement made",
      "answers": {
        "concise": {
          "text": "50-300 character answer that directly answers THIS specific question",
          "approach": "concise",
          "priority": "high"
        },
        "detailed": {
          "text": "comprehensive answer with examples that thoroughly answers THIS specific question",
          "approach": "detailed",
          "priority": "medium"
        },
        "structured": {
          "text": "well-organized answer with bullet points or numbered lists answering THIS specific question",
          "approach": "structured",
          "priority": "medium"
        },
        "conversational": {
          "text": "natural, voice-search friendly answer in conversational tone for THIS specific question",
          "approach": "conversational",
          "priority": "low"
        }
      }
    }
  ],
  "additional_suggestions": [
    {
      "suggestion": "specific actionable improvement",
      "type": "add_examples|improve_structure|enhance_keywords|voice_optimization",
      "reason": "why this improvement helps",
      "impact": "high|medium|low"
    }
  ],
  "seo_analysis": {
    "keywords": ["extracted", "relevant", "keywords"],
    "search_intent": "informational|commercial|navigational|transactional",
    "voice_search_friendly": true,
    "featured_snippet_potential": true,
    "improvement_areas": ["specific areas to improve"],
    "target_audience": "description of target audience",
    "competition_level": "low|medium|high"
  },
  "quality_scores": {
    "question_clarity": 8,
    "answer_completeness": 7,
    "seo_optimization": 6,
    "score_explanations": {
      "question_clarity": "explanation of why this score",
      "answer_completeness": "explanation of completeness score",
      "seo_optimization": "explanation of SEO score"
    }
  }
}`;

      // Call Cloudflare Workers AI with Llama 4 Scout 17B
      console.log('Calling Llama 4 Scout 17B for comprehensive enhancement analysis...');
      
      const aiResponse = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          {
            role: 'system',
            content: 'You are an expert SEO and FAQ optimization specialist with deep knowledge of search engine ranking factors, user intent, and content optimization. You analyze content thoroughly and provide actionable improvement suggestions in perfect JSON format. Your recommendations significantly improve SEO performance and user satisfaction. You ALWAYS return valid JSON with no additional text, explanations, or formatting.'
          },
          {
            role: 'user',
            content: enhancementPrompt
          }
        ],
        temperature: 0.3, // Balanced for consistency while allowing creative variations
        max_tokens: 4000, // Increased for comprehensive responses
        stream: false
      });

      console.log('AI Response received, processing...');

      // Enhanced response parsing for Llama 4 Scout 17B with comprehensive fallback
      let enhancements;
      try {
        let responseText = '';
        
        // Handle different response formats from Llama 4 Scout 17B
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

        // Advanced JSON cleaning and extraction
        let cleanedResponse = responseText.trim();
        
        // Remove any markdown code blocks
        cleanedResponse = cleanedResponse.replace(/```json\s*/gi, '');
        cleanedResponse = cleanedResponse.replace(/```\s*/g, '');
        
        // Remove any explanatory text before or after JSON
        const jsonStartIndex = cleanedResponse.indexOf('{');
        const jsonEndIndex = cleanedResponse.lastIndexOf('}');
        
        if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
          cleanedResponse = cleanedResponse.substring(jsonStartIndex, jsonEndIndex + 1);
        }

        // Additional cleaning for common AI response issues
        cleanedResponse = cleanedResponse
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
          .replace(/\n/g, ' ') // Replace newlines with spaces in JSON strings
          .replace(/\r/g, '') // Remove carriage returns
          .replace(/\t/g, ' ') // Replace tabs with spaces
          .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas

        // Parse the cleaned JSON
        enhancements = JSON.parse(cleanedResponse);
        console.log('Successfully parsed AI response');

        // Comprehensive validation and enhancement of structure
        validateAndEnhanceResponse(enhancements, sanitizedQuestion, sanitizedAnswer);

      } catch (parseError) {
        console.error('JSON parsing failed:', parseError.message);
        console.error('Raw response preview:', responseText?.substring(0, 500) + '...');
        
        // Comprehensive fallback: Create rich structure manually
        enhancements = createComprehensiveFallbackEnhancements(sanitizedQuestion, sanitizedAnswer, pageContext);
        console.log('Using comprehensive fallback enhancement structure');
      }

      console.log(`Enhancement complete. Generated ${enhancements.question_variations.length} question variations with full answer matrix.`);
      console.log(`Usage: ${usageData.count}/25`);

      // Return successful response with enhanced format matching legacy functionality
      return new Response(JSON.stringify({
        success: true,
        enhancements: enhancements,
        usage: {
          used: usageData.count,
          remaining: 25 - usageData.count,
          limit: 25,
          resetTime: new Date().setHours(24, 0, 0, 0)
        },
        model_info: {
          model: '@cf/meta/llama-4-scout-17b-16e-instruct',
          version: env.WORKER_VERSION || '3.0.0-comprehensive',
          feature_set: 'full-legacy-functionality-plus-enhancements',
          page_context_extracted: pageContext.length > 0,
          cache_status: sessionContextCache.has(`${sessionId || 'no-session'}:${pageUrl}`) ? 'hit' : 'miss'
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
      } else if (error.message.includes('context') || error.message.includes('page')) {
        errorMessage = 'Page context extraction failed. Enhancement will proceed without page context.';
        errorCategory = 'context_extraction';
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

// Extract page context with session-based caching and cleanup
async function getPageContextWithCaching(pageUrl, sessionId) {
  const cacheKey = `${sessionId || 'no-session'}:${pageUrl}`;
  
  // Check session cache first
  if (sessionContextCache.has(cacheKey)) {
    console.log('Using cached page context for session');
    return sessionContextCache.get(cacheKey);
  }
  
  console.log('Extracting fresh page context for:', pageUrl);
  
  // Extract fresh context
  const context = await extractPageContext(pageUrl);
  
  // Cache for this session (with cleanup)
  if (sessionContextCache.size >= 100) {
    // Remove oldest entry
    const firstKey = sessionContextCache.keys().next().value;
    sessionContextCache.delete(firstKey);
  }
  
  sessionContextCache.set(cacheKey, context);
  console.log(`Cached page context for session (${sessionContextCache.size} total entries)`);
  
  // Cleanup cache periodically
  if (sessionContextCache.size > 50) {
    cleanupCache();
  }
  
  return context;
}

// Smart page context extraction using HTMLRewriter
async function extractPageContext(pageUrl) {
  const CONTEXT_LIMIT = 12000; // ~3000 tokens worth of context
  
  try {
    // Fetch the page with cache busting and proper headers
    const urlWithCacheBust = new URL(pageUrl);
    urlWithCacheBust.searchParams.append('_cb', Date.now());
    
    const response = await fetch(urlWithCacheBust.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      },
      cf: { 
        cacheTtl: 0,
        cacheEverything: false
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status}`);
    }
    
    const html = await response.text();
    
    // Extract content using HTMLRewriter
    const extractionResult = await extractContentWithHTMLRewriter(html);
    
    // Build comprehensive context within our limit
    let context = '';
    
    // Add page title (high priority)
    if (extractionResult.title) {
      context += `PAGE TITLE: ${extractionResult.title}\n\n`;
    }
    
    // Add headings (high priority for structure)
    if (extractionResult.headings && extractionResult.headings.length > 0) {
      context += `PAGE HEADINGS:\n${extractionResult.headings.join('\n')}\n\n`;
    }
    
    // Add main content, truncated to fit within our limit
    if (extractionResult.content) {
      const remainingSpace = CONTEXT_LIMIT - context.length;
      if (remainingSpace > 500) { // Leave some buffer
        const truncatedContent = extractionResult.content.substring(0, remainingSpace - 100);
        context += `PAGE CONTENT:\n${truncatedContent}`;
        
        // Add truncation notice if we cut content
        if (extractionResult.content.length > truncatedContent.length) {
          context += '\n\n[Content truncated to fit context limit]';
        }
      }
    }
    
    // Add meta description if available
    if (extractionResult.metaDescription) {
      const remainingSpace = CONTEXT_LIMIT - context.length;
      if (remainingSpace > 200) {
        context += `\n\nMETA DESCRIPTION: ${extractionResult.metaDescription}`;
      }
    }
    
    return context.trim();
    
  } catch (error) {
    console.error('Page context extraction failed:', error.message);
    throw new Error(`Context extraction failed: ${error.message}`);
  }
}

// Enhanced content extraction using HTMLRewriter for intelligent parsing
async function extractContentWithHTMLRewriter(html) {
  // Create a readable stream from the HTML string
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(html));
      controller.close();
    },
  });

  // Initialize content collector with comprehensive content types
  const contentCollector = {
    title: '',
    mainContent: '',
    articleContent: '',
    sectionContent: '',
    paragraphContent: '',
    headingContent: '',
    divContent: '',
    imgAltText: '',
    buttonText: '',
    listContent: '',
    skipContent: false,
    headings: [],
    metaDescription: ''
  };

  // Create a response to pass through HTMLRewriter
  const response = new Response(readable);

  // Process with HTMLRewriter - comprehensive content extraction
  const rewriter = new HTMLRewriter()
    // Extract title and meta description
    .on('title', {
      text(text) {
        contentCollector.title += text.text;
      }
    })
    .on('meta[name="description"]', {
      element(element) {
        const content = element.getAttribute('content');
        if (content) {
          contentCollector.metaDescription = content;
          contentCollector.mainContent += ' ' + content;
        }
      }
    })
    // Capture all headings separately for topic extraction
    .on('h1, h2, h3, h4, h5, h6', {
      text(text) {
        const heading = text.text.trim();
        if (heading && heading.length > 3) {
          contentCollector.headings.push(heading);
        }
        // Double weight for headings in content
        contentCollector.headingContent += ' ' + heading + ' ' + heading;
      }
    })
    // Skip script, style, nav, footer, aside, svg
    .on('script, style, nav, footer, aside, svg', {
      element(element) {
        element.remove();
      }
    })
    // Capture alt text from images
    .on('img', {
      element(element) {
        const alt = element.getAttribute('alt');
        if (alt) {
          contentCollector.imgAltText += ' ' + alt;
        }
      }
    })
    // Capture button text
    .on('button', {
      text(text) {
        contentCollector.buttonText += ' ' + text.text;
      }
    })
    // Process main content areas with higher priority
    .on('main, article, .elementor-widget-container, .elementor-widget-text-editor, .content, .post-content', {
      text(text) {
        if (!contentCollector.skipContent) {
          contentCollector.mainContent += ' ' + text.text;
        }
      }
    })
    .on('section', {
      text(text) {
        if (!contentCollector.skipContent) {
          contentCollector.sectionContent += ' ' + text.text;
        }
      }
    })
    // Process common text elements
    .on('p, span, td, th', {
      text(text) {
        if (!contentCollector.skipContent) {
          contentCollector.paragraphContent += ' ' + text.text;
        }
      }
    })
    // Better capture list content
    .on('li', {
      text(text) {
        if (!contentCollector.skipContent) {
          contentCollector.listContent += ' • ' + text.text;
        }
      }
    })
    // Process divs (lowest priority, but still important)
    .on('div', {
      text(text) {
        if (!contentCollector.skipContent) {
          contentCollector.divContent += ' ' + text.text;
        }
      },
      element(element) {
        // Check for common non-content div classes/ids - WordPress and Elementor specific
        const classAttr = element.getAttribute('class') || '';
        const idAttr = element.getAttribute('id') || '';
        
        const nonContentPatterns = [
          'navigation', 'main-menu', 'site-header', 'site-footer', 
          'sidebar-area', 'banner-ad', 'popup-modal', 'cookie-notice', 
          'comment-section', 'social-share', 'search-box',
          'elementor-container', 'elementor-row', 'elementor-column-wrap',
          'elementor-widget-image', 'elementor-widget-spacer',
          'elementor-widget-divider', 'elementor-widget-social-icons',
          'elementor-shape', 'elementor-background-overlay'
        ];
        
        // Only skip if it matches a non-content pattern AND is not an elementor widget
        // with actual content
        contentCollector.skipContent = nonContentPatterns.some(pattern => 
          classAttr.toLowerCase().includes(pattern) || idAttr.toLowerCase().includes(pattern)
        ) && !classAttr.toLowerCase().includes('elementor-widget-text-editor');
      }
    });

  // Transform the HTML
  await rewriter.transform(response).text();

  // Combine all content with proper prioritization
  let extractedContent = '';
  
  // Add the title first as it's important
  if (contentCollector.title) {
    extractedContent += contentCollector.title + ' ';
  }
  
  // Add heading content with extra weight
  if (contentCollector.headingContent) {
    extractedContent += contentCollector.headingContent + ' ';
  }
  
  // Combine all content together with priorities
  extractedContent += 
    contentCollector.mainContent + ' ' + 
    contentCollector.articleContent + ' ' + 
    contentCollector.sectionContent + ' ' + 
    contentCollector.paragraphContent + ' ' + 
    contentCollector.listContent + ' ' + 
    contentCollector.imgAltText + ' ' + 
    contentCollector.buttonText + ' ' + 
    contentCollector.divContent;

  // Clean up whitespace and excessive repetition
  extractedContent = extractedContent
    .replace(/\s+/g, ' ')
    .trim();

  console.log(`Extracted content length: ${extractedContent.length} characters`);
  console.log(`Extracted ${contentCollector.headings.length} headings from page`);
  
  // Return comprehensive extraction result
  return {
    title: contentCollector.title.trim(),
    content: extractedContent,
    headings: Array.from(new Set(contentCollector.headings)), // Deduplicate headings
    metaDescription: contentCollector.metaDescription
  };
}

// Cache cleanup function
function cleanupCache() {
  // Remove oldest 25% of cache entries
  const entriesToRemove = Math.floor(sessionContextCache.size * 0.25);
  const keysToRemove = Array.from(sessionContextCache.keys()).slice(0, entriesToRemove);
  
  keysToRemove.forEach(key => sessionContextCache.delete(key));
  console.log(`Cache cleanup: removed ${entriesToRemove} entries`);
}

// Validate and enhance AI response structure
function validateAndEnhanceResponse(enhancements, originalQuestion, originalAnswer) {
  // Ensure we have the required structure
  if (!enhancements.question_variations || !Array.isArray(enhancements.question_variations)) {
    enhancements.question_variations = [];
  }
  
  // Ensure we have at least 2 question variations
  if (enhancements.question_variations.length < 2) {
    // Add fallback variations
    const fallbackVariations = createFallbackQuestionVariations(originalQuestion, originalAnswer);
    enhancements.question_variations = [...enhancements.question_variations, ...fallbackVariations].slice(0, 3);
  }
  
  // Validate and enhance each question variation
  enhancements.question_variations.forEach((variation, index) => {
    // Ensure required fields exist
    if (!variation.question) variation.question = originalQuestion;
    if (!variation.reason) variation.reason = 'Enhanced for better SEO performance';
    if (!variation.type) variation.type = 'seo';
    if (!variation.priority) variation.priority = index === 0 ? 'high' : 'medium';
    if (!variation.seo_benefit) variation.seo_benefit = 'Improved search engine visibility';
    if (!variation.improvement_reason) variation.improvement_reason = 'Enhanced with optimized phrasing';
    
    // Ensure answers object exists and has all 4 styles
    if (!variation.answers || typeof variation.answers !== 'object') {
      variation.answers = {};
    }
    
    const requiredStyles = ['concise', 'detailed', 'structured', 'conversational'];
    requiredStyles.forEach(style => {
      if (!variation.answers[style]) {
        variation.answers[style] = createFallbackAnswer(variation.question, style);
      }
      
      // Ensure answer has required structure
      if (typeof variation.answers[style] === 'string') {
        variation.answers[style] = {
          text: variation.answers[style],
          approach: style,
          priority: style === 'concise' ? 'high' : (style === 'detailed' || style === 'structured') ? 'medium' : 'low'
        };
      }
    });
  });
  
  // Ensure other required sections exist with defaults
  if (!enhancements.additional_suggestions) {
    enhancements.additional_suggestions = [
      {
        suggestion: 'Add specific examples to improve user understanding',
        type: 'add_examples',
        reason: 'Examples increase engagement and answer quality',
        impact: 'high'
      },
      {
        suggestion: 'Include relevant internal links where appropriate',
        type: 'add_links',
        reason: 'Internal linking improves SEO and user navigation',
        impact: 'medium'
      }
    ];
  }
  
  if (!enhancements.seo_analysis) {
    enhancements.seo_analysis = {
      keywords: extractKeywords(originalQuestion + ' ' + originalAnswer),
      search_intent: 'informational',
      voice_search_friendly: true,
      featured_snippet_potential: true,
      improvement_areas: ['keyword optimization', 'answer structure', 'length optimization'],
      target_audience: 'users seeking informational content',
      competition_level: 'medium'
    };
  }
  
  if (!enhancements.quality_scores) {
    enhancements.quality_scores = calculateQualityScores(originalQuestion, originalAnswer);
  }
  
  // Enhanced validation for quality scores
  if (!enhancements.quality_scores || typeof enhancements.quality_scores !== 'object') {
    enhancements.quality_scores = {
      question_clarity: 5,
      answer_completeness: 5,
      seo_optimization: 5,
      score_explanations: {
        question_clarity: "Unable to analyze - using default score",
        answer_completeness: "Unable to analyze - using default score",
        seo_optimization: "Unable to analyze - using default score"
      }
    };
  }
  
  // Ensure score explanations exist
  if (!enhancements.quality_scores.score_explanations) {
    enhancements.quality_scores.score_explanations = {
      question_clarity: "Score based on grammar, clarity, and search-friendliness",
      answer_completeness: "Score based on directness, detail, and structure",
      seo_optimization: "Score based on keywords, length, and search intent match"
    };
  }
  
  // Validate score ranges (1-10)
  ['question_clarity', 'answer_completeness', 'seo_optimization'].forEach(scoreType => {
    const score = enhancements.quality_scores[scoreType];
    if (typeof score !== 'number' || score < 1 || score > 10) {
      enhancements.quality_scores[scoreType] = 5;
      console.warn(`Invalid ${scoreType} score: ${score}, using default 5`);
    }
  });
}

// Create fallback question variations when AI doesn't provide enough
function createFallbackQuestionVariations(originalQuestion, originalAnswer) {
  const variations = [];
  
  // Create an alternative phrasing
  let altQuestion = originalQuestion;
  if (originalQuestion.toLowerCase().startsWith('what ')) {
    altQuestion = originalQuestion.replace(/^what /i, 'How can I understand ');
  } else if (originalQuestion.toLowerCase().startsWith('how ')) {
    altQuestion = originalQuestion.replace(/^how /i, 'What is the process to ');
  } else {
    altQuestion = `What should I know about ${originalQuestion.toLowerCase().replace(/\?$/, '')}?`;
  }
  
  variations.push({
    question: altQuestion,
    reason: 'Alternative phrasing to capture different search patterns',
    type: 'seo',
    priority: 'medium',
    seo_benefit: 'Broader keyword coverage',
    improvement_reason: 'Rephrased to match different user search behaviors',
    answers: createAllAnswerStyles(altQuestion)
  });
  
  // Create a more specific version
  const specificQuestion = `${originalQuestion.replace(/\?$/, '')} - detailed guide?`;
  variations.push({
    question: specificQuestion,
    reason: 'More specific version for detailed searches',
    type: 'specificity',
    priority: 'low',
    seo_benefit: 'Targets users seeking comprehensive information',
    improvement_reason: 'Added specificity for users wanting detailed information',
    answers: createAllAnswerStyles(specificQuestion)
  });
  
  return variations;
}

// Create all 4 answer styles for a question
function createAllAnswerStyles(questionText) {
  return {
    concise: createFallbackAnswer(questionText, 'concise'),
    detailed: createFallbackAnswer(questionText, 'detailed'),
    structured: createFallbackAnswer(questionText, 'structured'),
    conversational: createFallbackAnswer(questionText, 'conversational')
  };
}

// Create a fallback answer for a specific style
function createFallbackAnswer(questionText, style) {
  const baseAnswers = {
    concise: `Enhanced concise answer for: ${questionText}`,
    detailed: `This is a comprehensive answer that provides detailed information about ${questionText}. It includes relevant context and examples to fully address the user's question with thorough explanations and actionable insights.`,
    structured: `Structured answer for ${questionText}:\n• Key point 1: Primary information\n• Key point 2: Supporting details\n• Key point 3: Additional context\n\nThis organized format improves readability and SEO performance.`,
    conversational: `Great question! When it comes to ${questionText}, you'll find that this conversational approach makes the information more accessible and voice-search friendly. Let me walk you through this in a natural way.`
  };
  
  return {
    text: baseAnswers[style] || `Enhanced ${style} answer for: ${questionText}`,
    approach: style,
    priority: style === 'concise' ? 'high' : (style === 'detailed' || style === 'structured') ? 'medium' : 'low'
  };
}

// Calculate quality scores based on actual content analysis
function calculateQualityScores(question, answer) {
  let questionClarity = 5;
  let answerCompleteness = 5;
  let seoOptimization = 5;
  
  // Question clarity scoring
  if (question.length > 10 && question.length < 160) questionClarity += 2;
  if (question.includes('?')) questionClarity += 1;
  if (/^(what|how|why|when|where|who)\s/i.test(question)) questionClarity += 2;
  
  // Answer completeness scoring
  if (answer.length > 50) answerCompleteness += 1;
  if (answer.length > 150) answerCompleteness += 1;
  if (answer.length > 300) answerCompleteness += 1;
  if (answer.includes('.') || answer.includes(',')) answerCompleteness += 1;
  if (/\b(example|for instance|such as)\b/i.test(answer)) answerCompleteness += 1;
  
  // SEO optimization scoring
  const questionWords = question.toLowerCase().split(/\s+/);
  const answerWords = answer.toLowerCase().split(/\s+/);
  const overlap = questionWords.filter(word => answerWords.includes(word)).length;
  if (overlap > 2) seoOptimization += 2;
  if (answer.length >= 50 && answer.length <= 300) seoOptimization += 2;
  if (/\b(benefits?|advantages?|features?|steps?|tips?)\b/i.test(answer)) seoOptimization += 1;
  
  // Cap at 10
  questionClarity = Math.min(10, questionClarity);
  answerCompleteness = Math.min(10, answerCompleteness);
  seoOptimization = Math.min(10, seoOptimization);
  
  return {
    question_clarity: questionClarity,
    answer_completeness: answerCompleteness,
    seo_optimization: seoOptimization,
    score_explanations: {
      question_clarity: `Question scores ${questionClarity}/10 - Clear structure and appropriate length for search queries`,
      answer_completeness: `Answer scores ${answerCompleteness}/10 - Provides adequate information with room for enhancement`,
      seo_optimization: `SEO scores ${seoOptimization}/10 - Good foundation with optimization opportunities`
    }
  };
}

// Create comprehensive fallback enhancement structure
function createComprehensiveFallbackEnhancements(question, answer, pageContext) {
  return {
    question_variations: [
      {
        question: question,
        reason: 'Original question maintained with enhanced answer options',
        type: 'original',
        priority: 'high',
        seo_benefit: 'Provides multiple answer formats for better search performance',
        improvement_reason: 'Enhanced with optimized answer variations',
        answers: createAllAnswerStyles(question)
      },
      {
        question: `What ${question.toLowerCase().replace(/^(what|how|why|when|where)\s+/i, '')}?`,
        reason: 'Alternative phrasing for broader keyword coverage',
        type: 'seo',
        priority: 'medium',
        seo_benefit: 'Captures different search query variations',
        improvement_reason: 'Rephrased to match alternative search patterns',
        answers: createAllAnswerStyles(question)
      }
    ],
    additional_suggestions: [
      {
        suggestion: 'Add specific examples to improve user understanding',
        type: 'add_examples',
        reason: 'Examples increase engagement and answer quality',
        impact: 'high'
      },
      {
        suggestion: 'Include relevant internal links where appropriate',
        type: 'add_links',
        reason: 'Internal linking improves SEO and user navigation',
        impact: 'medium'
      },
      {
        suggestion: 'Optimize answer length for featured snippets',
        type: 'improve_structure',
        reason: 'Structured content performs better in search results',
        impact: 'medium'
      }
    ],
    seo_analysis: {
      keywords: extractKeywords(question + ' ' + answer),
      search_intent: 'informational',
      voice_search_friendly: true,
      featured_snippet_potential: true,
      improvement_areas: ['keyword optimization', 'answer structure', 'length optimization'],
      target_audience: 'users seeking informational content',
      competition_level: 'medium'
    },
    quality_scores: calculateQualityScores(question, answer)
  };
}

// Helper function to extract keywords from text
function extractKeywords(text) {
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'what', 'how', 'why', 'when', 'where', 'who']);
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !commonWords.has(word))
    .slice(0, 8);
}