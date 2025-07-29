const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const url = require('url');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');

let printWindow = null;
let httpServer = null;
let serverPort = null;
let currentSession = null;
let receivedUrls = {};

// 프로토콜 핸들러 등록 (강화)
function registerProtocol() {
  const protocolName = 'webprinter';
  
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        const result = app.setAsDefaultProtocolClient(protocolName, process.execPath, [path.resolve(process.argv[1])]);
        console.log(`🔗 프로토콜 핸들러 등록 (개발 모드): ${result ? '성공' : '실패'}`);
      }
    } else {
      const result = app.setAsDefaultProtocolClient(protocolName);
      console.log(`🔗 프로토콜 핸들러 등록: ${result ? '성공' : '실패'}`);
      
      // 등록 상태 확인
      const isDefault = app.isDefaultProtocolClient(protocolName);
      console.log(`📋 기본 프로토콜 클라이언트 상태: ${isDefault ? '등록됨' : '등록 안됨'}`);
      
      // 시스템에 등록된 프로토콜 핸들러 정보 표시
      if (process.platform === 'darwin') {
        console.log(`💡 테스트 URL: webprinter://print?session=test`);
        console.log(`💡 터미널에서 테스트: open "webprinter://print?session=test"`);
      }
    }
  } catch (error) {
    console.error('❌ 프로토콜 핸들러 등록 실패:', error);
  }
}

// HTTP 서버 시작
function startHttpServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    
    // CORS 설정
    app.use(cors({
      origin: '*',
      credentials: true
    }));
    
    app.use(express.json({ limit: '10mb' }));
    
    // URL 정보 전송 엔드포인트
    app.post('/send-urls', (req, res) => {
      try {
        const sessionId = req.body.session;
        const previewUrl = req.body.preview_url;
        const printUrl = req.body.print_url;
        
        if (!sessionId) {
          return res.status(400).json({ error: 'Session ID required' });
        }
        
        if (!previewUrl && !printUrl) {
          return res.status(400).json({ error: 'At least one URL required' });
        }
        
        // 용지 사이즈 정보 추출
        const paperWidth = parseFloat(req.body.paper_width) || 210; // 기본값: A4 width (210mm)
        const paperHeight = parseFloat(req.body.paper_height) || 297; // 기본값: A4 height (297mm)
        const paperSize = req.body.paper_size || 'Custom'; // A4, Letter, Custom 등
        
        console.log(`용지 사이즈: ${paperWidth}mm × ${paperHeight}mm (${paperSize})`);
        
        const urlData = {
          paperSize: {
            name: paperSize,
            width: paperWidth,
            height: paperHeight
          }
        };
        
        if (previewUrl) {
          urlData.previewUrl = previewUrl;
        }
        
        if (printUrl) {
          urlData.printUrl = printUrl;
        }
        
        // 세션에 URL과 용지 정보 저장
        receivedUrls[sessionId] = urlData;
        
        console.log(`URL 정보 수신 완료 - 세션: ${sessionId}`);
        console.log('미리보기 URL:', urlData.previewUrl || '없음');
        console.log('인쇄 URL:', urlData.printUrl || '없음');
        console.log('용지 사이즈:', urlData.paperSize);
        
        // 미리보기 창이 있으면 URL 로드 알림
        console.log(`🔍 실시간 IPC 전송 조건 확인:`);
        console.log(`- printWindow 존재: ${!!printWindow}`);
        console.log(`- currentSession: ${currentSession}`);
        console.log(`- 요청 sessionId: ${sessionId}`);
        console.log(`- 세션 일치: ${currentSession === sessionId}`);
        
        if (printWindow && currentSession === sessionId) {
          // 렌더러가 준비될 때까지 대기 후 전송
          if (printWindow.webContents.isLoading()) {
            console.log('⏳ 렌더러 로딩 중 - 로드 완료 후 전송');
            printWindow.webContents.once('did-finish-load', () => {
              setTimeout(() => {
                console.log('✅ 실시간 IPC 메시지 전송: urls-received');
                printWindow.webContents.send('urls-received', urlData);
              }, 500);
            });
          } else {
            console.log('✅ 즉시 IPC 메시지 전송: urls-received');
            printWindow.webContents.send('urls-received', urlData);
          }
        } else {
          console.log('⚠️ IPC 메시지 전송 조건 불충족 - 나중에 전송됩니다');
        }
        
        res.json({ 
          success: true, 
          message: 'URLs received successfully',
          session: sessionId,
          paperSize: urlData.paperSize
        });
        
      } catch (error) {
        console.error('URL 정보 처리 오류:', error);
        res.status(500).json({ error: 'URL processing failed' });
      }
    });
    
    // 서버 상태 확인 엔드포인트
    app.get('/status', (req, res) => {
      const packageInfo = require('./package.json');
      res.json({ 
        status: 'running', 
        session: currentSession,
        version: packageInfo.version,
        name: packageInfo.name
      });
    });

    // 버전 정보 전용 엔드포인트
    app.get('/version', (req, res) => {
      const packageInfo = require('./package.json');
      res.json({
        version: packageInfo.version,
        name: packageInfo.name,
        description: packageInfo.description,
        author: packageInfo.author,
        homepage: `https://github.com/code-x-team/webprint-electron`
      });
    });
    
    // 사용 가능한 포트 찾기 (18731-18740 범위)
    let portToTry = 18731;
    
    const tryPort = (port) => {
      const server = app.listen(port, 'localhost', () => {
        serverPort = server.address().port;
        console.log(`HTTP 서버 시작됨: http://localhost:${serverPort}`);
        resolve(server);
      });
      
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && port < 18740) {
          console.log(`포트 ${port} 사용 중, ${port + 1} 시도`);
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    };
    
    tryPort(portToTry);
  });
}

