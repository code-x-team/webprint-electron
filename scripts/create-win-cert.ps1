# Windows Self-Signed 인증서 생성 스크립트
Write-Host "🔑 Windows용 Self-Signed 인증서 생성 중..." -ForegroundColor Green

# 인증서 설정
$CertName = "WebPrinter Self-Signed"
$CertPassword = "webprinter123"  # 실제로는 더 강한 비밀번호 사용
$CertPath = "certificates\windows-self-signed.p12"

# certificates 폴더 생성
if (!(Test-Path "certificates")) {
    New-Item -ItemType Directory -Path "certificates"
}

# Self-signed 인증서 생성
$cert = New-SelfSignedCertificate `
    -Subject "CN=$CertName" `
    -Type CodeSigningCert `
    -KeyUsage DigitalSignature `
    -FriendlyName $CertName `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3") `
    -KeyLength 2048

# PFX 파일로 내보내기
$certPassword = ConvertTo-SecureString -String $CertPassword -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $CertPath -Password $certPassword

Write-Host "✅ Self-signed 인증서가 생성되었습니다: $CertPath" -ForegroundColor Green
Write-Host "⚠️  이 인증서는 개발용으로만 사용하세요." -ForegroundColor Yellow
Write-Host "📋 Windows Defender가 경고를 표시할 수 있습니다." -ForegroundColor Yellow

Write-Host ""
Write-Host "사용법:" -ForegroundColor Cyan
Write-Host "환경변수 설정 후 빌드하세요:" -ForegroundColor White
Write-Host "`$env:WIN_CSC_LINK='$CertPath'" -ForegroundColor Gray
Write-Host "`$env:WIN_CSC_KEY_PASSWORD='$CertPassword'" -ForegroundColor Gray
Write-Host "yarn build-win" -ForegroundColor Gray 