$body = @{
    question = "Architecture validation test"
    context = "testing"
} | ConvertTo-Json

$headers = @{
    'Content-Type' = 'application/json'
    'X-Forwarded-For' = '203.0.113.700'
}

try {
    Write-Host "Testing FAQ Answer Generator worker backwards compatibility..."
    $response = Invoke-RestMethod -Uri 'https://faq-answer-generator-worker.winter-cake-bf57.workers.dev/' -Method POST -Headers $headers -Body $body -SkipCertificateCheck
    Write-Host "SUCCESS: FAQ Worker functioning with updated Rate Limiter DO"
    $response | ConvertTo-Json -Depth 3
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host "Response: $($_.ErrorDetails.Message)"
}