/**
 * Cloudflare Models API Worker
 * 
 * A comprehensive Cloudflare Worker that dynamically fetches all text generation models 
 * from the official Cloudflare API and returns them as enhanced JSON with useful metadata.
 * 
 * Features:
 * - Real-time model data from Cloudflare's official API
 * - Enhanced metadata including capabilities, use cases, pricing tiers
 * - Multiple endpoints for different data views
 * - Smart filtering and caching
 * - CORS support for browser applications
 * 
 * @version 1.0.0
 * @author 365i Development Team
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS for browser requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight OPTIONS request
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // Route handling
      if (pathname === '/models' || pathname === '/') {
        return await handleModelsRequest(request, env, corsHeaders);
      } else if (pathname.startsWith('/model/')) {
        const modelId = pathname.split('/model/')[1];
        return await handleSingleModelRequest(modelId, env, corsHeaders);
      } else if (pathname === '/capabilities') {
        return await handleCapabilitiesRequest(env, corsHeaders);
      } else if (pathname === '/providers') {
        return await handleProvidersRequest(env, corsHeaders);
      } else if (pathname === '/health') {
        return await handleHealthRequest(env, corsHeaders);
      } else if (pathname === '/debug') {
        return await handleDebugRequest(env, corsHeaders);
      } else {
        return new Response(JSON.stringify({ 
          error: 'Not Found',
          available_endpoints: [
            'GET /models - List all text generation models with optional filters',
            'GET /model/{model_id} - Get details for a specific model',
            'GET /capabilities - List all available capabilities',
            'GET /providers - List all model providers',
            'GET /health - Health check endpoint'
          ]
        }), { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal Server Error', 
        message: error.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Handle models list request with filtering and pagination
 */
