/**
 * Cloudflare Models API Worker - Usage Examples
 * 
 * This file demonstrates how to use the Cloudflare Models API Worker
 * from various environments and use cases.
 * 
 * @version 1.0.0
 * @author 365i Development Team
 */

// Configuration
const WORKER_URL = 'https://your-worker.your-subdomain.workers.dev';

/**
 * Example 1: Basic Models Fetching
 */
async function fetchAllModels() {
  console.log('🔍 Fetching all models...');
  
  try {
    const response = await fetch(`${WORKER_URL}/models`);
    const data = await response.json();
    
    console.log(`📊 Found ${data.total} models across ${data.total_pages} pages`);
    console.log(`🔧 Available providers: ${data.available_filters.providers.join(', ')}`);
    console.log(`⚡ Available capabilities: ${data.available_filters.capabilities.slice(0, 5).join(', ')}...`);
    
    return data;
  } catch (error) {
    console.error('❌ Error fetching models:', error);
    throw error;
  }
}

/**
 * Example 2: Filtered Model Search
 */
async function findMetaModels() {
  console.log('🔍 Searching for Meta models...');
  
  try {
    const response = await fetch(`${WORKER_URL}/models?provider=meta&details=true&limit=10`);
    const data = await response.json();
    
    console.log(`🦾 Found ${data.total} Meta models`);
    
    data.models.forEach(model => {
      console.log(`  📋 ${model.display_name}`);
      console.log(`     🏷️  Capabilities: ${model.capabilities.join(', ')}`);
      console.log(`     💰 Pricing Tier: ${model.pricing_tier}`);
      console.log(`     🎯 Best For: ${model.best_for}`);
      console.log('');
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error searching Meta models:', error);
    throw error;
  }
}

/**
 * Example 3: Find Models by Capability
 */
async function findReasoningModels() {
  console.log('🧠 Finding models with reasoning capabilities...');
  
  try {
    const response = await fetch(`${WORKER_URL}/models?capability=reasoning&task=text-generation`);
    const data = await response.json();
    
    console.log(`🤖 Found ${data.total} reasoning-capable models`);
    
    data.models.forEach(model => {
      console.log(`  🧮 ${model.display_name} (${model.parameter_count})`);
      console.log(`     🏢 Provider: ${model.provider}`);
      console.log(`     💡 Use Cases: ${model.use_cases.join(', ')}`);
      console.log('');
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error finding reasoning models:', error);
    throw error;
  }
}

/**
 * Example 4: Get Specific Model Details
 */
async function getModelDetails(modelId) {
  console.log(`🔎 Getting details for model: ${modelId}`);
  
  try {
    const response = await fetch(`${WORKER_URL}/model/${encodeURIComponent(modelId)}`);
    const data = await response.json();
    
    if (response.ok) {
      console.log(`📝 Model: ${data.display_name}`);
      console.log(`🏢 Provider: ${data.provider}`);
      console.log(`🔢 Parameters: ${data.parameter_count}`);
      console.log(`⚡ Capabilities: ${data.capabilities.join(', ')}`);
      console.log(`🎯 Best For: ${data.best_for}`);
      console.log(`📊 Performance: ${data.performance_characteristics.join(', ')}`);
      
      if (data.recommended_use_cases.length > 0) {
        console.log('💼 Recommended Use Cases:');
        data.recommended_use_cases.forEach(useCase => {
          console.log(`  • ${useCase.category}: ${useCase.description}`);
        });
      }
      
      return data;
    } else {
      console.log(`❌ Model not found: ${data.message}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Error getting model details:', error);
    throw error;
  }
}

/**
 * Example 5: Explore All Capabilities
 */
async function exploreCapabilities() {
  console.log('🛠️ Exploring all available capabilities...');
  
  try {
    const response = await fetch(`${WORKER_URL}/capabilities`);
    const data = await response.json();
    
    console.log(`🔧 Found ${data.total_capabilities} capabilities`);
    
    data.capabilities.forEach(capability => {
      console.log(`\n🏷️  ${capability.name.toUpperCase()}`);
      console.log(`   📝 ${capability.description}`);
      console.log(`   📊 ${capability.model_count} models available`);
      console.log(`   🔧 Examples: ${capability.example_models.map(m => m.name).join(', ')}`);
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error exploring capabilities:', error);
    throw error;
  }
}

/**
 * Example 6: Provider Analysis
 */
async function analyzeProviders() {
  console.log('🏢 Analyzing model providers...');
  
  try {
    const response = await fetch(`${WORKER_URL}/providers`);
    const data = await response.json();
    
    console.log(`🏭 Found ${data.total_providers} providers`);
    
    // Sort providers by model count
    const sortedProviders = data.providers.sort((a, b) => b.model_count - a.model_count);
    
    sortedProviders.forEach(provider => {
      console.log(`\n🏢 ${provider.name}`);
      console.log(`   📊 Models: ${provider.model_count}`);
      console.log(`   🎯 Tasks: ${provider.tasks.join(', ')}`);
      console.log(`   🔧 Sample Models: ${provider.models.slice(0, 3).map(m => m.display_name).join(', ')}`);
    });
    
    return data;
  } catch (error) {
    console.error('❌ Error analyzing providers:', error);
    throw error;
  }
}

/**
 * Example 7: Health Check and Monitoring
 */
async function checkWorkerHealth() {
  console.log('🏥 Checking worker health...');
  
  try {
    const startTime = Date.now();
    const response = await fetch(`${WORKER_URL}/health`);
    const responseTime = Date.now() - startTime;
    const data = await response.json();
    
    if (data.status === 'healthy') {
      console.log('✅ Worker is healthy');
      console.log(`⏱️  Response Time: ${responseTime}ms (Worker: ${data.response_time_ms}ms)`);
      console.log(`🔗 API Connectivity: ${data.api_connectivity.status}`);
      console.log(`📊 Available Models: ${data.api_connectivity.model_count}`);
      console.log(`📦 Worker Version: ${data.version}`);
    } else {
      console.log(`⚠️  Worker status: ${data.status}`);
    }
    
    return data;
  } catch (error) {
    console.error('❌ Health check failed:', error);
    throw error;
  }
}

/**
 * Example 8: Smart Model Recommendation System
 */
async function recommendModels(useCase) {
  console.log(`🎯 Finding models recommended for: ${useCase}`);
  
  try {
    // Get all models with details
    const response = await fetch(`${WORKER_URL}/models?details=true&limit=100`);
    const data = await response.json();
    
    // Filter models based on use case
    const recommendations = data.models.filter(model => {
      const useCaseMatch = model.use_cases.some(uc => 
        uc.toLowerCase().includes(useCase.toLowerCase())
      );
      const bestForMatch = model.best_for.toLowerCase().includes(useCase.toLowerCase());
      const recommendedMatch = model.recommended_use_cases.some(ruc => 
        ruc.category.toLowerCase().includes(useCase.toLowerCase()) ||
        ruc.description.toLowerCase().includes(useCase.toLowerCase())
      );
      
      return useCaseMatch || bestForMatch || recommendedMatch;
    });
    
    // Sort by pricing tier (economy first, then basic, standard, premium)
    const tierOrder = { economy: 0, basic: 1, standard: 2, premium: 3 };
    recommendations.sort((a, b) => tierOrder[a.pricing_tier] - tierOrder[b.pricing_tier]);
    
    console.log(`🔍 Found ${recommendations.length} suitable models:`);
    
    recommendations.slice(0, 5).forEach((model, index) => {
      console.log(`\n${index + 1}. 🤖 ${model.display_name}`);
      console.log(`   🏢 Provider: ${model.provider}`);
      console.log(`   💰 Pricing: ${model.pricing_tier}`);
      console.log(`   🔢 Size: ${model.parameter_count}`);
      console.log(`   🎯 Best For: ${model.best_for}`);
      console.log(`   ⚡ Performance: ${model.performance_characteristics.join(', ')}`);
    });
    
    return recommendations;
  } catch (error) {
    console.error('❌ Error getting recommendations:', error);
    throw error;
  }
}

/**
 * Example 9: Batch Operations
 */
async function performBatchAnalysis() {
  console.log('📊 Performing batch analysis...');
  
  try {
    // Parallel requests for different data
    const [modelsData, capabilitiesData, providersData, healthData] = await Promise.all([
      fetch(`${WORKER_URL}/models?limit=50`).then(r => r.json()),
      fetch(`${WORKER_URL}/capabilities`).then(r => r.json()),
      fetch(`${WORKER_URL}/providers`).then(r => r.json()),
      fetch(`${WORKER_URL}/health`).then(r => r.json())
    ]);
    
    // Analyze the data
    const analysis = {
      totalModels: modelsData.total,
      totalCapabilities: capabilitiesData.total_capabilities,
      totalProviders: providersData.total_providers,
      workerHealth: healthData.status,
      
      // Most common capabilities
      topCapabilities: capabilitiesData.capabilities
        .sort((a, b) => b.model_count - a.model_count)
        .slice(0, 5)
        .map(cap => ({ name: cap.name, count: cap.model_count })),
      
      // Provider distribution
      providerDistribution: providersData.providers
        .sort((a, b) => b.model_count - a.model_count)
        .map(prov => ({ name: prov.name, count: prov.model_count })),
      
      // Pricing tier distribution
      pricingDistribution: modelsData.models.reduce((acc, model) => {
        acc[model.pricing_tier] = (acc[model.pricing_tier] || 0) + 1;
        return acc;
      }, {})
    };
    
    console.log('📈 Analysis Results:');
    console.log(`   📊 Total Models: ${analysis.totalModels}`);
    console.log(`   🛠️  Total Capabilities: ${analysis.totalCapabilities}`);
    console.log(`   🏢 Total Providers: ${analysis.totalProviders}`);
    console.log(`   🏥 Worker Health: ${analysis.workerHealth}`);
    
    console.log('\n🔝 Top Capabilities:');
    analysis.topCapabilities.forEach(cap => {
      console.log(`   • ${cap.name}: ${cap.count} models`);
    });
    
    console.log('\n🏢 Provider Distribution:');
    analysis.providerDistribution.forEach(prov => {
      console.log(`   • ${prov.name}: ${prov.count} models`);
    });
    
    console.log('\n💰 Pricing Distribution:');
    Object.entries(analysis.pricingDistribution).forEach(([tier, count]) => {
      console.log(`   • ${tier}: ${count} models`);
    });
    
    return analysis;
  } catch (error) {
    console.error('❌ Error performing batch analysis:', error);
    throw error;
  }
}

/**
 * Example 10: Paginated Data Fetching
 */
async function fetchAllModelsWithPagination() {
  console.log('📄 Fetching all models with pagination...');
  
  const allModels = [];
  let page = 1;
  let hasMore = true;
  
  try {
    while (hasMore) {
      console.log(`   📄 Fetching page ${page}...`);
      
      const response = await fetch(`${WORKER_URL}/models?page=${page}&limit=50`);
      const data = await response.json();
      
      allModels.push(...data.models);
      
      hasMore = page < data.total_pages;
      page++;
      
      // Small delay to be respectful to the API
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`✅ Fetched all ${allModels.length} models`);
    
    // Group by provider
    const modelsByProvider = allModels.reduce((acc, model) => {
      if (!acc[model.provider]) {
        acc[model.provider] = [];
      }
      acc[model.provider].push(model);
      return acc;
    }, {});
    
    console.log('\n📊 Models by Provider:');
    Object.entries(modelsByProvider).forEach(([provider, models]) => {
      console.log(`   • ${provider}: ${models.length} models`);
    });
    
    return allModels;
  } catch (error) {
    console.error('❌ Error fetching paginated data:', error);
    throw error;
  }
}

/**
 * Demo Runner - Execute all examples
 */
async function runDemo() {
  console.log('🚀 Starting Cloudflare Models API Worker Demo\n');
  console.log(`🔗 Worker URL: ${WORKER_URL}\n`);
  
  const examples = [
    { name: 'Health Check', fn: checkWorkerHealth },
    { name: 'Fetch All Models', fn: fetchAllModels },
    { name: 'Find Meta Models', fn: findMetaModels },
    { name: 'Find Reasoning Models', fn: findReasoningModels },
    { name: 'Explore Capabilities', fn: exploreCapabilities },
    { name: 'Analyze Providers', fn: analyzeProviders },
    { name: 'Model Recommendations', fn: () => recommendModels('code generation') },
    { name: 'Batch Analysis', fn: performBatchAnalysis },
    { name: 'Model Details', fn: () => getModelDetails('@cf/meta/llama-3.1-8b-instruct') }
  ];
  
  for (const example of examples) {
    try {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🎯 Running: ${example.name}`);
      console.log('='.repeat(60));
      
      await example.fn();
      
      console.log(`\n✅ Completed: ${example.name}`);
      
      // Small delay between examples
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.log(`\n❌ Failed: ${example.name} - ${error.message}`);
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('🎉 Demo completed!');
  console.log('='.repeat(60));
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchAllModels,
    findMetaModels,
    findReasoningModels,
    getModelDetails,
    exploreCapabilities,
    analyzeProviders,
    checkWorkerHealth,
    recommendModels,
    performBatchAnalysis,
    fetchAllModelsWithPagination,
    runDemo
  };
}

// Auto-run demo if this file is executed directly
if (typeof window === 'undefined' && require.main === module) {
  runDemo().catch(console.error);
}