#!/bin/bash

# macOS Self-Signed 인증서 생성 스크립트
echo "🔑 macOS용 Self-Signed 인증서 생성 중..."

# 인증서 이름 설정
CERT_NAME="WebPrinter Self-Signed"

# Keychain에서 기존 인증서 삭제 (있다면)
security delete-certificate -c "$CERT_NAME" 2>/dev/null || true

# Self-signed 인증서 생성
security create-csr \
  -n "$CERT_NAME" \
  -t rsa \
  -s 2048 \
  -f ~/Desktop/WebPrinter.csr

# 인증서를 keychain에 추가
security add-certificates ~/Desktop/WebPrinter.csr

echo "✅ Self-signed 인증서가 생성되었습니다."
echo "⚠️  이 인증서는 개발용으로만 사용하세요."
echo "📋 Gatekeeper에서 차단될 수 있습니다."

# 사용법 출력
echo ""
echo "사용법:"
echo "export CSC_NAME=\"$CERT_NAME\""
echo "yarn build-mac" 