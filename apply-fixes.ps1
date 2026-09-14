Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Applying VialTrack Stability Fixes & Launch " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# 1. Check TypeScript Build / Diagnostics
Write-Host "`n[1/3] Running TypeScript check..." -ForegroundColor Yellow
npx tsc --noEmit

if ($LASTEXITCODE -eq 0) {
    Write-Host "No TypeScript compilation errors found." -ForegroundColor Green
} else {
    Write-Host "TypeScript warnings/errors detected above." -ForegroundColor Red
}

# 2. Stage and Push any remaining fixes
Write-Host "`n[2/3] Checking Git Status..." -ForegroundColor Yellow
git status --short

git add .
git commit -m "fix(core): enhance map teardown cleanup and SLA calculation safety"
if ($LASTEXITCODE -eq 0) {
    Write-Host "Pushing updates to GitHub..." -ForegroundColor Green
    git push origin main
} else {
    Write-Host "No unstaged changes to push." -ForegroundColor Gray
}

# 3. Start Local Dev Server
Write-Host "`n[3/3] Launching Local Development Server..." -ForegroundColor Yellow
Write-Host "Admin Portal:    http://localhost:3000/#/admin" -ForegroundColor Cyan
Write-Host "Rider Portal:    http://localhost:3000/#/rider/login" -ForegroundColor Cyan
Write-Host "==============================================`n" -ForegroundColor Cyan

npm run dev
