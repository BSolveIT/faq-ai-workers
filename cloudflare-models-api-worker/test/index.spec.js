/**
 * Test suite for Cloudflare Models API Worker
 * 
 * @version 1.0.0
 * @author 365i Development Team
 */

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';

/**
 * Test data and mocks
 */
const mockModelsData = [
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    display_name: 'Meta Llama 3.1 8B Instruct',
    description: 'Meta Llama 3.1 8B Instruct model for conversational AI',
    task: {
      name: 'Text Generation',
      description: 'Generate human-like text from prompts'
    },
    properties: {
      provider: 'Meta',
      parameter_count: '8B'
    }
  },
  {
    id: '@cf/google/gemma-7b-it',
    display_name: 'Google Gemma 7B Instruct',
    description: 'Google Gemma 7B instruction-tuned model',
    task: {
      name: 'Text Generation',
      description: 'Generate human-like text from prompts'
    },
    properties: {
      provider: 'Google',
      parameter_count: '7B'
    }
  },
  {
    id: '@cf/microsoft/dialoGPT-medium',
    display_name: 'Microsoft DialoGPT Medium',
    description: 'Microsoft conversational AI model',
    task: {
      name: 'Text Generation',
      description: 'Generate conversational responses'
    },
    properties: {
      provider: 'Microsoft',
      parameter_count: 'Medium'
    }
  }
];

/**
 * Mock fetch for Cloudflare API
 */
