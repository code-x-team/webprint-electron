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
      const { session, front_preview_url, paper_width, paper_height, print_selector } = data;
      
      if (!session || !front_preview_url) {
        throw new Error('필수 파라미터가 없습니다');
      }

      const sessionData = {
        previewUrl: front_preview_url,
        printUrl: data.front_print_url || front_preview_url,
        paperSize: {
          width: parseFloat(paper_width) || 210,
          height: parseFloat(paper_height) || 297
        },
        printSelector: print_selector || '.print_wrap',
        timestamp: Date.now()
      };

      appState.sessions.set(session, sessionData);
      
      // 윈도우에 알림
      if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
        appState.mainWindow.webContents.send('urls-received', sessionData);
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

// IPC 핸들러 설정
function setupIpcHandlers() {
  // 서버 정보 요청
  ipcMain.handle('get-server-info', () => ({
    port: appState.serverPort,
    ready: appState.serverReady,
    session: Array.from(appState.sessions.keys())[0] || null
  }));

  // 세션 데이터 요청
  ipcMain.handle('get-session-data', (event, sessionId) => {
    return appState.sessions.get(sessionId) || null;
  });

  // 프린터 목록
  ipcMain.handle('get-printers', async () => {
    try {
      if (!appState.mainWindow || appState.mainWindow.isDestroyed()) {
        throw new Error('윈도우가 없습니다');
      }
      
      const printers = await appState.mainWindow.webContents.getPrintersAsync();
      return { success: true, printers };
    } catch (error) {
      return { success: false, error: error.message, printers: [] };
    }
  });

  // 인쇄
  ipcMain.handle('print-url', async (event, params) => {
    try {
      // 간단한 PDF 인쇄 로직
      const pdfOptions = {
        marginsType: 1,
        pageSize: 'A4',
        printBackground: true,
        landscape: false
      };
      
      const pdf = await appState.mainWindow.webContents.printToPDF(pdfOptions);
      
      if (params.outputType === 'pdf') {
        // PDF 저장
        const pdfPath = path.join(os.homedir(), 'Downloads', `WebPrinter_${Date.now()}.pdf`);
        await fs.writeFile(pdfPath, pdf);
        
        // PDF 열기
        require('electron').shell.openPath(pdfPath);
        
        return { success: true, message: 'PDF가 생성되었습니다' };
      } else {
        // 프린터로 인쇄
        await appState.mainWindow.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: params.printerName
        });
        
        return { success: true, message: '인쇄가 시작되었습니다' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 앱 정보
  ipcMain.handle('get-app-version', () => app.getVersion());
  
  // 종료
  ipcMain.handle('hide-to-background', () => {
    if (appState.mainWindow && !appState.mainWindow.isDestroyed()) {
      appState.mainWindow.hide();
    }
  });
}

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
    setupIpcHandlers();
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