/**
 * FAQ SEO Analyzer Worker
 * Uses Mistral AI for comprehensive SEO analysis and optimization
 * Optimized for detailed insights and keyword optimization (5 neurons per request)
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
      // Parse request body
      const { question, answer, mode = 'comprehensive', keywords = '', industry = '' } = await request.json();

      if (!question || question.trim().length < 5) {
        return new Response(JSON.stringify({
          error: 'Question too short for analysis',
          analysis: null
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Create analysis prompt based on mode
      let prompt = createAnalysisPrompt(question, answer, mode, keywords, industry);

      // Call Mistral AI model for deep analysis
      const response = await env.AI.run('@cf/mistral/mistral-7b-instruct-v0.2-lora', {
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert SEO consultant specializing in FAQ optimization. Provide detailed, actionable insights with specific scores and recommendations.' 
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.2
      });

      // Parse the AI response into structured analysis
      const analysis = parseAnalysisResponse(response.response, question, answer);

      return new Response(JSON.stringify({
        success: true,
        question: question,
        answer: answer || '',
        mode: mode,
        analysis: analysis,
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('SEO Analysis Error:', error);
      return new Response(JSON.stringify({
        error: 'SEO analysis failed',
        details: error.message,
        analysis: null
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

// Create analysis prompt based on mode and inputs
function createAnalysisPrompt(question, answer, mode, keywords, industry) {
  const baseInfo = `Question: "${question}"${answer ? `\nAnswer: "${answer}"` : ''}${keywords ? `\nTarget Keywords: ${keywords}` : ''}${industry ? `\nIndustry: ${industry}` : ''}`;

  if (mode === 'comprehensive') {
    return `${baseInfo}

Analyze this FAQ for SEO optimization. Return your analysis as valid JSON in this exact format:

{
  "seoScore": 85,
  "questionQuality": {
    "score": 90,
    "clarity": "High",
    "seoOptimization": "Good",
    "naturalLanguage": "Yes"
  },
  "answerQuality": {
    "score": 75,
    "length": "Appropriate",
    "structure": "Good",
    "helpfulness": "Very helpful"
  },
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "improvements": ["improvement 1", "improvement 2", "improvement 3"],
  "featuredSnippet": {
    "potential": "High",
    "recommendations": ["tip1", "tip2", "tip3"]
  },
  "voiceSearch": {
    "readiness": "Good",
    "suggestions": ["suggestion1", "suggestion2"]
  },
  "readability": {
    "score": 80,
    "level": "Easy",
    "suggestions": ["tip1", "tip2"]
  },
  "recommendations": [
    {"type": "Keywords", "priority": "High", "action": "specific action"},
    {"type": "Structure", "priority": "Medium", "action": "specific action"}
  ]
}

Provide specific scores and actionable recommendations. Return ONLY valid JSON, no other text.`;

  } else if (mode === 'keywords') {
    return `${baseInfo}

Focus on keyword optimization. Return analysis as valid JSON:

{
  "primaryKeywords": ["keyword1", "keyword2"],
  "secondaryKeywords": ["keyword3", "keyword4"],
  "longTailKeywords": ["long tail phrase 1", "long tail phrase 2"],
  "keywordDensity": "Good",
  "searchIntent": "Informational",
  "recommendations": ["action 1", "action 2"]
}

Return ONLY valid JSON, no other text.`;

  } else if (mode === 'readability') {
    return `${baseInfo}

Analyze readability and user experience. Return as valid JSON:

{
  "readabilityScore": 85,
  "readingLevel": "Easy",
  "sentenceLength": "Good",
  "clarityScore": 90,
  "voiceSearchOptimized": true,
  "mobileReadable": true,
  "improvements": ["suggestion 1", "suggestion 2"]
}

Return ONLY valid JSON, no other text.`;

  } else if (mode === 'competition') {
    return `${baseInfo}

Competitive SEO analysis. Return as valid JSON:

{
  "competitiveScore": 75,
  "advantages": ["advantage 1", "advantage 2"],
  "contentGaps": ["gap 1", "gap 2"],
  "uniqueValue": "What makes this FAQ unique",
  "rankingPotential": "High",
  "strategies": ["strategy 1", "strategy 2"]
}

Return ONLY valid JSON, no other text.`;
  }

  // Default comprehensive analysis
  return `${baseInfo}

Analyze this FAQ comprehensively. Return as valid JSON with scores and recommendations. Return ONLY valid JSON, no other text.`;
}

// Parse AI response into structured analysis object
function parseAnalysisResponse(aiResponse, question, answer) {
  if (!aiResponse) {
    return createFallbackAnalysis(question, answer);
  }

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(aiResponse.trim());
    
    // If successful, validate and return the parsed JSON
    if (parsed && typeof parsed === 'object') {
      return {
        seoScore: parsed.seoScore || parsed.competitiveScore || parsed.readabilityScore || 60,
        questionQuality: parsed.questionQuality || {
          score: 70,
          clarity: 'Good',
          seoOptimization: 'Needs review',
          naturalLanguage: 'Yes'
        },
        answerQuality: answer ? (parsed.answerQuality || {
          score: 70,
          length: 'Appropriate',
          structure: 'Good',
          helpfulness: 'Helpful'
        }) : null,
        keywords: parsed.keywords || parsed.primaryKeywords || ['FAQ', 'questions', 'answers'],
        improvements: parsed.improvements || parsed.strategies || ['Optimize for target keywords'],
        featuredSnippet: parsed.featuredSnippet || {
          potential: 'Medium',
          recommendations: ['Structure content clearly', 'Use direct answers']
        },
        voiceSearch: parsed.voiceSearch || {
          readiness: parsed.voiceSearchOptimized ? 'Good' : 'Needs work',
          suggestions: ['Use conversational language', 'Provide direct answers']
        },
        readability: parsed.readability || {
          score: parsed.readabilityScore || parsed.clarityScore || 70,
          level: parsed.readingLevel || 'Medium',
          suggestions: ['Use simpler language', 'Break up long sentences']
        },
        recommendations: parsed.recommendations || [
          {
            type: 'SEO',
            priority: 'High', 
            action: 'Optimize content for target keywords'
          }
        ],
        rawAnalysis: aiResponse
      };
    }
  } catch (jsonError) {
    console.log('JSON parsing failed, attempting text parsing...', jsonError.message);
  }

  // Fallback to text parsing if JSON fails
  try {
    const analysis = {
      seoScore: extractSEOScore(aiResponse),
      questionQuality: extractQuestionQuality(aiResponse),
      answerQuality: answer ? extractAnswerQuality(aiResponse) : null,
      keywords: extractKeywords(aiResponse),
      improvements: extractImprovements(aiResponse),
      featuredSnippet: extractFeaturedSnippetPotential(aiResponse),
      voiceSearch: extractVoiceSearchReadiness(aiResponse),
      readability: extractReadabilityScore(aiResponse),
      recommendations: extractRecommendations(aiResponse),
      rawAnalysis: aiResponse
    };

    return analysis;
  } catch (error) {
    console.error('Error parsing analysis:', error);
    return createFallbackAnalysis(question, answer);
  }
}

// Extract SEO score from AI response
function extractSEOScore(text) {
  const scoreMatch = text.match(/(?:seo score|score)[:\s]*(\d+)(?:\/100|%|\s|$)/i);
  if (scoreMatch) {
    return Math.min(100, Math.max(0, parseInt(scoreMatch[1])));
  }
  
  // Fallback scoring based on content analysis
  let score = 60; // Base score
  if (text.toLowerCase().includes('excellent') || text.toLowerCase().includes('very good')) score += 20;
  if (text.toLowerCase().includes('good') || text.toLowerCase().includes('well-structured')) score += 10;
  if (text.toLowerCase().includes('needs improvement') || text.toLowerCase().includes('poor')) score -= 20;
  
  return Math.min(100, Math.max(0, score));
}

// Extract question quality assessment
function extractQuestionQuality(text) {
  const qualityIndicators = {
    clear: text.toLowerCase().includes('clear') || text.toLowerCase().includes('specific'),
    seoFriendly: text.toLowerCase().includes('seo') || text.toLowerCase().includes('keyword'),
    conversational: text.toLowerCase().includes('natural') || text.toLowerCase().includes('conversational'),
    targeted: text.toLowerCase().includes('target') || text.toLowerCase().includes('focused')
  };

  const score = Object.values(qualityIndicators).filter(Boolean).length * 25;
  
  return {
    score: score,
    clarity: qualityIndicators.clear ? 'High' : 'Medium',
    seoOptimization: qualityIndicators.seoFriendly ? 'Good' : 'Needs work',
    naturalLanguage: qualityIndicators.conversational ? 'Yes' : 'Could improve'
  };
}

// Extract answer quality if answer is provided
function extractAnswerQuality(text) {
  const lengthGood = text.toLowerCase().includes('appropriate length') || text.toLowerCase().includes('detailed');
  const structureGood = text.toLowerCase().includes('well-structured') || text.toLowerCase().includes('organized');
  const helpfulGood = text.toLowerCase().includes('helpful') || text.toLowerCase().includes('comprehensive');

  const qualityScore = [lengthGood, structureGood, helpfulGood].filter(Boolean).length * 33;

  return {
    score: Math.min(100, qualityScore),
    length: lengthGood ? 'Appropriate' : 'Review needed',
    structure: structureGood ? 'Well organized' : 'Could improve',
    helpfulness: helpfulGood ? 'Very helpful' : 'Add more detail'
  };
}

// Extract keyword suggestions
function extractKeywords(text) {
  const keywordSection = text.match(/(?:keywords?|terms?)[:\s\n]*(.*?)(?:\n\n|\n[A-Z]|\n\d+\.|\n-|$)/is);
  if (keywordSection) {
    const keywords = keywordSection[1]
      .split(/[,\n\-•]/)
      .map(k => k.trim().replace(/^["'\d\.\)\s]+|["'\s]+$/g, ''))
      .filter(k => k.length > 2 && k.length < 50)
      .slice(0, 6);
    
    return keywords.length > 0 ? keywords : ['FAQ', 'questions', 'answers', 'help', 'guide'];
  }
  
  return ['FAQ', 'questions', 'answers', 'help', 'guide'];
}

// Extract improvement suggestions
function extractImprovements(text) {
  const improvementMatches = text.match(/(?:improve|recommend|suggest|better)[^.]*[.:]/gi);
  if (improvementMatches) {
    return improvementMatches
      .map(imp => imp.replace(/^\d+[\.\)\s]*/, '').trim())
      .filter(imp => imp.length > 10)
      .slice(0, 5);
  }

  return [
    'Add relevant keywords to the question',
    'Expand the answer with more detail',
    'Include specific examples or steps',
    'Optimize for voice search queries',
    'Improve readability and structure'
  ];
}