function mockCloudflareAPI() {
  global.fetch = async (url, options) => {
    if (url.includes('/ai/models/search')) {
      return new Response(JSON.stringify({
        success: true,
        result: mockModelsData
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Not Found', { status: 404 });
  };
}

describe('Cloudflare Models API Worker', () => {
  beforeAll(() => {
    mockCloudflareAPI();
  });

  describe('Health Check Endpoint', () => {
    it('should return healthy status', async () => {
      const request = new Request('http://localhost/health');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.version).toBeDefined();
      expect(data.timestamp).toBeDefined();
    });
  });

  describe('Models List Endpoint', () => {
    it('should return list of models', async () => {
      const request = new Request('http://localhost/models');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.total).toBeGreaterThan(0);
      expect(data.models).toBeDefined();
      expect(Array.isArray(data.models)).toBe(true);
      expect(data.filters_applied).toBeDefined();
      expect(data.available_filters).toBeDefined();
    });

    it('should filter models by provider', async () => {
      const request = new Request('http://localhost/models?provider=meta');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.filters_applied.provider).toBe('meta');
      
      // Check that filtered models contain Meta provider
      if (data.models.length > 0) {
        expect(data.models.some(model => 
          model.provider === 'Meta' || model.id.includes('meta')
        )).toBe(true);
      }
    });

    it('should filter models by task', async () => {
      const request = new Request('http://localhost/models?task=text-generation');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.filters_applied.task).toBe('text-generation');
    });

    it('should support pagination', async () => {
      const request = new Request('http://localhost/models?page=1&limit=10');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.page).toBe(1);
      expect(data.limit).toBe(10);
      expect(data.total_pages).toBeDefined();
    });

    it('should include enhanced metadata', async () => {
      const request = new Request('http://localhost/models?details=true&limit=1');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      if (data.models.length > 0) {
        const model = data.models[0];
        expect(model.id).toBeDefined();
        expect(model.display_name).toBeDefined(); // Should be formatted model name
        expect(model.description).toBeDefined(); // Should contain detailed description
        expect(model.provider).toBeDefined();
        expect(model.capabilities).toBeDefined();
        expect(model.use_cases).toBeDefined();
        expect(model.pricing_tier).toBeDefined();
        expect(model.best_for).toBeDefined();
        expect(model.performance_characteristics).toBeDefined();
        expect(model.recommended_use_cases).toBeDefined();
        expect(model.details).toBeDefined();
      }
    });
  });

  describe('Single Model Endpoint', () => {
    it('should return single model details', async () => {
      const modelId = '@cf/meta/llama-3.1-8b-instruct';
      const request = new Request(`http://localhost/model/${encodeURIComponent(modelId)}`);
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.id).toBe(modelId);
      expect(data.display_name).toBeDefined();
      expect(data.provider).toBeDefined();
      expect(data.capabilities).toBeDefined();
      expect(data.details).toBeDefined();
    });

    it('should return 404 for non-existent model', async () => {
      const request = new Request('http://localhost/model/non-existent-model');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(404);
      
      const data = await response.json();
      expect(data.error).toBe('Model not found');
    });
  });

  describe('Capabilities Endpoint', () => {
    it('should return list of capabilities', async () => {
      const request = new Request('http://localhost/capabilities');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.total_capabilities).toBeGreaterThan(0);
      expect(data.capabilities).toBeDefined();
      expect(Array.isArray(data.capabilities)).toBe(true);
      
      if (data.capabilities.length > 0) {
        const capability = data.capabilities[0];
        expect(capability.name).toBeDefined();
        expect(capability.description).toBeDefined();
        expect(capability.model_count).toBeDefined();
        expect(capability.example_models).toBeDefined();
      }
    });
  });

  describe('Providers Endpoint', () => {
    it('should return list of providers', async () => {
      const request = new Request('http://localhost/providers');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.total_providers).toBeGreaterThan(0);
      expect(data.providers).toBeDefined();
      expect(Array.isArray(data.providers)).toBe(true);
      
      if (data.providers.length > 0) {
        const provider = data.providers[0];
        expect(provider.name).toBeDefined();
        expect(provider.model_count).toBeGreaterThan(0);
        expect(provider.models).toBeDefined();
        expect(provider.tasks).toBeDefined();
      }
    });
  });

  describe('CORS Support', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = new Request('http://localhost/models', { method: 'OPTIONS' });
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('should include CORS headers in responses', async () => {
      const request = new Request('http://localhost/models');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('http://localhost/unknown');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(404);
      
      const data = await response.json();
      expect(data.error).toBe('Not Found');
      expect(data.available_endpoints).toBeDefined();
    });

    it('should handle API errors gracefully', async () => {
      // Mock API error
      global.fetch = async () => {
        return new Response('Internal Server Error', { status: 500 });
      };

      const request = new Request('http://localhost/models');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(500);
      
      const data = await response.json();
      expect(data.error).toBe('Failed to fetch models');
    });
  });

  describe('Caching', () => {
    it('should set appropriate cache headers', async () => {
      const request = new Request('http://localhost/models');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toContain('max-age');
    });

    it('should indicate cache status', async () => {
      const request = new Request('http://localhost/models');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      expect(response.headers.get('X-Cache')).toBeDefined();
    });
  });

  describe('Data Enhancement', () => {
    it('should enhance model data with metadata', async () => {
      const request = new Request('http://localhost/models?limit=1');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      if (data.models.length > 0) {
        const model = data.models[0];
        
        // Check enhanced fields
        expect(model.provider).toBeDefined();
        expect(model.capabilities).toBeDefined();
        expect(Array.isArray(model.capabilities)).toBe(true);
        expect(model.use_cases).toBeDefined();
        expect(Array.isArray(model.use_cases)).toBe(true);
        expect(model.parameter_count).toBeDefined();
        expect(model.pricing_tier).toBeDefined();
        expect(model.best_for).toBeDefined();
        expect(model.performance_characteristics).toBeDefined();
        expect(model.recommended_use_cases).toBeDefined();
      }
    });

    it('should extract provider correctly', async () => {
      const request = new Request('http://localhost/models?provider=meta&limit=1');
      const ctx = createExecutionContext();
      const response = await SELF.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      
      const data = await response.json();
      if (data.models.length > 0) {
        const model = data.models[0];
        expect(['Meta', 'Unknown'].includes(model.provider)).toBe(true);
      }
    });
  });
});