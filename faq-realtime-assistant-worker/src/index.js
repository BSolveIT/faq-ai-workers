/**
 * Enhanced FAQ Realtime Assistant Worker - Question Optimizer
 * UPGRADED: From Llama 3.2 1B to Llama 4 Scout 17B for premium SEO analysis
 * Features: 3 scored question options, SEO benefits, Position Zero optimization
 * Cost: ~6.3 neurons per request (vs 1.2 neurons previously)
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers for cross-origin requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight
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
      // Parse enhanced request body with new context fields
      const { 
        question, 
        answer = '', 
        pageUrl = '', 
        websiteContext = '', 
        mode = 'improve' 
      } = await request.json();

      // Validate input
      if (!question || question.trim().length < 3) {
        return new Response(JSON.stringify({
          error: 'Question too short or missing',
          suggestions: []
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Enhanced mode handling with sophisticated prompts
      if (mode === 'improve') {
        return await handleQuestionImprovement(question, answer, pageUrl, websiteContext, env, corsHeaders);
      } else if (mode === 'autocomplete') {
        return await handleQuestionAutocomplete(question, env, corsHeaders);
      } else {
        return await handleQuestionValidation(question, env, corsHeaders);
      }

    } catch (error) {
      console.error('Enhanced Worker Error:', error);
      return new Response(JSON.stringify({
        error: 'AI processing failed',
        details: error.message
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

/**
 * Enhanced Question Improvement with SEO Analysis
 * Uses Llama 4 Scout 17B for expert-level Position Zero optimization
 */
