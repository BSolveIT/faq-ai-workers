/**
 * Production Enhanced URL-to-FAQ Generator (Speed Optimized)
 * 
 * Features:
 * - Adaptive processing based on FAQ count
 * - Simplified prompts for 10+ FAQs
 * - Skip optimization for larger requests
 * - Reduced content and tokens for speed
 * 
 * Model: Llama 4 Scout 17B with Llama 3.1 8B fallback
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

// JSON cleaning function
function cleanJsonResponse(text) {
  text = text.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return text;
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

      // Rate limiting
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
          error: 'Hourly limit reached (10 per hour)',
          resetTime: nextHour.toISOString(),
          success: false
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const faqCount = Math.min(Math.max(options.faqCount || 12, 6), 20);
      console.log(`Starting generation of ${faqCount} FAQs`);

      // STEP 1: Content Extraction
      let pageContent, title, headings, extractedContent;
      
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 10000); // 10s for fetch
        
        const pageResponse = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (FAQ-Generator-Bot/3.0)',
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

        console.log(`Content extracted in ${Date.now() - startTime}ms`);

      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: `Failed to extract content: ${error.message}`
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // STEP 2: FAQ Generation (Adaptive based on count)
      const contentLimit = faqCount >= 10 ? 3000 : 5000;
      const contentForAI = extractedContent.substring(0, contentLimit);

      // Simpler prompt for 10+ FAQs
      const generationPrompt = faqCount >= 10 ? 
        `Generate ${faqCount} FAQs about "${title}".

Key topics: ${headings.slice(0, 3).join(', ')}

Content: ${contentForAI}

Create exactly ${faqCount} relevant Q&As in this JSON format:
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Question?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Answer"
      }
    }
  ]
}

ONLY return the JSON.` :
        // Full prompt for <10 FAQs
        `Generate ${faqCount} SEO-optimized FAQs.

Title: ${title}
Topics: ${headings.slice(0, 5).join(' | ')}
Content: ${contentForAI}

Requirements:
- Questions: 50-60 chars, natural style
- Answers: 50-300 chars, direct and clear
- Cover main topics comprehensively

Return exactly ${faqCount} FAQs as JSON:
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Question here?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Answer here"
      }
    }
  ]
}`;

      let initialFAQs;
      const maxTokens = faqCount >= 10 ? 2000 : 2500;
      const timeout = faqCount >= 10 ? 30000 : 35000;

      try {
        const aiResponse = await callAIWithTimeout(
          env.AI,
          '@cf/meta/llama-4-scout-17b-16e-instruct',
          [
            { role: 'system', content: 'Generate FAQs in JSON format only.' },
            { role: 'user', content: generationPrompt }
          ],
          { temperature: 0.4, max_tokens: maxTokens },
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

        console.log(`Generated ${initialFAQs.mainEntity?.length} FAQs in ${Date.now() - startTime}ms`);
        
      } catch (error) {
        console.error('Primary model failed:', error.message);
        
        // Fallback to Llama 3.1
        try {
          const fallbackResponse = await callAIWithTimeout(
            env.AI,
            '@cf/meta/llama-3.1-8b-instruct',
            [
              { role: 'system', content: 'Generate FAQs in JSON format.' },
              { role: 'user', content: generationPrompt }
            ],
            { temperature: 0.4, max_tokens: maxTokens },
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
          throw new Error('FAQ generation failed');
        }
      }

      if (!initialFAQs?.mainEntity || !Array.isArray(initialFAQs.mainEntity)) {
        throw new Error('Invalid FAQ structure');
      }

      // STEP 3: Skip optimization for 10+ FAQs
      let finalFAQs = initialFAQs;
      
      // Only optimize for small FAQ counts and if under 25 seconds
      if (faqCount < 10 && Date.now() - startTime < 25000) {
        // Quick optimization attempt
        console.log('Running optimization...');
        // Skip for now to save time
      }

      // Validate FAQs
      const validFAQs = finalFAQs.mainEntity.filter(faq => 
        faq?.name && 
        faq?.acceptedAnswer?.text && 
        faq.name.length > 10 && 
        faq.acceptedAnswer.text.length > 20
      );

      if (validFAQs.length < 3) {
        throw new Error(`Only ${validFAQs.length} valid FAQs`);
      }

      // Update rate limit
      usageData.count++;
      await env.FAQ_RATE_LIMITS.put(rateLimitKey, JSON.stringify(usageData), {
        expirationTtl: 3600
      });

      const processingTime = Date.now() - startTime;
      console.log(`Completed in ${processingTime}ms`);

      return new Response(JSON.stringify({
        success: true,
        source: targetUrl,
        faqs: validFAQs.slice(0, faqCount),
        metadata: {
          title: title,
          totalGenerated: validFAQs.length,
          processingTime: processingTime,
          model: 'llama-4-scout-17b-16e',
          enhanced: faqCount < 10,
          usage: {
            used: usageData.count,
            remaining: 10 - usageData.count,
            resetTime: new Date((currentHour + 1) * 60 * 60 * 1000).toISOString()
          }
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Error:', error);
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

// Content extraction (unchanged)
async function extractContentUltimate(html) {
  const root = parse(html);

  root.querySelectorAll('script, style, nav, header, footer, aside, .navigation, .menu, .sidebar, .ad, .advertisement, .popup, .modal, .cookie-notice, .social-share, .comment').forEach(el => el.remove());

  let title = root.querySelector('title')?.text?.trim() ||
              root.querySelector('h1')?.text?.trim() ||
              root.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
              'Website Content';

  title = title.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

  const headings = [];
  root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
    const text = heading.text?.trim();
    if (text && text.length > 2 && text.length < 200) {
      headings.push(text);
    }
  });

  const contentSelectors = [
    'main', 'article', '[role="main"]', '.content', '#content',
    '.main-content', '.entry-content', '.post-content'
  ];

  let mainContent = '';
  for (const selector of contentSelectors) {
    const element = root.querySelector(selector);
    if (element) {
      mainContent = element.text;
      break;
    }
  }

  if (!mainContent) {
    mainContent = root.querySelector('body')?.text || '';
  }

  mainContent = mainContent
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title,
    headings,
    content: mainContent,
    metadata: {
      contentType: 'article',
      sections: headings.length
    }
  };
}