// Extract featured snippet potential
function extractFeaturedSnippetPotential(text) {
  const hasGoodStructure = text.toLowerCase().includes('structured') || text.toLowerCase().includes('list');
  const hasDefinition = text.toLowerCase().includes('definition') || text.toLowerCase().includes('explain');
  const hasSteps = text.toLowerCase().includes('steps') || text.toLowerCase().includes('process');

  let potential = 'Medium';
  let recommendations = [];

  if (hasGoodStructure && (hasDefinition || hasSteps)) {
    potential = 'High';
    recommendations.push('Excellent structure for featured snippets');
  } else if (hasGoodStructure || hasDefinition) {
    potential = 'Medium';
    recommendations.push('Good potential with some optimization');
  } else {
    potential = 'Low';
    recommendations.push('Needs better structure and clarity');
  }

  recommendations.push('Use numbered lists or bullet points');
  recommendations.push('Start answer with direct definition');
  recommendations.push('Keep answer between 40-60 words for snippets');

  return {
    potential: potential,
    recommendations: recommendations.slice(0, 3)
  };
}

// Extract voice search readiness
function extractVoiceSearchReadiness(text) {
  const isConversational = text.toLowerCase().includes('conversational') || text.toLowerCase().includes('natural');
  const isQuestionFormat = text.toLowerCase().includes('question') && text.toLowerCase().includes('how');
  
  let readiness = isConversational && isQuestionFormat ? 'Good' : 'Needs work';
  
  return {
    readiness: readiness,
    suggestions: [
      'Use natural, conversational language',
      'Include "how", "what", "why" question formats',
      'Provide direct, concise answers',
      'Target long-tail conversational keywords'
    ]
  };
}

