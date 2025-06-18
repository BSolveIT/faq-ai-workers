// Cloudflare Worker: faq-enhancement-worker
// UPDATED: Llama 3.1 8B model, 50/day limit, 2 answer types (Optimised & Detailed)
// All original functionality preserved
// SYNTAX ERROR FIXED: Removed duplicate code sections

const { htmlToText } = require('html-to-text');
const { parse: parseHTML } = require('node-html-parser');

// Session-based context caching to reduce duplicate fetching
const sessionContextCache = new Map();

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    console.log(`========== FAQ Enhancement Request Started ==========`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Method: ${request.method}`);
    console.log(`URL: ${request.url}`);
    
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

    // Health check endpoint
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'faq-enhancement-worker',
          timestamp: new Date().toISOString(),
          version: '3.0.0-speed-optimized',
          model: '@cf/meta/llama-3.1-8b-instruct',
          features: ['question_enhancement', 'answer_optimization', 'seo_analysis', 'quality_scoring'],
          rate_limits: {
            daily_limit: 50,
            per_request_timeout: '15s'
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Only accept POST requests for main functionality
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      // Parse request body
      const { question, answer, pageUrl, sessionId } = await request.json();
      console.log(`Request received - Question length: ${question?.length}, Answer length: ${answer?.length}, URL: ${pageUrl || 'none'}, Session: ${sessionId || 'none'}`);

      // Validate input
      if (!question || !answer) {
        console.error('Missing required fields - question or answer');
        return new Response(JSON.stringify({
          error: 'Missing question or answer'
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Rate limiting using KV store - UPDATED TO 50/DAY
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const today = new Date().toISOString().split('T')[0];
      const rateLimitKey = `enhance:${clientIP}:${today}`;
      
      // Get current usage count
      let usageData = await env.FAQ_RATE_LIMITS.get(rateLimitKey, { type: 'json' });
      if (!usageData) {
        usageData = { count: 0, date: today };
      }

      // Check rate limit - UPDATED TO 50
      if (usageData.count >= 50) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        return new Response(JSON.stringify({
          error: 'Daily enhancement limit reached',
          message: 'You can enhance up to 50 FAQs per day.',
          usage: {
            used: usageData.count,
            remaining: 0,
            limit: 50,
            resetTime: tomorrow.getTime()
          }
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      console.log('Processing enhancement request. Usage:', usageData.count + 1, '/50');

      // Clean input for AI processing
      const sanitizedQuestion = sanitizeContent(question);
      const sanitizedAnswer = sanitizeContent(answer);

      // Extract page context if URL provided (with caching)
      let pageContext = '';
      if (pageUrl) {
        try {
          pageContext = await getCachedPageContext(pageUrl, sessionId);
          console.log('Page context extracted:', pageContext.length, 'characters');
        } catch (contextError) {
          console.error('Page context extraction failed:', contextError.message);
          // Continue without page context rather than failing completely
        }
      }

      // UPDATED PROMPT FOR 2 ANSWER TYPES - STRICT JSON ONLY
      const enhancementPrompt = `CRITICAL: Return ONLY valid JSON. No explanations, no introductory text, no comments. Your response must start with { and end with }.

Analyze this FAQ and provide 2-3 improved question variations that stay on the same topic.

Current FAQ:
Q: ${sanitizedQuestion}
A: ${sanitizedAnswer}

${pageContext ? `Page context:\n${pageContext}\n` : ''}

For each question variation, provide exactly 2 answer versions:
1. "optimised": 50-100 words, perfect for featured snippets, direct and scannable
2. "detailed": 200-300 words, comprehensive coverage with examples and depth

Create variations that:
- Target different search intents
- Use natural language people actually search for
- Include relevant keywords naturally
- Are 8-15 words long for optimal search visibility

RETURN ONLY THIS JSON STRUCTURE (no additional text):
{
  "question_variations": [
    {
      "question": "improved natural question",
      "reason": "why this variation is better",
      "type": "seo|clarity|specificity",
      "priority": "high|medium",
      "seo_benefit": "specific SEO improvement",
      "answers": {
        "optimised": "concise 50-100 word answer perfect for featured snippets",
        "detailed": "comprehensive 200-300 word answer with examples and depth"
      }
    }
  ],
  "additional_suggestions": [
    {
      "suggestion": "specific improvement suggestion",
      "type": "add_examples|add_links|improve_structure",
      "reason": "why this helps",
      "impact": "high|medium|low"
    }
  ],
  "seo_analysis": {
    "keywords": ["relevant", "keywords"],
    "search_intent": "informational|transactional|navigational",
    "voice_search_friendly": true,
    "featured_snippet_potential": true
  },
  "quality_scores": {
    "question_clarity": 7,
    "answer_completeness": 8,
    "seo_optimization": 7,
    "score_explanations": {
      "question_clarity": "specific reason for score",
      "answer_completeness": "specific reason for score",
      "seo_optimization": "specific reason for score"
    }
  }
}

IMPORTANT: Return ONLY the JSON object above. No other text.`;

      // Update rate limit counter first
      usageData.count++;
      await env.FAQ_RATE_LIMITS.put(rateLimitKey, JSON.stringify(usageData), {
        expirationTtl: 86400 // 24 hours
      });

      // AI call with retry logic and timeout protection
      const MAX_WAIT_TIME = 15000; // 15 seconds max per attempt
      const MAX_RETRIES = 3;
      let lastError = null;
      
      console.log(`Starting AI enhancement with ${MAX_RETRIES} retry attempts available`);
      
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          console.log(`AI call attempt ${attempt}/${MAX_RETRIES}...`);
          
          // Create timeout promise
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`AI timeout after ${MAX_WAIT_TIME/1000} seconds`)), MAX_WAIT_TIME)
          );
          
          // Race between AI call and timeout
          const aiResponse = await Promise.race([
            env.AI.run(
              '@cf/meta/llama-3.1-8b-instruct', // UPDATED MODEL
              {
                messages: [
                  { 
                    role: 'system', 
                    content: 'You are an expert FAQ optimizer. CRITICAL: Return ONLY valid JSON. No explanations, no introductory text, no comments. Your response must begin with { and end with }. Create 2-3 question variations with exactly 2 answer types each: "optimised" (50-100 words for featured snippets) and "detailed" (200-300 words for comprehensive coverage).'
                  },
                  { 
                    role: 'user', 
                    content: enhancementPrompt 
                  }
                ],
                temperature: 0.7,
                max_tokens: 1500
              }
            ),
            timeoutPromise
          ]);

          let enhancements;
          
          try {
            // Get the response text
            const responseText = aiResponse.response;
            console.log(`AI response received in ${Date.now() - startTime}ms on attempt ${attempt}`);

            // Clean response and parse JSON - ENHANCED CLEANING
            let cleanedResponse = responseText
              .replace(/```json/gi, '')
              .replace(/```javascript/gi, '')
              .replace(/```/g, '')
              .trim();
            
            // AGGRESSIVE: Remove any introductory text before the JSON
            const jsonStart = cleanedResponse.indexOf('{');
            if (jsonStart > 0) {
              console.log(`Removing ${jsonStart} characters of intro text before JSON`);
              cleanedResponse = cleanedResponse.substring(jsonStart);
            }
            
            // AGGRESSIVE: Remove any trailing text after the JSON
            const jsonEnd = cleanedResponse.lastIndexOf('}');
            if (jsonEnd > -1 && jsonEnd < cleanedResponse.length - 1) {
              console.log(`Removing trailing text after JSON`);
              cleanedResponse = cleanedResponse.substring(0, jsonEnd + 1);
            }
            
            // Final cleanup
            cleanedResponse = cleanedResponse
              .replace(/\n/g, ' ')
              .replace(/\r/g, '')
              .replace(/\t/g, ' ')
              .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas

            enhancements = JSON.parse(cleanedResponse);
            console.log('Successfully parsed AI response');

            // Validate and enhance structure
            validateAndEnhanceResponse(enhancements, sanitizedQuestion, sanitizedAnswer);

          } catch (parseError) {
            console.error(`JSON parsing failed on attempt ${attempt}:`, parseError.message);
            
            // Use comprehensive fallback
            enhancements = createComprehensiveFallbackEnhancements(sanitizedQuestion, sanitizedAnswer, pageContext);
            console.log('Using comprehensive fallback enhancement structure');
          }

          console.log(`Enhancement complete. Generated ${enhancements.question_variations.length} question variations.`);
          console.log(`========== Request completed successfully in ${Date.now() - startTime}ms ==========`);

          // Return successful response
          return new Response(JSON.stringify({
            success: true,
            enhancements: enhancements,
            usage: {
              used: usageData.count,
              remaining: 50 - usageData.count,
              limit: 50,
              resetTime: new Date().setHours(24, 0, 0, 0)
            },
            model_info: {
              model: '@cf/meta/llama-3.1-8b-instruct',
              version: env.WORKER_VERSION || '3.0.0-speed-optimized',
              processingTime: Date.now() - startTime,
              page_context_extracted: pageContext.length > 0,
              cache_status: sessionContextCache.has(`${sessionId || 'no-session'}:${pageUrl}`) ? 'hit' : 'miss',
              attempts_used: attempt
            }
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });

        } catch (aiError) {
          lastError = aiError;
          console.error(`AI processing failed on attempt ${attempt}:`, aiError.message);
          
          // Check if it's error 7000
          if (aiError.message?.includes('7000') || aiError.message?.includes('unknown internal error')) {
            console.log('Detected error 7000 - Cloudflare AI infrastructure issue');
          }
          
          // If not the last attempt, wait before retrying
          if (attempt < MAX_RETRIES) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
            console.log(`Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.log('All retry attempts exhausted');
          }
        }
      }
      
      // All attempts failed
      console.error('AI enhancement failed after all retries:', lastError?.message);
      console.log('Returning fallback response with rule-based enhancements');
      console.log(`========== Request completed with fallback in ${Date.now() - startTime}ms ==========`);
      
      // Decrement counter on complete failure
      usageData.count--;
      await env.FAQ_RATE_LIMITS.put(rateLimitKey, JSON.stringify(usageData), {
        expirationTtl: 86400
      });
      
      // Return graceful fallback response
      return new Response(JSON.stringify({
        success: true,
        enhancements: createComprehensiveFallbackEnhancements(sanitizedQuestion, sanitizedAnswer, pageContext),
        fallback: true,
        message: "AI service is experiencing issues - using instant rule-based enhancements",
        usage: {
          used: usageData.count,
          remaining: 50 - usageData.count,
          limit: 50
        },
        debug_info: {
          error: lastError?.message,
          attempts: MAX_RETRIES,
          timestamp: new Date().toISOString()
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Enhancement error:', error);
      console.error('Error stack:', error.stack);
      console.log(`Total processing time: ${Date.now() - startTime}ms`);
      
      // User-friendly error response
      return new Response(JSON.stringify({
        error: 'Enhancement service temporarily unavailable',
        message: error.message.includes('timeout') 
          ? 'The AI service is experiencing high demand. Please try again in a moment.'
          : 'An error occurred while processing your request. Please try again.',
        technicalDetails: {
          error: error.message,
          suggestion: 'If this persists, try simplifying your FAQ content',
          code: error.message.includes('7000') ? 'AI_SERVICE_ERROR' : 'GENERAL_ERROR'
        },
        fallback: {
          message: 'While the AI is unavailable, here are some general enhancement tips:',
          tips: [
            'Start questions with "What", "How", "Why", or "When" for better SEO',
            'Include your main keyword in the question naturally',
            'Keep questions between 8-15 words for optimal search visibility',
            'Make answers comprehensive (150-300 words) with examples',
            'Use bullet points or numbered lists for structured answers'
          ]
        }
      }), {
        status: 503,
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Retry-After': '30'
        }
      });
    }
  },
};

// Get cached page context or extract new
async function getCachedPageContext(pageUrl, sessionId) {
  const cacheKey = `${sessionId || 'no-session'}:${pageUrl}`;
  
  // Check cache first
  if (sessionContextCache.has(cacheKey)) {
    console.log(`Cache HIT for ${cacheKey} - returning cached context`);
    return sessionContextCache.get(cacheKey);
  }
  
  console.log(`Cache MISS for ${cacheKey} - extracting new context`);
  
  // Extract new context
  const context = await extractPageContext(pageUrl);
  
  // Cache it
  sessionContextCache.set(cacheKey, context);
  console.log(`Cached context for ${cacheKey} - Cache size: ${sessionContextCache.size}`);
  
  // Cleanup old cache entries if needed
  if (sessionContextCache.size > 50) {
    cleanupCache();
  }
  
  return context;
}

// Enhanced page context extraction using modern server-side parsing
async function extractPageContext(pageUrl) {
  const CONTEXT_LIMIT = 12000; // ~3000 tokens worth of context
  console.log(`Starting page context extraction for: ${pageUrl}`);
  
  try {
    // Fetch the page with cache busting and proper headers
    const urlWithCacheBust = new URL(pageUrl);
    urlWithCacheBust.searchParams.append('_cb', Date.now());
    
    console.log(`Fetching URL: ${urlWithCacheBust.toString()}`);
    const fetchStart = Date.now();
    
    const response = await fetch(urlWithCacheBust.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
    
    console.log(`Fetch completed in ${Date.now() - fetchStart}ms - Status: ${response.status}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch page: ${response.status}`);
    }
    
    const html = await response.text();
    console.log(`HTML retrieved - Length: ${html.length} characters`);
    
    // Use enhanced content extraction
    const extractionResult = await extractContentWithHTMLRewriter(html);
    console.log(`Content extracted - Title: "${extractionResult.title}", Headings: ${extractionResult.headings.length}, Content length: ${extractionResult.content.length}`);
    
    // Build comprehensive context
    let context = '';
    
    // Add page title
    if (extractionResult.title) {
      context += `PAGE TITLE: ${extractionResult.title}\n\n`;
    }
    
    // Add meta description
    if (extractionResult.metaDescription) {
      context += `META DESCRIPTION: ${extractionResult.metaDescription}\n\n`;
    }
    
    // Add headings
    if (extractionResult.headings && extractionResult.headings.length > 0) {
      const headingText = Array.isArray(extractionResult.headings) 
        ? extractionResult.headings.join('\n')
        : extractionResult.headings;
      context += `PAGE HEADINGS:\n${headingText}\n\n`;
    }
    
    // Add structured data insights
    if (extractionResult.structuredData) {
      const insights = [];
      if (extractionResult.structuredData.hasImages) insights.push('Contains images');
      if (extractionResult.structuredData.hasLists) insights.push('Contains lists');
      if (extractionResult.structuredData.linkCount > 0) {
        insights.push(`${extractionResult.structuredData.linkCount} internal links`);
      }
      
      if (insights.length > 0) {
        context += `CONTENT FEATURES: ${insights.join(', ')}\n\n`;
      }
    }
    
    // Add main content with smart truncation
    if (extractionResult.content) {
      const remainingSpace = CONTEXT_LIMIT - context.length;
      if (remainingSpace > 500) {
        let contentToAdd = extractionResult.content;
        
        // Smart truncation preserving sentence boundaries
        if (contentToAdd.length > remainingSpace - 100) {
          const truncatedContent = contentToAdd.substring(0, remainingSpace - 100);
          const lastSentenceEnd = Math.max(
            truncatedContent.lastIndexOf('.'),
            truncatedContent.lastIndexOf('!'),
            truncatedContent.lastIndexOf('?')
          );
          
          if (lastSentenceEnd > truncatedContent.length * 0.7) {
            contentToAdd = truncatedContent.substring(0, lastSentenceEnd + 1);
          } else {
            contentToAdd = truncatedContent + '...';
          }
        }
        
        context += `PAGE CONTENT:\n${contentToAdd}`;
        
        if (extractionResult.content.length > contentToAdd.length) {
          context += '\n\n[Content truncated to fit context limit]';
        }
      }
    }
    
    // Final cleanup
    context = context.trim();
    
    if (context.length < 100) {
      console.warn('Extracted context is very short, page may have limited content');
    }
    
    // Limit to 3000 chars for speed
    if (context.length > 3000) {
      console.log(`Truncating context from ${context.length} to 3000 characters for speed`);
      context = context.substring(0, 3000) + '...';
    }
    
    console.log(`Final context length: ${context.length} characters`);
    return context;
    
  } catch (error) {
    console.error('Enhanced page context extraction failed:', error.message);
    throw new Error(`Context extraction failed: ${error.message}`);
  }
}

// Enhanced content extraction using node-html-parser only
async function extractContentWithHTMLRewriter(html) {
  console.log(`Starting HTML content extraction - HTML length: ${html.length}`);
  
  try {
    // Parse HTML using node-html-parser
    const root = parseHTML(html, {
      lowerCaseTagName: true,
      comment: false,
      blockTextElements: {
        script: false,
        noscript: false,
        style: false,
        pre: true
      }
    });
    
    // Initialize enhanced content collector
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
      metaDescription: '',
      structuredData: {},
      linkContext: ''
    };

    // Extract title
    const titleElem = root.querySelector('title');
    contentCollector.title = titleElem ? titleElem.text : '';
    
    // Extract meta description
    const metaDesc = root.querySelector('meta[name="description"]');
    contentCollector.metaDescription = metaDesc ? metaDesc.getAttribute('content') || '' : '';
    
    // Extract all headings with hierarchy
    const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach(elem => {
      const text = elem.text.trim();
      if (text && text.length > 3) {
        contentCollector.headings.push(text);
        contentCollector.headingContent += ' ' + text + ' ';
      }
    });
    
    // Extract main content areas
    const contentSelectors = [
      'main', 'article', '[role="main"]', '.main-content', '#main-content',
      '.content', '#content', '.entry-content', '.post-content',
      '.elementor-widget-text-editor', '.elementor-text-editor'
    ];
    
    contentSelectors.forEach(selector => {
      const elements = root.querySelectorAll(selector);
      elements.forEach(elem => {
        if (!shouldSkipElementNode(elem)) {
          contentCollector.mainContent += ' ' + elem.text + ' ';
        }
      });
    });
    
    // Extract paragraphs
    const paragraphs = root.querySelectorAll('p');
    paragraphs.forEach(elem => {
      const text = elem.text.trim();
      if (text.length > 20) {
        contentCollector.paragraphContent += ' ' + text + ' ';
      }
    });
    
    // Extract list items
    const listItems = root.querySelectorAll('li');
    listItems.forEach(elem => {
      const text = elem.text.trim();
      if (text.length > 10) {
        contentCollector.listContent += ' • ' + text + ' ';
      }
    });
    
    // Extract image alt text
    const images = root.querySelectorAll('img[alt]');
    images.forEach(elem => {
      const alt = elem.getAttribute('alt');
      if (alt && alt.length > 3) {
        contentCollector.imgAltText += ' ' + alt + ' ';
      }
    });
    
    // Extract link context
    const links = root.querySelectorAll('a');
    links.forEach(elem => {
      const text = elem.text.trim();
      const href = elem.getAttribute('href');
      if (text && !href?.startsWith('#')) {
        contentCollector.linkContext += ' (' + text + ') ';
      }
    });
    
    // Compile final content with smart prioritisation and deduplication
    let extractedContent = '';
    
    // Add title first (highest priority)
    if (contentCollector.title) {
      extractedContent += contentCollector.title + '\n\n';
    }

    // Add meta description
    if (contentCollector.metaDescription) {
      extractedContent += contentCollector.metaDescription + '\n\n';
    }

    // Add heading content (high priority for structure)
    if (contentCollector.headingContent.trim()) {
      extractedContent += cleanText(contentCollector.headingContent) + '\n\n';
    }

    // Combine and prioritise main content areas
    const allContent = [
      contentCollector.mainContent,
      contentCollector.articleContent,
      contentCollector.sectionContent,
      contentCollector.paragraphContent,
      contentCollector.listContent,
      contentCollector.buttonText,
      contentCollector.linkContext,
      contentCollector.imgAltText,
      contentCollector.divContent
    ].join(' ');

    // Use html-to-text for final cleanup and formatting
    const cleanedContent = htmlToText(allContent, {
      wordwrap: false,
      preserveNewlines: false,
      ignoreImage: false,
      ignoreHref: false,
      uppercaseHeadings: false
    });

    extractedContent += cleanText(cleanedContent);

    // Advanced content cleaning and normalisation
    extractedContent = normaliseContent(extractedContent);
    
    console.log(`Content extraction complete - Title: "${contentCollector.title}", Content: ${extractedContent.length} chars, Headings: ${contentCollector.headings.length}`);

    // Return enhanced extraction result with structured data
    return {
      content: extractedContent,
      title: contentCollector.title,
      headings: contentCollector.headings,
      metaDescription: contentCollector.metaDescription,
      structuredData: {
        hasImages: contentCollector.imgAltText.length > 0,
        hasLists: contentCollector.listContent.length > 0,
        linkCount: contentCollector.linkContext.split('(').length - 1
      }
    };

  } catch (error) {
    console.error('Enhanced content extraction failed:', error);
    
    // Fallback to basic text extraction if advanced parsing fails
    try {
      const fallbackText = htmlToText(html, {
        wordwrap: false,
        preserveNewlines: false,
        ignoreImage: true,
        ignoreHref: true
      });
      
      return {
        content: cleanText(fallbackText),
        title: '',
        headings: [],
        metaDescription: ''
      };
    } catch (fallbackError) {
      console.error('Fallback extraction also failed:', fallbackError);
      return {
        content: '',
        title: '',
        headings: [],
        metaDescription: ''
      };
    }
  }
}

// Enhanced element filtering for node-html-parser
function shouldSkipElementNode(element) {
  const classAttr = element.getAttribute('class') || '';
  const idAttr = element.getAttribute('id') || '';
  const ariaHidden = element.getAttribute('aria-hidden');
  
  if (ariaHidden === 'true') return true;
  
  const nonContentPatterns = [
    'navigation', 'main-menu', 'site-header', 'site-footer', 
    'sidebar-area', 'banner-ad', 'popup-modal', 'cookie-notice', 
    'comment-section', 'social-share', 'search-box',
    'elementor-background-overlay', 'elementor-motion-effects',
    'skip-link', 'screen-reader', 'visually-hidden',
    'breadcrumb', 'pagination', 'widget-area',
    'author-info', 'related-posts', 'advertisement'
  ];
  
  const hasNonContentPattern = nonContentPatterns.some(pattern => 
    classAttr.toLowerCase().includes(pattern) || 
    idAttr.toLowerCase().includes(pattern)
  );
  
  const isElementorTextWidget = classAttr.toLowerCase().includes('elementor-widget-text-editor');
  
  return hasNonContentPattern && !isElementorTextWidget;
}

// Clean and sanitize content
function sanitizeContent(content) {
  if (!content) return '';
  
  return content
    .trim()
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Advanced text cleaning
function cleanText(text) {
  if (!text) return '';
  
  return text
    .replace(/\s+/g, ' ')
    .replace(/\[.*?\]/g, '')
    .replace(/\{.*?\}/g, '')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/\S+@\S+\.\S+/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .trim()
    .replace(/\s+/g, ' ');
}

// Content normalisation
function normaliseContent(content) {
  if (!content) return '';
  
  const sentences = content.split(/[.!?]+/);
  
  const filteredSentences = sentences
    .map(s => s.trim())
    .filter(s => s.length > 10)
    .filter(s => !/^(click|read more|learn more|contact us)$/i.test(s))
    .slice(0, 100);
  
  return filteredSentences.join('. ').trim();
}

// Cache cleanup
function cleanupCache() {
  const initialSize = sessionContextCache.size;
  const entriesToRemove = Math.floor(sessionContextCache.size * 0.25);
  const keysToRemove = Array.from(sessionContextCache.keys()).slice(0, entriesToRemove);
  
  keysToRemove.forEach(key => sessionContextCache.delete(key));
  console.log(`Cache cleanup: removed ${entriesToRemove} entries (${initialSize} → ${sessionContextCache.size})`);
}

// UPDATED: Validate and enhance AI response for 2 answer types
function validateAndEnhanceResponse(enhancements, originalQuestion, originalAnswer) {
  console.log('Validating and enhancing AI response structure...');
  
  // Ensure we have the required structure
  if (!enhancements.question_variations || !Array.isArray(enhancements.question_variations)) {
    console.warn('Missing or invalid question_variations array - creating new one');
    enhancements.question_variations = [];
  }
  
  console.log(`Found ${enhancements.question_variations.length} question variations`);
  
  // Ensure we have at least 2 question variations
  if (enhancements.question_variations.length < 2) {
    console.log('Insufficient variations - adding fallback variations');
    const fallbackVariations = createFallbackQuestionVariations(originalQuestion, originalAnswer);
    enhancements.question_variations = [...enhancements.question_variations, ...fallbackVariations].slice(0, 3);
  }
  
  // Validate each question variation
  enhancements.question_variations.forEach((variation, index) => {
    console.log(`Validating variation ${index + 1}: "${variation.question?.substring(0, 50)}..."`);
    
    // Ensure required fields
    if (!variation.question) variation.question = originalQuestion;
    if (!variation.reason) variation.reason = 'Enhanced for better SEO performance';
    if (!variation.type) variation.type = 'seo';
    if (!variation.priority) variation.priority = index === 0 ? 'high' : 'medium';
    if (!variation.seo_benefit) variation.seo_benefit = 'Improved search engine visibility';
    
    // UPDATED: Ensure answers object has 2 types (not 4)
    if (!variation.answers || typeof variation.answers !== 'object') {
      variation.answers = {};
    }
    
    // Only require optimised and detailed
    if (!variation.answers.optimised) {
      console.log(`Creating optimised answer for variation ${index + 1}`);
      variation.answers.optimised = createOptimisedAnswer(originalAnswer);
    }
    if (!variation.answers.detailed) {
      console.log(`Creating detailed answer for variation ${index + 1}`);
      variation.answers.detailed = createDetailedAnswer(originalAnswer);
    }
  });
  
  // Ensure other sections exist
  if (!enhancements.additional_suggestions) {
    console.log('Adding default additional_suggestions');
    enhancements.additional_suggestions = [
      {
        suggestion: 'Add specific examples to improve user understanding',
        type: 'add_examples',
        reason: 'Examples increase engagement and answer quality',
        impact: 'high'
      }
    ];
  }
  
  if (!enhancements.seo_analysis) {
    console.log('Adding default seo_analysis');
    enhancements.seo_analysis = {
      keywords: extractKeywords(originalQuestion + ' ' + originalAnswer),
      search_intent: 'informational',
      voice_search_friendly: true,
      featured_snippet_potential: true
    };
  }
  
  if (!enhancements.quality_scores) {
    console.log('Calculating quality scores');
    enhancements.quality_scores = calculateQualityScores(originalQuestion, originalAnswer);
  }
  
  console.log('Validation complete');
}

// UPDATED: Create fallback variations with 2 answer types
function createFallbackQuestionVariations(originalQuestion, originalAnswer) {
  const variations = [];
  
  // Create alternative phrasing
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
    reason: 'Alternative phrasing for broader search appeal',
    type: 'clarity',
    priority: 'medium',
    seo_benefit: 'Captures different search patterns',
    answers: {
      optimised: createOptimisedAnswer(originalAnswer),
      detailed: createDetailedAnswer(originalAnswer)
    }
  });
  
  return variations;
}

// Create optimised answer (50-100 words)
function createOptimisedAnswer(originalAnswer) {
  const words = originalAnswer.split(' ').filter(w => w.length > 0);
  
  if (words.length <= 100) {
    // Already concise
    return originalAnswer;
  }
  
  // Take first 80-90 words and ensure complete sentence
  let optimised = words.slice(0, 90).join(' ');
  
  // Try to end at a sentence boundary
  const lastPeriod = optimised.lastIndexOf('.');
  const lastExclamation = optimised.lastIndexOf('!');
  const lastQuestion = optimised.lastIndexOf('?');
  
  const lastSentenceEnd = Math.max(lastPeriod, lastExclamation, lastQuestion);
  
  if (lastSentenceEnd > optimised.length * 0.7) {
    optimised = optimised.substring(0, lastSentenceEnd + 1);
  } else {
    optimised += '...';
  }
  
  return optimised;
}

// Create detailed answer (200-300 words)
function createDetailedAnswer(originalAnswer) {
  const words = originalAnswer.split(' ').filter(w => w.length > 0);
  
  if (words.length >= 200) {
    // Already detailed enough
    if (words.length > 300) {
      // Truncate to 300 words
      return words.slice(0, 300).join(' ') + '...';
    }
    return originalAnswer;
  }
  
  // Enhance short answers
  let detailed = originalAnswer;
  
  if (words.length < 150) {
    detailed += '\n\nFor more comprehensive information on this topic, consider the following aspects:';
    detailed += '\n• Specific examples and use cases';
    detailed += '\n• Step-by-step implementation details';
    detailed += '\n• Common variations or alternatives';
    detailed += '\n• Best practices and recommendations';
    detailed += '\n• Related topics and resources';
  }
  
  return detailed;
}

// UPDATED: Comprehensive fallback for 2 answer types
function createComprehensiveFallbackEnhancements(question, answer, pageContext) {
  return {
    question_variations: [
      {
        question: improveQuestion(question),
        reason: 'Optimized for natural search patterns',
        type: 'seo',
        priority: 'high',
        seo_benefit: 'Better matches how users search',
        answers: {
          optimised: createOptimisedAnswer(answer),
          detailed: createDetailedAnswer(answer)
        }
      },
      {
        question: createAlternativeQuestion(question),
        reason: 'Alternative phrasing for different search intents',
        type: 'clarity',
        priority: 'medium',
        seo_benefit: 'Captures variations in search queries',
        answers: {
          optimised: createOptimisedAnswer(answer),
          detailed: createDetailedAnswer(answer)
        }
      }
    ],
    additional_suggestions: [
      {
        suggestion: 'Add specific examples or case studies',
        type: 'add_examples',
        reason: 'Examples improve understanding and engagement',
        impact: 'high'
      },
      {
        suggestion: 'Include relevant statistics or data points',
        type: 'add_data',
        reason: 'Data adds credibility and authority',
        impact: 'medium'
      }
    ],
    seo_analysis: {
      keywords: extractKeywords(question + ' ' + answer),
      search_intent: determineSearchIntent(question),
      voice_search_friendly: isVoiceSearchFriendly(question),
      featured_snippet_potential: hasFeaturedSnippetPotential(answer)
    },
    quality_scores: calculateQualityScores(question, answer)
  };
}

// Improve question helper
function improveQuestion(question) {
  let improved = question.trim();
  
  // Add question mark if missing
  if (!improved.endsWith('?')) improved += '?';
  
  // Capitalize first letter
  improved = improved.charAt(0).toUpperCase() + improved.slice(1);
  
  // Add question word if missing
  const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'do', 'is'];
  const startsWithQuestion = questionWords.some(word => 
    improved.toLowerCase().startsWith(word)
  );
  
  if (!startsWithQuestion && improved.length < 50) {
    // Determine best question word based on content
    if (improved.toLowerCase().includes('process') || improved.toLowerCase().includes('method')) {
      improved = 'How do ' + improved.charAt(0).toLowerCase() + improved.slice(1);
    } else if (improved.toLowerCase().includes('definition') || improved.toLowerCase().includes('meaning')) {
      improved = 'What is ' + improved.charAt(0).toLowerCase() + improved.slice(1);
    } else {
      improved = 'What are ' + improved.charAt(0).toLowerCase() + improved.slice(1);
    }
  }
  
  return improved;
}

// Create alternative question
function createAlternativeQuestion(original) {
  const lower = original.toLowerCase();
  
  if (lower.startsWith('what is')) {
    return original.replace(/^what is/i, 'How would you define');
  } else if (lower.startsWith('how do')) {
    return original.replace(/^how do/i, 'What\'s the best way to');
  } else if (lower.startsWith('why')) {
    return original.replace(/^why/i, 'What are the reasons for');
  } else if (lower.startsWith('when')) {
    return original.replace(/^when/i, 'At what time should');
  } else {
    return 'Can you explain ' + lower.replace(/\?$/, '') + '?';
  }
}

// Calculate quality scores
function calculateQualityScores(question, answer) {
  console.log(`Calculating quality scores for Q: "${question.substring(0, 50)}..." A: "${answer.substring(0, 50)}..."`);
  
  // Question clarity scoring
  let questionClarity = 5; // Base score
  if (question.endsWith('?')) questionClarity += 1;
  if (question.split(' ').length >= 5 && question.split(' ').length <= 15) questionClarity += 2;
  if (/^(what|how|why|when|where|who|which)/i.test(question)) questionClarity += 2;
  
  // Answer completeness scoring
  let answerCompleteness = 5; // Base score
  const answerWords = answer.split(' ').length;
  if (answerWords >= 50) answerCompleteness += 2;
  if (answerWords >= 100) answerCompleteness += 1;
  if (answer.includes('.') || answer.includes(',')) answerCompleteness += 1;
  if (/\b(example|for instance|such as)\b/i.test(answer)) answerCompleteness += 1;
  
  // SEO optimization scoring
  let seoOptimization = 5; // Base score
  const questionWords = question.toLowerCase().split(/\s+/);
  const answerWordsLower = answer.toLowerCase().split(/\s+/);
  const overlap = questionWords.filter(word => answerWordsLower.includes(word)).length;
  if (overlap > 2) seoOptimization += 2;
  if (answer.length >= 50 && answer.length <= 300) seoOptimization += 2;
  if (/\b(benefits?|advantages?|features?|steps?|tips?)\b/i.test(answer)) seoOptimization += 1;
  
  // Cap scores at 10
  questionClarity = Math.min(10, questionClarity);
  answerCompleteness = Math.min(10, answerCompleteness);
  seoOptimization = Math.min(10, seoOptimization);
  
  console.log(`Quality scores calculated - Clarity: ${questionClarity}, Completeness: ${answerCompleteness}, SEO: ${seoOptimization}`);
  
  return {
    question_clarity: questionClarity,
    answer_completeness: answerCompleteness,
    seo_optimization: seoOptimization,
    score_explanations: {
      question_clarity: `Score ${questionClarity}/10 - Based on structure, length, and clarity`,
      answer_completeness: `Score ${answerCompleteness}/10 - Based on detail, examples, and comprehensiveness`,
      seo_optimization: `Score ${seoOptimization}/10 - Based on keywords, length, and search optimization`
    }
  };
}

// Extract keywords
function extractKeywords(text) {
  const commonWords = new Set(['the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'some', 'any', 'few', 'many', 'much', 'more', 'most', 'other', 'into', 'up', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'of', 'for', 'to', 'in', 'with', 'from']);
  
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !commonWords.has(word));
  
  // Get unique words and return top 5
  const uniqueWords = [...new Set(words)];
  return uniqueWords.slice(0, 5);
}

// Determine search intent
function determineSearchIntent(question) {
  const lower = question.toLowerCase();
  
  if (lower.includes('buy') || lower.includes('price') || lower.includes('cost') || lower.includes('cheap') || lower.includes('best')) {
    return 'transactional';
  } else if (lower.includes('near me') || lower.includes('location') || lower.includes('address') || lower.includes('directions')) {
    return 'navigational';
  } else {
    return 'informational';
  }
}

// Check if voice search friendly
function isVoiceSearchFriendly(question) {
  // Voice searches tend to be conversational and complete sentences
  return question.split(' ').length >= 5 && 
         /^(what|how|why|when|where|who|which|can|do|is)/i.test(question);
}

// Check featured snippet potential
function hasFeaturedSnippetPotential(answer) {
  const words = answer.split(' ').length;
  // Featured snippets typically 40-60 words
  return words >= 40 && words <= 120 && 
         (answer.includes('.') || answer.includes(','));
}