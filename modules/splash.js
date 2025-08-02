const { BrowserWindow } = require('electron');
const path = require('path');

let splashWindow = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 인라인 HTML로 로딩 화면 생성 (별도 파일 로드 불필요)
  const loadingHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          padding: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          user-select: none;
          -webkit-app-region: drag;
        }
        .loading-container {
          text-align: center;
          color: white;
        }
        .logo {
          width: 80px;
          height: 80px;
          margin: 0 auto 20px;
          background: white;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 40px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        .title {
          font-size: 24px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .subtitle {
          font-size: 14px;
          opacity: 0.8;
          margin-bottom: 30px;
        }
        .spinner {
          width: 40px;
          height: 40px;
          margin: 0 auto;
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .progress-bar {
          width: 200px;
          height: 4px;
          background: rgba(255,255,255,0.2);
          border-radius: 2px;
          margin: 20px auto;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: white;
          border-radius: 2px;
          width: 0%;
          animation: progress 2s ease-in-out forwards;
        }
        @keyframes progress {
          0% { width: 0%; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="loading-container">
        <div class="logo">🖨️</div>
        <div class="title">WebPrinter</div>
        <div class="subtitle">시작하는 중...</div>
        <div class="spinner"></div>
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
      </div>
    </body>
    </html>
  `;

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingHTML)}`);
  
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });

  return splashWindow;
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

function updateSplashProgress(message) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.executeJavaScript(`
      document.querySelector('.subtitle').textContent = '${message}';
    `);
  }
}

module.exports = {
  createSplashWindow,
  closeSplashWindow,
  updateSplashProgress
};