// SEO Analyzer Worker - AI-Powered with Expert-Level Analysis
// Uses Llama 4 Scout 17B 16E Instruct for superior SEO comprehension and Position Zero analysis

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check endpoint
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({
          status: 'healthy',
          service: 'faq-seo-analyzer-worker',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
          model: '@cf/meta/llama-4-scout-17b-16e-instruct',
          features: ['seo_analysis', 'readability_scoring', 'voice_search_optimization', 'featured_snippet_analysis'],
          rate_limits: {
            per_request_timeout: '30s'
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // Only accept POST for main functionality
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: corsHeaders 
      });
    }

    try {
      // Parse request
      const { question, answer, pageUrl } = await request.json();
      
      console.log('SEO Analysis Request:', { 
        questionLength: question?.length, 
        answerLength: answer?.length,
        pageUrl
      });

      // Validate input
      if (!question || !answer) {
        return new Response(JSON.stringify({
          error: 'Question and answer are required',
          seoScore: 0,
          readabilityScore: 0,
          voiceSearchScore: 0
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Expert-level AI prompt with detailed instructions
      const analysisPrompt = `You are a senior Google Search Quality Rater and SEO expert with 15 years of experience. You understand exactly how Google ranks content for Featured Snippets (Position Zero), People Also Ask boxes, and voice search results.

ANALYZE THIS FAQ:
Question: "${question}"
Answer: "${answer}"
${pageUrl ? `Page URL: ${pageUrl}` : ''}

YOUR TASK: Score this FAQ for its potential to rank in Google Search, win Featured Snippets, and appear in AI-generated answers.

SCORING CRITERIA:

1. SEO SCORE (0-100) - Position Zero & Featured Snippet Potential:
   
   PERFECT (90-100): 
   - Question matches high-volume search queries exactly
   - Answer starts with a 40-250 character direct response
   - Contains the question keywords naturally in the answer
   - Includes related entities and LSI keywords
   - Perfect length for Featured Snippets (40-60 words ideal)
   - Example: "What is SEO?" with answer starting "SEO (Search Engine Optimization) is the practice of improving website visibility in search results..."
   
   EXCELLENT (80-89):
   - Strong keyword match with minor variations
   - Good direct answer but slightly too long/short
   - Most LSI keywords present
   
   GOOD (70-79):
   - Decent keyword usage but missing opportunities
   - Answer addresses question but not immediately
   
   AVERAGE (50-69):
   - Basic keyword presence
   - Answer eventually addresses question
   
   POOR (0-49):
   - Vague question or keyword stuffing
   - Answer doesn't clearly address question
   - Too short (<20 words) or too long (>500 words)

2. READABILITY SCORE (0-100) - Google's E-A-T and User Experience:
   
   PERFECT (90-100):
   - 8th-grade reading level (Flesch-Kincaid)
   - Sentences under 20 words
   - Active voice throughout
   - Clear structure with natural flow
   - Example: Short sentences. Clear points. Easy to scan.
   
   EXCELLENT (80-89):
   - 9th-10th grade reading level
   - Mostly short sentences
   - Minimal passive voice
   
   GOOD (70-79):
   - 11th-12th grade level
   - Some long sentences but clear
   
   AVERAGE (50-69):
   - College level language
   - Complex sentence structures
   
   POOR (0-49):
   - Graduate level complexity
   - Jargon without explanation
   - Run-on sentences

3. VOICE SEARCH SCORE (0-100) - Google Assistant & Alexa Optimization:
   
   PERFECT (90-100):
   - Conversational question (how, what, where, when)
   - Answer starts with direct 1-2 sentence response
   - Uses "you" and natural language
   - Speakable answer under 30 seconds
   - Example: "How do I tie a tie?" → "To tie a tie, start by..."
   
   EXCELLENT (80-89):
   - Natural question format
   - Quick answer but slightly formal
   
   GOOD (70-79):
   - Decent conversational tone
   - Answer a bit too long for voice
   
   AVERAGE (50-69):
   - Formal language but clear
   - Would need editing for voice
   
   POOR (0-49):
   - Technical/formal question
   - Answer too complex for voice reading

PROVIDE YOUR ANALYSIS:

Consider:
- Would this win Position Zero for its target query?
- Would Google's AI Overview include this answer?
- Would voice assistants choose this answer?
- Does it follow Google's Helpful Content guidelines?

Return ONLY a JSON object:
{
  "seoScore": [0-100 with reasoning],
  "readabilityScore": [0-100 with reasoning],
  "voiceSearchScore": [0-100 with reasoning],
  "suggestions": [
    "Specific improvement that would increase Position Zero chances",
    "Specific change to improve readability score by X points",
    "Specific optimization for voice search ranking"
  ],
  "analysis": {
    "featuredSnippetPotential": true/false,
    "positionZeroReady": true/false,
    "targetKeyword": "identified main keyword",
    "missingElements": ["what's missing for 100% score"]
  },
  "reasoning": {
    "seo": "Why this score - be specific about Google ranking factors",
    "readability": "Specific readability issues or strengths",
    "voiceSearch": "Why it would/wouldn't work for voice"
  }
}`;

      // Call AI for expert analysis
      console.log('Calling Llama 4 Scout 17B 16E for expert SEO analysis...');
      
      const aiResponse = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          {
            role: 'system',
            content: `You are a Google Search Quality Rater with deep knowledge of:
- Featured Snippets algorithm and Position Zero requirements
- People Also Ask ranking factors  
- Voice search optimization for Google Assistant and Alexa
- E-A-T (Expertise, Authoritativeness, Trustworthiness)
- Google's Helpful Content Update and Core Web Vitals
- BERT and natural language understanding
- RankBrain and semantic search

Analyze FAQs as if determining their Google ranking potential. Your advanced 17B parameter model allows you to provide nuanced, specific scores that reflect real Google ranking likelihood. Be extremely specific with scores and actionable suggestions.`
          },
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        temperature: 0.3, // Low temperature for consistent expert scoring
        max_tokens: 1200 // Increased for detailed responses from the 17B model
      });

      console.log('AI Response received');

      // Parse AI response
      let aiAnalysis;
      try {
        // Extract JSON from response
        const jsonMatch = aiResponse.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiAnalysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in AI response');
        }
      } catch (parseError) {
        console.error('Failed to parse Llama 4 Scout 17B response:', parseError);
        console.log('AI Response was:', aiResponse.response);
        
        // Fallback to enhanced algorithmic scoring with the data we have
        return enhancedFallbackScoring(question, answer, pageUrl, corsHeaders);
      }

      // Validate and sanitize scores
      const seoScore = Math.max(0, Math.min(100, Math.round(aiAnalysis.seoScore || 50)));
      const readabilityScore = Math.max(0, Math.min(100, Math.round(aiAnalysis.readabilityScore || 50)));
      const voiceSearchScore = Math.max(0, Math.min(100, Math.round(aiAnalysis.voiceSearchScore || 50)));

      // Ensure we have suggestions
      const suggestions = Array.isArray(aiAnalysis.suggestions) 
        ? aiAnalysis.suggestions.filter(s => s && typeof s === 'string').slice(0, 5)
        : generateDefaultSuggestions(seoScore, readabilityScore, voiceSearchScore);

      // Build response
      const response = {
        success: true,
        seoScore,
        readabilityScore,
        voiceSearchScore,
        suggestions,
        analysis: {
          questionLength: question.length,
          answerWordCount: answer.split(/\s+/).length,
          featuredSnippetPotential: aiAnalysis.analysis?.featuredSnippetPotential ?? (answer.split(/[.!?]/)[0]?.length <= 300),
          positionZeroReady: aiAnalysis.analysis?.positionZeroReady ?? (seoScore >= 90),
          targetKeyword: aiAnalysis.analysis?.targetKeyword || extractMainKeyword(question),
          missingElements: aiAnalysis.analysis?.missingElements || [],
          aiPowered: true,
          model: 'llama-4-scout-17b-16e-instruct',
          neurons: 4,
          reasoning: aiAnalysis.reasoning || null
        }
      };

      console.log('SEO Analysis Response:', response);

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('SEO analyzer error:', error);
      
      // Return error response
      return new Response(JSON.stringify({
        error: error.message,
        seoScore: 0,
        readabilityScore: 0,
        voiceSearchScore: 0,
        suggestions: ['An error occurred during analysis. Please try again.']
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

// Enhanced fallback function with more sophisticated scoring
function enhancedFallbackScoring(question, answer, pageUrl, corsHeaders) {
  console.log('Using enhanced fallback scoring...');
  
  // More sophisticated algorithmic calculations
  let seoScore = 0;
  let readabilityScore = 0;
  let voiceSearchScore = 0;
  
  // SEO Score Calculation
  // Question quality (30 points)
  if (question.length >= 10 && question.length <= 60) seoScore += 10;
  if (question.includes('?')) seoScore += 5;
  if (/^(what|how|why|when|where|who|which|can|does|is|are)/i.test(question)) seoScore += 15;
  
  // Answer quality (50 points)
  const wordCount = answer.split(/\s+/).length;
  if (wordCount >= 40 && wordCount <= 100) seoScore += 20; // Optimal for featured snippets
  else if (wordCount >= 20 && wordCount <= 300) seoScore += 15;
  else if (wordCount > 10) seoScore += 5;
  
  // Featured snippet optimization (20 points)
  const firstSentence = answer.split(/[.!?]/)[0] || '';
  if (firstSentence.length >= 40 && firstSentence.length <= 250) seoScore += 20;
  
  // Keyword presence
  const questionWords = question.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const answerLower = answer.toLowerCase();
  const keywordMatches = questionWords.filter(word => answerLower.includes(word)).length;
  seoScore += Math.min(20, keywordMatches * 5);
  
  // Readability Score Calculation
  const sentences = answer.split(/[.!?]/).filter(s => s.trim().length > 0);
  const avgWordsPerSentence = sentences.length > 0 ? wordCount / sentences.length : 20;
  
  // Sentence length scoring
  if (avgWordsPerSentence <= 15) readabilityScore += 40;
  else if (avgWordsPerSentence <= 20) readabilityScore += 30;
  else if (avgWordsPerSentence <= 25) readabilityScore += 20;
  else readabilityScore += 10;
  
  // Simple language bonus
  const complexWords = answer.split(/\s+/).filter(word => word.length > 7).length;
  const complexityRatio = complexWords / Math.max(1, wordCount);
  if (complexityRatio < 0.1) readabilityScore += 30;
  else if (complexityRatio < 0.2) readabilityScore += 20;
  else readabilityScore += 10;
  
  // Structure bonus
  if (/<[^>]+>/.test(answer)) readabilityScore += 10; // HTML formatting
  if (sentences.length >= 2 && sentences.length <= 5) readabilityScore += 20;
  
  // Voice Search Score Calculation
  // Question optimization (40 points)
  if (/^(what|how|why|when|where|who)/i.test(question)) voiceSearchScore += 20;
  if (question.length <= 50) voiceSearchScore += 10;
  if (question.split(' ').length >= 3 && question.split(' ').length <= 8) voiceSearchScore += 10;
  
  // Answer optimization (60 points)
  if (firstSentence.length >= 40 && firstSentence.length <= 200) voiceSearchScore += 30;
  if (/\b(you|your|you're|you'll)\b/i.test(answer)) voiceSearchScore += 15;
  if (sentences.length <= 3) voiceSearchScore += 15;
  
  // Generate intelligent suggestions based on scores
  const suggestions = [];
  
  if (seoScore < 80) {
    if (firstSentence.length > 250) {
      suggestions.push(`Shorten your opening sentence to under 250 characters (currently ${firstSentence.length}) to improve Featured Snippet chances`);
    }
    if (wordCount < 40) {
      suggestions.push(`Expand your answer to 40-100 words (currently ${wordCount}) for optimal Featured Snippet length`);
    }
    if (keywordMatches < 2) {
      suggestions.push('Include more keywords from your question in the answer to improve relevance');
    }
  }
  
  if (readabilityScore < 80) {
    if (avgWordsPerSentence > 20) {
      suggestions.push(`Reduce sentence length to under 20 words (current average: ${Math.round(avgWordsPerSentence)})`);
    }
    if (complexityRatio > 0.2) {
      suggestions.push('Simplify language - replace complex words with simpler alternatives');
    }
  }
  
  if (voiceSearchScore < 80) {
    if (!/\b(you|your)\b/i.test(answer)) {
      suggestions.push('Add conversational elements using "you" and "your" for voice search optimization');
    }
    if (!firstSentence || firstSentence.length > 200) {
      suggestions.push('Start with a concise direct answer (40-200 characters) for voice assistants');
    }
  }
  
  if (suggestions.length === 0) {
    if (seoScore >= 90 && readabilityScore >= 90 && voiceSearchScore >= 90) {
      suggestions.push('Excellent FAQ! This has strong Position Zero potential');
    } else {
      suggestions.push('Good FAQ! Fine-tune based on the scores above for Featured Snippet optimization');
    }
  }
  
  return new Response(JSON.stringify({
    success: true,
    seoScore: Math.min(100, seoScore),
    readabilityScore: Math.min(100, readabilityScore),
    voiceSearchScore: Math.min(100, voiceSearchScore),
    suggestions,
    analysis: {
      questionLength: question.length,
      answerWordCount: wordCount,
      featuredSnippetPotential: seoScore >= 80,
      positionZeroReady: seoScore >= 90,
      targetKeyword: extractMainKeyword(question),
      missingElements: generateMissingElements(seoScore, readabilityScore, voiceSearchScore),
      aiPowered: false,
      model: 'algorithmic',
      fallbackUsed: true
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// Helper function to extract main keyword from question
function extractMainKeyword(question) {
  // Remove question words and extract key topic
  const cleaned = question
    .toLowerCase()
    .replace(/^(what|how|why|when|where|who|which|can|does|is|are)\s+/i, '')
    .replace(/[?!.,]/g, '')
    .trim();
  
  // Return first 2-3 significant words
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  return words.slice(0, 3).join(' ');
}

// Helper function to generate missing elements for perfect score
function generateMissingElements(seoScore, readabilityScore, voiceSearchScore) {
  const missing = [];
  
  if (seoScore < 100) {
    if (seoScore < 50) missing.push('Direct answer in first sentence');
    if (seoScore < 70) missing.push('Optimal word count (40-100 words)');
    if (seoScore < 90) missing.push('Natural keyword placement');
  }
  
  if (readabilityScore < 100) {
    if (readabilityScore < 60) missing.push('Shorter sentences (under 20 words)');
    if (readabilityScore < 80) missing.push('Simpler vocabulary');
  }
  
  if (voiceSearchScore < 100) {
    if (voiceSearchScore < 70) missing.push('Conversational tone');
    if (voiceSearchScore < 90) missing.push('Concise opening statement');
  }
  
  return missing;
}

// Helper function to generate default suggestions
function generateDefaultSuggestions(seoScore, readabilityScore, voiceSearchScore) {
  const suggestions = [];
  
  if (seoScore < 80) {
    suggestions.push('Optimize for Featured Snippets by starting with a 40-250 character direct answer');
  }
  
  if (readabilityScore < 80) {
    suggestions.push('Improve readability by using shorter sentences and simpler words');
  }
  
  if (voiceSearchScore < 80) {
    suggestions.push('Make it more conversational for voice search optimization');
  }
  
  return suggestions.length > 0 ? suggestions : ['Great FAQ! Consider testing variations to improve Position Zero chances'];
}