async function handleQuestionImprovement(question, answer, pageUrl, websiteContext, env, corsHeaders) {
  // Estimate current question score for fallback handling
  const estimatedCurrentScore = estimateQuestionSEOScore(question, answer);

  // Fallback: Already optimized
  if (estimatedCurrentScore > 85) {
    return new Response(JSON.stringify({
      success: true,
      fallback: "already_optimized",
      message: "Your question is already well-optimized! Here are minor refinements:",
      options: generateMinorRefinements(question),
      analysis: {
        originalScore: estimatedCurrentScore,
        improvements: ["Minor wording adjustments", "Enhanced readability"],
        websiteRelevance: "Question maintains excellent SEO potential"
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Fallback: Limited context
  if (!answer && !websiteContext) {
    return new Response(JSON.stringify({
      success: true,
      fallback: "limited_context",
      message: "Limited context available. Here are general SEO improvements:",
      options: generateGenericImprovements(question),
      analysis: {
        originalScore: estimatedCurrentScore,
        improvements: ["SEO-friendly structure", "Search intent optimization"],
        websiteRelevance: "General SEO best practices applied"
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Advanced prompting for Llama 4 Scout 17B
  const advancedPrompt = `You are a Google Search Quality Rater and senior SEO expert with 15 years of experience.

ANALYZE AND IMPROVE THIS FAQ QUESTION:
Original Question: "${question}"
Current Answer: "${answer}"
Website Context: ${websiteContext || 'Not provided'}
Page URL: ${pageUrl || 'Not provided'}

YOUR TASK: Create 3 improved question variations, each optimized for different SEO objectives.

REQUIREMENTS FOR EACH OPTION:
1. Question text (optimized for SEO and grammar)
2. Primary SEO benefit (Featured Snippets, AI Answers, Position Zero, Voice Search, etc.)
3. SEO score (0-100) based on ranking potential
4. Specific explanation of why this version ranks better

OPTIMIZATION FOCUS AREAS:
- Featured Snippet potential (40-250 character answers)
- Google AI Overview inclusion
- Voice search compatibility ("How", "What", "Why" questions)
- Position Zero ranking factors
- Search intent matching (informational, commercial, navigational)
- Keyword optimization for target terms
- Grammar, punctuation, and readability
- Natural conversational language

SCORING CRITERIA:
- 90-100: Excellent Position Zero potential with perfect grammar
- 80-89: Strong Featured Snippet candidate with good readability
- 70-79: Good search ranking potential with minor grammar improvements needed
- 60-69: Decent with room for improvement in SEO and grammar
- Below 60: Needs significant optimization for both SEO and readability

GRAMMAR CONSIDERATIONS:
- Proper capitalization and punctuation
- Clear, concise wording without redundancy
- Natural question flow for voice search
- Professional tone appropriate for search results

Return ONLY this JSON structure:
{
  "success": true,
  "options": [
    {
      "question": "Optimized question text here?",
      "seoScore": 85,
      "primaryBenefit": "Featured Snippets",
      "explanation": "Specific reason why this ranks better, including grammar improvements",
      "targetKeywords": ["keyword1", "keyword2"],
      "searchIntent": "informational"
    },
    {
      "question": "Second optimized version?",
      "seoScore": 78,
      "primaryBenefit": "Voice Search",
      "explanation": "Natural conversational phrasing with proper grammar for voice queries",
      "targetKeywords": ["voice keyword1", "voice keyword2"],
      "searchIntent": "informational"
    },
    {
      "question": "Third optimized version?",
      "seoScore": 82,
      "primaryBenefit": "Grammar & Readability",
      "explanation": "Improved grammar and structure for better user experience",
      "targetKeywords": ["readability keyword1", "readability keyword2"],
      "searchIntent": "informational"
    }
  ],
  "analysis": {
    "originalScore": ${estimatedCurrentScore},
    "improvements": ["what was improved including grammar"],
    "websiteRelevance": "how it matches the site context"
  }
}`;

  try {
    // Call Llama 4 Scout 17B for expert analysis
    const response = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
      messages: [
        { 
          role: 'system', 
          content: 'You are an expert SEO analyst specializing in FAQ optimization for Position Zero, Featured Snippets, and AI-generated answers. Always respond with valid JSON only.' 
        },
        { role: 'user', content: advancedPrompt }
      ],
      max_tokens: 800,
      temperature: 0.2 // Lower temperature for consistent, professional results
    });

    // Parse AI response
    const result = parseEnhancedAIResponse(response.response);
    
    if (result && result.success && result.options && result.options.length >= 3) {
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else {
      throw new Error('Invalid AI response structure');
    }

  } catch (error) {
    console.error('Llama 4 Scout 17B Error:', error);
    
    // Intelligent fallback with structured options
    return new Response(JSON.stringify({
      success: true,
      fallback: "ai_error",
      message: "AI enhancement temporarily unavailable. Here are optimized alternatives:",
      options: generateIntelligentFallback(question, answer),
      analysis: {
        originalScore: estimatedCurrentScore,
        improvements: ["SEO structure improvements", "Search intent optimization"],
        websiteRelevance: "Fallback optimizations applied"
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Parse enhanced AI response with robust error handling
 */
function parseEnhancedAIResponse(aiResponse) {
  if (!aiResponse) return null;

  try {
    // Clean the response
    let cleaned = aiResponse.trim();
    
    // Remove common prefixes that might confuse JSON parsing
    const prefixes = ['```json', '```', 'Here is', 'Here\'s', 'Response:', 'JSON:'];
    for (const prefix of prefixes) {
      if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
        cleaned = cleaned.substring(prefix.length).trim();
      }
    }
    
    // Remove trailing markdown
    cleaned = cleaned.replace(/```$/, '').trim();
    
    // Parse JSON
    const parsed = JSON.parse(cleaned);
    
    // Validate structure
    if (parsed.success && parsed.options && Array.isArray(parsed.options)) {
      // Ensure all options have required fields
      parsed.options = parsed.options.map(option => ({
        question: option.question || 'Optimized question',
        seoScore: Math.max(60, Math.min(100, parseInt(option.seoScore) || 75)),
        primaryBenefit: option.primaryBenefit || 'SEO Optimization',
        explanation: option.explanation || 'Improved for better search rankings',
        targetKeywords: Array.isArray(option.targetKeywords) ? option.targetKeywords : ['seo', 'faq'],
        searchIntent: option.searchIntent || 'informational'
      }));
      
      return parsed;
    }
    
    return null;
    
  } catch (error) {
    console.error('JSON parsing error:', error);
    return null;
  }
}

/**
 * Handle autocomplete mode (simplified for speed)
 */
async function handleQuestionAutocomplete(question, env, corsHeaders) {
  const prompt = `Complete this FAQ question naturally: "${question}"
Return only the completed question, nothing else.`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3.2-1b-instruct', {
      messages: [
        { role: 'system', content: 'Complete FAQ questions naturally and concisely.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 50,
      temperature: 0.3
    });

    const completion = response.response?.trim() || question;
    
    return new Response(JSON.stringify({
      success: true,
      suggestions: [completion]
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: true,
      suggestions: [question + '?']
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle validation mode (simplified)
 */
async function handleQuestionValidation(question, env, corsHeaders) {
  const tips = [
    'Use natural, conversational language',
    'Include relevant keywords',
    'Keep it clear and specific',
    'Consider voice search patterns'
  ];

  return new Response(JSON.stringify({
    success: true,
    suggestions: tips
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Estimate current question SEO score for fallback logic
 */
function estimateQuestionSEOScore(question, answer) {
  let score = 50; // Base score
  
  // Length optimization
  if (question.length >= 10 && question.length <= 100) score += 10;
  
  // Question words (good for voice search)
  if (/^(how|what|why|when|where|which|who|can|do|does|is|are|will)/i.test(question)) score += 15;
  
  // Ends with question mark
  if (question.endsWith('?')) score += 10;
  
  // Has answer (context available)
  if (answer && answer.length > 20) score += 15;
  
  // Grammar and readability bonus
  const grammarScore = checkBasicGrammar(question);
  score += grammarScore;
  
  return Math.min(100, score);
}

/**
 * Check basic grammar and readability issues
 * Returns bonus points (0-10) for good grammar
 */
function checkBasicGrammar(question) {
  let grammarScore = 0;
  const issues = [];
  
  // Check capitalization
  if (question.charAt(0) === question.charAt(0).toUpperCase()) {
    grammarScore += 2;
  } else {
    issues.push('Should start with capital letter');
  }
  
  // Check for double spaces
  if (!question.includes('  ')) {
    grammarScore += 1;
  } else {
    issues.push('Contains double spaces');
  }
  
  // Check for proper question punctuation
  if (question.endsWith('?')) {
    grammarScore += 2;
  } else if (question.trim().length > 0) {
    issues.push('Missing question mark');
  }
  
  // Check for common grammar issues
  const commonMistakes = [
    { pattern: /\bthere\s+is\s+\d+\s+\w+s\b/i, issue: "Subject-verb disagreement (there is + plural)" },
    { pattern: /\bit's\s+\w+ing\b/i, issue: "Possible its/it's confusion" },
    { pattern: /\byour\s+(doing|going|coming)\b/i, issue: "Possible your/you're confusion" },
    { pattern: /\bwho's\s+\w+\b/i, issue: "Possible who's/whose confusion" }
  ];
  
  let hasGrammarIssues = false;
  for (const mistake of commonMistakes) {
    if (mistake.pattern.test(question)) {
      issues.push(mistake.issue);
      hasGrammarIssues = true;
    }
  }
  
  // Bonus for no common grammar issues
  if (!hasGrammarIssues) {
    grammarScore += 3;
  }
  
  // Check word count (reasonable question length)
  const wordCount = question.trim().split(/\s+/).length;
  if (wordCount >= 3 && wordCount <= 15) {
    grammarScore += 2; // Good length
  } else if (wordCount > 20) {
    issues.push('Question too long for optimal readability');
  } else if (wordCount < 3) {
    issues.push('Question too short');
  }
  
  return Math.max(0, grammarScore);
}

/**
 * Generate grammar-improved versions of questions
 */
function improveQuestionGrammar(question) {
  let improved = question.trim();
  
  // Fix capitalization
  if (improved.length > 0) {
    improved = improved.charAt(0).toUpperCase() + improved.slice(1);
  }
  
  // Fix double spaces
  improved = improved.replace(/\s+/g, ' ');
  
  // Ensure question mark
  if (!improved.endsWith('?') && !improved.endsWith('.')) {
    improved += '?';
  }
  
  // Fix common grammar issues
  improved = improved.replace(/\bthere\s+is\s+(\d+)\s+(\w+s)\b/gi, 'there are $1 $2');
  improved = improved.replace(/\byour\s+(doing|going|coming)\b/gi, "you're $1");
  
  return improved;
}

/**
 * Generate minor refinements for already optimized questions
 */
function generateMinorRefinements(question) {
  const grammarImproved = improveQuestionGrammar(question);
  const baseQuestion = grammarImproved !== question ? grammarImproved : question;
  
  return [
    {
      question: baseQuestion.replace(/\b(a|an|the)\b/gi, '').replace(/\s+/g, ' ').trim(),
      seoScore: 88,
      primaryBenefit: "Conciseness",
      explanation: "Removed unnecessary articles for tighter phrasing",
      targetKeywords: ["concise", "focused"],
      searchIntent: "informational"
    },
    {
      question: baseQuestion.endsWith('?') ? baseQuestion : baseQuestion + '?',
      seoScore: 86,
      primaryBenefit: "Voice Search",
      explanation: "Ensured proper question format for voice queries",
      targetKeywords: ["voice", "question"],
      searchIntent: "informational"
    },
    {
      question: grammarImproved,
      seoScore: 87,
      primaryBenefit: "Grammar & Readability",
      explanation: "Improved grammar and readability for better user experience",
      targetKeywords: ["grammar", "readability"],
      searchIntent: "informational"
    }
  ];
}

/**
 * Generate generic improvements for limited context
 */
function generateGenericImprovements(question) {
  const grammarImproved = improveQuestionGrammar(question);
  const cleanQuestion = question.replace(/\?$/, '').toLowerCase().trim();
  
  // Smart question transformation based on question type
  let alternativeQuestions = [];
  
  // If it's a "how to" question, create variations
  if (/^(how\s+(do|can|to)|how\s+.*(improve|get|make|create|build))/i.test(cleanQuestion)) {
    const actionMatch = cleanQuestion.match(/improve|get|make|create|build|increase|optimize|fix|enhance/i);
    const action = actionMatch ? actionMatch[0] : 'improve';
    const topic = cleanQuestion.replace(/^how\s+(do|can|to)\s*(i\s*)?/i, '').replace(action, '').trim();
    
    alternativeQuestions = [
      `What are the best ways to ${action} ${topic}?`,
      `How can I effectively ${action} ${topic}?`
    ];
  }
  // If it's a "what is" question, create variations  
  else if (/^what\s+(is|are)/i.test(cleanQuestion)) {
    const topic = cleanQuestion.replace(/^what\s+(is|are)\s*/i, '');
    alternativeQuestions = [
      `How does ${topic} work?`,
      `Why is ${topic} important?`
    ];
  }
  // Generic fallbacks for other question types
  else {
    alternativeQuestions = [
      `What should I know about ${cleanQuestion}?`,
      `How can ${cleanQuestion} help me?`
    ];
  }
  
  return [
    {
      question: alternativeQuestions[0] || grammarImproved,
      seoScore: 75,
      primaryBenefit: "Featured Snippets",
      explanation: "Restructured for better search snippet potential",
      targetKeywords: ["best ways", "how to"],
      searchIntent: "informational"
    },
    {
      question: alternativeQuestions[1] || grammarImproved,
      seoScore: 72,
      primaryBenefit: "Voice Search",
      explanation: "Natural conversational phrasing for voice queries",
      targetKeywords: ["how can", "effectively"],
      searchIntent: "informational"
    },
    {
      question: grammarImproved,
      seoScore: 70,
      primaryBenefit: "Grammar Correction",
      explanation: "Fixed grammar and formatting issues for better readability",
      targetKeywords: ["grammar", "corrected"],
      searchIntent: "informational"
    }
  ];
}

/**
 * Generate intelligent fallback when AI fails
 */
function generateIntelligentFallback(question, answer) {
  const grammarImproved = improveQuestionGrammar(question);
  
  return [
    {
      question: grammarImproved,
      seoScore: 68,
      primaryBenefit: "Grammar & Readability",
      explanation: "Improved grammar, capitalization and punctuation",
      targetKeywords: ["professional", "readable"],
      searchIntent: "informational"
    },
    {
      question: question.endsWith('?') ? question : question + '?',
      seoScore: 65,
      primaryBenefit: "Question Format",
      explanation: "Proper question punctuation for search engines",
      targetKeywords: ["question", "format"],
      searchIntent: "informational"
    },
    {
      question: `${grammarImproved.replace(/\?$/, '')} - Complete Guide`,
      seoScore: 70,
      primaryBenefit: "Long-tail SEO",
      explanation: "Added guide suffix for comprehensive content targeting",
      targetKeywords: ["complete guide", "comprehensive"],
      searchIntent: "informational"
    }
  ];
}