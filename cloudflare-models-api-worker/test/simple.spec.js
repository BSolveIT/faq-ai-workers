/**
 * Simple test suite for Cloudflare Models API Worker
 * Tests core functionality without complex CloudFlare test framework
 * 
 * @version 1.0.0
 * @author 365i Development Team
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Import the worker module
let workerModule;

describe('Cloudflare Models API Worker - Core Functionality', () => {
  beforeAll(async () => {
    // Import worker dynamically
    workerModule = await import('../src/index.js');
  });

  describe('Worker Export Structure', () => {
    it('should export default object with fetch method', () => {
      expect(workerModule.default).toBeDefined();
      expect(typeof workerModule.default.fetch).toBe('function');
    });
  });

  describe('Request Handling Logic', () => {
    it('should handle basic request structure', async () => {
      // Mock environment
      const env = {
        CLOUDFLARE_ACCOUNT_ID: 'test-account',
        CLOUDFLARE_API_TOKEN: 'test-token',
        WORKER_VERSION: '1.0.0',
        CACHE_TTL: '300'
      };

      // Mock KV store
      const mockKV = {
        get: async () => null,
        put: async () => {}
      };
      env.MODELS_CACHE = mockKV;

      // Mock context
      const ctx = {
        waitUntil: () => {}
      };

      // Mock fetch for Cloudflare API
      global.fetch = async (url, options) => {
        if (url.includes('/ai/models/search')) {
          return new Response(JSON.stringify({
            success: true,
            result: [
              {
                id: '@cf/meta/llama-3.1-8b-instruct',
                display_name: 'Meta Llama 3.1 8B Instruct',
                task: {
                  name: 'Text Generation'
                },
                properties: {
                  provider: 'Meta'
                }
              }
            ]
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response('Not Found', { status: 404 });
      };

      // Test health endpoint
      const healthRequest = new Request('https://test.com/health');
      const healthResponse = await workerModule.default.fetch(healthRequest, env, ctx);
      
      expect(healthResponse.status).toBe(200);
      const healthData = await healthResponse.json();
      expect(healthData.status).toBe('healthy');
    });

    it('should handle CORS OPTIONS request', async () => {
      const env = {};
      const ctx = {};
      
      const optionsRequest = new Request('https://test.com/models', { method: 'OPTIONS' });
      const response = await workerModule.default.fetch(optionsRequest, env, ctx);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should return 404 for unknown endpoints', async () => {
      const env = {};
      const ctx = {};
      
      const unknownRequest = new Request('https://test.com/unknown-endpoint');
      const response = await workerModule.default.fetch(unknownRequest, env, ctx);
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Not Found');
      expect(data.available_endpoints).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle worker errors gracefully', async () => {
      const env = {}; // Missing required env vars
      const ctx = {};
      
      const request = new Request('https://test.com/models');
      const response = await workerModule.default.fetch(request, env, ctx);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });
});