// Extract readability score
function extractReadabilityScore(text) {
  const hasSimpleLanguage = text.toLowerCase().includes('simple') || text.toLowerCase().includes('clear');
  const hasGoodStructure = text.toLowerCase().includes('structured') || text.toLowerCase().includes('organized');
  
  let score = 70; // Base score
  if (hasSimpleLanguage) score += 15;
  if (hasGoodStructure) score += 15;
  
  return {
    score: Math.min(100, score),
    level: score > 80 ? 'Easy' : score > 60 ? 'Medium' : 'Difficult',
    suggestions: [
      'Use shorter sentences (under 20 words)',
      'Avoid jargon and technical terms',
      'Include bullet points for lists',
      'Add examples to clarify concepts'
    ]
  };
}

// Extract specific recommendations
function extractRecommendations(text) {
  const recommendations = [];
  
  if (text.toLowerCase().includes('keyword')) {
    recommendations.push({
      type: 'Keywords',
      priority: 'High',
      action: 'Add target keywords naturally to question and answer'
    });
  }
  
  if (text.toLowerCase().includes('structure') || text.toLowerCase().includes('format')) {
    recommendations.push({
      type: 'Structure',
      priority: 'Medium',
      action: 'Improve content structure with lists and headings'
    });
  }
  
  if (text.toLowerCase().includes('length') || text.toLowerCase().includes('detail')) {
    recommendations.push({
      type: 'Content',
      priority: 'Medium',
      action: 'Expand answer with more comprehensive information'
    });
  }
  
  // Always include at least one recommendation
  if (recommendations.length === 0) {
    recommendations.push({
      type: 'SEO',
      priority: 'High',
      action: 'Optimize content for target keywords and user intent'
    });
  }
  
  return recommendations.slice(0, 4);
}

