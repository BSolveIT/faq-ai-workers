# Quick Setup Guide

## 🚀 Get Started in 5 Minutes

### 1. Install Dependencies
```bash
cd faq-ai-workers/cloudflare-models-api-worker
npm install
```

### 2. Authenticate with Cloudflare
```bash
# Login to Cloudflare (opens browser)
wrangler login

# Or set API token manually
wrangler auth
```

### 3. Create KV Namespaces
```bash
# Create the required KV namespaces
wrangler kv:namespace create "MODELS_CACHE"
wrangler kv:namespace create "MODELS_RATE_LIMITS"

# Copy the returned IDs and update wrangler.jsonc
```

### 4. Set Environment Secrets
```bash
# Set your Cloudflare Account ID
wrangler secret put CLOUDFLARE_ACCOUNT_ID
# Enter your account ID when prompted

# Set your API Token (with Workers AI read permissions)
wrangler secret put CLOUDFLARE_API_TOKEN
# Enter your API token when prompted
```

### 5. Deploy
```bash
# Deploy to Cloudflare Workers
npm run deploy

# Or use the PowerShell script for validation
./deploy.ps1
```

## 🔧 Getting Your Credentials

### Account ID
1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select any domain
3. Copy the Account ID from the right sidebar

### API Token
1. Go to [Cloudflare Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use "Custom token" with these permissions:
   - Account: `Cloudflare Workers:Read`
   - Zone: `Zone:Read` (if needed)
   - Account: `Account:Read`

## ✅ Verify Installation

Once deployed, test your endpoints:

```bash
# Health check
curl https://your-worker.your-subdomain.workers.dev/health

# List models
curl https://your-worker.your-subdomain.workers.dev/models

# Get capabilities
curl https://your-worker.your-subdomain.workers.dev/capabilities
```

## 🐛 Troubleshooting

### Schema Validation Error
The VSCode error about schema not found is normal before running `npm install`. This will be fixed after installing dependencies.

### Authentication Issues
```bash
# Check if you're logged in
wrangler whoami

# Re-authenticate if needed
wrangler login
```

### KV Namespace Issues
Make sure to update the `id` values in `wrangler.jsonc` with the actual namespace IDs returned from the create commands.

### API Token Permissions
Ensure your API token has the following permissions:
- Account: `Cloudflare Workers:Read`
- Account: `Account:Read`

## 📚 Next Steps

1. Run the demo: `node examples/api-demo.js`
2. Read the full documentation in `README.md`
3. Explore the test suite: `npm test`
4. Check the changelog for features: `CHANGELOG.md`