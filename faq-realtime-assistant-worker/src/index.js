/**
 * FAQ Realtime Assistant Worker
 * Uses Llama 3.2 1B for instant, lightweight suggestions while typing
 * Optimized for speed and low neuron usage (1 neuron per request)
 * Updated to use the fastest smart model available
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
      const { question, mode = 'improve' } = await request.json();

      if (!question || question.trim().length < 3) {
        return new Response(JSON.stringify({
          error: 'Question too short',
          suggestions: []
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Create prompt based on mode - ultra-explicit for question variations only
      let prompt;
      if (mode === 'improve') {
        prompt = `Rewrite this QUESTION in 3 different ways. Only give me the questions, nothing else:
Original question: "${question}"

1. [Question version 1]
2. [Question version 2]
3. [Question version 3]

Remember: Only questions, no answers or explanations.`;
      } else if (mode === 'autocomplete') {
        prompt = `Complete this question: "${question}"
Just give me the completed question, nothing else.`;
      } else {
        prompt = `Give one short SEO tip for this question: "${question}"
Just the tip, nothing else.`;
      }

      // Call Llama 3.2 1B AI model - fastest smart model available
      const response = await env.AI.run('@cf/meta/llama-3.2-1b-instruct', {
        messages: [
          { role: 'system', content: 'You help rewrite FAQ questions. When asked to improve a question, only provide alternative question phrasings - never provide answers or explanations. Be concise.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 100,
        temperature: 0.3
      });

      // Parse the response using new JSON parsing with fallback
      const suggestions = parseAISuggestions(response.response, mode);

      return new Response(JSON.stringify({
        success: true,
        original: question,
        mode: mode,
        suggestions: suggestions
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('AI Error:', error);
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

// Updated helper function - prioritizes question extraction for realtime assistance
function parseAISuggestions(aiResponse, mode) {
  if (!aiResponse) return [];

  console.log('AI Response:', aiResponse);

  // Clean the response first
  let cleaned = aiResponse.trim();
  
  // Remove common prefixes that might confuse parsing
  const prefixes = ['Here are', 'Here\'s', 'The questions are', 'Questions:', 'Response:', 'Sure!', 'Here you go'];
  for (const prefix of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.substring(prefix.length).trim();
    }
  }

  if (mode === 'improve') {
    // Primary method: Extract numbered suggestions
    const matches = cleaned.match(/\d\.\s*([^0-9\n\r]+?)(?=\d\.|$)/g);
    if (matches && matches.length > 0) {
      console.log('Found numbered suggestions');
      const questions = matches.map(match => {
        let question = match.replace(/^\d\.\s*/, '').trim();
        // Remove any markdown or formatting
        question = question.replace(/\*\*/g, '').replace(/\*/g, '');
        // Clean up brackets
        question = question.replace(/^\[/, '').replace(/\]$/, '');
        return question;
      }).filter(q => {
        // Only keep strings that look like questions
        return q.length > 5 && 
               q.length < 200 && 
               !q.includes('Definition:') && 
               !q.includes('Answer:') && 
               !q.includes('**') &&
               !q.includes('Search Engine Optimization') &&
               q.split(' ').length < 20; // Reasonable question length
      }).slice(0, 3);
      
      if (questions.length > 0) {
        return questions;
      }
    }
    
    // Fallback: Split by lines and filter for question-like content
    const lines = cleaned.split(/[\n\r]+/).filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 5 && 
             trimmed.length < 200 &&
             !trimmed.toLowerCase().includes('definition') && 
             !trimmed.toLowerCase().includes('answer') &&
             !trimmed.includes('**') &&
             !trimmed.includes('{') &&
             trimmed.split(' ').length < 20;
    });
    
    if (lines.length > 0) {
      console.log('Using line-based parsing');
      return lines.slice(0, 3).map(line => {
        let clean = line.replace(/^[-*•]\s*/, '').trim();
        clean = clean.replace(/^\[/, '').replace(/\]$/, '');
        return clean;
      });
    }
    
  } else if (mode === 'autocomplete') {
    // For autocomplete, return the first clean line that looks like a question
    const lines = cleaned.split(/[\n\r]+/).filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 5 && 
             trimmed.length < 200 &&
             !trimmed.toLowerCase().includes('json') &&
             trimmed.split(' ').length < 20;
    });
    
    if (lines.length > 0) {
      let question = lines[0].replace(/^[-*•]\s*/, '').trim();
      question = question.replace(/^\[/, '').replace(/\]$/, '');
      return [question];
    }
    
    return [cleaned];
    
  } else {
    // For validation/tips, return the main content
    const lines = cleaned.split(/[\n\r]+/).filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 5 && 
             trimmed.length < 200 &&
             !trimmed.toLowerCase().includes('json');
    });
    
    if (lines.length > 0) {
      return [lines[0].trim()];
    }
    
    return [cleaned];
  }

  // Final fallback
  return ['Unable to generate suggestions'];
}