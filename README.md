# 🖨️ WebPrinter

웹사이트에서 호출되는 로컬 인쇄 프로그램입니다. 웹 브라우저에서 프린트 버튼을 클릭하면 로컬에 설치된 WebPrinter가 실행되어 인쇄 미리보기와 프린터 선택, 인쇄 실행을 담당합니다.

## 🔄 작동 방식

1. **웹사이트에서 프린트 버튼 클릭** - `webprinter://print` 프로토콜 링크
2. **로컬 프로그램 설치 확인** - 브라우저가 프로토콜 핸들러 확인
3. **WebPrinter 실행** - 설치되어 있으면 자동 실행, HTTP 서버 시작 (포트: 50000-50010)
4. **URL 정보 전송** - 웹에서 미리보기용/인쇄용 URL을 HTTP POST로 전송 ✅
5. **인쇄 미리보기 표시** - 받은 URL의 웹페이지를 미리보기로 표시 ✅
6. **프린터 선택** - 사용 가능한 프린터 목록 표시 ✅
7. **인쇄 실행** - 선택된 프린터로 웹페이지 인쇄 시작 ✅

## ✨ 주요 기능

- **웹 프로토콜 핸들러**: `webprinter://` 프로토콜로 웹에서 직접 호출
- **URL 정보 전송**: HTTP 서버를 통한 안전한 URL 정보 전송
- **이중 URL 지원**: 미리보기용 URL과 실제 인쇄용 URL 별도 관리
- **커스텀 용지 사이즈**: 244mm×88mm 등 다양한 용지 크기 지원
- **실시간 미리보기**: 전송받은 URL의 웹페이지 실시간 미리보기
- **프린터 자동 감지**: 시스템의 모든 프린터 자동 인식
- **자동 업데이트**: GitHub를 통한 자동 업데이트 지원
- **크로스 플랫폼**: Windows와 macOS 지원
- **사용자 친화적**: 직관적인 인터페이스

## 🚀 설치 및 사용

### 개발자용 설치

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm start

# 디버그 모드 실행 (DevTools 포함)
npm run dev
```

### 프로덕션 빌드

```bash
# Windows용 빌드
npm run build-win

# macOS용 빌드  
npm run build-mac

