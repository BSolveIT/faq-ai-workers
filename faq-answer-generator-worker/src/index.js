/**
 * FAQ Answer Generator Worker
 * Uses Llama 4 Scout 17B (MoE) for comprehensive answer generation and improvement
 * Latest generation model with Mixture of Experts architecture (~3-5 neurons per request)
 * Updated to use the newest, most capable model available
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
        existingAnswer = '', 
        mode = 'generate', 
        tone = 'professional',
        context = '',
        industry = ''
      } = await request.json();

      if (!question || question.trim().length < 3) {
        return new Response(JSON.stringify({
          error: 'Question is required and must be at least 3 characters',
          answer: ''
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Create prompt based on mode and context - now requesting JSON responses
      const prompt = createPrompt(mode, question, existingAnswer, tone, context, industry);

      // Call Llama 4 Scout AI model (Mixture of Experts - estimated 3-5 neurons per request)
      const response = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
        messages: [
          { 
            role: 'system', 
            content: getSystemPrompt(mode, tone)
          },
          { 
            role: 'user', 
            content: prompt 
          }
        ],
        max_tokens: mode === 'expand' ? 600 : 500,
        temperature: tone === 'creative' ? 0.8 : 0.3
      });

      // Process the AI response using new JSON parsing with fallback
      const result = processAIResponse(response.response, mode);

      // Calculate metrics for the answer
      const metrics = calculateAnswerMetrics(result.answer, question);

      return new Response(JSON.stringify({
        success: true,
        question: question,
        mode: mode,
        tone: tone,
        answer: result.answer,
        metrics: metrics,
        suggestions: result.suggestions || generateSuggestions(result.answer, mode)
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error('AI Error:', error);
      return new Response(JSON.stringify({
        error: 'Answer generation failed',
        details: error.message,
        answer: ''
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

// Updated system prompts for Llama 4 Scout's advanced capabilities
function getSystemPrompt(mode, tone) {
  const basePrompt = "You are an expert FAQ content writer with advanced SEO knowledge. You create clear, helpful, and highly optimized answers. Always respond with valid JSON only, following the exact structure requested.";
  
  const modeInstructions = {
    generate: "Generate comprehensive, SEO-optimized answers that directly address the question with relevant details and clear structure.",
    expand: "Intelligently expand existing content by adding valuable details, context, examples, and related information while maintaining the original meaning.",
    examples: "Add concrete, relevant, and practical examples that enhance understanding and provide real-world context.",
    tone: "Expertly adjust tone and style while preserving all important information and maintaining content quality."
  };

  const toneInstructions = {
    professional: "Use a professional, authoritative tone that builds trust. Be formal yet accessible, with clear and confident language.",
    casual: "Use a friendly, conversational tone that feels natural and approachable. Be engaging while remaining informative.",
    technical: "Use precise technical language appropriate for knowledgeable audiences. Include relevant terminology and detailed explanations.",
    creative: "Use an engaging, creative tone that captures attention while remaining accurate and informative. Be memorable and distinctive."
  };

  return `${basePrompt} ${modeInstructions[mode] || modeInstructions.generate} ${toneInstructions[tone] || toneInstructions.professional}`;
}

// Updated prompts to request JSON responses
function createPrompt(mode, question, existingAnswer, tone, context, industry) {
  const contextInfo = context ? `Context: ${context}\n` : '';
  const industryInfo = industry ? `Industry: ${industry}\n` : '';
  
  switch (mode) {
    case 'generate':
      return `${contextInfo}${industryInfo}Question: "${question}"

Create a comprehensive FAQ answer. Return ONLY a JSON object with this exact structure:
{
  "answer": "your generated answer here (50-300 characters for SEO)",
  "suggestions": ["writing tip 1", "SEO tip 2", "improvement tip 3"]
}

Requirements for the answer:
- Directly answers the question
- 50-300 characters for SEO optimization
- Uses clear, accessible language
- Includes relevant details
- Is structured for easy reading`;

    case 'expand':
      return `${contextInfo}${industryInfo}Question: "${question}"
Current Answer: "${existingAnswer}"

Expand this answer. Return ONLY a JSON object with this exact structure:
{
  "answer": "your expanded answer here",
  "suggestions": ["expansion tip 1", "detail tip 2", "improvement tip 3"]
}

Expand by:
- Adding more relevant details
- Including additional context
- Providing more comprehensive information
- Maintaining clarity and readability
- Keeping the core message intact`;

    case 'examples':
      return `${contextInfo}${industryInfo}Question: "${question}"
Current Answer: "${existingAnswer}"

Add concrete examples to this answer. Return ONLY a JSON object with this exact structure:
{
  "answer": "your answer with examples integrated",
  "suggestions": ["example tip 1", "improvement tip 2", "clarity tip 3"]
}

Requirements:
- Include 2-3 specific examples
- Make examples realistic and practical
- Integrate examples naturally into the content
- Maintain the original answer's structure`;

    case 'tone':
      return `${contextInfo}${industryInfo}Question: "${question}"
Current Answer: "${existingAnswer}"
Target Tone: ${tone}

Rewrite this answer to match the target tone. Return ONLY a JSON object with this exact structure:
{
  "answer": "your tone-adjusted answer",
  "suggestions": ["tone tip 1", "style tip 2", "improvement tip 3"]
}

Requirements:
- Preserve all important information
- Maintain accuracy and clarity
- Adapt language style appropriately
- Keep the same level of detail`;

    default:
      return `${contextInfo}${industryInfo}Create a helpful FAQ answer for: "${question}"

Return ONLY a JSON object with this exact structure:
{
  "answer": "your answer here",
  "suggestions": ["tip 1", "tip 2", "tip 3"]
}`;
  }
}

// Updated to parse JSON responses with fallback to text processing
function processAIResponse(aiResponse, mode) {
  if (!aiResponse) return { answer: '', suggestions: [] };

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
      
      if (parsed.answer) {
        console.log('Successfully parsed JSON response');
        return {
          answer: cleanAnswer(parsed.answer),
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : []
        };
      }
    }
  } catch (error) {
    console.log('JSON parsing failed, falling back to text parsing:', error.message);
  }

  // Fallback to original text processing methods
  console.log('Using fallback text processing for mode:', mode);
  
  let processed = aiResponse.trim();

  // Remove common AI prefixes
  const prefixes = [
    'Answer:', 'Expanded Answer:', 'Answer with Examples:', 'Rewritten Answer:',
    'Here\'s', 'Here is', 'The answer is', 'A:', 'Response:', 'Sure!', 'Certainly!'
  ];

  for (const prefix of prefixes) {
    if (processed.toLowerCase().startsWith(prefix.toLowerCase())) {
      processed = processed.substring(prefix.length).trim();
    }
  }

  // Clean up the text response
  const cleanedAnswer = cleanAnswer(processed);
  
  return {
    answer: cleanedAnswer,
    suggestions: generateSuggestions(cleanedAnswer, mode)
  };
}

// Helper function to clean and format answers
function cleanAnswer(answer) {
  if (!answer) return '';

  let cleaned = answer.trim();

  // Clean up markdown-style formatting for HTML
  cleaned = cleaned
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
    .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
    .replace(/^\- (.+)$/gm, '<li>$1</li>') // List items
    .replace(/^(\d+)\. (.+)$/gm, '<li>$1. $2</li>'); // Numbered list items

  // Wrap list items in ul tags if present
  if (cleaned.includes('<li>')) {
    cleaned = cleaned.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  }

  // Remove any JSON artifacts
  cleaned = cleaned.replace(/[{}]/g, '').replace(/"/g, '');
  
  // Limit length (reasonable for FAQ answers)
  if (cleaned.length > 1000) {
    cleaned = cleaned.substring(0, 1000) + '...';
  }

  return cleaned;
}

// Calculate answer metrics for quality assessment
function calculateAnswerMetrics(answer, question) {
  const answerLength = answer.length;
  const wordCount = answer.split(/\s+/).length;
  const readabilityScore = Math.max(0, Math.min(100, 100 - (answerLength - 200) / 10));
  
  return {
    characterCount: answerLength,
    wordCount: wordCount,
    readabilityScore: Math.round(readabilityScore),
    seoOptimized: answerLength >= 50 && answerLength <= 300,
    hasFormatting: answer.includes('<') || answer.includes('*'),
    estimatedReadingTime: Math.ceil(wordCount / 200) // minutes
  };
}

// Generate helpful suggestions based on content and mode
function generateSuggestions(answer, mode) {
  const suggestions = [];
  
  if (mode === 'generate') {
    suggestions.push('Consider adding specific examples to make the answer more concrete');
    suggestions.push('Include relevant keywords for better SEO performance');
    suggestions.push('Structure the answer with bullet points for better readability');
  } else if (mode === 'expand') {
    suggestions.push('Add statistics or data to support your points');
    suggestions.push('Include step-by-step instructions if applicable');
    suggestions.push('Consider adding related resources or links');
  } else if (mode === 'examples') {
    suggestions.push('Make examples more specific to your industry');
    suggestions.push('Add real-world scenarios that users can relate to');
    suggestions.push('Include both positive and negative examples for clarity');
  } else if (mode === 'tone') {
    suggestions.push('Ensure the tone matches your brand voice consistently');
    suggestions.push('Consider your target audience when adjusting tone');
    suggestions.push('Balance professionalism with approachability');
  }
  
  // Add general suggestions based on answer analysis
  if (answer.length < 50) {
    suggestions.push('Answer is quite short - consider adding more detail');
  }
  if (answer.length > 300) {
    suggestions.push('Answer is quite long - consider breaking into smaller sections');
  }
  if (!answer.includes('<')) {
    suggestions.push('Consider adding formatting like bold or lists for better readability');
  }
  
  return suggestions.slice(0, 3); // Return max 3 suggestions
}