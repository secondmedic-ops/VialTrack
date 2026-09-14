Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " VialTrack Route Assignment Flow Verification " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

# 1. Check Git Status & Changes
Write-Host "`n[1/4] Checking Git Status..." -ForegroundColor Yellow
git status --short

# 2. Stage & Commit Any Pending Flow Fixes
Write-Host "`n[2/4] Staging and Committing Route Flow Fixes..." -ForegroundColor Yellow
git add .
git commit -m "fix: standardize assignedRiderId schema and route flow synchronization"
if ($LASTEXITCODE -eq 0) {
    Write-Host "Changes committed. Pushing to GitHub..." -ForegroundColor Green
    git push origin main
} else {
    Write-Host "Working tree already clean or nothing to commit." -ForegroundColor Gray
}

# 3. Firestore Rules Check / Deploy
Write-Host "`n[3/4] Checking Firebase CLI..." -ForegroundColor Yellow
if (Get-Command firebase -ErrorAction SilentlyContinue) {
    Write-Host "Firebase CLI found. Deploying Firestore security rules..." -ForegroundColor Green
    firebase deploy --only firestore:rules
} else {
    Write-Host "Firebase CLI not installed in path. Skipping remote rules deploy." -ForegroundColor Gray
}

# 4. Launch Development Server for Live Flow Testing
Write-Host "`n[4/4] Starting Vite Development Server for Live Testing..." -ForegroundColor Yellow
Write-Host "Admin Portal:    http://localhost:5173/#/admin" -ForegroundColor Cyan
Write-Host "Rider Portal:    http://localhost:5173/#/rider/login" -ForegroundColor Cyan
Write-Host "==============================================`n" -ForegroundColor Cyan

npm run dev
