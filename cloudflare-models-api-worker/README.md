# Cloudflare Models API Worker

A comprehensive Cloudflare Worker that dynamically fetches all text generation models from the official Cloudflare API and returns them as enhanced JSON with useful metadata.

## Features

🚀 **Real-time Model Data** - Fetches live data from Cloudflare's official API endpoint  
🔍 **Enhanced Metadata** - Adds practical information like capabilities, use cases, pricing tiers  
📊 **Multiple Endpoints** - Different views for models, capabilities, and providers  
🎯 **Smart Filtering** - Filter by provider, capability, or task type  
⚡ **Caching** - Built-in response caching for optimal performance  
🌐 **CORS Support** - Works perfectly with browser applications  
🛡️ **Error Handling** - Comprehensive error responses with helpful suggestions  
📄 **Pagination** - Handle large datasets efficiently  

## API Endpoints

### GET `/models` or `/`
List all text generation models with optional filtering and pagination.

**Query Parameters:**
- `provider` - Filter by model provider (e.g., `meta`, `google`, `mistralai`)
- `task` - Filter by task type (e.g., `text-generation`, `text-classification`)
- `capability` - Filter by capability (e.g., `reasoning`, `code_generation`)
- `details` - Include detailed metadata (`true`/`false`)
- `page` - Page number for pagination (default: 1)
- `limit` - Items per page (default: 50, max: 100)

**Example:**
```bash
GET /models?provider=meta&capability=reasoning&details=true&page=1&limit=10
```

### GET `/model/{model_id}`
Get detailed information for a specific model.

**Example:**
```bash
GET /model/@cf/meta/llama-3.1-8b-instruct
```

### GET `/capabilities`
List all available model capabilities with descriptions and example models.

### GET `/providers`
List all model providers with their model counts and supported tasks.

### GET `/health`
Health check endpoint for monitoring worker status.

## Response Format

### Models List Response
```json
{
  "total": 150,
  "page": 1,
  "limit": 50,
  "total_pages": 3,
  "models": [
    {
      "id": "@cf/meta/llama-3.1-8b-instruct",
      "display_name": "Meta Llama 3.1 8B Instruct",
      "provider": "Meta",
      "task": "text-generation",
      "capabilities": ["text_generation", "instruction_following", "conversational"],
      "use_cases": ["conversational_ai", "customer_support"],
      "parameter_count": "8B",
      "pricing_tier": "basic",
      "best_for": "Chatbots and customer service applications",
      "performance_characteristics": ["balanced_performance", "instruction_optimized"],
      "recommended_use_cases": [
        {
          "category": "Customer Support",
          "description": "Automated customer service, FAQ responses, live chat assistance"
        }
      ]
    }
  ],
  "filters_applied": {
    "provider": null,
    "task": null,
    "capability": null,
    "details": false
  },
  "available_filters": {
    "providers": ["Meta", "Google", "MistralAI", "OpenAI"],
    "tasks": ["text-generation", "text-classification", "translation"],
    "capabilities": ["text_generation", "reasoning", "code_generation"]
  },
  "last_updated": "2025-06-22T09:23:00.000Z",
  "cache_info": {
    "cached": false,
    "ttl": 300
  }
}
```

### Single Model Response
```json
{
  "id": "@cf/meta/llama-3.1-8b-instruct",
  "display_name": "Meta Llama 3.1 8B Instruct",
  "provider": "Meta",
  "task": "text-generation",
  "capabilities": ["text_generation", "instruction_following", "conversational"],
  "use_cases": ["conversational_ai", "customer_support"],
  "parameter_count": "8B",
  "pricing_tier": "basic",
  "best_for": "Chatbots and customer service applications",
  "performance_characteristics": ["balanced_performance", "instruction_optimized"],
  "recommended_use_cases": [
    {
      "category": "Customer Support",
      "description": "Automated customer service, FAQ responses, live chat assistance"
    }
  ],
  "details": {
    "full_description": "Meta Llama 3.1 8B Instruct",
    "properties": {},
    "schema": null,
    "raw_model_data": { /* Original API response */ }
  }
}
```

## Setup

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare account with Workers AI access

### 2. Installation
```bash
# Clone the repository
git clone <repository-url>
cd cloudflare-models-api-worker

# Install dependencies
npm install
```

### 3. Environment Setup
Create the required KV namespaces:
```bash
# Create KV namespaces
wrangler kv:namespace create "MODELS_CACHE"
wrangler kv:namespace create "MODELS_RATE_LIMITS"
```