// HTTP 서버 중지
function stopHttpServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    serverPort = null;
    console.log('HTTP 서버 중지됨');
  }
}

// URL에서 매개변수 파싱
function parseProtocolUrl(protocolUrl) {
  try {
    const parsedUrl = new URL(protocolUrl);
    const action = parsedUrl.hostname;
    const params = {};
    
    parsedUrl.searchParams.forEach((value, key) => {
      params[key] = decodeURIComponent(value);
    });
    
    return { action, params };
  } catch (error) {
    console.error('URL 파싱 실패:', error);
    return null;
  }
}

// 세션 ID 생성
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 인쇄 미리보기 창 생성
async function createPrintWindow(sessionId = null) {
  if (printWindow) {
    printWindow.close();
  }

  // 세션 ID가 없으면 새로 생성
  if (!sessionId) {
    sessionId = generateSessionId();
  }
  currentSession = sessionId;

  // HTTP 서버가 실행 중이 아니면 시작
  if (!httpServer) {
    try {
      httpServer = await startHttpServer();
    } catch (error) {
      console.error('HTTP 서버 시작 실패:', error);
      return;
    }
  }

  printWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'WebPrinter - 인쇄 미리보기',
    show: false,
    autoHideMenuBar: true
  });

  // 인쇄 UI 로드
  printWindow.loadFile('print-preview.html');

  printWindow.once('ready-to-show', () => {
    printWindow.show();
    
    // 렌더러가 완전히 로드될 때까지 대기 후 IPC 전송
    printWindow.webContents.once('did-finish-load', () => {
      console.log('🎯 렌더러 프로세스 로드 완료');
      
      // 조금 더 대기 후 IPC 전송 (렌더러 스크립트 실행 완료 보장)
      setTimeout(() => {
        console.log('📡 IPC 메시지 전송 시작');
        
        // 서버 정보와 세션 ID를 렌더러 프로세스로 전송
        printWindow.webContents.send('server-info', {
          port: serverPort,
          session: sessionId
        });
        console.log('✅ server-info 전송 완료');

        // 이미 받은 URL이 있으면 로드
        console.log(`🔍 윈도우 생성 후 URL 확인:`);
        console.log(`- sessionId: ${sessionId}`);
        console.log(`- receivedUrls[sessionId] 존재: ${!!receivedUrls[sessionId]}`);
        
        if (receivedUrls[sessionId]) {
          console.log('✅ 이미 받은 URL 데이터를 윈도우로 전송');
          console.log('📤 전송할 데이터:', receivedUrls[sessionId]);
          printWindow.webContents.send('urls-received', receivedUrls[sessionId]);
          console.log('✅ urls-received 전송 완료');
        } else {
          console.log('⚠️ 아직 URL 데이터가 없음 - 대기 중');
        }
      }, 1000); // 1초 대기
    });
  });

  printWindow.on('closed', () => {
    printWindow = null;
    currentSession = null;
    
    // 세션 데이터 정리
    if (sessionId && receivedUrls[sessionId]) {
      delete receivedUrls[sessionId];
      console.log(`세션 ${sessionId} 정리 완료`);
    }
  });

  // DevTools는 프로덕션에서 사용하지 않음

  return sessionId;
}

