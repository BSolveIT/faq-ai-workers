import { parse } from 'node-html-parser';
import { createRateLimiter } from '../../enhanced-rate-limiting/rate-limiter.js';

/**
 * Enhanced FAQ Schema Extraction Proxy Worker with Enhanced Rate Limiting
 * - Handles nested schemas, comments, multiple formats
 * - Processes images with verification
 * - Robust HTML sanitization
 * - Comprehensive metadata and warnings
 * - Enhanced IP-based rate limiting with violation tracking and progressive penalties
 * - EXTENSIVE DEBUG LOGGING
 * - Updated for modern ES modules format
 */

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

async function handleRequest(request, env, ctx) {
  // Extract origin/referer early for logging
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: cors });
  }

  // Health check endpoint
  if (request.method === 'GET') {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'faq-proxy-fetch',
        timestamp: new Date().toISOString(),
        version: '1.0.0-enhanced-rate-limiting',
        features: ['faq_extraction', 'schema_parsing', 'json_ld', 'microdata', 'rdfa', 'enhanced_rate_limiting', 'ip_management'],
        rate_limits: {
          hourly: 25,
          daily: 100,
          weekly: 500,
          monthly: 2000,
          per_request_timeout: '10s'
        },
        capabilities: [
          'multi_tier_rate_limiting',
          'ip_whitelist_blacklist',
          'violation_tracking',
          'progressive_penalties',
          'geographic_restrictions',
          'origin_validation'
        ]
      }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
  }

  // Security: Origin/Referer checking
  const allowedOrigins = [
    'https://365i.co.uk',
    'https://www.365i.co.uk',
    'https://staging.365i.co.uk',
    'http://localhost:3000',
    'http://localhost:8080',
    'https://dash.cloudflare.com' // Allow testing from Cloudflare dashboard
  ];
  
  // More flexible origin checking
  if (origin || referer) {
    const checkOrigin = origin || referer;
    const isAllowed = allowedOrigins.some(allowed => {
      return checkOrigin.startsWith(allowed) ||
        checkOrigin.startsWith(allowed.replace('www.', '')) ||
        checkOrigin.startsWith(allowed.replace('://', '://www.'));
    });
    
    if (!isAllowed) {
      console.log(`Request from origin: ${origin}, referer: ${referer}`);
      console.log(`Blocked request from unauthorized origin: ${checkOrigin}`);
      return new Response(JSON.stringify({
        error: 'Unauthorized origin',
        success: false,
        debug: {
          origin: origin,
          referer: referer,
          checkedAgainst: checkOrigin
        },
        metadata: {
          warning: "This service is for FAQ extraction only. Abuse will result in blocking.",
          terms: "By using this service, you agree not to violate any website's terms of service."
        }
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
  }

  // ENHANCED RATE LIMITING - Check before processing request
  const clientIP = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                   request.headers.get('X-Real-IP') ||
                   'unknown';

  console.log(`Processing FAQ extraction request from IP: ${clientIP}`);

  // Initialize enhanced rate limiter with worker-specific config for scraping protection
  const rateLimiter = createRateLimiter(env, 'faq-proxy-fetch', {
    limits: {
      hourly: 25,    // 25 URL extractions per hour (prevent rapid scraping)
      daily: 100,    // 100 URL extractions per day (maintain current limit)
      weekly: 500,   // 500 URL extractions per week
      monthly: 2000  // 2000 URL extractions per month
    },
    violations: {
      soft_threshold: 2,    // Warning after 2 violations (stricter for scraping protection)
      hard_threshold: 4,    // Block after 4 violations
      ban_threshold: 8      // Permanent ban after 8 violations
    }
  });

  // Check rate limiting BEFORE processing request
  const rateLimitResult = await rateLimiter.checkRateLimit(clientIP, request, 'faq-proxy-fetch');
  
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
        errorMessage = 'FAQ extraction rate limit exceeded. Please try again later';
        break;
    }

    return new Response(JSON.stringify({
      rateLimited: true,
      error: errorMessage,
      message: 'FAQ extraction requests are rate limited to prevent abuse and scraping',
      success: false,
      reason: rateLimitResult.reason,
      usage: rateLimitResult.usage,
      limits: rateLimitResult.limits,
      reset_times: rateLimitResult.reset_times,
      block_expires: rateLimitResult.block_expires,
      remaining_time: rateLimitResult.remaining_time,
      metadata: {
        warning: "This service is for FAQ extraction only. Abuse will result in blocking.",
        terms: "By using this service, you agree not to violate any website's terms of service."
      }
    }), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': rateLimitResult.limits?.daily?.toString() || '100',
        'X-RateLimit-Remaining': (rateLimitResult.limits?.daily - rateLimitResult.usage?.daily)?.toString() || '0',
        'X-RateLimit-Reset': rateLimitResult.reset_times?.daily?.toString() || '',
        ...cors
      },
    });
  }

  console.log(`Processing FAQ extraction request. Usage: ${JSON.stringify(rateLimitResult.usage)}`);
  
  // Add rate limit headers to response for successful requests
  cors['X-RateLimit-Limit'] = rateLimitResult.limits?.daily?.toString() || '100';
  cors['X-RateLimit-Remaining'] = Math.max(0, (rateLimitResult.limits?.daily || 100) - (rateLimitResult.usage?.daily || 0)).toString();
  cors['X-RateLimit-Reset'] = rateLimitResult.reset_times?.daily?.toString() || '';

  const url = new URL(request.url).searchParams.get('url');
  if (!url) {
    return new Response(JSON.stringify({ 
      error: 'URL parameter required', 
      success: false 
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  try {
    const targetUrl = new URL(url);
    
    // Security: Block internal/private IPs and localhost
    const hostname = targetUrl.hostname;
    
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /\.local$/i,
      /^0\.0\.0\.0$/
    ];
    
    if (blockedPatterns.some(pattern => pattern.test(hostname))) {
      console.log(`Blocked request to internal/private URL: ${hostname}`);
      return new Response(JSON.stringify({ 
        error: 'Internal/private URLs not allowed', 
        success: false,
        metadata: {
          warning: "This service cannot access internal or private network addresses.",
          terms: "By using this service, you agree not to violate any website's terms of service."
        }
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
    
    const requestOrigin = origin || referer || 'unknown origin';
    console.log(`FAQ extraction requested: ${url} from ${requestOrigin} at ${new Date().toISOString()}`);
    
    // Add cache buster
    targetUrl.searchParams.append('_cb', Date.now());
    
    // Fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Cache-Control': 'no-cache',
      },
      cf: { cacheTtl: 0, cacheEverything: false },
    }).catch(err => {
      if (err.name === 'AbortError') {
        console.error(`Request timeout for ${url} after 10 seconds`);
        throw new Error('Request timeout - target site took too long to respond');
      }
      throw err;
    });
    
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      return new Response(JSON.stringify({ 
        error: `Fetch failed: ${resp.status}`, 
        success: false 
      }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
    
    const ct = resp.headers.get('Content-Type') || '';
    if (!ct.includes('text/html')) {
      return new Response(JSON.stringify({ 
        error: 'Not HTML', 
        success: false 
      }), {
        status: 415,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
    
    const html = await resp.text();
    
    // Check HTML size limit (5MB)
    if (html.length > 5 * 1024 * 1024) {
      return new Response(JSON.stringify({ 
        error: 'HTML too large (>5MB)', 
        success: false 
      }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }
    
    // Parse HTML - FIXED: Set script: true to enable script content parsing
    const root = parse(html, {
      lowerCaseTagName: false,
      comment: false,
      blockTextElements: {
        script: true,  // CHANGED FROM false TO true - This enables script content parsing!
        noscript: false,
        style: false,
      }
    });
    
    const title = root.querySelector('title')?.text || '';
    let allFaqs = [];
    const schemaTypesFound = [];
    const warnings = [];
    const processing = {
      questionsWithHtmlStripped: 0,
      answersWithHtmlSanitized: 0,
      truncatedAnswers: 0,
      imagesProcessed: 0,
      brokenImages: 0,
      unverifiedImages: 0,
      relativeUrlsFixed: 0,
      dataUrisRejected: 0
    };
    
    console.log('=== Starting FAQ extraction ===');
    
    // 1) Try Enhanced JSON-LD
    try {
      console.log('Attempting JSON-LD extraction...');
      const { faqs, metadata } = await extractEnhancedJsonLd(root, targetUrl.href, processing);
      console.log(`JSON-LD extraction complete. Found ${faqs.length} FAQs`);
      if (faqs.length > 0) {
        allFaqs = allFaqs.concat(faqs);
        schemaTypesFound.push('JSON-LD');
        if (metadata.warnings) warnings.push(...metadata.warnings);
      }
    } catch (e) {
      console.error('Enhanced JSON-LD extraction failed:', e);
    }
    
    // 2) Try Enhanced Microdata
    try {
      console.log('Attempting Microdata extraction...');
      const { faqs, metadata } = await extractEnhancedMicrodata(root, targetUrl.href, processing);
      console.log(`Microdata extraction complete. Found ${faqs.length} FAQs`);
      if (faqs.length > 0) {
        allFaqs = allFaqs.concat(faqs);
        schemaTypesFound.push('Microdata');
        if (metadata.warnings) warnings.push(...metadata.warnings);
      }
    } catch (e) {
      console.error('Enhanced Microdata extraction failed:', e);
    }
    
    // 3) Try Enhanced RDFa
    try {
      console.log('Attempting RDFa extraction...');
      const { faqs, metadata } = await extractEnhancedRdfa(root, targetUrl.href, processing);
      console.log(`RDFa extraction complete. Found ${faqs.length} FAQs`);
      if (faqs.length > 0) {
        allFaqs = allFaqs.concat(faqs);
        schemaTypesFound.push('RDFa');
        if (metadata.warnings) warnings.push(...metadata.warnings);
      }
    } catch (e) {
      console.error('Enhanced RDFa extraction failed:', e);
    }
    
    console.log(`Total FAQs before deduplication: ${allFaqs.length}`);
    
    // Deduplicate and limit
    allFaqs = dedupeEnhanced(allFaqs);
    
    console.log(`Total FAQs after deduplication: ${allFaqs.length}`);
    
    // Limit to 50 FAQs
    if (allFaqs.length > 50) {
      allFaqs = allFaqs.slice(0, 50);
      warnings.push('Limited to first 50 FAQs (found ' + allFaqs.length + ')');
    }
    
    // Build warnings from processing stats
    if (processing.questionsWithHtmlStripped > 0) {
      warnings.push(`${processing.questionsWithHtmlStripped} questions had HTML markup removed`);
    }
    if (processing.truncatedAnswers > 0) {
      warnings.push(`${processing.truncatedAnswers} answers were truncated to 5000 characters`);
    }
    if (processing.brokenImages > 0) {
      warnings.push(`${processing.brokenImages} images were unreachable`);
    }
    if (processing.unverifiedImages > 0) {
      warnings.push(`${processing.unverifiedImages} images could not be verified`);
    }
    if (processing.dataUrisRejected > 0) {
      warnings.push(`${processing.dataUrisRejected} embedded images were too large`);
    }
    
    if (allFaqs.length > 0) {
      console.log(`Successfully extracted ${allFaqs.length} FAQs from ${url}`);
      console.log('First FAQ:', JSON.stringify(allFaqs[0], null, 2));
      
      // Record successful usage AFTER processing request
      await rateLimiter.updateUsageCount(clientIP, 'faq-proxy-fetch');
      console.log(`Enhanced rate limit updated after successful FAQ extraction`);
      
      return new Response(JSON.stringify({
        success: true,
        source: url,
        faqs: allFaqs,
        metadata: {
          extractionMethod: 'enhanced-html-parser',
          totalExtracted: allFaqs.length,
          title: title,
          processing: processing,
          warnings: warnings,
          schemaTypes: schemaTypesFound,
          hasImages: processing.imagesProcessed > 0,
          imageCount: processing.imagesProcessed,
          brokenImages: processing.brokenImages,
          terms: "By using this service, you agree not to violate any website's terms of service."
        },
        rate_limiting: {
          usage: rateLimitResult.usage,
          limits: rateLimitResult.limits,
          reset_times: rateLimitResult.reset_times,
          worker: 'faq-proxy-fetch',
          enhanced: true,
          check_duration: rateLimitResult.duration
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...cors }
      });
    }
    
    // Check if markup exists
    const hasFaqMarkup = html.includes('schema.org/FAQPage') || 
                         html.includes('typeof="FAQPage"') ||
                         html.includes('"@type":"FAQPage"');
    
    if (hasFaqMarkup) {
      console.warn(`FAQ markup detected but extraction failed for ${url}`);
      return new Response(JSON.stringify({
        success: false,
        source: url,
        error: "Page contains FAQ markup but extraction failed. The structure might be non-standard.",
        metadata: {
          title: title,
          extractionMethod: "failed",
          warnings: ["FAQ schema detected but could not be parsed"],
          terms: "By using this service, you agree not to violate any website's terms of service."
        }
      }), {
        headers: { 'Content-Type': 'application/json', ...cors }
      });
    }
    
    // No FAQs found
    console.log(`No FAQ markup found on ${url}`);
    return new Response(JSON.stringify({
      success: false,
      source: url,
      faqs: [],
      metadata: { 
        extractionMethod: 'none', 
        title: title,
        message: "No FAQ schema markup found on this page",
        warnings: [],
        terms: "By using this service, you agree not to violate any website's terms of service."
      }
    }), { 
      headers: { 'Content-Type': 'application/json', ...cors } 
    });
    
  } catch (err) {
    console.error(`Worker error for URL ${url} from ${origin || referer || 'unknown origin'}: ${err.message}`, err.stack);
    return new Response(JSON.stringify({ 
      error: err.message || 'Internal error', 
      success: false,
      metadata: {
        warning: "This service is for FAQ extraction only. Abuse will result in blocking.",
        terms: "By using this service, you agree not to violate any website's terms of service."
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}

// Enhanced JSON-LD extraction with preprocessing - FIXED to use correct properties
async function extractEnhancedJsonLd(root, baseUrl, processing) {
  const faqs = [];
  const warnings = [];
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  
  console.log(`[JSON-LD] Found ${scripts.length} JSON-LD scripts`);
  
  for (let scriptIndex = 0; scriptIndex < scripts.length; scriptIndex++) {
    const script = scripts[scriptIndex];
    console.log(`[JSON-LD] Processing script ${scriptIndex + 1}/${scripts.length}`);
    
    try {
      // FIXED: Use the correct properties based on node-html-parser documentation
      // textContent is preferred, innerHTML also works, rawText is the raw version
      // Do NOT use .text as it returns outerHTML!
      let content = script.textContent || script.innerHTML || script.rawText || '';
      
      content = content.trim();
      console.log(`[JSON-LD] Script content length: ${content.length} characters`);
      
      if (content.length > 0) {
        console.log(`[JSON-LD] First 200 chars: ${content.substring(0, 200)}...`);
      } else {
        console.log('[JSON-LD] Script has no content, skipping');
        continue;
      }
      
      let data;
      
      // First, try to parse without any preprocessing (for valid escaped JSON)
      try {
        data = JSON.parse(content);
        console.log('[JSON-LD] Successfully parsed JSON-LD without preprocessing');
      } catch (initialError) {
        // Only preprocess if the initial parse fails
        console.log('[JSON-LD] Initial JSON parse failed:', initialError.message);
        console.log('[JSON-LD] Applying preprocessing...');
        
        // Preprocess to handle comments and common issues
        content = content
          // Only match // at the very beginning of a line (not escaped \/)
          .replace(/^(\s*)\/\/(?!\/).*$/gm, '')
          // Remove /* */ comments
          .replace(/\/\*[\s\S]*?\*\//g, '')
          // Remove control characters (but preserve valid Unicode like \u2019)
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          // Remove trailing commas
          .replace(/,(\s*[}\]])/g, '$1')
          // Remove any BOM characters
          .replace(/^\uFEFF/, '')
          .trim();
        
        // Try parsing again after preprocessing
        try {
          data = JSON.parse(content);
          console.log('[JSON-LD] Successfully parsed after preprocessing');
        } catch (preprocessError) {
          console.warn('[JSON-LD] Failed to parse JSON-LD even after preprocessing:', preprocessError.message);
          console.warn('[JSON-LD] Content sample:', content.substring(0, 200) + '...');
          continue; // Skip this script
        }
      }
      
      console.log('[JSON-LD] Parsed data type:', data['@type']);
      
      // Process the parsed data
      const arr = Array.isArray(data) ? data : [data];
      console.log(`[JSON-LD] Processing ${arr.length} objects`);
      
      for (let objIndex = 0; objIndex < arr.length; objIndex++) {
        const obj = arr[objIndex];
        console.log(`[JSON-LD] Processing object ${objIndex + 1}/${arr.length} with type: ${obj['@type']}`);
        await traverseEnhancedLd(obj, faqs, baseUrl, processing);
      }
      
      console.log(`[JSON-LD] After processing script ${scriptIndex + 1}, total FAQs: ${faqs.length}`);
      
    } catch (e) {
      console.error('[JSON-LD] Unexpected error in JSON-LD extraction:', e.message);
      warnings.push(`Failed to process JSON-LD: ${e.message}`);
    }
  }
  
  console.log(`[JSON-LD] Total FAQs extracted: ${faqs.length}`);
  return { faqs, metadata: { warnings } };
}

// Enhanced traversal for complex JSON-LD structures
async function traverseEnhancedLd(obj, out, baseUrl, processing, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) {
    console.log(`[Traverse] Skipping at depth ${depth} - obj null or too deep`);
    return;
  }
  
  const type = obj['@type'];
  console.log(`[Traverse] Depth ${depth}, type: ${type}`);
  
  // Check if this is or contains FAQPage
  if ((Array.isArray(type) ? type.includes('FAQPage') : type === 'FAQPage') ||
      (obj.mainEntity && obj.mainEntity['@type'] === 'FAQPage')) {
    
    console.log('[Traverse] Found FAQPage!');
    
    // Find the FAQ content
    let faqContent = obj;
    if (obj.mainEntity && obj.mainEntity['@type'] === 'FAQPage') {
      faqContent = obj.mainEntity;
      console.log('[Traverse] FAQPage is in mainEntity');
    }
    
    let mainEntity = faqContent.mainEntity || faqContent['mainEntity'] || faqContent.hasPart;
    if (mainEntity) {
      mainEntity = Array.isArray(mainEntity) ? mainEntity : [mainEntity];
      console.log(`[Traverse] Found ${mainEntity.length} items in mainEntity`);
      
      for (let qIndex = 0; qIndex < mainEntity.length; qIndex++) {
        const q = mainEntity[qIndex];
        console.log(`[Traverse] Processing question ${qIndex + 1}/${mainEntity.length}`);
        console.log(`[Traverse] Question type: ${q['@type']}`);
        
        if (!q['@type'] || !q['@type'].includes('Question')) {
          console.log('[Traverse] Skipping - not a Question type');
          continue;
        }
        
        // Process question
        const rawQuestion = q.name || q.question || '';
        console.log(`[Traverse] Raw question: "${rawQuestion}"`);
        
        const processedQuestion = processQuestion(rawQuestion, processing);
        console.log(`[Traverse] Processed question: "${processedQuestion}"`);
        
        if (!processedQuestion) {
          console.log('[Traverse] Question processing returned empty, skipping');
          continue;
        }
        
        // Extract answer - try multiple properties
        let rawAnswer = '';
        const accepted = q.acceptedAnswer;
        const suggested = q.suggestedAnswer;
        
        if (accepted) {
          rawAnswer = typeof accepted === 'string' ? accepted : 
                     (accepted.text || accepted.answerText || accepted.description || '');
          console.log(`[Traverse] Found acceptedAnswer, length: ${rawAnswer.length}`);
        } else if (suggested && suggested.length > 0) {
          const firstSuggested = suggested[0];
          rawAnswer = typeof firstSuggested === 'string' ? firstSuggested :
                     (firstSuggested.text || firstSuggested.answerText || '');
          console.log(`[Traverse] Found suggestedAnswer, length: ${rawAnswer.length}`);
        }
        
        if (!rawAnswer) {
          console.log('[Traverse] No answer found, skipping');
          continue;
        }
        
        // Process answer with sanitization and image handling
        const processedAnswer = await processAnswer(rawAnswer, baseUrl, processing);
        console.log(`[Traverse] Processed answer length: ${processedAnswer.length}`);
        
        // Extract ID/anchor
        let id = q['@id'] || q.id || q.url || null;
        if (id && id.includes('#')) {
          id = id.split('#').pop();
        }
        if (id) {
          id = sanitizeAnchor(id);
        }
        console.log(`[Traverse] FAQ ID: ${id || 'none'}`);
        
        out.push({ 
          question: processedQuestion,
          answer: processedAnswer,
          id: id
        });
        console.log(`[Traverse] Added FAQ. Total count: ${out.length}`);
      }
    } else {
      console.log('[Traverse] No mainEntity found in FAQPage');
    }
  }
  
  // Traverse nested structures
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    console.log(`[Traverse] Found @graph with ${obj['@graph'].length} items`);
    for (const item of obj['@graph']) {
      await traverseEnhancedLd(item, out, baseUrl, processing, depth + 1);
    }
  }
  
  // Check for nested WebPage > mainEntity patterns
  if (obj.mainEntity && depth < 3) {
    console.log('[Traverse] Found mainEntity, traversing deeper');
    await traverseEnhancedLd(obj.mainEntity, out, baseUrl, processing, depth + 1);
  }
}

// Enhanced Microdata extraction
async function extractEnhancedMicrodata(root, baseUrl, processing) {
  const faqs = [];
  const warnings = [];
  
  console.log('[Microdata] Starting extraction');
  
  // First try FAQPage containers
  const faqPages = root.querySelectorAll('[itemscope][itemtype*="FAQPage"]');
  console.log(`[Microdata] Found ${faqPages.length} FAQPage containers`);
  
  for (const faqPage of faqPages) {
    const questions = faqPage.querySelectorAll('[itemscope][itemtype*="Question"]');
    console.log(`[Microdata] Found ${questions.length} questions in FAQPage`);
    for (const q of questions) {
      await processMicrodataQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  // Also try standalone Questions (but simpler approach)
  const allQuestions = root.querySelectorAll('[itemscope][itemtype*="Question"]');
  console.log(`[Microdata] Found ${allQuestions.length} total Question elements`);
  
  const processedIds = new Set(faqs.map(f => f.id).filter(Boolean));
  
  for (const q of allQuestions) {
    const id = q.getAttribute('id') || q.getAttribute('itemid')?.split('#').pop();
    if (!processedIds.has(id)) {
      await processMicrodataQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  console.log(`[Microdata] Total FAQs extracted: ${faqs.length}`);
  return { faqs, metadata: { warnings } };
}

async function processMicrodataQuestion(questionEl, faqs, baseUrl, processing) {
  console.log('[Microdata] Processing question element');
  
  // Get ID
  const id = sanitizeAnchor(
    questionEl.getAttribute('id') || 
    questionEl.getAttribute('itemid')?.split('#').pop() || 
    null
  );
  console.log(`[Microdata] Question ID: ${id || 'none'}`);
  
  // Get question text - FIXED to use textContent instead of .text
  let rawQuestion = '';
  const nameEl = questionEl.querySelector('[itemprop="name"]');
  if (nameEl) {
    // Use textContent or innerText, NOT .text (which returns outerHTML)
    rawQuestion = nameEl.textContent || nameEl.innerText || nameEl.getAttribute('content') || '';
    console.log(`[Microdata] Found question name: "${rawQuestion}"`);
  }
  
  const processedQuestion = processQuestion(rawQuestion, processing);
  if (!processedQuestion) {
    console.log('[Microdata] No question text found, skipping');
    return;
  }
  
  // Get answer - try multiple approaches
  let rawAnswer = '';
  
  // Direct text property
  const directTextEl = questionEl.querySelector('[itemprop="text"]');
  if (directTextEl) {
    rawAnswer = directTextEl.innerHTML;
    console.log(`[Microdata] Found direct answer text, length: ${rawAnswer.length}`);
  } else {
    // Inside acceptedAnswer
    const acceptedAnswerEl = questionEl.querySelector('[itemprop="acceptedAnswer"]');
    if (acceptedAnswerEl) {
      const textEl = acceptedAnswerEl.querySelector('[itemprop="text"]');
      if (textEl) {
        rawAnswer = textEl.innerHTML;
        console.log(`[Microdata] Found answer in acceptedAnswer/text, length: ${rawAnswer.length}`);
      } else {
        // Sometimes the acceptedAnswer itself contains the text
        rawAnswer = acceptedAnswerEl.innerHTML;
        console.log(`[Microdata] Using acceptedAnswer innerHTML, length: ${rawAnswer.length}`);
      }
    }
  }
  
  if (!rawAnswer) {
    // Try suggestedAnswer as fallback
    const suggestedEl = questionEl.querySelector('[itemprop="suggestedAnswer"] [itemprop="text"]');
    if (suggestedEl) {
      rawAnswer = suggestedEl.innerHTML;
      console.log(`[Microdata] Found answer in suggestedAnswer, length: ${rawAnswer.length}`);
    }
  }
  
  if (!rawAnswer) {
    console.log('[Microdata] No answer found, skipping');
    return;
  }
  
  const processedAnswer = await processAnswer(rawAnswer, baseUrl, processing);
  
  faqs.push({
    question: processedQuestion,
    answer: processedAnswer,
    id: id
  });
  console.log(`[Microdata] Added FAQ. Total count: ${faqs.length}`);
}

// Enhanced RDFa extraction
async function extractEnhancedRdfa(root, baseUrl, processing) {
  const faqs = [];
  const warnings = [];
  
  console.log('[RDFa] Starting extraction');
  
  // Try FAQPage containers first
  const faqPages = root.querySelectorAll('[typeof*="FAQPage"], [typeof*="https://schema.org/FAQPage"]');
  console.log(`[RDFa] Found ${faqPages.length} FAQPage containers`);
  
  for (const faqPage of faqPages) {
    const questions = faqPage.querySelectorAll('[typeof*="Question"]');
    console.log(`[RDFa] Found ${questions.length} questions in FAQPage`);
    for (const q of questions) {
      await processRdfaQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  // Also try standalone Questions (simpler approach)
  const allQuestions = root.querySelectorAll('[typeof*="Question"]');
  console.log(`[RDFa] Found ${allQuestions.length} total Question elements`);
  
  const processedIds = new Set(faqs.map(f => f.id).filter(Boolean));
  
  for (const q of allQuestions) {
    const id = q.getAttribute('id') || q.getAttribute('resource')?.split('#').pop();
    if (!processedIds.has(id)) {
      await processRdfaQuestion(q, faqs, baseUrl, processing);
    }
  }
  
  console.log(`[RDFa] Total FAQs extracted: ${faqs.length}`);
  return { faqs, metadata: { warnings } };
}

async function processRdfaQuestion(questionEl, faqs, baseUrl, processing) {
  console.log('[RDFa] Processing question element');
  
  // Get ID
  const id = sanitizeAnchor(
    questionEl.getAttribute('id') || 
    questionEl.getAttribute('resource')?.split('#').pop() ||
    questionEl.getAttribute('about')?.split('#').pop() ||
    null
  );
  console.log(`[RDFa] Question ID: ${id || 'none'}`);
  
  // Get question text - FIXED to use textContent instead of .text
  const nameEl = questionEl.querySelector('[property="name"], [property="schema:name"]');
  if (!nameEl) {
    console.log('[RDFa] No name element found');
    return;
  }
  
  // Use textContent or innerText, NOT .text (which returns outerHTML)
  const rawQuestion = nameEl.textContent || nameEl.innerText || nameEl.getAttribute('content') || '';
  console.log(`[RDFa] Found question: "${rawQuestion}"`);
  
  const processedQuestion = processQuestion(rawQuestion, processing);
  if (!processedQuestion) {
    console.log('[RDFa] Question processing returned empty');
    return;
  }
  
  // Get answer - try multiple selectors
  let rawAnswer = '';
  const textEl = questionEl.querySelector('[property="text"], [property="schema:text"], [property="acceptedAnswer"] [property="text"]');
  if (textEl) {
    rawAnswer = textEl.innerHTML;
    console.log(`[RDFa] Found answer, length: ${rawAnswer.length}`);
  }
  
  if (!rawAnswer) {
    console.log('[RDFa] No answer found');
    return;
  }
  
  const processedAnswer = await processAnswer(rawAnswer, baseUrl, processing);
  
  faqs.push({
    question: processedQuestion,
    answer: processedAnswer,
    id: id
  });
  console.log(`[RDFa] Added FAQ. Total count: ${faqs.length}`);
}

// Process question text
function processQuestion(raw, processing) {
  console.log(`[ProcessQ] Input: "${raw}"`);
  
  if (!raw) {
    console.log('[ProcessQ] Empty input');
    return '';
  }
  
  // Decode HTML entities
  raw = decodeHtmlEntities(raw);
  console.log(`[ProcessQ] After decode: "${raw}"`);
  
  // Check if contains HTML
  if (/<[^>]+>/.test(raw)) {
    processing.questionsWithHtmlStripped++;
    console.log('[ProcessQ] Contains HTML, will strip');
  }
  
  // Strip all HTML tags
  raw = raw.replace(/<[^>]+>/g, '');
  
  // Normalize whitespace
  raw = raw.replace(/\s+/g, ' ').trim();
  console.log(`[ProcessQ] After cleanup: "${raw}"`);
  
  // Limit length
  if (raw.length > 300) {
    // Try to cut at word boundary
    raw = raw.substring(0, 300);
    const lastSpace = raw.lastIndexOf(' ');
    if (lastSpace > 250) {
      raw = raw.substring(0, lastSpace) + '...';
    }
    console.log(`[ProcessQ] Truncated to: "${raw}"`);
  }
  
  console.log(`[ProcessQ] Final output: "${raw}"`);
  return raw;
}

// Process answer with sanitization and image handling (simplified for Workers)
async function processAnswer(raw, baseUrl, processing) {
  console.log(`[ProcessA] Input length: ${raw.length}`);
  
  if (!raw) {
    console.log('[ProcessA] Empty input');
    return '';
  }
  
  processing.answersWithHtmlSanitized++;
  
  // First decode entities
  raw = decodeHtmlEntities(raw);
  console.log(`[ProcessA] After decode length: ${raw.length}`);
  
  // Parse the HTML string
  const tempRoot = parse(raw);
  
  // Remove dangerous elements
  const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'];
  dangerousTags.forEach(tag => {
    const elements = tempRoot.querySelectorAll(tag);
    elements.forEach(el => el.remove());
  });
  
  // Remove event handlers by rebuilding clean HTML
  const allElements = tempRoot.querySelectorAll('*');
  allElements.forEach(el => {
    // Get all attributes
    const attrs = el.attributes;
    Object.keys(attrs).forEach(attrName => {
      if (attrName.startsWith('on') || attrs[attrName].includes('javascript:')) {
        el.removeAttribute(attrName);
      }
    });
  });
  
  // Process links - make relative URLs absolute
  const links = tempRoot.querySelectorAll('a');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
      try {
        const absolute = new URL(href, baseUrl).href;
        link.setAttribute('href', absolute);
        processing.relativeUrlsFixed++;
      } catch (e) {
        // Invalid URL, remove href
        link.removeAttribute('href');
      }
    }
  });
  
  // Process images
  const images = tempRoot.querySelectorAll('img');
  processing.imagesProcessed += images.length;
  console.log(`[ProcessA] Found ${images.length} images`);
  
  for (const img of images) {
    let src = img.getAttribute('src');
    
    if (!src) {
      img.remove();
      continue;
    }
    
    // Handle data URIs
    if (src.startsWith('data:')) {
      if (src.length > 100000) { // 100KB limit
        img.setAttribute('src', '#');
        img.setAttribute('alt', img.getAttribute('alt') || 'Image too large to display');
        img.setAttribute('data-error', 'embedded-image-too-large');
        processing.dataUrisRejected++;
        processing.brokenImages++;
      }
      continue;
    }
    
    // Fix relative URLs
    if (!src.startsWith('http')) {
      try {
        // Handle protocol-relative URLs
        if (src.startsWith('//')) {
          src = 'https:' + src;
        } else {
          src = new URL(src, baseUrl).href;
        }
        img.setAttribute('src', src);
        processing.relativeUrlsFixed++;
      } catch (e) {
        img.setAttribute('data-broken', 'true');
        img.setAttribute('alt', img.getAttribute('alt') || 'Image unavailable');
        processing.brokenImages++;
        continue;
      }
    }
    
    // Add lazy loading
    img.setAttribute('loading', 'lazy');
    
    // Add alt text if missing
    if (!img.getAttribute('alt')) {
      img.setAttribute('alt', 'FAQ image');
    }
    
    // Mark all images as unverified in Workers environment
    img.setAttribute('data-verified', 'unverified');
    processing.unverifiedImages++;
  }
  
  // Clean up empty paragraphs
  const paragraphs = tempRoot.querySelectorAll('p');
  paragraphs.forEach(p => {
    if (!p.text.trim() && !p.querySelector('img')) {
      p.remove();
    }
  });
  
  // Get cleaned HTML
  let cleaned = tempRoot.innerHTML;
  console.log(`[ProcessA] Cleaned HTML length: ${cleaned.length}`);
  
  // Final length check
  if (cleaned.length > 5000) {
    cleaned = cleaned.substring(0, 5000);
    // Try to close any open tags
    cleaned = cleaned.replace(/<[^>]*$/, '') + '... (truncated)';
    processing.truncatedAnswers++;
    console.log('[ProcessA] Answer truncated to 5000 chars');
  }
  
  console.log(`[ProcessA] Final output length: ${cleaned.length}`);
  return cleaned;
}

// Sanitize anchor/ID
function sanitizeAnchor(id) {
  if (!id) return null;
  
  // Remove any dangerous characters
  const sanitized = id
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
  
  console.log(`[Sanitize] Input: "${id}" Output: "${sanitized}"`);
  return sanitized;
}

// Decode HTML entities
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™'
  };
  
  return text.replace(/&[#a-zA-Z0-9]+;/g, (match) => entities[match] || match);
}

// Enhanced deduplication
function dedupeEnhanced(arr) {
  console.log(`[Dedupe] Input: ${arr.length} FAQs`);
  
  const seen = new Map();
  const MAX_FAQS = 50;
  
  const result = arr.filter((faq, index) => {
    if (index >= MAX_FAQS) {
      console.log(`[Dedupe] Skipping FAQ ${index + 1} - exceeds limit`);
      return false;
    }
    
    if (!faq.question || !faq.answer) {
      console.log(`[Dedupe] Skipping FAQ ${index + 1} - missing question or answer`);
      return false;
    }
    
    if (faq.question.includes('${') || faq.answer.includes('${')) {
      console.log(`[Dedupe] Skipping FAQ ${index + 1} - contains template variables`);
      return false;
    }
    
    // Create normalized key for comparison
    const key = faq.question.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`[Dedupe] FAQ ${index + 1} normalized key: "${key}"`);
    
    if (seen.has(key)) {
      // Keep the one with an ID if duplicate
      const existing = seen.get(key);
      if (!existing.id && faq.id) {
        console.log(`[Dedupe] Replacing duplicate without ID with one that has ID: ${faq.id}`);
        seen.set(key, faq);
      } else {
        console.log(`[Dedupe] Skipping duplicate FAQ`);
      }
      return false;
    }
    
    seen.set(key, faq);
    return true;
  });
  
  console.log(`[Dedupe] Output: ${result.length} FAQs`);
  return result;
}