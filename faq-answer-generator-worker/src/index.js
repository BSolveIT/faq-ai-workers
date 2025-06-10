// ULTIMATE FAQ ANSWER GENERATOR WORKER - Context Intelligence + Universal Preservation
// The most intelligent FAQ generation system ever built
// Features: Website context analysis + Universal content preservation + Enhanced prompting

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      // ULTIMATE REQUEST PARSING - Context Intelligence + Universal Preservation
      const { 
        question, 
        existingAnswer, 
        mode, 
        tone = 'professional',
        // Website Context Intelligence
        pageUrl = '',
        websiteContext = '',
        hasWebsiteContext = false,
        contextSummary = '',
        // Universal Preservation
        preservationInstructions = '',
        hasSpecificContent = false,
        preservationSummary = ''
      } = await request.json();

      if (!question) {
        return new Response(JSON.stringify({
          error: 'Question is required'
        }), { 
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Enhanced rate limiting
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const today = new Date().toISOString().split('T')[0];
      const rateLimitKey = `answer:${clientIP}:${today}`;
      
      let usageData = await env.FAQ_RATE_LIMITS?.get(rateLimitKey, { type: 'json' });
      if (!usageData) {
        usageData = { count: 0, date: today };
      }

      if (usageData.count >= 75) { // Increased limit for ultimate system
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        return new Response(JSON.stringify({
          rateLimited: true,
          error: 'Daily answer generation limit reached (75/day)',
          resetTime: tomorrow.getTime()
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // BUILD ULTIMATE INTELLIGENCE PROMPT
      const prompt = buildUltimateIntelligencePrompt(question, existingAnswer, mode, tone, {
        pageUrl,
        websiteContext,
        hasWebsiteContext,
        contextSummary,
        preservationInstructions,
        hasSpecificContent,
        preservationSummary
      });

      console.log('🚀 ULTIMATE AI Generation:', {
        hasContext: hasWebsiteContext,
        hasPreservation: hasSpecificContent,
        contextSummary,
        preservationSummary
      });

      // AI API call with ultimate intelligence
      const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
        messages: [
          { 
            role: 'system', 
            content: buildUltimateSystemPrompt(hasWebsiteContext, hasSpecificContent)
          },
          { 
            role: 'user', 
            content: prompt 
          }
        ],
        temperature: mode === 'expand' ? 0.15 : 0.25, // Lower temperature for maximum precision
        max_tokens: 1000 // Increased for richer responses
      });

      const result = processUltimateAIResponse(aiResponse.response || aiResponse, mode);

      // Enhanced result with intelligence metadata
      result.intelligence = {
        hasWebsiteContext,
        hasSpecificContent,
        contextSummary,
        preservationSummary,
        mode,
        timestamp: Date.now()
      };

      // Update usage count
      usageData.count += 1;
      await env.FAQ_RATE_LIMITS?.put(rateLimitKey, JSON.stringify(usageData), {
        expirationTtl: 86400
      });

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('Ultimate answer generation error:', error);
      return new Response(JSON.stringify({
        error: 'Answer generation failed. Please try again.'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// ULTIMATE SYSTEM PROMPT with adaptive intelligence
function buildUltimateSystemPrompt(hasWebsiteContext, hasSpecificContent) {
  let systemPrompt = `You are the ULTIMATE FAQ content assistant - the most intelligent FAQ generation system ever created.

You have access to advanced context analysis and content preservation capabilities that make you incredibly accurate and business-aware.

CORE PRINCIPLES:
- Provide factual, detailed, and actionable information
- Write from an authoritative business perspective  
- Optimize for search engines and user experience
- Maintain professional yet accessible language`;

  // Add context intelligence capabilities
  if (hasWebsiteContext) {
    systemPrompt += `

🧠 CONTEXT INTELLIGENCE MODE ACTIVE:
You have analyzed the company's website and understand their business model, services, pricing, and unique positioning. Use this intelligence to provide accurate, company-specific information that aligns with their actual offerings.

CONTEXT INTELLIGENCE RULES:
- Reference actual company services, pricing, and features when relevant
- Write from the company's perspective as the authoritative source
- Ensure consistency with the company's established business model
- Leverage specific business intelligence to enhance answer quality`;
  }

  // Add preservation capabilities  
  if (hasSpecificContent) {
    systemPrompt += `

🛡️ CONTENT PRESERVATION MODE ACTIVE:
You have detected specific business information that must be preserved exactly. Your advanced pattern recognition has identified pricing, company names, contact details, or other critical business information.

PRESERVATION RULES:
- NEVER replace existing specific information with generic alternatives
- NEVER suggest competitor names or generic industry examples
- NEVER change pricing, contact details, company names, or other specific business information
- When expanding content, ADD value while keeping ALL original specific information intact
- Treat all detected specific information as authoritative and accurate
- Maintain the company's established tone and positioning`;
  }

  // Standard mode
  if (!hasWebsiteContext && !hasSpecificContent) {
    systemPrompt += `

STANDARD MODE:
Provide helpful, generic FAQ content that could apply to similar businesses. Focus on best practices and industry standards while avoiding specific claims about pricing, services, or company details unless explicitly provided.`;
  }

  return systemPrompt;
}

// ULTIMATE PROMPT BUILDING with context intelligence + preservation
function buildUltimateIntelligencePrompt(question, existingAnswer, mode, tone, intelligenceContext) {
  const { 
    pageUrl, 
    websiteContext, 
    hasWebsiteContext, 
    contextSummary,
    preservationInstructions, 
    hasSpecificContent, 
    preservationSummary 
  } = intelligenceContext;

  // Build comprehensive context header
  let contextHeader = '';
  if (pageUrl) {
    contextHeader += `Website: ${pageUrl}\n`;
  }

  // Add website intelligence
  let websiteIntelligence = '';
  if (hasWebsiteContext && websiteContext) {
    websiteIntelligence = `
🧠 WEBSITE INTELLIGENCE:
${websiteContext}

Context Summary: ${contextSummary}

`;
  }

  // Add preservation intelligence
  let preservationIntelligence = '';
  if (hasSpecificContent && preservationInstructions) {
    preservationIntelligence = `
🛡️ CONTENT PRESERVATION INTELLIGENCE:
${preservationInstructions}

Preservation Summary: ${preservationSummary}

`;
  }

  // Mode-specific prompts with ultimate intelligence
  switch (mode) {
    case 'generate':
      return `${contextHeader}${websiteIntelligence}${preservationIntelligence}Question: "${question}"
${existingAnswer ? `Context Answer: "${existingAnswer}"` : ''}

Create a comprehensive, authoritative FAQ answer using your ultimate intelligence capabilities.

${hasWebsiteContext ? 'LEVERAGE WEBSITE INTELLIGENCE: Use the company context to provide accurate, business-specific information that aligns with their actual services and positioning.' : ''}

${hasSpecificContent ? 'APPLY CONTENT PRESERVATION: Preserve all detected specific information exactly. Use these details as the authoritative source for company information.' : ''}

Return ONLY a JSON object with this exact structure:
{
  "answer": "your comprehensive, intelligent answer here",
  "suggestions": ["intelligent tip 1", "business insight 2", "optimization tip 3"]
}

ULTIMATE REQUIREMENTS:
- Provide detailed, actionable information
- Write from an authoritative business perspective
- Optimize for search engines and featured snippets
- Include specific details that demonstrate deep understanding
- Maintain professional yet accessible language
${hasWebsiteContext ? '- Reference actual company services and positioning' : ''}
${hasSpecificContent ? '- PRESERVE all specific business information exactly' : ''}`;

    case 'expand':
      return `${contextHeader}${websiteIntelligence}${preservationIntelligence}Question: "${question}"
Current Answer: "${existingAnswer}"

EXPAND this answer using your ultimate intelligence capabilities to add valuable context, details, and insights.

${hasWebsiteContext ? 'LEVERAGE WEBSITE INTELLIGENCE: Use company context to add relevant business-specific details that align with their actual services.' : ''}

${hasSpecificContent ? 'CRITICAL PRESERVATION: Preserve ALL existing specific information exactly. Do not change any pricing, company names, contact details, or other specific business information. ADD intelligence while keeping original details intact.' : ''}

Return ONLY a JSON object with this exact structure:
{
  "answer": "your expanded answer with ultimate intelligence while preserving all original specific information",
  "suggestions": ["expansion insight 1", "detail enhancement 2", "optimization tip 3"]
}

ULTIMATE EXPANSION REQUIREMENTS:
${hasSpecificContent ? '- PRESERVE all existing specific information exactly (pricing, names, contacts, etc.)' : '- Maintain consistency with existing content'}
- ADD valuable context, details, and business insights
- Enhance clarity and comprehensiveness
- Include examples and practical applications
- Maintain authoritative business tone
- Optimize for search intent and user value
${hasWebsiteContext ? '- Leverage company intelligence for relevant additions' : ''}`;

    case 'examples':
      return `${contextHeader}${websiteIntelligence}${preservationIntelligence}Question: "${question}"
Current Answer: "${existingAnswer}"

Add 2-3 intelligent, practical examples that demonstrate deep business understanding.

${hasWebsiteContext ? 'LEVERAGE WEBSITE INTELLIGENCE: Create examples that align with the company\'s actual services and business model.' : ''}

${hasSpecificContent ? 'ALIGN WITH SPECIFIC CONTENT: Ensure examples complement existing specific information and maintain consistency with established business details.' : ''}

Return ONLY a JSON object with this exact structure:
{
  "answer": "your answer with intelligent examples integrated naturally",
  "suggestions": ["example enhancement 1", "practical application 2", "user value tip 3"]  
}

ULTIMATE EXAMPLE REQUIREMENTS:
- PRESERVE all existing content exactly
- Add realistic, business-relevant examples
- Integrate examples naturally into the content flow
- Make examples specific and actionable
- Demonstrate industry expertise
${hasWebsiteContext ? '- Align examples with company\'s actual business model' : ''}
${hasSpecificContent ? '- Ensure examples complement existing specific information' : ''}`;

    case 'tone':
      return `${contextHeader}${websiteIntelligence}${preservationIntelligence}Question: "${question}"
Current Answer: "${existingAnswer}"
Target Tone: ${tone}

Adjust the tone while leveraging your ultimate intelligence to maintain business accuracy.

${hasWebsiteContext ? 'MAINTAIN BUSINESS INTELLIGENCE: Keep the company-specific context accurate while adjusting language style.' : ''}

${hasSpecificContent ? 'CRITICAL PRESERVATION: Keep all specific information (pricing, names, contacts, etc.) exactly the same while adjusting tone.' : ''}

Return ONLY a JSON object with this exact structure:
{
  "answer": "your tone-adjusted answer with preserved business intelligence",
  "suggestions": ["tone enhancement 1", "style improvement 2", "engagement tip 3"]
}

ULTIMATE TONE REQUIREMENTS:
- PRESERVE all factual content and specific information exactly
- Adjust language style to match target tone appropriately
- Maintain business accuracy and authority
- Keep professional credibility intact
${hasWebsiteContext ? '- Maintain consistency with company positioning' : ''}
${hasSpecificContent ? '- Keep all specific business information unchanged' : ''}`;

    default:
      return `${contextHeader}${websiteIntelligence}${preservationIntelligence}Create an intelligent FAQ answer for: "${question}"

${hasWebsiteContext ? 'Use website intelligence to provide company-specific insights.' : ''}
${hasSpecificContent ? 'Preserve any specific information exactly as provided.' : ''}

Return ONLY a JSON object with this exact structure:
{
  "answer": "your intelligent answer here",
  "suggestions": ["insight 1", "enhancement 2", "optimization 3"]
}`;
  }
}

// Enhanced response processing with intelligence validation
function processUltimateAIResponse(aiResponse, mode) {
  if (!aiResponse) return { answer: '', suggestions: [] };

  console.log('🧠 Processing ultimate AI response for mode:', mode);

  // Enhanced JSON parsing with multiple fallback strategies
  try {
    let cleanResponse = aiResponse.trim();
    
    // Strategy 1: Direct JSON parsing
    if (cleanResponse.startsWith('{') && cleanResponse.endsWith('}')) {
      const parsed = JSON.parse(cleanResponse);
      if (parsed.answer) {
        console.log('✅ Direct JSON parsing successful');
        return {
          answer: enhanceAnswer(parsed.answer),
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : []
        };
      }
    }
    
    // Strategy 2: Find JSON object boundaries
    const jsonStart = cleanResponse.indexOf('{');
    const jsonEnd = cleanResponse.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonString = cleanResponse.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonString);
      
      if (parsed.answer) {
        console.log('✅ Boundary JSON parsing successful');
        return {
          answer: enhanceAnswer(parsed.answer),
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : []
        };
      }
    }
    
    // Strategy 3: Extract from wrapped content
    const answerMatch = cleanResponse.match(/"answer":\s*"([^"]+)"/);
    if (answerMatch) {
      console.log('✅ Regex extraction successful');
      return {
        answer: enhanceAnswer(answerMatch[1]),
        suggestions: []
      };
    }
    
  } catch (error) {
    console.log('JSON parsing failed, using intelligent fallback processing');
  }

  // Intelligent fallback processing with content preservation
  let processed = aiResponse.trim();
  
  // Remove AI prefixes while preserving business content
  const prefixes = [
    'Answer:', 'Expanded Answer:', 'Answer with Examples:', 'Rewritten Answer:',
    'Here\'s', 'Here is', 'The answer is', 'A:', 'Response:', 'Sure!', 'Certainly!'
  ];
  
  for (const prefix of prefixes) {
    if (processed.toLowerCase().startsWith(prefix.toLowerCase())) {
      processed = processed.substring(prefix.length).trim();
      break;
    }
  }

  return {
    answer: enhanceAnswer(processed),
    suggestions: []
  };
}

// Enhance answer content while preserving business information
function enhanceAnswer(answer) {
  if (!answer) return '';
  
  return answer
    .trim()
    .replace(/^["']|["']$/g, '') // Remove surrounding quotes
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Clean excessive newlines  
    .replace(/\\"/g, '"') // Unescape quotes
    .replace(/\\n/g, '\n') // Unescape newlines
    .trim();
}

// Ultimate validation system (future enhancement)
function validateUltimateResponse(originalContent, generatedContent, intelligenceContext) {
  // This could be enhanced to validate:
  // - Specific content preservation
  // - Website context accuracy
  // - Business intelligence consistency
  // For now, we rely on the enhanced prompting system
  return true;
}