// 자동 업데이트 설정
function setupAutoUpdater() {
  // 더 적극적인 업데이트 체크 설정
  autoUpdater.checkForUpdatesAndNotify();
  
  // 5분마다 업데이트 체크
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 5 * 60 * 1000);
  
  // 개발 모드에서는 업데이트 비활성화
  if (process.env.NODE_ENV === 'development') {
    autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
  }
  
  // 업데이트 이벤트 리스너
  autoUpdater.on('checking-for-update', () => {
    console.log('업데이트 확인 중...');
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('업데이트 발견됨:', info.version);
    
    // 사용자에게 업데이트 알림 (프린터 창이 있는 경우)
    if (printWindow) {
      printWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate
      });
    }
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('최신 버전입니다.');
  });
  
  autoUpdater.on('error', (error) => {
    console.error('업데이트 오류:', error);
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    const message = `다운로드 진행률: ${Math.round(progressObj.percent)}%`;
    console.log(message);
    
    if (printWindow) {
      printWindow.webContents.send('update-progress', {
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('업데이트 다운로드 완료, 재시작 준비됨');
    
    // 사용자에게 재시작 확인
    if (printWindow) {
      printWindow.webContents.send('update-downloaded', {
        version: info.version
      });
    } else {
      // 프린터 창이 없으면 바로 재시작
      setTimeout(() => {
        autoUpdater.quitAndInstall();
      }, 3000);
    }
  });
}

// 앱 준비 상태 추적
let isAppReady = false;
let pendingProtocolCall = null;

// 앱 이벤트 핸들러
app.whenReady().then(async () => {
  registerProtocol();
  setupAutoUpdater();
  
  // HTTP 서버 시작
  try {
    httpServer = await startHttpServer();
  } catch (error) {
    console.error('HTTP 서버 시작 실패:', error);
  }
  
  // 앱 준비 완료 표시
  isAppReady = true;
  
  // 대기 중인 프로토콜 호출 처리
  if (pendingProtocolCall) {
    console.log('대기 중이던 프로토콜 호출 처리:', pendingProtocolCall);
    await handleProtocolCall(pendingProtocolCall);
    pendingProtocolCall = null;
  }
  
  // 앱이 이미 실행 중일 때 프로토콜 호출 처리
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const protocolUrl = commandLine.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) {
      handleProtocolCall(protocolUrl);
    }
  });
});

// 단일 인스턴스 보장
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // 프로토콜 URL 처리
  app.on('open-url', (event, protocolUrl) => {
    event.preventDefault();
    handleProtocolCall(protocolUrl);
  });

  // Windows에서 프로토콜 처리
  if (process.platform === 'win32') {
    const protocolUrl = process.argv.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) {
      console.log('Windows 프로토콜 호출 감지:', protocolUrl);
      handleProtocolCall(protocolUrl);
    }
  }
}

