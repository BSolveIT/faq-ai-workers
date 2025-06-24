$body = @{
    windowType = "weekly"
    workerName = "week-test"
} | ConvertTo-Json

$headers = @{
    'Content-Type' = 'application/json'
    'X-Forwarded-For' = '203.0.113.900'
}

try {
    Write-Host "Testing weekly window calculation..."
    $response = Invoke-RestMethod -Uri 'https://rate-limiter-do.winter-cake-bf57.workers.dev/increment' -Method POST -Headers $headers -Body $body -SkipCertificateCheck
    Write-Host "SUCCESS: Weekly window working correctly"
    Write-Host "Weekly Window ID: $($response.window)"
    $response | ConvertTo-Json -Depth 3
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host "Response: $($_.ErrorDetails.Message)"
}