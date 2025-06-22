#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Deploy Cloudflare Models API Worker

.DESCRIPTION
    PowerShell script to deploy the Cloudflare Models API Worker with proper setup and validation.

.PARAMETER Environment
    Target environment (dev, staging, production)

.PARAMETER SkipTests
    Skip running tests before deployment

.EXAMPLE
    .\deploy.ps1 -Environment production
    .\deploy.ps1 -Environment dev -SkipTests
#>

param(
    [Parameter()]
    [ValidateSet("dev", "staging", "production")]
    [string]$Environment = "dev",
    
    [Parameter()]
    [switch]$SkipTests
)

# Script configuration
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Colors for output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    } else {
        $input | Write-Output
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Info($message) {
    Write-ColorOutput Cyan "ℹ️  $message"
}

function Write-Success($message) {
    Write-ColorOutput Green "✅ $message"
}

function Write-Warning($message) {
    Write-ColorOutput Yellow "⚠️  $message"
}

function Write-Error($message) {
    Write-ColorOutput Red "❌ $message"
}

# Main deployment function
function Deploy-Worker {
    Write-Info "Starting Cloudflare Models API Worker deployment to $Environment..."
    
    # Check prerequisites
    Write-Info "Checking prerequisites..."
    
    # Check if Node.js is installed
    try {
        $nodeVersion = node --version
        Write-Success "Node.js version: $nodeVersion"
    } catch {
        Write-Error "Node.js is not installed or not in PATH"
        return
    }
    
    # Check if Wrangler is installed
    try {
        $wranglerVersion = wrangler --version
        Write-Success "Wrangler version: $wranglerVersion"
    } catch {
        Write-Error "Wrangler is not installed. Install with: npm install -g wrangler"
        return
    }
    
    # Install dependencies
    Write-Info "Installing dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install dependencies"
        return
    }
    Write-Success "Dependencies installed"
    
    # Run tests (unless skipped)
    if (-not $SkipTests) {
        Write-Info "Running tests..."
        npm test
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Tests failed. Use -SkipTests to bypass."
            return
        }
        Write-Success "All tests passed"
    } else {
        Write-Warning "Skipping tests"
    }
    
    # Check authentication
    Write-Info "Checking Cloudflare authentication..."
    try {
        wrangler whoami
        Write-Success "Cloudflare authentication verified"
    } catch {
        Write-Error "Cloudflare authentication failed. Run: wrangler login"
        return
    }
    
    # Create KV namespaces if they don't exist
    Write-Info "Setting up KV namespaces..."
    
    $kvNamespaces = @(
        "MODELS_CACHE",
        "MODELS_RATE_LIMITS"
    )
    
    foreach ($namespace in $kvNamespaces) {
        Write-Info "Checking KV namespace: $namespace"
        try {
            # Try to list the namespace (this will fail if it doesn't exist)
            wrangler kv:namespace list | ConvertFrom-Json | Where-Object { $_.title -eq $namespace } | Out-Null
            Write-Success "KV namespace '$namespace' exists"
        } catch {
            Write-Info "Creating KV namespace: $namespace"
            $result = wrangler kv:namespace create $namespace
            Write-Success "Created KV namespace: $namespace"
            Write-Warning "Please update wrangler.jsonc with the new namespace ID:"
            Write-Output $result
        }
    }
    
    # Check for required secrets
    Write-Info "Checking required secrets..."
    $requiredSecrets = @(
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_API_TOKEN"
    )
    
    foreach ($secret in $requiredSecrets) {
        try {
            # This will show if the secret exists (without revealing the value)
            wrangler secret list | Select-String $secret | Out-Null
            Write-Success "Secret '$secret' is configured"
        } catch {
            Write-Warning "Secret '$secret' is not configured"
            Write-Info "Set it with: wrangler secret put $secret"
        }
    }
    
    # Deploy based on environment
    Write-Info "Deploying to $Environment environment..."
    
    switch ($Environment) {
        "dev" {
            wrangler deploy --env dev
        }
        "staging" {
            wrangler deploy --env staging
        }
        "production" {
            Write-Warning "Deploying to PRODUCTION environment"
            $confirm = Read-Host "Are you sure you want to deploy to production? (y/N)"
            if ($confirm -eq "y" -or $confirm -eq "Y") {
                wrangler deploy
            } else {
                Write-Info "Production deployment cancelled"
                return
            }
        }
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Deployment failed"
        return
    }
    
    Write-Success "Deployment completed successfully!"
    
    # Get worker URL
    Write-Info "Getting worker URL..."
    $workerUrl = wrangler deploy --dry-run 2>&1 | Select-String "https://.*\.workers\.dev" | ForEach-Object { $_.Matches[0].Value }
    
    if ($workerUrl) {
        Write-Success "Worker deployed to: $workerUrl"
        Write-Info "Test endpoints:"
        Write-Output "  Health Check: $workerUrl/health"
        Write-Output "  Models List:  $workerUrl/models"
        Write-Output "  Capabilities: $workerUrl/capabilities"
        Write-Output "  Providers:    $workerUrl/providers"
    }
    
    # Run post-deployment tests
    if ($workerUrl -and -not $SkipTests) {
        Write-Info "Running post-deployment health check..."
        try {
            $response = Invoke-RestMethod -Uri "$workerUrl/health" -Method Get -TimeoutSec 30
            if ($response.status -eq "healthy") {
                Write-Success "Health check passed"
                Write-Info "API connectivity: $($response.api_connectivity.status)"
                Write-Info "Model count: $($response.api_connectivity.model_count)"
            } else {
                Write-Warning "Health check returned: $($response.status)"
            }
        } catch {
            Write-Warning "Health check failed: $($_.Exception.Message)"
        }
    }
    
    Write-Success "🚀 Cloudflare Models API Worker deployment complete!"
}

# Run deployment
try {
    Deploy-Worker
} catch {
    Write-Error "Deployment failed with error: $($_.Exception.Message)"
    exit 1
}