Update `wrangler.jsonc` with the namespace IDs returned from the commands above.

### 4. Secrets Configuration
Set your Cloudflare credentials:
```bash
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_API_TOKEN
```

**Getting your credentials:**
1. **Account ID**: Found in Cloudflare Dashboard → Right sidebar
2. **API Token**: 
   - Go to Cloudflare Dashboard → My Profile → API Tokens
   - Create token with "Workers AI:Read" permissions

### 5. Development
```bash
# Start development server
npm run dev

# Run tests
npm test

# Deploy to production
npm run deploy
```

## Usage Examples

### JavaScript/Frontend
```javascript
// Fetch all models
const response = await fetch('https://your-worker.your-subdomain.workers.dev/models');
const data = await response.json();

// Filter models by provider
const metaModels = await fetch(
  'https://your-worker.your-subdomain.workers.dev/models?provider=meta'
);

// Get specific model details
const modelDetails = await fetch(
  'https://your-worker.your-subdomain.workers.dev/model/@cf/meta/llama-3.1-8b-instruct'
);
```

### cURL
```bash
# Get all models
curl "https://your-worker.your-subdomain.workers.dev/models"

# Filter by capabilities
curl "https://your-worker.your-subdomain.workers.dev/models?capability=reasoning&details=true"

# Get capabilities list
curl "https://your-worker.your-subdomain.workers.dev/capabilities"

# Health check
curl "https://your-worker.your-subdomain.workers.dev/health"
```

### Python
```python
import requests

# Fetch models with filtering
response = requests.get(
    'https://your-worker.your-subdomain.workers.dev/models',
    params={
        'provider': 'meta',
        'capability': 'code_generation',
        'details': 'true',
        'limit': 20
    }
)

models = response.json()
```

## Enhanced Metadata

The worker enhances raw Cloudflare API data with:

### Capabilities
- `text_generation` - Generate human-like text from prompts
- `instruction_following` - Follow complex instructions and guidelines
- `conversational` - Engage in natural dialogue and conversations
- `code_generation` - Generate and understand programming code
- `reasoning` - Perform complex logical reasoning
- `multimodal` - Process both text and images
- `multilingual` - Support multiple languages
- `fast_inference` - Optimized for quick response times

### Use Cases
- **Conversational AI** - Chatbots, customer support, virtual assistants
- **Developer Tools** - Code completion, debugging assistance
- **Content Creation** - Blog posts, marketing copy, creative writing
- **Business Intelligence** - Data analysis, decision support

### Pricing Tiers
- **Economy** - Small models, basic functionality
- **Basic** - 7-30B parameter models, good performance
- **Standard** - 30-70B parameter models, high accuracy
- **Premium** - 70B+ parameter models, advanced capabilities

## Caching

The worker implements intelligent caching:
- **Models list**: 5 minutes TTL
- **Single model**: 10 minutes TTL
- **Capabilities/Providers**: 10 minutes TTL
- **Health checks**: No cache

Cache status is indicated in response headers:
- `X-Cache: HIT` - Served from cache
- `X-Cache: MISS` - Fresh API call
- `Cache-Control` - Browser caching instructions

## Error Handling

The worker provides comprehensive error responses:

```json
{
  "error": "Model not found",
  "message": "Model '@cf/invalid/model' not found",
  "suggestion": "Use /models to see all available models"
}
```

Common error scenarios:
- Invalid model IDs (404)
- API authentication failures (500)
- Rate limiting (429)
- Malformed requests (400)

## Monitoring

### Health Endpoint
```bash
GET /health
```

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2025-06-22T09:23:00.000Z",
  "version": "1.0.0",
  "api_connectivity": {
    "status": "connected",
    "model_count": 150
  },
  "response_time_ms": 45,
  "cache_status": "operational"
}
```

### Observability
The worker includes Cloudflare observability for monitoring:
- Request traces
- Performance metrics
- Error tracking
- Usage analytics

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm test -- --coverage
```

The test suite includes:
- ✅ Health check functionality
- ✅ Models list with filtering
- ✅ Single model retrieval
- ✅ Capabilities and providers endpoints
- ✅ CORS support
- ✅ Error handling
- ✅ Caching behavior
- ✅ Data enhancement validation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For issues and questions:
- Create an issue in the repository
- Check the Cloudflare Workers documentation
- Review the Cloudflare AI documentation

---

**Built with ❤️ by the 365i Development Team**