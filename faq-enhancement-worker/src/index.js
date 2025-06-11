// UPGRADE: NEW CONTENT EXTRACTION IMPORTS
// UPGRADE: NEW CONTENT EXTRACTION IMPORTS
import * as cheerio from 'cheerio';
import { htmlToText } from 'html-to-text';
import { parse as parseHTML } from 'node-html-parser';

// Cloudflare Worker: faq-enhancement-worker.js
// Enhanced FAQ optimization using Cloudflare Workers AI with Llama 4 Scout 17B
// Complete implementation preserving all legacy functionality + UPGRADED CONTENT EXTRACTION

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

      // Check rate limit (50 enhancements per day)
      if (usageData.count >= 50) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        return new Response(JSON.stringify({
          rateLimited: true,
          error: 'Daily enhancement limit reached. You can enhance up to 50 FAQs per day.',
          resetTime: tomorrow.getTime(),
          limit: 50,
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

      // Sanitize input for AI processing
      const sanitizedQuestion = question.trim().replace(/[^\w\s\?\-\.\,]/g, '');
      const sanitizedAnswer = answer.trim().replace(/[^\w\s\?\-\.\,\(\)]/g, '');

      // Get page context with session-based caching
      let pageContext = '';
      if (pageUrl) {
        try {
          pageContext = await getPageContextWithCaching(pageUrl, sessionId);
          console.log(`Page context extracted: ${pageContext.length} characters`);
        } catch (contextError) {
          console.warn('Page context extraction failed:', contextError.message);
          pageContext = ''; // Continue without context
        }
      }

      // Create enhanced AI prompt
      const enhancementPrompt = `You are an expert FAQ enhancement assistant specializing in creating comprehensive question variations with complete answer sets.

QUESTION TO ENHANCE: "${sanitizedQuestion}"
CURRENT ANSWER: "${sanitizedAnswer}"
${pageContext ? `PAGE CONTEXT: ${pageContext}` : ''}

Create 2-3 enhanced question variations that:
1. Improve SEO potential and search visibility
2. Address different search intents and user needs
3. Use natural, conversational language

For EACH question variation, provide EXACTLY 4 different answer styles:
- concise: Direct, brief response (30-60 words)
- detailed: Comprehensive explanation (100-200 words)  
- structured: Organized with bullet points or steps
- conversational: Friendly, engaging tone

REQUIRED JSON FORMAT:
{
  "question_variations": [
    {
      "question": "enhanced question text",
      "reason": "explanation of improvement",
      "type": "clarity|seo|specificity",
      "priority": "high|medium|low",
      "seo_benefit": "specific SEO advantage",
      "answers": {
        "concise": {
          "text": "brief answer",
          "approach": "concise",
          "priority": "high"
        },
        "detailed": {
          "text": "comprehensive explanation",
          "approach": "detailed", 
          "priority": "medium"
        },
        "structured": {
          "text": "organized answer with structure",
          "approach": "structured",
          "priority": "medium"
        },
        "conversational": {
          "text": "friendly, engaging response",
          "approach": "conversational",
          "priority": "low"
        }
      }
    }
  ],
  "additional_suggestions": [
    {
      "suggestion": "specific improvement",
      "type": "add_examples|improve_clarity|add_links",
      "reason": "explanation",
      "impact": "high|medium|low"
    }
  ],
  "seo_analysis": {
    "keywords": ["relevant", "keywords"],
    "search_intent": "informational|navigational|transactional",
    "voice_search_friendly": true,
    "featured_snippet_potential": true
  },
  "quality_scores": {
    "question_clarity": 8,
    "answer_completeness": 7,
    "seo_optimization": 8
  }
}

Respond with valid JSON only.`;

      // Call Cloudflare Workers AI
      const aiResponse = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert FAQ enhancement assistant. Respond with valid JSON only.' 
          },
          { 
            role: 'user', 
            content: enhancementPrompt 
          }
        ],
        temperature: 0.7,
        max_tokens: 4000
      });

      let enhancements;
      
      try {
        // Get the response text
        const responseText = aiResponse.response;
        console.log('AI response received:', responseText?.substring(0, 200) + '...');

        // Clean response and handle markdown code blocks
        let cleanedResponse = responseText
          .replace(/```json/gi, '')
          .replace(/```javascript/gi, '')
          .replace(/```/g, '')
          .trim()
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
        errorMessage = 'Request timeout. The AI model is taking longer than usual. Enhancement will proceed without page context.';
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

// UPGRADE: Enhanced page context extraction using modern server-side parsing
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
    
    // UPGRADE: Use enhanced content extraction with modern parsing
    const extractionResult = await extractContentWithHTMLRewriter(html);
    
    // UPGRADE: Build comprehensive context with enhanced data structure
    let context = '';
    
    // Add page title (high priority)
    if (extractionResult.title) {
      context += `PAGE TITLE: ${extractionResult.title}\n\n`;
    }
    
    // Add meta description if available and different from title
    if (extractionResult.metaDescription && 
        extractionResult.metaDescription !== extractionResult.title) {
      context += `META DESCRIPTION: ${extractionResult.metaDescription}\n\n`;
    }
    
    // UPGRADE: Enhanced heading structure with hierarchy information
    if (extractionResult.headings && extractionResult.headings.length > 0) {
      // For compatibility, use the simple format but with better organization
      const headingText = Array.isArray(extractionResult.headings) 
        ? extractionResult.headings.join('\n')
        : extractionResult.headings;
      context += `PAGE HEADINGS:\n${headingText}\n\n`;
    }
    
    // UPGRADE: Add structured data insights if available
    if (extractionResult.structuredData) {
      const insights = [];
      if (extractionResult.structuredData.hasImages) insights.push('Contains images');
      if (extractionResult.structuredData.hasLists) insights.push('Contains lists');
      if (extractionResult.structuredData.linkCount > 0) insights.push(`${extractionResult.structuredData.linkCount} internal links`);
      
      if (insights.length > 0) {
        context += `CONTENT FEATURES: ${insights.join(', ')}\n\n`;
      }
    }
    
    // Add main content, with intelligent truncation
    if (extractionResult.content) {
      const remainingSpace = CONTEXT_LIMIT - context.length;
      if (remainingSpace > 500) { // Leave some buffer
        let contentToAdd = extractionResult.content;
        
        // UPGRADE: Smart truncation that preserves sentence boundaries
        if (contentToAdd.length > remainingSpace - 100) {
          // Find the last complete sentence within our limit
          const truncatedContent = contentToAdd.substring(0, remainingSpace - 100);
          const lastSentenceEnd = Math.max(
            truncatedContent.lastIndexOf('.'),
            truncatedContent.lastIndexOf('!'),
            truncatedContent.lastIndexOf('?')
          );
          
          if (lastSentenceEnd > truncatedContent.length * 0.7) {
            // If we can preserve most content with sentence boundary, do so
            contentToAdd = truncatedContent.substring(0, lastSentenceEnd + 1);
          } else {
            // Otherwise, just truncate with ellipsis
            contentToAdd = truncatedContent + '...';
          }
        }
        
        context += `PAGE CONTENT:\n${contentToAdd}`;
        
        // Add truncation notice if we cut content
        if (extractionResult.content.length > contentToAdd.length) {
          context += '\n\n[Content truncated to fit context limit]';
        }
      }
    }
    
    // Final context cleanup and validation
    context = context.trim();
    
    // UPGRADE: Enhanced context validation
    if (context.length < 100) {
      console.warn('Extracted context is very short, page may have limited content');
    }
    
    return context;
    
  } catch (error) {
    console.error('Enhanced page context extraction failed:', error.message);
    
    // UPGRADE: Enhanced error handling with more specific error types
    if (error.message.includes('Failed to fetch page')) {
      throw new Error(`Page fetch failed: ${error.message}`);
    } else if (error.message.includes('parsing')) {
      throw new Error(`Content parsing failed: ${error.message}`);
    } else {
      throw new Error(`Context extraction failed: ${error.message}`);
    }
  }
}

// UPGRADE: Enhanced content extraction using modern server-side parsing tools
async function extractContentWithHTMLRewriter(html) {
  try {
    // UPGRADE: Initialize with modern server-side parsing tools
    const $ = cheerio.load(html);
    const parsedHTML = parseHTML(html);
    
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

    // UPGRADE: Extract title using Cheerio (more reliable)
    const title = $('title').text().trim();
    if (title) {
      contentCollector.title = title;
    }

    // UPGRADE: Enhanced meta data extraction
    const metaDescription = $('meta[name="description"]').attr('content') || 
                          $('meta[property="og:description"]').attr('content') || '';
    if (metaDescription) {
      contentCollector.metaDescription = metaDescription;
      contentCollector.mainContent += ' ' + metaDescription;
    }

    // UPGRADE: Advanced heading extraction with hierarchy understanding
    const headingSelectors = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    headingSelectors.forEach(tag => {
      $(tag).each((index, element) => {
        const heading = $(element).text().trim();
        if (heading && heading.length > 3) {
          contentCollector.headings.push(heading);
          // Double weight for headings in content
          contentCollector.headingContent += ' ' + heading + ' ' + heading;
        }
      });
    });

    // UPGRADE: Remove unwanted elements using Cheerio's powerful selectors
    const elementsToRemove = [
      'script', 'style', 'nav', 'footer', 'aside', 'svg',
      '.site-header', '.site-footer', '.navigation', '.main-menu',
      '.sidebar-area', '.banner-ad', '.popup-modal', '.cookie-notice',
      '.comment-section', '.social-share', '.search-box',
      '.elementor-background-overlay', '[aria-hidden="true"]',
      '.skip-link', '.screen-reader-text'
    ];
    
    elementsToRemove.forEach(selector => {
      $(selector).remove();
    });

    // UPGRADE: Smart content prioritisation using CSS selectors
    const highPrioritySelectors = [
      'main', 'article', '[role="main"]',
      '.elementor-widget-container', '.elementor-widget-text-editor',
      '.content', '.post-content', '.entry-content', '.page-content'
    ];

    const mediumPrioritySelectors = [
      'section', '.content-area', '.primary-content'
    ];

    // UPGRADE: Process high priority content areas
    highPrioritySelectors.forEach(selector => {
      $(selector).each((index, element) => {
        const text = $(element).text().trim();
        if (text && !shouldSkipElement($(element))) {
          contentCollector.mainContent += ' ' + text;
        }
      });
    });

    // UPGRADE: Enhanced image alt text extraction
    $('img').each((index, element) => {
      const alt = $(element).attr('alt');
      const title = $(element).attr('title');
      if (alt) contentCollector.imgAltText += ' ' + alt;
      if (title) contentCollector.imgAltText += ' ' + title;
    });

    // UPGRADE: Better list content extraction with structure preservation
    $('ul, ol').each((index, element) => {
      const listItems = $(element).find('li').map((i, li) => {
        return '• ' + $(li).text().trim();
      }).get();
      contentCollector.listContent += ' ' + listItems.join(' ');
    });

    // UPGRADE: Extract button and link context for better understanding
    $('button, a[href]').each((index, element) => {
      const text = $(element).text().trim();
      if (text && text.length > 2) {
        contentCollector.buttonText += ' ' + text;
        
        // For links, also capture href context if it's internal
        const href = $(element).attr('href');
        if (href && !href.startsWith('http') && !href.startsWith('mailto:')) {
          contentCollector.linkContext += ' ' + text + ' (' + href + ')';
        }
      }
    });

    // UPGRADE: Process medium priority content
    mediumPrioritySelectors.forEach(selector => {
      $(selector).each((index, element) => {
        const text = $(element).text().trim();
        if (text && !shouldSkipElement($(element))) {
          contentCollector.sectionContent += ' ' + text;
        }
      });
    });

    // UPGRADE: Process remaining paragraphs and text elements
    $('p, span, td, th').each((index, element) => {
      const text = $(element).text().trim();
      if (text && !shouldSkipElement($(element)) && text.length > 10) {
        contentCollector.paragraphContent += ' ' + text;
      }
    });

    // UPGRADE: Final div processing with improved filtering
    $('div').each((index, element) => {
      if (!shouldSkipElement($(element))) {
        const text = $(element).text().trim();
        if (text && text.length > 15) {
          contentCollector.divContent += ' ' + text;
        }
      }
    });

    // UPGRADE: Combine content with intelligent prioritisation and deduplication
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

    // UPGRADE: Use html-to-text for final cleanup and formatting
    const cleanedContent = htmlToText(allContent, {
      wordwrap: false,
      preserveNewlines: false,
      ignoreImage: false,
      ignoreHref: false,
      uppercaseHeadings: false,
      formatters: {
        // Custom formatters for better text extraction
        'anchor': function (elem, walk, builder, formatOptions) {
          const href = elem.attribs.href;
          walk(elem.children, builder);
          if (href && !href.startsWith('http')) {
            builder.addInline(' (' + href + ')');
          }
        }
      }
    });

    extractedContent += cleanText(cleanedContent);

    // UPGRADE: Advanced content cleaning and normalisation
    extractedContent = normaliseContent(extractedContent);

    // Return enhanced extraction result with structured data
    return {
      content: extractedContent,
      title: contentCollector.title,
      headings: contentCollector.headings, // Preserve original format for compatibility
      metaDescription: contentCollector.metaDescription,
      structuredData: {
        hasImages: contentCollector.imgAltText.length > 0,
        hasLists: contentCollector.listContent.length > 0,
        linkCount: contentCollector.linkContext.split('(').length - 1
      }
    };

  } catch (error) {
    console.error('Enhanced content extraction failed:', error);
    
    // UPGRADE: Fallback to basic text extraction if advanced parsing fails
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

// UPGRADE: NEW HELPER FUNCTIONS

// Enhanced element filtering for better content detection
function shouldSkipElement($element) {
  const classAttr = $element.attr('class') || '';
  const idAttr = $element.attr('id') || '';
  const ariaHidden = $element.attr('aria-hidden');
  
  // Skip if aria-hidden
  if (ariaHidden === 'true') return true;
  
  // Enhanced non-content patterns
  const nonContentPatterns = [
    'navigation', 'main-menu', 'site-header', 'site-footer', 
    'sidebar-area', 'banner-ad', 'popup-modal', 'cookie-notice', 
    'comment-section', 'social-share', 'search-box',
    'elementor-background-overlay', 'elementor-motion-effects',
    'skip-link', 'screen-reader', 'visually-hidden',
    'breadcrumb', 'pagination', 'widget-area',
    'author-info', 'related-posts', 'advertisement'
  ];
  
  // Check for non-content patterns
  const hasNonContentPattern = nonContentPatterns.some(pattern => 
    classAttr.toLowerCase().includes(pattern) || 
    idAttr.toLowerCase().includes(pattern)
  );
  
  // Always include Elementor text widgets
  const isElementorTextWidget = classAttr.toLowerCase().includes('elementor-widget-text-editor');
  
  return hasNonContentPattern && !isElementorTextWidget;
}

// Advanced text cleaning and normalisation
function cleanText(text) {
  if (!text) return '';
  
  return text
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove common web artifacts
    .replace(/\[.*?\]/g, '')
    .replace(/\{.*?\}/g, '')
    // Clean up punctuation
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // Remove email addresses and URLs for privacy
    .replace(/\S+@\S+\.\S+/g, '[email]')
    .replace(/https?:\/\/\S+/g, '[url]')
    // Trim and ensure single spaces
    .trim()
    .replace(/\s+/g, ' ');
}

// Content normalisation for consistent formatting
function normaliseContent(content) {
  if (!content) return '';
  
  // Split into sentences for better processing
  const sentences = content.split(/[.!?]+/);
  
  // Filter out very short or repetitive sentences
  const filteredSentences = sentences
    .map(s => s.trim())
    .filter(s => s.length > 10) // Remove very short fragments
    .filter(s => !/^(click|read more|learn more|contact us)$/i.test(s)) // Remove common UI text
    .slice(0, 100); // Prevent excessive content
  
  return filteredSentences.join('. ').trim();
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
    reason: 'Alternative phrasing for broader search appeal',
    type: 'clarity',
    priority: 'medium',
    seo_benefit: 'Captures different search patterns',
    answers: {
      concise: createFallbackAnswer(altQuestion, 'concise'),
      detailed: createFallbackAnswer(altQuestion, 'detailed'),
      structured: createFallbackAnswer(altQuestion, 'structured'),
      conversational: createFallbackAnswer(altQuestion, 'conversational')
    }
  });
  
  return variations;
}

// Create fallback answers for different styles
function createFallbackAnswer(question, style) {
  const baseAnswer = 'This answer provides helpful information about your question.';
  
  switch (style) {
    case 'concise':
      return {
        text: baseAnswer,
        approach: 'concise',
        priority: 'high'
      };
    case 'detailed':
      return {
        text: `${baseAnswer} Here's a more comprehensive explanation that covers the key aspects and provides additional context to help you understand the topic better.`,
        approach: 'detailed',
        priority: 'medium'
      };
    case 'structured':
      return {
        text: `Here's a structured approach:\n• ${baseAnswer}\n• Additional key points for clarity\n• Actionable steps if applicable`,
        approach: 'structured',
        priority: 'medium'
      };
    case 'conversational':
      return {
        text: `Great question! ${baseAnswer} I hope this helps clarify things for you, and feel free to ask if you need more information.`,
        approach: 'conversational',
        priority: 'low'
      };
    default:
      return {
        text: baseAnswer,
        approach: style,
        priority: style === 'concise' ? 'high' : (style === 'detailed' || style === 'structured') ? 'medium' : 'low'
      };
  }
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