// 프로토콜 호출 처리
async function handleProtocolCall(protocolUrl) {
  console.log('프로토콜 호출 받음:', protocolUrl);
  
  // 앱이 아직 준비되지 않았으면 대기
  if (!isAppReady) {
    console.log('앱이 준비 중입니다. 프로토콜 호출을 대기합니다...');
    pendingProtocolCall = protocolUrl;
    return;
  }
  
  const parsed = parseProtocolUrl(protocolUrl);
  if (!parsed) {
    console.error('잘못된 프로토콜 URL:', protocolUrl);
    return;
  }

  const { action, params } = parsed;

  switch (action) {
    case 'print':
      const sessionId = params.session || generateSessionId();
      console.log('프린트 윈도우 생성 중...', sessionId);
      
      // 백그라운드 서비스 모드에서 복원
      if (isBackgroundService) {
        console.log('🔄 백그라운드 서비스에서 UI 복원 중...');
        isBackgroundService = false;
        
        // 플랫폼별 UI 복원
        if (process.platform === 'darwin' && app.dock) {
          // macOS: 독(Dock)에서 앱 다시 표시
          app.dock.show();
        } else if (process.platform === 'win32') {
          // Windows: 앱을 전면으로 가져오기
          if (printWindow) {
            printWindow.show();
            printWindow.focus();
          }
        }
      }
      
      await createPrintWindow(sessionId);
      
      // 웹에게 서버 정보 응답 (콘솔 출력으로 웹 개발자가 확인 가능)
      console.log(`WebPrinter 준비됨:`);
      console.log(`- 서버 주소: http://localhost:${serverPort}`);
      console.log(`- 세션 ID: ${sessionId}`);
      console.log(`- URL 전송 엔드포인트: POST /send-urls`);
      break;
    
    case 'server-info':
      // 서버 정보만 요청하는 경우
      if (!httpServer) {
        try {
          httpServer = await startHttpServer();
        } catch (error) {
          console.error('HTTP 서버 시작 실패:', error);
          return;
        }
      }
      console.log(`서버 정보: http://localhost:${serverPort}`);
      break;
    
    default:
      console.error('알 수 없는 액션:', action);
  }
}

// 모든 윈도우가 닫히면 앱 종료 (macOS 제외)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopHttpServer();
    app.quit();
  }
});

// 앱 종료 전 정리
app.on('before-quit', () => {
  stopHttpServer();
  
  // 모든 세션 데이터 정리
  receivedUrls = {};
  console.log('모든 세션 데이터 정리 완료');
});

// 백그라운드 서비스 모드 (앱이 숨겨져도 HTTP 서버 유지)
let isBackgroundService = false;

// macOS에서 앱이 활성화되면 처리
app.on('activate', () => {
  // macOS에서는 독에서 클릭했을 때 새 창을 만들지 않음
  if (!printWindow && !isBackgroundService) {
    // 프린트 윈도우가 없고 백그라운드 서비스 모드가 아니면 미리보기 창 생성
    createPrintWindow();
  }
});

// 모든 창이 닫혔을 때 처리
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    // macOS: 백그라운드 서비스로 유지
    console.log('🔄 백그라운드 서비스 모드로 전환 (macOS) - HTTP 서버 유지 중...');
    isBackgroundService = true;
    
    // 독(Dock)에서 앱 숨기기
    if (app.dock) {
      app.dock.hide();
    }
  } else if (process.platform === 'win32') {
    // Windows: 시스템 트레이로 최소화 (백그라운드 서비스)
    console.log('🔄 백그라운드 서비스 모드로 전환 (Windows) - HTTP 서버 유지 중...');
    isBackgroundService = true;
    
    // 시스템 트레이 아이콘이 있다면 계속 실행
    console.log('💡 시스템 트레이에서 WebPrinter 서비스가 실행 중입니다.');
  } else {
    // 기타 플랫폼: 앱 종료
    app.quit();
  }
});

// 앱이 완전히 종료되기 전 처리
app.on('before-quit', () => {
  console.log('📴 WebPrinter 서비스 종료 중...');
  isBackgroundService = false;
  
  // HTTP 서버 정리
  if (httpServer) {
    stopHttpServer();
  }
});

// IPC 핸들러들

// 프린터 목록 가져오기
ipcMain.handle('get-printers', async () => {
  try {
    const printers = printWindow ? await printWindow.webContents.getPrintersAsync() : [];
    return { success: true, printers };
  } catch (error) {
    console.error('프린터 목록 가져오기 실패:', error);
    return { success: false, error: error.message };
  }
});

// URL이 PDF인지 확인
function isPdfUrl(url) {
  if (!url) return false;
  
  const urlLower = url.toLowerCase();
  // PDF 파일 확장자 또는 키워드로 판단
  return urlLower.includes('.pdf') || 
         urlLower.includes('pdf') || 
         urlLower.includes('document');
}

