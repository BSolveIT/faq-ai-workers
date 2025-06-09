/**
 * FAQ Realtime Assistant Worker
 * Uses TinyLlama for instant, lightweight suggestions while typing
 * Optimized for speed and low neuron usage (1 neuron per request)
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

      // Create prompt based on mode
      let prompt;
      if (mode === 'improve') {
        prompt = `Improve this FAQ question for clarity and SEO. Original: "${question}". Give 3 short improvements. Format: 1. [improvement] 2. [improvement] 3. [improvement]`;
      } else if (mode === 'autocomplete') {
        prompt = `Complete this FAQ question: "${question}". Give 1 natural completion. Be concise.`;
      } else {
        prompt = `Is this a good FAQ question: "${question}"? Give 1 brief SEO tip.`;
      }

      // Call TinyLlama AI model
      const response = await env.AI.run('@cf/tinyllama/tinyllama-1.1b-chat-v1.0', {
        messages: [
          { role: 'system', content: 'You are a helpful FAQ assistant. Be very concise.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 100,
        temperature: 0.3
      });

      // Parse the response
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

// Helper function to parse AI responses
function parseAISuggestions(aiResponse, mode) {
  if (!aiResponse) return [];

  if (mode === 'improve') {
    // Extract numbered suggestions
    const matches = aiResponse.match(/\d\.\s*([^0-9]+?)(?=\d\.|$)/g);
    if (matches) {
      return matches.map(match => match.replace(/^\d\.\s*/, '').trim());
    }
  } else if (mode === 'autocomplete') {
    // Return as single suggestion
    return [aiResponse.trim()];
  } else {
    // SEO tip - return as is
    return [aiResponse.trim()];
  }

  // Fallback
  return [aiResponse.trim()];
}