// Create fallback analysis when AI parsing fails
function createFallbackAnalysis(question, answer) {
  const questionLength = question.length;
  const hasAnswer = !!answer;
  const answerLength = answer ? answer.length : 0;

  // Basic scoring based on content analysis
  let seoScore = 50;
  if (questionLength > 10 && questionLength < 100) seoScore += 20;
  if (hasAnswer && answerLength > 50) seoScore += 20;
  if (question.toLowerCase().includes('how') || question.toLowerCase().includes('what')) seoScore += 10;

  return {
    seoScore: Math.min(100, seoScore),
    questionQuality: {
      score: questionLength > 5 ? 75 : 50,
      clarity: questionLength > 10 ? 'Good' : 'Needs improvement',
      seoOptimization: 'Needs analysis',
      naturalLanguage: 'Review recommended'
    },
    answerQuality: hasAnswer ? {
      score: answerLength > 50 ? 70 : 40,
      length: answerLength > 50 ? 'Good' : 'Too short',
      structure: 'Needs review',
      helpfulness: 'Could be expanded'
    } : null,
    keywords: ['FAQ', 'questions', 'answers'],
    improvements: [
      'Add relevant target keywords',
      'Expand answer with more detail',
      'Improve question structure',
      'Optimize for search intent'
    ],
    featuredSnippet: {
      potential: 'Medium',
      recommendations: ['Structure content clearly', 'Use direct answers', 'Include specific examples']
    },
    voiceSearch: {
      readiness: 'Needs work',
      suggestions: ['Use conversational language', 'Include question words', 'Provide direct answers']
    },
    readability: {
      score: 70,
      level: 'Medium',
      suggestions: ['Use simpler language', 'Break up long sentences', 'Add examples']
    },
    recommendations: [
      {
        type: 'Content',
        priority: 'High',
        action: 'Expand and optimize content for target keywords'
      }
    ],
    rawAnalysis: 'Fallback analysis due to AI processing limitation'
  };
}