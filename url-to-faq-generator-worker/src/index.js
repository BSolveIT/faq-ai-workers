/**
 * ULTIMATE URL-to-FAQ Generator - Fixed with Timeouts
 * 
 * Cost: £0.035 vs $15-20 per request (99.8% savings!)
 * AI: Llama 4 Scout 17B (Mixture of Experts - best available)
 * Parsing: node-html-parser (lightweight, fast, accurate)
 * Features: Enhanced 3-step process with timeout controls
 */

import { parse } from 'node-html-parser';

// Helper function for AI calls with timeout
async function callAIWithTimeout(aiBinding, model, messages, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await aiBinding.run(model, {
      messages,
      temperature: options.temperature || 0.4,
      max_tokens: options.max_tokens || 1024,
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

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        error: 'Method not allowed. Use POST with URL parameter.'
      }), { 
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      console.log('Starting ULTIMATE FAQ generation...');
      const startTime = Date.now();
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

      // Validate URL format
      try {
        const parsedUrl = new URL(targetUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch (error) {
        return new Response(JSON.stringify({
          error: 'Invalid URL format. Please provide a valid HTTP/HTTPS URL.',
          success: false
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Enhanced rate limiting (10/hour)
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const currentHour = Math.floor(Date.now() / (60 * 60 * 1000));
      const rateLimitKey = `url_faq:${clientIP}:${currentHour}`;
      
      let usageData = await env.FAQ_RATE_LIMITS.get(rateLimitKey, { type: 'json' });
      if (!usageData) {
        usageData = { count: 0, hour: currentHour };
      }

      if (usageData.count >= 10) {
        const nextHour = new Date((currentHour + 1) * 60 * 60 * 1000);
        return new Response(JSON.stringify({
          rateLimited: true,
          error: 'Hourly FAQ generation limit reached. You can generate up to 10 FAQ sets per hour.',
          resetTime: nextHour.toISOString(),
          success: false
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const faqCount = Math.min(Math.max(options.faqCount || 12, 6), 20);
      console.log(`Generating ${faqCount} FAQs for: ${targetUrl}`);

      // STEP 1: Enhanced content fetching and parsing WITH TIMEOUT
      console.log('Step 1: Enhanced content extraction...');
      let pageContent, title, headings, extractedContent, metadata;
      
      try {
        // Fetch with timeout
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
        
        const pageResponse = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FAQ-Generator-Bot/3.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          }
        });

        clearTimeout(fetchTimeout);

        if (!pageResponse.ok) {
          throw new Error(`HTTP ${pageResponse.status}: ${pageResponse.statusText}`);
        }

        pageContent = await pageResponse.text();
        console.log(`Content fetched: ${pageContent.length} characters`);

        // ULTIMATE content extraction with node-html-parser
        const extractionResult = await extractContentUltimate(pageContent);
        title = extractionResult.title;
        headings = extractionResult.headings;
        extractedContent = extractionResult.content;
        metadata = extractionResult.metadata;

        if (extractedContent.length < 500) {
          throw new Error('Insufficient content found for FAQ generation');
        }

        console.log(`Extraction complete: ${extractedContent.length} chars`);
      } catch (error) {
        console.error('Content extraction failed:', error);
        return new Response(JSON.stringify({
          success: false,
          error: `Failed to process URL: ${error.message}`
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // STEP 2: LLAMA 4 SCOUT Generation (SIMPLIFIED - NO CHUNKING)
      console.log('Step 2: Llama 4 Scout AI generation...');
      
      // Limit content to avoid chunking and multiple AI calls
      const contentForAI = extractedContent.substring(0, 6000);

      const enhancedPrompt = `Analyze this website and generate ${faqCount} comprehensive FAQs.

URL: ${targetUrl}
Title: ${title}
Main Topics: ${headings.slice(0, 5).join(' | ')}

Content:
${contentForAI}

Generate EXACTLY ${faqCount} FAQs in this Schema.org format:
{
  "@context": "https://schema.org",
  "@type": "FAQPage", 
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Your question here?",
      "acceptedAnswer": {
        "@type": "Answer", 
        "text": "Your comprehensive answer here"
      }
    }
  ]
}

Return ONLY the JSON object. Be specific and helpful.`;

      let generatedFAQs;
      try {
        const generationResponse = await callAIWithTimeout(
          env.AI,
          '@cf/meta/llama-4-scout-17b-16e-instruct',
          [
            {
              role: 'system',
              content: 'You are an expert FAQ generator. Create helpful FAQs in valid JSON format only.'
            },
            {
              role: 'user',
              content: enhancedPrompt
            }
          ],
          { temperature: 0.4, max_tokens: 3072 },
          30000 // 30 second timeout for generation
        );

        console.log('Llama 4 Scout generation completed');
        
        let responseText = typeof generationResponse.response === 'string' ? 
          generationResponse.response : 
          generationResponse.response?.text || JSON.stringify(generationResponse.response);

        // Enhanced JSON cleaning
        responseText = cleanJsonResponse(responseText);
        generatedFAQs = JSON.parse(responseText);

        if (!generatedFAQs.mainEntity || !Array.isArray(generatedFAQs.mainEntity)) {
          throw new Error('Invalid FAQ structure generated');
        }

        console.log(`Generated ${generatedFAQs.mainEntity.length} FAQs`);
      } catch (error) {
        console.error('FAQ generation failed:', error);
        return new Response(JSON.stringify({
          success: false,
          error: `FAQ generation failed: ${error.message}`
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // STEP 3: Quick validation
      const validFAQs = generatedFAQs.mainEntity.filter(faq => {
        return faq?.name && 
               faq?.acceptedAnswer?.text && 
               faq.name.length > 10 && 
               faq.acceptedAnswer.text.length > 50 &&
               faq.name.includes('?');
      });

      if (validFAQs.length < 3) {
        return new Response(JSON.stringify({
          success: false,
          error: `Generated only ${validFAQs.length} valid FAQs, minimum required is 3`
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const finalFAQs = validFAQs.slice(0, faqCount);

      // Update rate limit
      usageData.count++;
      await env.FAQ_RATE_LIMITS.put(rateLimitKey, JSON.stringify(usageData), {
        expirationTtl: 3600
      });

      // Calculate processing time
      const processingTime = Date.now() - startTime;
      console.log(`Total processing time: ${processingTime}ms`);

      // Enhanced response
      const response = {
        success: true,
        source: targetUrl,
        faqs: finalFAQs,
        metadata: {
          title: title,
          extractionMethod: 'ultimate-node-html-parser-llama4-scout',
          headings: headings.slice(0, 10),
          totalExtracted: finalFAQs.length,
          aiModel: 'Llama 4 Scout 17B',
          processingTime: processingTime,
          contentAnalysis: {
            originalLength: pageContent.length,
            extractedLength: extractedContent.length,
            sectionsFound: metadata.sections,
            contentType: metadata.contentType
          }
        },
        usage: {
          used: usageData.count,
          remaining: 15 - usageData.count,
          resetTime: (currentHour + 1) * 60 * 60 * 1000
        }
      };

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('ULTIMATE generator error:', error);
      return new Response(JSON.stringify({
        success: false,
        error: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// ULTIMATE content extraction with node-html-parser (UNCHANGED)
async function extractContentUltimate(html) {
  const root = parse(html);

  // Remove unwanted elements
  root.querySelectorAll('script, style, nav, header, footer, aside, .navigation, .menu, .sidebar, .ad, .advertisement, .popup, .modal, .cookie-notice, .social-share, .comment').forEach(el => el.remove());

  // Extract title with multiple fallbacks
  let title = root.querySelector('title')?.text?.trim() ||
              root.querySelector('h1')?.text?.trim() ||
              root.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
              root.querySelector('meta[name="title"]')?.getAttribute('content') ||
              'Website Content';

  // Clean title
  title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

  // Extract structured headings
  const headings = [];
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
    const text = heading.text?.trim();
    if (text && text.length > 2 && text.length < 200) {
      headings.push(text);
    }
  });

  // Analyze content type and structure
  let contentType = 'general';
  let sections = 0;

  if (root.querySelectorAll('article').length > 0) contentType = 'article';
  else if (root.querySelectorAll('.product, .service').length > 0) contentType = 'business';
  else if (root.querySelectorAll('main, .content').length > 0) contentType = 'website';

  // Extract content from prioritized selectors
  const contentSelectors = [
    'main', 'article', '[role="main"]', '.content', '.main-content',
    '.post-content', '.entry-content', '.page-content', 'section'
  ];

  let extractedContent = '';

  contentSelectors.forEach(selector => {
    root.querySelectorAll(selector).forEach(element => {
      sections++;
      const text = element.text?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 50) {
        extractedContent += text + ' ';
      }
    });
  });

  // Fallback to paragraph extraction if content is insufficient
  if (extractedContent.length < 1000) {
    root.querySelectorAll('p, div').forEach(element => {
      const text = element.text?.replace(/\s+/g, ' ').trim();
      if (text && text.length > 30 && text.length < 1000) {
        extractedContent += text + ' ';
      }
    });
  }

  // Extract list content
  root.querySelectorAll('ul, ol').forEach(list => {
    list.querySelectorAll('li').forEach(item => {
      const text = item.text?.trim();
      if (text && text.length > 10) {
        extractedContent += '• ' + text + ' ';
      }
    });
  });

  // Final content cleaning
  extractedContent = extractedContent
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s.,!?;:()\-'"€$£¥%]/g, '')
    .replace(/\b(click here|read more|learn more|view all|see more|continue reading|home|about|contact|privacy|terms|login|register)\b/gi, '')
    .trim();

  return {
    title: title,
    headings: headings.slice(0, 25),
    content: extractedContent,
    metadata: {
      contentType: contentType,
      sections: sections,
      originalLength: html.length,
      extractedLength: extractedContent.length
    }
  };
}

// Enhanced JSON response cleaning
function cleanJsonResponse(response) {
  let cleaned = response.trim();
  
  // Remove markdown formatting and common prefixes
  cleaned = cleaned
    .replace(/```json\s*/gi, '')
    .replace(/```\s*$/g, '')
    .replace(/^Here's the JSON.*?:\s*/gi, '')
    .replace(/^Here is the.*?:\s*/gi, '');
  
  // Find JSON boundaries
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }
  
  return cleaned;
}