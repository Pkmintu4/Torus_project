$filePath = 'connected-device.html'
$content = [System.IO.File]::ReadAllText($filePath)

# Remove the dark topbar override and everything until the end of the old dark block
# The old block starts right after our new "Hide unwanted elements" block
# We look for the old dark topbar override that should be deleted

$startPattern = "    body.patient-view .topbar {`r`n      background: rgba(10, 14, 30, 0.97) !important;"
$endPattern = "    body.patient-view .patient-consultation-card .feeds-row {`r`n      display: none !important;`r`n    }`r`n"

$startIdx = $content.IndexOf($startPattern)
$endIdx = $content.IndexOf($endPattern, $startIdx)

if ($startIdx -ge 0 -and $endIdx -ge 0) {
    $endIdx += $endPattern.Length
    $removed = $content.Substring($startIdx, $endIdx - $startIdx)
    $content = $content.Remove($startIdx, $endIdx - $startIdx)
    Write-Host "SUCCESS: Removed old dark CSS block ($($endIdx - $startIdx) chars)"
    [System.IO.File]::WriteAllText($filePath, $content, [System.Text.Encoding]::UTF8)
} else {
    Write-Host "Start: $startIdx, End: $endIdx"
    Write-Host "Pattern not found - checking for dark bg..."
    $darkIdx = $content.IndexOf("background: #0a0e1e")
    Write-Host "Dark bg at: $darkIdx"
}