# 모든 플랫폼 빌드
npm run build
```

### 웹 개발자용 사용법

WebPrinter가 설치된 사용자의 컴퓨터에서 다음과 같이 사용할 수 있습니다:

#### 1단계: WebPrinter 실행
```html
<a href="webprinter://print">🖨️ 인쇄하기</a>
```

#### 2단계: URL 정보 전송
```javascript
async function sendUrlsToWebPrinter(port, sessionId, previewUrl, printUrl, paperSize) {
    const requestData = {
        session: sessionId,
        preview_url: previewUrl,
        print_url: printUrl
    };
    
    // 용지 사이즈 정보 추가
    if (paperSize) {
        requestData.paper_width = paperSize.width;   // mm
        requestData.paper_height = paperSize.height; // mm
        requestData.paper_size = paperSize.name;
    }
    
    try {
        const response = await fetch(`http://localhost:${port}/send-urls`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        const result = await response.json();
        if (result.success) {
            console.log('URL 전송 성공:', result);
        }
    } catch (error) {
        console.error('URL 전송 실패:', error);
    }
}
```

#### 서버 자동 감지
```javascript
async function findWebPrinterServer() {
    // 포트 50000-50010 범위에서 서버 찾기
    for (let port = 50000; port <= 50010; port++) {
        try {
            const response = await fetch(`http://localhost:${port}/status`);
            if (response.ok) {
                return port;
            }
        } catch (error) {
            // 계속 시도
        }
    }
    throw new Error('WebPrinter 서버를 찾을 수 없습니다');
}
```

## 📁 프로젝트 구조

```
print/
├── main.js              # Electron 메인 프로세스 (프로토콜 핸들러)
├── preload.js           # 보안 컨텍스트 브리지
├── print-preview.html   # 인쇄 미리보기 UI
├── print-preview.js     # 미리보기 창 로직
├── web-example.html     # 웹 개발자용 사용 예제
├── package.json         # 프로젝트 설정 및 프로토콜 등록
└── assets/              # 아이콘 및 리소스
```

## 🔧 기술 스택

- **Electron**: 크로스 플랫폼 데스크톱 앱
- **프로토콜 핸들러**: `webprinter://` 커스텀 프로토콜
- **웹페이지 인쇄**: Chromium의 내장 웹페이지 인쇄 기능
- **프린터 API**: Electron의 네이티브 프린터 지원

## 🌐 웹 통합 예제

`web-example.html` 파일을 브라우저에서 열어 다양한 사용 예제를 확인할 수 있습니다:

- 기본 프로토콜 링크 사용법
- JavaScript 프로그래밍 방식
- 사용자 정의 URL 입력
- 다양한 웹사이트 테스트

## 📋 프로토콜 명세

### 기본 형식
```
webprinter://print?session={세션_ID}
```

### 매개변수
- `session` (선택): 세션 ID (없으면 자동 생성)

### 예제
```
webprinter://print
webprinter://print?session=abc123def456
```

### HTTP API 엔드포인트
- **서버 주소**: `http://localhost:50000-50010` (자동 할당)
- **URL 정보 전송**: `POST /send-urls`
- **서버 상태**: `GET /status`

### URL 정보 전송 요청 형식
```
POST /send-urls
Content-Type: application/json

{
  "session": "세션 ID",
  "preview_url": "미리보기용 URL",
  "print_url": "실제 인쇄용 URL",
  "paper_width": 244,          // 용지 너비 (mm)
  "paper_height": 88,          // 용지 높이 (mm)
  "paper_size": "Label"        // 용지 이름 (A4, Letter, Custom 등)
}
```

## 🖥️ 지원 플랫폼

### Windows
- Windows 10 이상
- 자동 프로토콜 등록
- NSIS 설치 프로그램

### macOS  
- macOS 10.14 (Mojave) 이상
- 64비트 시스템
- 자동 프로토콜 등록

## 🛠️ 개발자 가이드

### 프로토콜 핸들러 등록

설치 시 자동으로 `webprinter://` 프로토콜이 시스템에 등록됩니다:

```json
{
  "protocols": [
    {
      "name": "WebPrinter Protocol",
      "schemes": ["webprinter"]
    }
  ]
}
```

### IPC 통신 API

**메인 프로세스 → 렌더러 프로세스:**
- `load-url`: 인쇄할 URL 전달

**렌더러 프로세스 → 메인 프로세스:**
- `get-printers`: 프린터 목록 조회
- `print-url`: URL 인쇄 실행  
- PDF 관련 기능 제거됨
- `quit-app`: 애플리케이션 종료

## 🐛 문제 해결

### 프로토콜이 작동하지 않는 경우

1. **WebPrinter 설치 확인**
   - Windows: 시작 메뉴에서 WebPrinter 검색
   - macOS: 응용 프로그램 폴더 확인

2. **프로토콜 등록 확인**
   - Windows: 레지스트리에서 `HKEY_CLASSES_ROOT\webprinter` 확인
   - macOS: 시스템 환경설정 > 보안 및 개인정보 보호

3. **브라우저 캐시 삭제**
   - 프로토콜 핸들러 정보가 캐시될 수 있음

### 인쇄가 실패하는 경우

1. **프린터 상태 확인**
   - 프린터가 온라인 상태인지 확인
   - 드라이버가 최신인지 확인

2. **웹페이지 접근성**
   - URL이 유효하고 접근 가능한지 확인
   - CORS 정책으로 인한 제한 여부 확인

3. **보안 설정**
   - 일부 보안이 엄격한 사이트는 인쇄 제한

## 📈 로드맵

- [ ] 인쇄 설정 저장 기능
- [ ] 다중 페이지 인쇄 지원
- [ ] 사용자 정의 CSS 적용
- [ ] 인쇄 기록 관리
- [ ] 네트워크 프린터 지원

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이센스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 📞 지원

문제 발생 시 GitHub Issues를 통해 문의해 주세요.

---

**WebPrinter** - 웹에서 호출되는 스마트한 로컬 인쇄 솔루션 