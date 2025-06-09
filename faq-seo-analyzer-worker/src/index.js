/**
 * FAQ SEO Analyzer Worker
 * Uses Llama 3.1 8B Fast for comprehensive SEO analysis and optimization
 * Optimized for speed and practical usage (2 neurons per request)
 * Updated to use fast model for real-world multiple FAQ analysis
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
      const { 
        question, 
        answer = '', 
        mode = 'comprehensive',
        keywords = '',
        industry = '',
        targetAudience = 'general'
      } = await request.json();

      if (!question || question.trim().length < 3) {
        return new Response(JSON.stringify({
          error: 'Question is required and must be at least 3 characters',
          analysis: null
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Create analysis prompt
      const prompt = createAnalysisPrompt(mode, question, answer, keywords, industry, targetAudience);

      // Call Llama 3.1 8B Fast AI model (2 neurons per request)
      const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert SEO analyst who provides comprehensive FAQ optimization advice. Always respond with valid JSON only, following the exact structure requested. Be specific and actionable in your recommendations.'
          },
          { 
            role: 'user', 
            content: prompt 
          }
        ],
        max_tokens: 800,
        temperature: 0.3
      });

      // Parse the AI response
      const analysis = parseAnalysisResponse(response.response, question, answer);

      return new Response(JSON.stringify({
        success: true,
        question: question,
        answer: answer,
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

// Create analysis prompts optimized for Llama 3.1 8B Fast
function createAnalysisPrompt(mode, question, answer, keywords, industry, targetAudience) {
  const baseInfo = `Question: "${question}"${answer ? `\nAnswer: "${answer}"` : ''}${keywords ? `\nTarget Keywords: ${keywords}` : ''}${industry ? `\nIndustry: ${industry}` : ''}${targetAudience ? `\nTarget Audience: ${targetAudience}` : ''}`;

  if (mode === 'comprehensive') {
    return `${baseInfo}

Perform a comprehensive SEO analysis of this FAQ. Return ONLY a JSON object with this exact structure:

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
  "keywords": ["primary keyword", "secondary keyword", "related term"],
  "improvements": ["specific improvement 1", "specific improvement 2", "specific improvement 3"],
  "featuredSnippet": {
    "potential": "High",
    "recommendations": ["format tip 1", "content tip 2", "structure tip 3"]
  },
  "voiceSearch": {
    "readiness": "Good",
    "suggestions": ["voice optimization 1", "natural language tip 2"]
  },
  "readability": {
    "score": 80,
    "level": "Easy",
    "suggestions": ["readability tip 1", "clarity improvement 2"]
  },
  "recommendations": [
    {"type": "Keywords", "priority": "High", "action": "specific actionable step"},
    {"type": "Structure", "priority": "Medium", "action": "specific actionable step"},
    {"type": "Content", "priority": "Low", "action": "specific actionable step"}
  ]
}

Provide specific, actionable insights with realistic scores. Focus on practical improvements that will boost search rankings. Return ONLY valid JSON, no other text.`;

  } else if (mode === 'keywords') {
    return `${baseInfo}

Analyze keyword optimization for this FAQ. Return ONLY a JSON object with this exact structure:

{
  "primaryKeywords": ["main keyword", "primary term"],
  "secondaryKeywords": ["related keyword 1", "related keyword 2"],
  "longTailKeywords": ["long tail phrase 1", "long tail phrase 2"],
  "keywordDensity": "Optimal",
  "searchIntent": "Informational",
  "difficulty": "Medium",
  "opportunities": ["keyword opportunity 1", "keyword opportunity 2"],
  "recommendations": ["keyword action 1", "keyword action 2", "keyword action 3"]
}

Focus on practical keyword strategies that will improve rankings. Return ONLY valid JSON, no other text.`;

  } else if (mode === 'readability') {
    return `${baseInfo}

Analyze readability and user experience. Return ONLY a JSON object with this exact structure:

{
  "readabilityScore": 85,
  "readingLevel": "Easy",
  "sentenceLength": "Good",
  "clarityScore": 90,
  "voiceSearchOptimized": true,
  "mobileReadable": true,
  "scannable": true,
  "improvements": ["readability improvement 1", "clarity enhancement 2", "structure suggestion 3"]
}

Focus on making content more accessible and user-friendly. Return ONLY valid JSON, no other text.`;

  } else if (mode === 'competition') {
    return `${baseInfo}

Perform competitive SEO analysis for this FAQ topic. Return ONLY a JSON object with this exact structure:

{
  "competitiveScore": 75,
  "advantages": ["unique advantage 1", "strength 2"],
  "contentGaps": ["missing element 1", "opportunity 2"],
  "uniqueValue": "What makes this FAQ distinctive",
  "rankingPotential": "High",
  "differentiation": ["how to stand out 1", "competitive edge 2"],
  "strategies": ["strategy 1", "strategy 2", "strategy 3"]
}

Focus on competitive positioning and ranking opportunities. Return ONLY valid JSON, no other text.`;
  }

  // Default comprehensive analysis
  return `${baseInfo}

Analyze this FAQ for SEO optimization. Return comprehensive analysis as valid JSON with scores, keywords, and specific recommendations. Return ONLY valid JSON, no other text.`;
}

// Parse AI response into structured analysis object with enhanced JSON handling
function parseAnalysisResponse(aiResponse, question, answer) {
  if (!aiResponse) {
    return createFallbackAnalysis(question, answer);
  }

  console.log('AI Response received, length:', aiResponse.length);

  try {
    // Clean the response - remove any text before/after JSON
    let cleanResponse = aiResponse.trim();
    
    // Find JSON object boundaries more precisely
    const jsonStart = cleanResponse.indexOf('{');
    const jsonEnd = cleanResponse.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonString = cleanResponse.substring(jsonStart, jsonEnd + 1);
      console.log('Attempting to parse JSON of length:', jsonString.length);
      
      const parsed = JSON.parse(jsonString);
      
      // Validate that we have the essential structure
      if (parsed && typeof parsed === 'object') {
        console.log('Successfully parsed JSON response from Llama 3.1 Fast');
        
        // Return structured analysis with validation
        return {
          seoScore: Math.min(100, Math.max(0, parsed.seoScore || parsed.competitiveScore || 70)),
          questionQuality: parsed.questionQuality || {
            score: 75,
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
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : 
                   Array.isArray(parsed.primaryKeywords) ? parsed.primaryKeywords :
                   ['SEO', 'optimization'],
          improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 4) : 
                       Array.isArray(parsed.strategies) ? parsed.strategies.slice(0, 4) :
                       ['Optimize for target keywords', 'Improve content structure'],
          featuredSnippet: parsed.featuredSnippet || {
            potential: 'Medium',
            recommendations: ['Structure content clearly', 'Use direct answers']
          },
          voiceSearch: parsed.voiceSearch || {
            readiness: parsed.voiceSearchOptimized ? 'Good' : 'Needs work',
            suggestions: ['Use conversational language', 'Provide direct answers']
          },
          readability: parsed.readability || {
            score: parsed.readabilityScore || parsed.clarityScore || 75,
            level: parsed.readingLevel || 'Medium',
            suggestions: parsed.improvements || ['Use simpler language', 'Improve structure']
          },
          recommendations: Array.isArray(parsed.recommendations) ? 
            parsed.recommendations.slice(0, 3) : [
            {
              type: 'SEO',
              priority: 'High',
              action: 'Optimize content for target keywords and user intent'
            }
          ],
          rawAnalysis: aiResponse
        };
      }
    }
  } catch (jsonError) {
    console.log('JSON parsing failed with Llama 3.1 Fast, using fallback. Error:', jsonError.message);
  }

  // Fallback to text parsing if JSON fails
  console.log('Using fallback analysis for Llama 3.1 Fast response');
  return createFallbackAnalysis(question, answer);
}

// Enhanced fallback analysis when AI parsing fails
function createFallbackAnalysis(question, answer) {
  const questionLength = question.length;
  const hasAnswer = !!answer;
  const answerLength = answer ? answer.length : 0;

  // Smarter scoring based on content analysis
  let seoScore = 60; // Start higher for fast model
  if (questionLength > 10 && questionLength < 100) seoScore += 15;
  if (hasAnswer && answerLength > 50) seoScore += 15;
  if (question.toLowerCase().includes('how') || question.toLowerCase().includes('what')) seoScore += 10;

  return {
    seoScore: Math.min(100, seoScore),
    questionQuality: {
      score: questionLength > 5 ? 80 : 60,
      clarity: questionLength > 10 ? 'Good' : 'Needs improvement',
      seoOptimization: 'Analyzable via fast model',
      naturalLanguage: 'Good'
    },
    answerQuality: hasAnswer ? {
      score: answerLength > 50 ? 75 : 50,
      length: answerLength > 50 ? 'Good' : 'Could be longer',
      structure: 'Reviewable',
      helpfulness: 'Helpful'
    } : null,
    keywords: ['FAQ', 'questions', 'answers', 'SEO'],
    improvements: [
      'Consider adding target keywords naturally',
      'Optimize answer length for better engagement',
      'Structure content for featured snippets',
      'Improve readability and scan-ability'
    ],
    featuredSnippet: {
      potential: 'Medium',
      recommendations: ['Use clear structure', 'Provide direct answers', 'Include specific examples']
    },
    voiceSearch: {
      readiness: 'Needs optimization',
      suggestions: ['Use natural language', 'Include question words', 'Provide concise answers']
    },
    readability: {
      score: 75,
      level: 'Medium',
      suggestions: ['Use shorter sentences', 'Break up content', 'Add formatting']
    },
    recommendations: [
      {
        type: 'Keywords',
        priority: 'High',
        action: 'Research and include relevant target keywords'
      },
      {
        type: 'Structure',
        priority: 'Medium',
        action: 'Improve content organization and formatting'
      },
      {
        type: 'Content',
        priority: 'Medium',
        action: 'Expand content with more comprehensive information'
      }
    ],
    rawAnalysis: 'Fast analysis completed with fallback processing'
  };
}