async function handleModelsRequest(request, env, corsHeaders) {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get('provider');
    const capability = url.searchParams.get('capability');
    const task = url.searchParams.get('task'); // text-generation, text-classification, etc.
    const includeDetails = url.searchParams.get('details') === 'true';
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

    // Check cache first
    const cacheKey = `models:${provider || 'all'}:${capability || 'all'}:${task || 'all'}:${includeDetails}:${page}:${limit}`;
    const cached = await getCachedData(env.MODELS_CACHE, cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached, null, 2), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': 'HIT'
        }
      });
    }

    // Fetch models from Cloudflare API
    const modelsData = await fetchModelsFromAPI(env);
    
    if (!modelsData) {
      throw new Error('Failed to fetch models from Cloudflare API');
    }

    // Filter for text generation and related models
    let filteredModels = modelsData.filter(model => {
      const taskName = model.task?.name?.toLowerCase() || '';
      return taskName.includes('text generation') ||
             taskName.includes('text classification') ||
             taskName.includes('automatic speech recognition') ||
             taskName.includes('translation') ||
             taskName.includes('summarization') ||
             taskName.includes('question');
    });

    // Apply filters
    if (provider) {
      filteredModels = filteredModels.filter(model =>
        model.id.toLowerCase().includes(provider.toLowerCase()) ||
        (model.properties && model.properties.provider &&
         model.properties.provider.toLowerCase().includes(provider.toLowerCase()))
      );
    }

    if (task) {
      filteredModels = filteredModels.filter(model => {
        const taskName = model.task?.name?.toLowerCase() || '';
        return taskName.includes(task.toLowerCase());
      });
    }

    // Transform models to include enhanced information
    const enhancedModels = filteredModels.map(model => enhanceModelData(model, includeDetails));

    // Filter by capability after enhancement
    let finalModels = enhancedModels;
    if (capability) {
      const capabilityLower = capability.toLowerCase();
      finalModels = enhancedModels.filter(model => 
        model.capabilities.some(cap => cap.toLowerCase().includes(capabilityLower))
      );
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedModels = finalModels.slice(startIndex, endIndex);

    const response = {
      total: finalModels.length,
      page: page,
      limit: limit,
      total_pages: Math.ceil(finalModels.length / limit),
      models: paginatedModels,
      filters_applied: {
        provider: provider || null,
        task: task || null,
        capability: capability || null,
        details: includeDetails
      },
      available_filters: {
        providers: [...new Set(filteredModels.map(m => extractProvider(m.id)))],
        tasks: [...new Set(filteredModels.map(m => m.task?.name))].filter(Boolean),
        capabilities: [...new Set(enhancedModels.flatMap(m => m.capabilities))]
      },
      last_updated: new Date().toISOString(),
      cache_info: {
        cached: false,
        ttl: parseInt(env.CACHE_TTL || '300')
      }
    };

    // Cache the response
    await setCachedData(env.MODELS_CACHE, cacheKey, response, parseInt(env.CACHE_TTL || '300'));

    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'MISS'
      }
    });
  } catch (error) {
    console.error('Models request error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch models', 
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle single model request
 */
async function handleSingleModelRequest(modelId, env, corsHeaders) {
  try {
    const cacheKey = `model:${modelId}`;
    const cached = await getCachedData(env.MODELS_CACHE, cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached, null, 2), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600',
          'X-Cache': 'HIT'
        }
      });
    }

    const modelsData = await fetchModelsFromAPI(env);
    
    if (!modelsData) {
      throw new Error('Failed to fetch models from Cloudflare API');
    }

    const model = modelsData.find(m => m.id === modelId);

    if (!model) {
      return new Response(JSON.stringify({ 
        error: 'Model not found',
        message: `Model '${modelId}' not found`,
        suggestion: 'Use /models to see all available models'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const enhancedModel = enhanceModelData(model, true);
    
    // Cache the response
    await setCachedData(env.MODELS_CACHE, cacheKey, enhancedModel, 600);

    return new Response(JSON.stringify(enhancedModel, null, 2), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',
        'X-Cache': 'MISS'
      }
    });
  } catch (error) {
    console.error('Single model request error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch model', 
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle capabilities request
 */
async function handleCapabilitiesRequest(env, corsHeaders) {
  try {
    const cacheKey = 'capabilities:all';
    const cached = await getCachedData(env.MODELS_CACHE, cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached, null, 2), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600',
          'X-Cache': 'HIT'
        }
      });
    }

    const modelsData = await fetchModelsFromAPI(env);
    
    if (!modelsData) {
      throw new Error('Failed to fetch models from Cloudflare API');
    }

    const textModels = modelsData.filter(model => {
      const taskName = model.task?.name?.toLowerCase() || '';
      return taskName.includes('text generation') ||
             taskName.includes('text classification') ||
             taskName.includes('automatic speech recognition') ||
             taskName.includes('translation') ||
             taskName.includes('summarization') ||
             taskName.includes('question');
    });

    const enhancedModels = textModels.map(model => enhanceModelData(model, false));
    const capabilities = [...new Set(enhancedModels.flatMap(m => m.capabilities))].sort();

    const capabilityDetails = capabilities.map(capability => ({
      name: capability,
      description: getCapabilityDescription(capability),
      model_count: enhancedModels.filter(m => m.capabilities.includes(capability)).length,
      example_models: enhancedModels
        .filter(m => m.capabilities.includes(capability))
        .slice(0, 3)
        .map(m => ({ id: m.id, name: formatModelName(m.id), provider: m.provider }))
    }));

    const response = {
      total_capabilities: capabilities.length,
      capabilities: capabilityDetails,
      last_updated: new Date().toISOString()
    };

    // Cache the response
    await setCachedData(env.MODELS_CACHE, cacheKey, response, 600);

    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',
        'X-Cache': 'MISS'
      }
    });
  } catch (error) {
    console.error('Capabilities request error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch capabilities', 
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle providers request
 */
async function handleProvidersRequest(env, corsHeaders) {
  try {
    const cacheKey = 'providers:all';
    const cached = await getCachedData(env.MODELS_CACHE, cacheKey);
    if (cached) {
      return new Response(JSON.stringify(cached, null, 2), {
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=600',
          'X-Cache': 'HIT'
        }
      });
    }

    const modelsData = await fetchModelsFromAPI(env);
    
    if (!modelsData) {
      throw new Error('Failed to fetch models from Cloudflare API');
    }

    const textModels = modelsData.filter(model => {
      const taskName = model.task?.name?.toLowerCase() || '';
      return taskName.includes('text generation') ||
             taskName.includes('text classification') ||
             taskName.includes('automatic speech recognition') ||
             taskName.includes('translation') ||
             taskName.includes('summarization') ||
             taskName.includes('question');
    });

    const providerMap = new Map();

    textModels.forEach(model => {
      const provider = extractProvider(model.id);
      if (!providerMap.has(provider)) {
        providerMap.set(provider, {
          name: provider,
          model_count: 0,
          models: [],
          tasks: new Set()
        });
      }
      
      const providerData = providerMap.get(provider);
      providerData.model_count++;
      providerData.models.push({
        id: model.id,
        display_name: formatModelName(model.id),
        task: model.task?.name || 'Unknown'
      });
      providerData.tasks.add(model.task?.name || 'Unknown');
    });

    const providers = Array.from(providerMap.values()).map(provider => ({
      ...provider,
      tasks: Array.from(provider.tasks),
      models: provider.models.slice(0, 5) // Limit to first 5 models for brevity
    }));

    const response = {
      total_providers: providers.length,
      providers: providers,
      last_updated: new Date().toISOString()
    };

    // Cache the response
    await setCachedData(env.MODELS_CACHE, cacheKey, response, 600);

    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',
        'X-Cache': 'MISS'
      }
    });
  } catch (error) {
    console.error('Providers request error:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch providers', 
      message: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle debug request - shows raw API data
 */
async function handleDebugRequest(env, corsHeaders) {
  try {
    const modelsData = await fetchModelsFromAPI(env);
    
    if (!modelsData) {
      throw new Error('Failed to fetch models from Cloudflare API');
    }

    // Show first 5 models with their tasks and names
    const sampleModels = modelsData.slice(0, 10).map(model => ({
      id: model.id,
      display_name: model.display_name,
      task: model.task,
      properties: model.properties || {}
    }));

    // Get unique task types
    const allTasks = [...new Set(modelsData.map(m => m.task))].filter(Boolean);

    const response = {
      total_models: modelsData.length,
      sample_models: sampleModels,
      all_task_types: allTasks,
      task_counts: allTasks.map(task => ({
        task,
        count: modelsData.filter(m => m.task === task).length
      }))
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Debug request error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch debug data',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle health check request
 */
async function handleHealthRequest(env, corsHeaders) {
  try {
    const startTime = Date.now();
    
    // Test API connectivity
    const testResult = await testAPIConnectivity(env);
    
    const response = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: env.WORKER_VERSION || '1.0.0',
      api_connectivity: testResult,
      response_time_ms: Date.now() - startTime,
      cache_status: 'operational'
    };

    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
    return new Response(JSON.stringify({ 
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message 
    }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Fetch models from Cloudflare API
 */
async function fetchModelsFromAPI(env) {
  // Check if we have required environment variables
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error('Missing required environment variables: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
  }

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CloudflareModelsAPIWorker/1.0.0'
    }
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Cloudflare API error: ${response.status} - ${errorData}`);
  }

  const data = await response.json();
  
  if (!data.success) {
    throw new Error(`API request failed: ${JSON.stringify(data.errors)}`);
  }

  return data.result;
}

/**
 * Test API connectivity
 */
async function testAPIConnectivity(env) {
  try {
    const modelsData = await fetchModelsFromAPI(env);
    return {
      status: 'connected',
      model_count: modelsData ? modelsData.length : 0
    };
  } catch (error) {
    return {
      status: 'disconnected',
      error: error.message
    };
  }
}

/**
 * Enhance model data with additional metadata
 */
function enhanceModelData(model, includeDetails = false) {
  // Extract real model name from properties info URL
  const realModelId = extractRealModelId(model);
  const provider = extractProvider(realModelId);
  const capabilities = extractCapabilities(model, realModelId);
  const parameterCount = extractParameterCount(realModelId);
  const useCase = determineUseCase(model, realModelId);

  const enhanced = {
    id: realModelId, // Use extracted model name instead of UUID
    name: formatModelName(realModelId),
    display_name: formatModelName(realModelId),
    description: generateModelDescription(realModelId, provider, model),
    provider: provider,
    task: model.task,
    capabilities: capabilities,
    use_cases: useCase,
    parameter_count: parameterCount,
    pricing_tier: determinePricingTier(model, parameterCount),
    best_for: determineBestFor(model, capabilities),
    performance_characteristics: getPerformanceCharacteristics(model, parameterCount),
    recommended_use_cases: getRecommendedUseCases(model, capabilities),
    uuid: model.id // Keep original UUID for reference
  };

  if (includeDetails) {
    enhanced.details = {
      full_description: generateModelDescription(realModelId, provider, model),
      properties: model.properties || {},
      schema: model.schema || null,
      raw_model_data: model
    };
  }

  return enhanced;
}

/**
 * Extract provider from model name
 */
function extractProvider(modelName) {
  const providers = {
    'meta': 'Meta',
    'google': 'Google', 
    'mistralai': 'MistralAI',
    'qwen': 'Qwen',
    'deepseek': 'DeepSeek',
    'openai': 'OpenAI',
    'huggingface': 'HuggingFace',
    'microsoft': 'Microsoft',
    'baai': 'BAAI',
    'anthropic': 'Anthropic',
    'cohere': 'Cohere'
  };

  for (const [key, value] of Object.entries(providers)) {
    if (modelName.includes(`/${key}/`) || modelName.includes(`-${key}-`) || modelName.toLowerCase().includes(key)) {
      return value;
    }
  }

  return 'Unknown';
}

/**
 * Extract capabilities from model
 */
function extractCapabilities(model, realModelId = null) {
  const capabilities = [];
  const name = (realModelId || model.id || '').toLowerCase();
  const task = (model.task?.name || '').toLowerCase();

  // Task-based capabilities
  if (task.includes('text generation')) {
    capabilities.push('text_generation');
  }
  if (task.includes('text classification')) {
    capabilities.push('text_classification');
  }
  if (task.includes('translation')) {
    capabilities.push('translation');
  }
  if (task.includes('speech')) {
    capabilities.push('speech_recognition');
  }
  if (task.includes('summarization')) {
    capabilities.push('summarization');
  }
  if (task.includes('question')) {
    capabilities.push('question_answering');
  }
  if (task.includes('embeddings')) {
    capabilities.push('text_embeddings');
  }
  if (task.includes('image')) {
    capabilities.push('image_processing');
  }

  // Model-specific capabilities from name
  if (name.includes('instruct') || name.includes('chat')) {
    capabilities.push('instruction_following', 'conversational');
  }
  if (name.includes('code')) {
    capabilities.push('code_generation');
  }
  if (name.includes('multilingual')) {
    capabilities.push('multilingual');
  }
  if (name.includes('vision') || name.includes('image')) {
    capabilities.push('multimodal', 'vision');
  }
  if (name.includes('fast') || name.includes('quick')) {
    capabilities.push('fast_inference');
  }
  if (name.includes('reasoning')) {
    capabilities.push('reasoning');
  }
  if (name.includes('awq') || name.includes('int8') || name.includes('fp8')) {
    capabilities.push('quantized');
  }

  // Check properties for additional capabilities
  if (model.properties && Array.isArray(model.properties)) {
    const hasLora = model.properties.some(prop => prop.property_id === 'lora');
    if (hasLora) {
      capabilities.push('fine_tunable');
    }
    
    const isBeta = model.properties.some(prop => prop.property_id === 'beta');
    if (isBeta) {
      capabilities.push('beta');
    }
  }

  return capabilities.length > 0 ? capabilities : ['general'];
}

/**
 * Extract parameter count from model name
 */
function extractParameterCount(modelId) {
  const name = (modelId || '').toLowerCase();
  
  const patterns = [
    /(\d+\.?\d*)b/,  // 7b, 13b, 70b, etc.
    /(\d+)b/,        // 7b, 13b, 70b
    /(\d+\.?\d*)m/   // 500m, 1.5m, etc.
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      const num = parseFloat(match[1]);
      if (name.includes('b')) {
        return `${num}B`;
      } else if (name.includes('m')) {
        return `${num}M`;
      }
    }
  }

  return 'Unknown';
}

/**
 * Determine pricing tier based on model characteristics
 */
function determinePricingTier(model, parameterCount) {
  const paramNum = parseFloat(parameterCount);
  
  if (parameterCount.includes('B') && paramNum >= 70) {
    return 'premium';
  } else if (parameterCount.includes('B') && paramNum >= 30) {
    return 'standard';
  } else if (parameterCount.includes('B') && paramNum >= 7) {
    return 'basic';
  } else {
    return 'economy';
  }
}

/**
 * Determine use cases for model
 */
function determineUseCase(model, realModelId = null) {
  const name = (realModelId || model.id || '').toLowerCase();
  const taskName = (model.task?.name || '').toLowerCase();
  const useCases = [];

  if (name.includes('chat') || name.includes('instruct')) {
    useCases.push('conversational_ai', 'customer_support');
  }
  if (name.includes('code')) {
    useCases.push('code_generation', 'programming_assistance');
  }
  if (name.includes('reasoning')) {
    useCases.push('complex_problem_solving', 'analysis');
  }
  if (taskName.includes('image') || name.includes('vision')) {
    useCases.push('multimodal_applications', 'image_analysis');
  }
  if (taskName.includes('text classification')) {
    useCases.push('sentiment_analysis', 'content_moderation');
  }
  if (taskName.includes('translation')) {
    useCases.push('language_translation', 'localization');
  }
  if (taskName.includes('summarization')) {
    useCases.push('document_summarization', 'content_extraction');
  }
  if (taskName.includes('embeddings')) {
    useCases.push('semantic_search', 'rag_applications');
  }
  if (taskName.includes('speech')) {
    useCases.push('voice_applications', 'transcription');
  }

  return useCases.length > 0 ? useCases : ['general_purpose'];
}

/**
 * Determine what the model is best for
 */
function determineBestFor(model, capabilities) {
  if (capabilities.includes('reasoning') && capabilities.includes('function_calling')) {
    return 'Advanced AI agents requiring complex reasoning and tool use';
  } else if (capabilities.includes('code_generation')) {
    return 'Developer tools and programming assistants';
  } else if (capabilities.includes('multimodal')) {
    return 'Applications requiring both text and image understanding';
  } else if (capabilities.includes('fast_inference')) {
    return 'High-throughput applications requiring quick responses';
  } else if (capabilities.includes('multilingual')) {
    return 'Global applications supporting multiple languages';
  } else if (capabilities.includes('conversational')) {
    return 'Chatbots and customer service applications';
  } else if (capabilities.includes('summarization')) {
    return 'Document processing and content summarization';
  } else {
    return 'General-purpose text generation tasks';
  }
}

/**
 * Get performance characteristics
 */
function getPerformanceCharacteristics(model, parameterCount) {
  const characteristics = [];
  const paramNum = parseFloat(parameterCount);
  
  if (parameterCount.includes('B') && paramNum >= 70) {
    characteristics.push('high_accuracy', 'complex_reasoning');
  } else if (parameterCount.includes('B') && paramNum >= 30) {
    characteristics.push('balanced_performance', 'good_accuracy');
  } else {
    characteristics.push('fast_inference', 'efficient');
  }

  if (model.id.includes('instruct')) {
    characteristics.push('instruction_optimized');
  }
  
  if (model.id.includes('chat')) {
    characteristics.push('conversation_optimized');
  }

  return characteristics;
}

/**
 * Get recommended use cases with detailed descriptions
 */
function getRecommendedUseCases(model, capabilities) {
  const useCases = [];
  
  if (capabilities.includes('conversational')) {
    useCases.push({
      category: 'Customer Support',
      description: 'Automated customer service, FAQ responses, live chat assistance'
    });
  }
  
  if (capabilities.includes('code_generation')) {
    useCases.push({
      category: 'Development Tools',
      description: 'Code completion, debugging assistance, technical documentation'
    });
  }
  
  if (capabilities.includes('reasoning')) {
    useCases.push({
      category: 'Business Intelligence',
      description: 'Data analysis, decision support, complex problem solving'
    });
  }
  
  if (capabilities.includes('text_generation')) {
    useCases.push({
      category: 'Content Creation',
      description: 'Blog posts, marketing copy, creative writing assistance'
    });
  }

  return useCases;
}

/**
 * Format model name for display
 */
function formatModelName(modelName) {
  return modelName
    .split('/')
    .pop()
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Get capability description
 */
function getCapabilityDescription(capability) {
  const descriptions = {
    'text_generation': 'Generate human-like text from prompts',
    'text_classification': 'Classify and categorize text content',
    'instruction_following': 'Follow complex instructions and guidelines',
    'conversational': 'Engage in natural dialogue and conversations',
    'code_generation': 'Generate and understand programming code',
    'multilingual': 'Support multiple languages',
    'multimodal': 'Process both text and images',
    'vision': 'Understand and analyze images',
    'fast_inference': 'Optimized for quick response times',
    'reasoning': 'Perform complex logical reasoning',
    'function_calling': 'Call external functions and APIs',
    'quantized': 'Optimized model with reduced memory usage',
    'translation': 'Translate between different languages',
    'speech_recognition': 'Convert speech to text',
    'summarization': 'Create concise summaries of longer texts',
    'question_answering': 'Answer questions based on context',
    'general': 'General-purpose text processing'
  };

  return descriptions[capability] || 'No description available';
}

/**
 * Cache helper functions
 */
async function getCachedData(cache, key) {
  try {
    const cached = await cache.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Cache get error:', error);
    return null;
  }
}

async function setCachedData(cache, key, data, ttl = 300) {
  try {
    await cache.put(key, JSON.stringify(data), { expirationTtl: ttl });
  } catch (error) {
    console.error('Cache set error:', error);
  }
}

/**
 * Extract real model ID from Cloudflare API response
 * The API returns UUIDs as IDs, but real model names are in properties.info URLs
 */
function extractRealModelId(model) {
  if (!model.properties || !Array.isArray(model.properties)) {
    return `cf-model-${model.id.substring(0, 8)}`;
  }

  // Look for info property with HuggingFace or other model URLs
  const infoProperty = model.properties.find(prop => prop.property_id === 'info');
  if (infoProperty && infoProperty.value) {
    const url = infoProperty.value;
    
    // Extract model name from HuggingFace URLs
    if (url.includes('huggingface.co/')) {
      const parts = url.split('/');
      const modelPath = parts.slice(-2).join('/'); // Get last two parts (org/model)
      return `@cf/${modelPath}`;
    }
    
    // Extract from other URLs
    if (url.includes('/')) {
      const parts = url.split('/');
      const modelName = parts[parts.length - 1];
      return `@cf/${modelName}`;
    }
  }

  // Fallback: use task name + shortened UUID
  const taskName = model.task?.name?.toLowerCase().replace(/\s+/g, '-') || 'unknown';
  const shortId = model.id.substring(0, 8);
  return `@cf/${taskName}/${shortId}`;
}

/**
 * Generate a proper description for the model
 */
function generateModelDescription(modelId, provider, model) {
  const taskName = model.task?.name || 'AI model';
  const baseDescription = `${provider} ${taskName} - ${formatModelName(modelId)}`;
  
  // Add context window info if available
  const contextProp = model.properties?.find(prop => prop.property_id === 'context_window');
  if (contextProp) {
    return `${baseDescription} (Context: ${contextProp.value} tokens)`;
  }
  
  return baseDescription;
}