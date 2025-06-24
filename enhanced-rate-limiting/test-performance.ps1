$body = @{
    windowType = "daily"
    workerName = "performance-test"
} | ConvertTo-Json

$headers = @{
    'Content-Type' = 'application/json'
    'X-Forwarded-For' = '203.0.113.800'
}

Write-Host "Testing RateLimiterDO performance..."

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

try {
    $response = Invoke-RestMethod -Uri 'https://rate-limiter-do.winter-cake-bf57.workers.dev/increment' -Method POST -Headers $headers -Body $body -SkipCertificateCheck
    $stopwatch.Stop()
    
    $responseTime = $stopwatch.ElapsedMilliseconds
    Write-Host "SUCCESS: Performance test completed"
    Write-Host "Response Time: $responseTime ms"
    
    if ($responseTime -lt 1000) {
        Write-Host "PERFORMANCE: Excellent (< 1000ms)" -ForegroundColor Green
    } elseif ($responseTime -lt 2000) {
        Write-Host "PERFORMANCE: Good (< 2000ms)" -ForegroundColor Yellow
    } else {
        Write-Host "PERFORMANCE: Needs investigation (> 2000ms)" -ForegroundColor Red
    }
    
    $response | ConvertTo-Json -Depth 3
} catch {
    $stopwatch.Stop()
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host "Response Time: $($stopwatch.ElapsedMilliseconds) ms"
}