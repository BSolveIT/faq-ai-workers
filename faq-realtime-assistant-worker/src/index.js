/**
 * FAQ Realtime Assistant Worker
 * Uses TinyLlama for instant, lightweight suggestions while typing
 * Optimized for speed and low neuron usage (1 neuron per request)
 * Updated to use JSON responses for consistency with other workers
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

      // Create prompt based on mode - now requesting JSON responses
      let prompt;
      if (mode === 'improve') {
        prompt = `Improve this FAQ question for clarity and SEO. Original: "${question}". 

Return ONLY a JSON object with this exact structure:
{
  "suggestions": ["improved version 1", "improved version 2", "improved version 3"]
}

Make each suggestion a complete, improved version of the question. Be concise and focus on SEO and clarity.`;
      } else if (mode === 'autocomplete') {
        prompt = `Complete this FAQ question: "${question}". 

Return ONLY a JSON object with this exact structure:
{
  "suggestions": ["completed question"]
}

Provide one natural, complete version of the question.`;
      } else {
        prompt = `Analyze this FAQ question for SEO: "${question}". 

Return ONLY a JSON object with this exact structure:
{
  "suggestions": ["brief SEO tip"]
}

Give one specific, actionable SEO improvement tip.`;
      }

      // Call TinyLlama AI model
      const response = await env.AI.run('@cf/tinyllama/tinyllama-1.1b-chat-v1.0', {
        messages: [
          { role: 'system', content: 'You are a helpful FAQ assistant. Always respond with valid JSON only. Be very concise.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 150,
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

// Updated helper function to parse JSON responses with fallback to text parsing
function parseAISuggestions(aiResponse, mode) {
  if (!aiResponse) return [];

  console.log('AI Response:', aiResponse);

  // Try JSON parsing first
  try {
    // Clean the response - remove any text before/after JSON
    let cleanResponse = aiResponse.trim();
    
    // Find JSON object boundaries
    const jsonStart = cleanResponse.indexOf('{');
    const jsonEnd = cleanResponse.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonString = cleanResponse.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonString);
      
      if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        console.log('Successfully parsed JSON response');
        return parsed.suggestions.filter(s => s && s.trim()).slice(0, 3);
      }
    }
  } catch (error) {
    console.log('JSON parsing failed, falling back to text parsing:', error.message);
  }

  // Fallback to original text parsing methods
  console.log('Using fallback text parsing for mode:', mode);

  if (mode === 'improve') {
    // Extract numbered suggestions (original method)
    const matches = aiResponse.match(/\d\.\s*([^0-9]+?)(?=\d\.|$)/g);
    if (matches) {
      return matches.map(match => match.replace(/^\d\.\s*/, '').trim());
    }
    
    // Alternative: try to split by common delimiters
    const lines = aiResponse.split(/[\n\r]+/).filter(line => line.trim());
    if (lines.length > 1) {
      return lines.slice(0, 3).map(line => line.replace(/^[-*•]\s*/, '').trim());
    }
  } else if (mode === 'autocomplete') {
    // Return as single suggestion (original method)
    return [aiResponse.trim()];
  } else {
    // SEO tip - return as is (original method)
    return [aiResponse.trim()];
  }

  // Final fallback
  return [aiResponse.trim()];
}