// URL 인쇄 실행 (웹페이지 또는 PDF 지원)
ipcMain.handle('print-url', async (event, options) => {
  try {
    const { url, printerName, copies = 1, silent = false, paperSize = null } = options;
    
    if (!url) {
      throw new Error('인쇄할 URL이 없습니다');
    }
    
    const isPdf = isPdfUrl(url);
    console.log(`인쇄 시작: ${isPdf ? 'PDF 문서' : '웹페이지'} - ${url}`);
    
    // 숨겨진 윈도우에서 URL 로드 및 인쇄
    const hiddenWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        plugins: true, // PDF 뷰어 플러그인 활성화
      }
    });

    await hiddenWindow.loadURL(url);
    
    // 페이지 로드 완료 대기
    await new Promise(resolve => {
      hiddenWindow.webContents.once('did-finish-load', resolve);
    });

    // PDF와 웹페이지에 따른 다른 대기 시간
    const waitTime = isPdf ? 2000 : 3000; // PDF는 조금 더 빠르게
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // 용지 사이즈 설정
    let pageSizeConfig = { pageSize: 'A4' };
    
    if (paperSize && paperSize.width && paperSize.height) {
      // 커스텀 용지 사이즈 (mm to microns: 1mm = 1000 microns)
      pageSizeConfig = {
        pageSize: {
          width: paperSize.width * 1000, // mm to microns
          height: paperSize.height * 1000
        }
      };
      console.log(`커스텀 용지 사이즈 적용: ${paperSize.width}mm × ${paperSize.height}mm`);
    }

    // 사용 가능한 프린터 목록 확인
    const availablePrinters = await hiddenWindow.webContents.getPrinters();
    console.log('사용 가능한 프린터 목록:', availablePrinters.map(p => p.name));
    
    // 선택된 프린터가 존재하는지 확인
    const selectedPrinter = availablePrinters.find(p => p.name === printerName);
    if (!selectedPrinter && printerName) {
      console.warn(`⚠️ 선택된 프린터 '${printerName}'를 찾을 수 없습니다. 기본 프린터 사용.`);
    } else if (selectedPrinter) {
      console.log(`✅ 프린터 확인: ${selectedPrinter.name} (상태: ${selectedPrinter.status})`);
    }

    // 일반 인쇄 (항상 대화상자 표시)
    const printOptions = {
      silent: false, // 강제로 대화상자 표시 (사용자 확인 필요)
      deviceName: selectedPrinter ? printerName : undefined, // 프린터가 없으면 기본값 사용
      copies: copies,
      ...pageSizeConfig,
      marginsType: isPdf ? 0 : 1, // PDF는 여백 없음, 웹페이지는 최소 여백
      scaleFactor: 100,
      printBackground: true, // 배경 인쇄 활성화
      headerFooter: false // 헤더/푸터 비활성화
    };

    console.log(`${isPdf ? 'PDF' : '웹페이지'} 인쇄 시작:`, {
      ...printOptions,
      url: url,
      printerCount: availablePrinters.length
    });

    try {
      // Electron의 print는 Promise를 반환하지 않으므로 다른 방식 사용
      hiddenWindow.webContents.print(printOptions, (success, failureReason) => {
        if (success) {
          console.log('✅ 인쇄 대화상자가 성공적으로 열렸습니다');
        } else {
          console.error('❌ 인쇄 대화상자 열기 실패:', failureReason);
        }
      });
      
      // 인쇄 대화상자가 열리는 최소 시간만 대기
      await new Promise(resolve => setTimeout(resolve, 300));
      
      hiddenWindow.close();
      console.log('🔄 인쇄 대화상자 열림 완료, 숨겨진 윈도우 닫음');
      
      return { 
        success: true, 
        message: '인쇄 대화상자가 열렸습니다.',
        printerName: selectedPrinter ? selectedPrinter.name : '기본 프린터',
        availablePrinters: availablePrinters.length
      };
      
    } catch (printError) {
      console.error('인쇄 실행 중 오류:', printError);
      hiddenWindow.close();
      throw new Error(`인쇄 실행 실패: ${printError.message}`);
    }
  } catch (error) {
    console.error('URL 인쇄 실패:', error);
    return { success: false, error: error.message };
  }
});

// 서버 정보 가져오기
ipcMain.handle('get-server-info', () => {
  return {
    port: serverPort,
    session: currentSession,
    running: !!httpServer
  };
});

// 앱 종료
ipcMain.handle('quit-app', () => {
  console.log('🚪 사용자 요청에 의한 앱 종료');
  isBackgroundService = false; // 백그라운드 서비스 비활성화
  app.quit();
});

// 업데이트 관련 IPC 핸들러
ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
}); 