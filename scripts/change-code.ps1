# החלפת קוד הכניסה לאתר. מנתק את כל הדפדפנים שמחוברים כרגע.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Read-Code {
  while ($true) {
    $s = Read-Host "בחרי קוד כניסה חדש (לפחות 8 תווים, Enter = קוד אקראי)" -AsSecureString
    $code = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    if (-not $code) {
      $bytes = New-Object byte[] 18
      [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      return [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
    }
    if ($code.Length -lt 8) { Write-Host "קצר מדי, צריך לפחות 8 תווים." -ForegroundColor Red; continue }
    $s2 = Read-Host "שוב, לאימות" -AsSecureString
    $again = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
    if ($code -ne $again) { Write-Host "הקודים לא זהים, נסי שוב." -ForegroundColor Red; continue }
    return $code
  }
}

$code = Read-Code
$code | npx wrangler secret put ACCESS_TOKEN
Write-Host "`n✅ הקוד הוחלף. הקוד שלך:" -ForegroundColor Green
Write-Host "   $code" -ForegroundColor Yellow
