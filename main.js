// improved-main.js - 개선된 메인 프로세스
const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs').promises;
const os = require('os');

// 전역 상태 관리
const appState = {
  isReady: false,
  serverReady: false,
  windowReady: false,
  tray: null,
  mainWindow: null,
  httpServer: null,
  serverPort: null,
  sessions: new Map(),
  initPromise: null
};

// 모듈 import
const { setupIpcHandlers: setupWindowIpcHandlers } = require('./modules/window');

// 간단한 HTTP 서버 (Express 의존성 제거)
class SimpleHttpServer {
  constructor(port) {
    this.port = port;
    this.routes = new Map();
    this.server = null;
  }

  post(path, handler) {
    this.routes.set(`POST:${path}`, handler);
  }

  get(path, handler) {
    this.routes.set(`GET:${path}`, handler);
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // CORS 헤더
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        const routeKey = `${req.method}:${req.url.split('?')[0]}`;
        const handler = this.routes.get(routeKey);

        if (handler) {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const data = body ? JSON.parse(body) : {};
              const result = await handler(data);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: error.message }));
            }
          });
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      const tryPort = (port) => {
        this.server.listen(port, 'localhost', () => {
          this.port = port;
          console.log(`✅ HTTP 서버 시작: http://localhost:${port}`);
          resolve(port);
        });

        this.server.on('error', (err) => {
          if (err.code === 'EADDRINUSE' && port < 18740) {
            console.log(`포트 ${port} 사용 중, 다음 포트 시도...`);
            tryPort(port + 1);
          } else {
            reject(err);
          }
        });
      };

      tryPort(this.port);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

// 초기화 관리자
class InitializationManager {
  constructor() {
    this.steps = [
      { name: 'app', status: 'pending', message: '애플리케이션 초기화' },
      { name: 'server', status: 'pending', message: '서버 시작' },
      { name: 'window', status: 'pending', message: '윈도우 생성' },
      { name: 'ready', status: 'pending', message: '준비 완료' }
    ];
  }

  updateStep(name, status) {
    const step = this.steps.find(s => s.name === name);
    if (step) {
      step.status = status;
      this.notifyProgress();
    }
  }

  notifyProgress() {
    if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
      appState.mainWindow.webContents.send('init-progress', {
        steps: this.steps,
        progress: this.getProgress()
      });
    }
  }

  getProgress() {
    const completed = this.steps.filter(s => s.status === 'completed').length;
    return Math.round((completed / this.steps.length) * 100);
  }
}

const initManager = new InitializationManager();

// HTTP 서버 설정
async function setupHttpServer() {
  try {
    const server = new SimpleHttpServer(18731);
    
    // 라우트 설정
    server.post('/send-urls', async (data) => {
      const { 
        session, 
        front_preview_url, 
        back_preview_url,
        front_print_url,
        back_print_url,
        paper_width, 
        paper_height, 
        print_selector 
      } = data;
      
      if (!session || (!front_preview_url && !front_print_url)) {
        throw new Error('필수 파라미터가 없습니다');
      }

      const sessionData = {
        // 앞면 데이터
        frontPreviewUrl: front_preview_url,
        frontPrintUrl: front_print_url || front_preview_url,
        // 뒷면 데이터
        backPreviewUrl: back_preview_url,
        backPrintUrl: back_print_url || back_preview_url,
        // 하위 호환성을 위한 기존 필드 (기본적으로 앞면)
        previewUrl: front_preview_url,
        printUrl: front_print_url || front_preview_url,
        paperSize: {
          width: parseFloat(paper_width) || 210,
          height: parseFloat(paper_height) || 297
        },
        printSelector: print_selector || '.print_wrap',
        timestamp: Date.now()
      };

      appState.sessions.set(session, sessionData);
      
      // 인쇄 윈도우에 알림
      try {
        const { notifyWindow } = require('./modules/window');
        notifyWindow(session, sessionData);
        console.log('✅ 인쇄 창에 데이터 전송:', session);
      } catch (notifyError) {
        console.error('❌ 윈도우 알림 실패:', notifyError);
      }

      return { success: true, session };
    });

    server.get('/status', async () => {
      return {
        status: 'running',
        port: appState.serverPort,
        version: app.getVersion(),
        sessions: appState.sessions.size
      };
    });

    appState.serverPort = await server.start();
    appState.httpServer = server;
    appState.serverReady = true;
    initManager.updateStep('server', 'completed');
    
    return appState.serverPort;
  } catch (error) {
    console.error('❌ HTTP 서버 시작 실패:', error);
    initManager.updateStep('server', 'failed');
    throw error;
  }
}

// 메인 윈도우 생성
async function createMainWindow() {
  try {
    appState.mainWindow = new BrowserWindow({
      width: 1000,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      title: 'WebPrinter'
    });

    await appState.mainWindow.loadFile('print-preview.html');
    
    appState.mainWindow.once('ready-to-show', () => {
      appState.windowReady = true;
      initManager.updateStep('window', 'completed');
      
      // 초기 데이터 전송
      appState.mainWindow.webContents.send('app-ready', {
        serverPort: appState.serverPort,
        serverReady: appState.serverReady
      });
      
      appState.mainWindow.show();
    });

    appState.mainWindow.on('closed', () => {
      appState.mainWindow = null;
      appState.windowReady = false;
    });

    return appState.mainWindow;
  } catch (error) {
    console.error('❌ 윈도우 생성 실패:', error);
    initManager.updateStep('window', 'failed');
    throw error;
  }
}

// IPC 핸들러는 modules/window.js에서 처리

// 트레이 생성
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon-32.png' : 'icon.png');
    appState.tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '열기',
        click: () => {
          if (appState.mainWindow) {
            appState.mainWindow.show();
          } else {
            createMainWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          app.quit();
        }
      }
    ]);
    
    appState.tray.setToolTip('WebPrinter');
    appState.tray.setContextMenu(contextMenu);
  } catch (error) {
    console.error('트레이 생성 실패:', error);
  }
}

// 순차적 초기화
async function initialize() {
  try {
    console.log('🚀 WebPrinter 초기화 시작');
    initManager.updateStep('app', 'in-progress');
    
    // 1. 기본 설정
    app.setAsDefaultProtocolClient('webprinter');
    setupWindowIpcHandlers(); // window 모듈의 IPC 핸들러 설정
    createTray();
    initManager.updateStep('app', 'completed');
    
    // 2. HTTP 서버 시작
    initManager.updateStep('server', 'in-progress');
    await setupHttpServer();
    
    // 3. 메인 윈도우 생성
    initManager.updateStep('window', 'in-progress');
    await createMainWindow();
    
    // 4. 준비 완료
    initManager.updateStep('ready', 'completed');
    appState.isReady = true;
    
    console.log('✅ WebPrinter 초기화 완료');
  } catch (error) {
    console.error('❌ 초기화 실패:', error);
    app.quit();
  }
}

// 앱 이벤트
app.whenReady().then(() => {
  appState.initPromise = initialize();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!appState.mainWindow) {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  if (appState.httpServer) {
    appState.httpServer.stop();
  }
});

module.exports = { appState };