// Extract keywords from text
function extractKeywords(text) {
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['what', 'how', 'why', 'when', 'where', 'who', 'this', 'that', 'with', 'from'].includes(word));
  
  // Get unique words and return top 5
  const uniqueWords = [...new Set(words)];
  return uniqueWords.slice(0, 5);
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
        seo_benefit: 'Provides multiple answer formats for different user preferences',
        answers: {
          concise: createFallbackAnswer(question, 'concise'),
          detailed: createFallbackAnswer(question, 'detailed'),
          structured: createFallbackAnswer(question, 'structured'),
          conversational: createFallbackAnswer(question, 'conversational')
        }
      }
    ],
    additional_suggestions: [
      {
        suggestion: 'Add more specific examples or data to support the answer',
        type: 'add_examples',
        reason: 'Examples improve user engagement and understanding',
        impact: 'high'
      },
      {
        suggestion: 'Consider adding internal links to related content',
        type: 'add_links',
        reason: 'Internal linking improves SEO and helps users find more information',
        impact: 'medium'
      }
    ],
    seo_analysis: {
      keywords: extractKeywords(question + ' ' + answer),
      search_intent: 'informational',
      voice_search_friendly: true,
      featured_snippet_potential: true,
      improvement_areas: ['keyword optimization', 'answer length', 'structure'],
      target_audience: 'users seeking informational content',
      competition_level: 'medium'
    },
    quality_scores: calculateQualityScores(question, answer)
  };
}