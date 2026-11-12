# התקנה ראשונה של האתר ב-Cloudflare (חינמי). הרצה: פותחים PowerShell בתיקייה ומריצים  .\setup.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "`n[1/5] התקנת כלים..." -ForegroundColor Cyan
npm install --no-fund --no-audit | Out-Null

Write-Host "`n[2/5] התחברות ל-Cloudflare (ייפתח דפדפן, מאשרים שם)..." -ForegroundColor Cyan
npx wrangler login

$toml = [IO.File]::ReadAllText("$PSScriptRoot\wrangler.toml", [Text.Encoding]::UTF8)
if ($toml -match 'REPLACE_WITH_KV_ID') {
  Write-Host "`n[3/5] יצירת אחסון KV..." -ForegroundColor Cyan
  $out = (npx wrangler kv namespace create COURSE_KV 2>&1) -join "`n"
  Write-Host $out
  if ($out -match '"?id"?\s*[=:]\s*"([0-9a-f]{32})"') {
    $toml = $toml -replace 'REPLACE_WITH_KV_ID', $Matches[1]
    [IO.File]::WriteAllText("$PSScriptRoot\wrangler.toml", $toml, (New-Object Text.UTF8Encoding($false)))
    Write-Host "KV נוצר: $($Matches[1])" -ForegroundColor Green
  } else {
    throw 'לא הצלחתי לזהות את מזהה ה-KV. העתיקי את ה-id מהפלט למעלה לקובץ wrangler.toml במקום REPLACE_WITH_KV_ID, והריצי שוב.'
  }
} else {
  Write-Host "`n[3/5] KV כבר מוגדר, מדלגת." -ForegroundColor DarkGray
}

Write-Host "`n[4/5] פריסה..." -ForegroundColor Cyan
npx wrangler deploy

Write-Host "`n[5/5] קוד כניסה ומפתח מייל..." -ForegroundColor Cyan
& "$PSScriptRoot\scripts\change-code.ps1"

$key = Read-Host "`nמפתח Resend לשליחת מיילים (מתחיל ב-re_). אפשר להשאיר ריק ולהוסיף אחר כך"
if ($key) { $key | npx wrangler secret put RESEND_API_KEY }

Write-Host "`n✅ האתר באוויר! הכתובת מופיעה למעלה בשורה שמתחילה ב-https:// ומסתיימת ב-.workers.dev" -ForegroundColor Green
Write-Host "   נכנסים אליה, מזינים את קוד הכניסה, ובדף ⚙️ הגדרות מגדירים תזכורות." -ForegroundColor Green
