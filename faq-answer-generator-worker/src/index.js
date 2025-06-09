/**
 * FAQ Answer Generator Worker
 * Uses Llama 3 for comprehensive answer generation and improvement
 * Optimized for quality content creation (2 neurons per request)
 * 
 * Copy this complete code into your src/index.js file
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

      // Create prompt based on mode and context
      const prompt = createPrompt(mode, question, existingAnswer, tone, context, industry);

      // Call Llama 3 AI model (2 neurons per request)
      const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
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
        max_tokens: mode === 'expand' ? 400 : 300,
        temperature: tone === 'creative' ? 0.7 : 0.4
      });

      // Process the AI response
      const processedAnswer = processAIResponse(response.response, mode);

      // Calculate metrics for the answer
      const metrics = calculateAnswerMetrics(processedAnswer, question);

      return new Response(JSON.stringify({
        success: true,
        question: question,
        mode: mode,
        tone: tone,
        answer: processedAnswer,
        metrics: metrics,
        suggestions: generateSuggestions(processedAnswer, mode)
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

// System prompts for different modes and tones
function getSystemPrompt(mode, tone) {
  const basePrompt = "You are an expert FAQ content writer who creates clear, helpful, and SEO-optimized answers.";
  
  const modeInstructions = {
    generate: "Generate comprehensive answers that directly address the question. Include relevant details and maintain clarity.",
    expand: "Expand existing content by adding more detail, context, or examples while maintaining the original meaning.",
    examples: "Add concrete, relevant examples to make the content more practical and understandable.",
    tone: "Adjust the tone and style while preserving all important information."
  };

  const toneInstructions = {
    professional: "Use a professional, business-appropriate tone. Be formal but approachable.",
    casual: "Use a friendly, conversational tone. Be approachable and easy to understand.",
    technical: "Use precise technical language appropriate for knowledgeable audiences.",
    creative: "Use an engaging, creative tone that captures attention while remaining informative."
  };

  return `${basePrompt} ${modeInstructions[mode] || modeInstructions.generate} ${toneInstructions[tone] || toneInstructions.professional}`;
}

// Create specific prompts for different modes
function createPrompt(mode, question, existingAnswer, tone, context, industry) {
  const contextInfo = context ? `Context: ${context}\n` : '';
  const industryInfo = industry ? `Industry: ${industry}\n` : '';
  
  switch (mode) {
    case 'generate':
      return `${contextInfo}${industryInfo}Question: "${question}"

Create a comprehensive FAQ answer that:
- Directly answers the question
- Is 50-300 characters for SEO optimization
- Uses clear, accessible language
- Includes relevant details
- Is structured for easy reading

Answer:`;

    case 'expand':
      return `${contextInfo}${industryInfo}Question: "${question}"
Current Answer: "${existingAnswer}"

Expand this answer by:
- Adding more relevant details
- Including additional context
- Providing more comprehensive information
- Maintaining clarity and readability
- Keeping the core message intact

Expanded Answer:`;

    case 'examples':
      return `${contextInfo}${industryInfo}Question: "${question}"
Current Answer: "${existingAnswer}"

Add concrete, relevant examples to this answer:
- Include 2-3 specific examples
- Make examples realistic and practical
- Integrate examples naturally into the content
- Maintain the original answer's structure

Answer with Examples:`;

    case 'tone':
      return `${contextInfo}${industryInfo}Question: "${question}"
Current Answer: "${existingAnswer}"
Target Tone: ${tone}

Rewrite this answer to match the target tone while:
- Preserving all important information
- Maintaining accuracy and clarity
- Adapting language style appropriately
- Keeping the same level of detail

Rewritten Answer:`;

    default:
      return `${contextInfo}${industryInfo}Create a helpful FAQ answer for: "${question}"`;
  }
}

// Process AI response based on mode
function processAIResponse(aiResponse, mode) {
  if (!aiResponse) return '';

  // Clean up the response
  let processed = aiResponse.trim();

  // Remove common AI prefixes
  const prefixes = [
    'Answer:', 'Expanded Answer:', 'Answer with Examples:', 'Rewritten Answer:',
    'Here\'s', 'Here is', 'The answer is', 'A:', 'Response:'
  ];

  for (const prefix of prefixes) {
    if (processed.toLowerCase().startsWith(prefix.toLowerCase())) {
      processed = processed.substring(prefix.length).trim();
    }
  }

  // Clean up markdown-style formatting for HTML
  processed = processed
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
    .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic
    .replace(/^\- (.+)$/gm, '<li>$1</li>') // List items
    .replace(/^(\d+)\. (.+)$/gm, '<li>$1. $2</li>'); // Numbered lists

  // Wrap list items in ul tags if we have any
  if (processed.includes('<li>')) {
    // Check if it's numbered or bulleted
    const hasNumbered = /^\d+\./.test(processed);
    const listTag = hasNumbered ? 'ol' : 'ul';
    
    processed = processed.replace(/(<li>.*<\/li>)/gs, `<${listTag}>$1</${listTag}>`);
  }

  // Ensure paragraphs for longer content
  if (processed.length > 100 && !processed.includes('<p>') && !processed.includes('<li>')) {
    // Split into paragraphs at double line breaks
    const paragraphs = processed.split('\n\n').filter(p => p.trim());
    if (paragraphs.length > 1) {
      processed = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
    } else {
      processed = `<p>${processed}</p>`;
    }
  }

  return processed;
}

// Calculate metrics for the generated answer
function calculateAnswerMetrics(answer, question) {
  const plainText = answer.replace(/<[^>]*>/g, ''); // Strip HTML
  const wordCount = plainText.trim().split(/\s+/).length;
  const charCount = plainText.length;
  
  // SEO score calculation
  let seoScore = 50; // Base score
  
  // Length optimization (50-300 chars is optimal)
  if (charCount >= 50 && charCount <= 300) {
    seoScore += 20;
  } else if (charCount > 300 && charCount <= 500) {
    seoScore += 10;
  } else if (charCount < 50) {
    seoScore -= 15;
  }
  
  // Word count optimization (10+ words is good)
  if (wordCount >= 10) {
    seoScore += 15;
  } else {
    seoScore -= 10;
  }
  
  // Structure bonus (lists, paragraphs)
  if (answer.includes('<li>') || answer.includes('<p>')) {
    seoScore += 10;
  }
  
  // Bold text bonus (helps with featured snippets)
  if (answer.includes('<strong>')) {
    seoScore += 5;
  }
  
  // Cap the score
  seoScore = Math.min(100, Math.max(0, seoScore));
  
  return {
    wordCount,
    charCount,
    seoScore,
    readabilityLevel: getReadabilityLevel(plainText),
    structureScore: getStructureScore(answer)
  };
}

// Calculate readability level
function getReadabilityLevel(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.trim().split(/\s+/);
  const avgWordsPerSentence = words.length / sentences.length;
  
  if (avgWordsPerSentence <= 15) return 'Easy';
  if (avgWordsPerSentence <= 20) return 'Medium';
  return 'Complex';
}

// Calculate structure score
function getStructureScore(html) {
  let score = 60; // Base score
  
  if (html.includes('<p>')) score += 10; // Paragraphs
  if (html.includes('<li>')) score += 15; // Lists
  if (html.includes('<strong>')) score += 10; // Bold text
  if (html.includes('<em>')) score += 5; // Emphasis
  
  return Math.min(100, score);
}

// Generate improvement suggestions
function generateSuggestions(answer, mode) {
  const suggestions = [];
  const plainText = answer.replace(/<[^>]*>/g, '');
  const charCount = plainText.length;
  const wordCount = plainText.trim().split(/\s+/).length;
  
  // Length suggestions
  if (charCount < 50) {
    suggestions.push({
      type: 'length',
      priority: 'high',
      message: 'Answer is too short. Add more detail to reach 50-300 characters for better SEO.',
      action: 'expand'
    });
  } else if (charCount > 500) {
    suggestions.push({
      type: 'length',
      priority: 'medium',
      message: 'Answer is quite long. Consider breaking into multiple FAQs or using bullet points.',
      action: 'restructure'
    });
  }
  
  // Structure suggestions
  if (!answer.includes('<li>') && wordCount > 20) {
    suggestions.push({
      type: 'structure',
      priority: 'medium',
      message: 'Consider using bullet points or numbered lists for better readability.',
      action: 'examples'
    });
  }
  
  // SEO suggestions
  if (!answer.includes('<strong>')) {
    suggestions.push({
      type: 'seo',
      priority: 'low',
      message: 'Add bold text to highlight key points for better featured snippet chances.',
      action: 'tone'
    });
  }
  
  return suggestions;
}