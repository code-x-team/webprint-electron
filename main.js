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

// 세션 데이터 저장 경로
const sessionDataPath = path.join(os.homedir(), '.webprinter-sessions.json');

// 세션 데이터 저장 (영구 저장소)
function saveSessionData() {
  try {
    const sessionData = {
      lastSaved: new Date().toISOString(),
      currentSession: currentSession,
      receivedUrls: receivedUrls
    };
    
    fs.writeFileSync(sessionDataPath, JSON.stringify(sessionData, null, 2));
    console.log('💾 세션 데이터 저장 완료:', Object.keys(receivedUrls).length, '개 세션');
  } catch (error) {
    console.warn('⚠️ 세션 데이터 저장 실패:', error.message);
  }
}

// 세션 데이터 복구
function loadSessionData() {
  try {
    if (!fs.existsSync(sessionDataPath)) {
      console.log('📂 저장된 세션 데이터가 없습니다.');
      return;
    }
    
    const data = fs.readFileSync(sessionDataPath, 'utf8');
    const sessionData = JSON.parse(data);
    
    // 24시간 이내 데이터만 복구
    const savedTime = new Date(sessionData.lastSaved);
    const now = new Date();
    const hoursDiff = (now - savedTime) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      console.log('🕒 저장된 세션 데이터가 24시간 이상 경과하여 무시됩니다.');
      fs.unlinkSync(sessionDataPath); // 오래된 파일 삭제
      return;
    }
    
    // 데이터 복구
    receivedUrls = sessionData.receivedUrls || {};
    const sessionCount = Object.keys(receivedUrls).length;
    
    if (sessionCount > 0) {
      console.log('🔄 세션 데이터 복구 완료:', sessionCount, '개 세션');
      
      // 각 세션의 상세 정보 출력
      Object.keys(receivedUrls).forEach(sessionId => {
        const urls = receivedUrls[sessionId];
        console.log(`📋 세션 ${sessionId}: preview=${!!urls.previewUrl}, print=${!!urls.printUrl}, size=${urls.paperSize?.width}x${urls.paperSize?.height}mm`);
      });
    } else {
      console.log('📂 복구할 세션 데이터가 없습니다.');
    }
  } catch (error) {
    console.warn('⚠️ 세션 데이터 복구 실패:', error.message);
    // 손상된 파일 삭제
    try {
      fs.unlinkSync(sessionDataPath);
    } catch (e) {
      // 무시
    }
  }
}

// 오래된 세션 정리
function cleanOldSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24시간
  let cleanedCount = 0;
  
  Object.keys(receivedUrls).forEach(sessionId => {
    const sessionData = receivedUrls[sessionId];
    if (sessionData.timestamp && (now - sessionData.timestamp) > maxAge) {
      delete receivedUrls[sessionId];
      cleanedCount++;
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`🧹 오래된 세션 ${cleanedCount}개 정리 완료`);
    saveSessionData(); // 정리 후 저장
  }
}

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
        
        // 용지 사이즈 정보 추출 (웹에서 반드시 전달해야 함)
        const paperWidth = parseFloat(req.body.paper_width);
        const paperHeight = parseFloat(req.body.paper_height);
        const paperSize = req.body.paper_size || 'Custom';
        
        // 용지 사이즈 검증
        if (!paperWidth || !paperHeight || paperWidth <= 0 || paperHeight <= 0) {
          console.error('❌ 잘못된 용지 사이즈:', { paperWidth, paperHeight });
          return res.status(400).json({ 
            error: 'Invalid paper size. Width and height must be positive numbers.',
            received: { paperWidth, paperHeight, paperSize }
          });
        }
        
        console.log(`📏 웹에서 전달받은 용지 사이즈: ${paperWidth}mm × ${paperHeight}mm (${paperSize})`);
        
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
        
        // 세션에 URL과 용지 정보 저장 (타임스탬프 포함)
        urlData.timestamp = Date.now();
        urlData.receivedAt = new Date().toISOString();
        receivedUrls[sessionId] = urlData;
        
        // 세션 데이터 영구 저장
        saveSessionData();
        
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
        
        if (printWindow && !printWindow.isDestroyed() && currentSession === sessionId) {
          // 렌더러가 준비될 때까지 대기 후 전송
          if (printWindow.webContents.isLoading()) {
            console.log('⏳ 렌더러 로딩 중 - 로드 완료 후 전송');
            printWindow.webContents.once('did-finish-load', () => {
              setTimeout(() => {
                if (printWindow && !printWindow.isDestroyed()) {
                  console.log('✅ 실시간 IPC 메시지 전송: urls-received');
                  printWindow.webContents.send('urls-received', urlData);
                }
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
async function createPrintWindow(sessionId = null, isForced = false) {
  // 프로그램 실행 시마다 업데이트 체크 (출력하기 버튼 클릭 시)
  if (isForced) {
    console.log('🚀 강제 실행 모드 - 업데이트 체크 생략');
  } else {
    console.log('🔄 WebPrinter 실행 - 업데이트 확인 중...');
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      console.warn('업데이트 체크 실패 (무시됨):', error.message);
    }
  }
  
  // 기존 창이 있고 숨겨져 있으면 재사용
  if (printWindow && !printWindow.isDestroyed()) {
    if (isForced) {
      console.log('🚀 강제 모드 - 기존 창 적극적 복원');
      printWindow.show();
      printWindow.focus();
      printWindow.setAlwaysOnTop(true);
      setTimeout(() => printWindow.setAlwaysOnTop(false), 1000); // 1초간 최상단 유지
      
      // 플랫폼별 추가 활성화
      if (process.platform === 'darwin' && app.dock) {
        app.dock.show();
        app.focus();
      } else if (process.platform === 'win32') {
        printWindow.setAlwaysOnTop(true);
        setTimeout(() => printWindow.setAlwaysOnTop(false), 1000);
      }
    } else {
      console.log('🔄 기존 창 재사용 - 숨겨진 상태에서 복원');
      printWindow.show();
      printWindow.focus();
    }
    
    // 세션 ID만 업데이트
    if (sessionId) {
      currentSession = sessionId;
    }
    
    // 서버 정보 다시 전송
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.webContents.send('server-info', {
          port: serverPort,
          session: currentSession
        });
      }
    }, 500);
    
    return;
  }
  
  // 기존 창이 파괴된 상태면 정리
  if (printWindow && printWindow.isDestroyed()) {
    printWindow = null;
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
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.show();
    }
    
    // 렌더러가 완전히 로드될 때까지 대기 후 IPC 전송
    printWindow.webContents.once('did-finish-load', () => {
      console.log('🎯 렌더러 프로세스 로드 완료');
      
      // 조금 더 대기 후 IPC 전송 (렌더러 스크립트 실행 완료 보장)
      setTimeout(() => {
        console.log('📡 IPC 메시지 전송 시작');
        
        // 서버 정보와 세션 ID를 렌더러 프로세스로 전송
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.webContents.send('server-info', {
            port: serverPort,
            session: sessionId
          });
          console.log('✅ server-info 전송 완료');
        }

        // 이미 받은 URL이 있으면 로드 (현재 세션 또는 복구된 최근 세션)
        console.log(`🔍 윈도우 생성 후 URL 확인:`);
        console.log(`- sessionId: ${sessionId}`);
        console.log(`- receivedUrls[sessionId] 존재: ${!!receivedUrls[sessionId]}`);
        
        let urlDataToSend = null;
        let usedSessionId = sessionId;
        
        if (receivedUrls[sessionId]) {
          // 현재 세션에 데이터가 있음
          urlDataToSend = receivedUrls[sessionId];
          console.log('✅ 현재 세션의 URL 데이터 발견');
        } else {
          // 현재 세션에 데이터가 없으면 복구된 세션 중 가장 최근 것 찾기
          const sessions = Object.keys(receivedUrls);
          if (sessions.length > 0) {
            // 타임스탬프 기준으로 가장 최근 세션 찾기
            let latestSession = sessions[0];
            let latestTimestamp = receivedUrls[latestSession].timestamp || 0;
            
            sessions.forEach(sid => {
              const timestamp = receivedUrls[sid].timestamp || 0;
              if (timestamp > latestTimestamp) {
                latestSession = sid;
                latestTimestamp = timestamp;
              }
            });
            
            urlDataToSend = receivedUrls[latestSession];
            usedSessionId = latestSession;
            
            console.log(`🔄 복구된 세션에서 가장 최근 데이터 사용: ${latestSession}`);
            console.log(`📅 데이터 생성 시간: ${new Date(latestTimestamp).toLocaleString()}`);
            
            // 현재 세션을 복구된 세션으로 업데이트
            currentSession = latestSession;
          }
        }
        
        if (urlDataToSend) {
          console.log('✅ URL 데이터를 윈도우로 전송');
          console.log('📤 전송할 데이터:', urlDataToSend);
          console.log('🔗 사용된 세션 ID:', usedSessionId);
          
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.webContents.send('urls-received', urlDataToSend);
            printWindow.webContents.send('session-restored', {
              sessionId: usedSessionId,
              restoredFromSaved: usedSessionId !== sessionId,
              dataAge: urlDataToSend.receivedAt ? new Date(urlDataToSend.receivedAt).toLocaleString() : '알 수 없음'
            });
            console.log('✅ urls-received 및 session-restored 전송 완료');
          }
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
      
      // 세션 정리 후 저장
      saveSessionData();
    }
  });

  // DevTools는 프로덕션에서 사용하지 않음

  return sessionId;
}

// 자동 업데이트 설정 (적극적 자동 업데이트)
function setupAutoUpdater() {
  // 앱 시작 시 즉시 업데이트 체크 (자동 다운로드)
  console.log('🔄 시작 시 업데이트 확인 중...');
  autoUpdater.checkForUpdates();
  
  // 10분마다 업데이트 체크 (백그라운드)
  setInterval(() => {
    console.log('🔄 정기 업데이트 확인 중...');
    autoUpdater.checkForUpdates();
  }, 10 * 60 * 1000);
  
  // 개발 모드에서는 업데이트 비활성화
  if (process.env.NODE_ENV === 'development') {
    autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
  }
  
  // 업데이트 이벤트 리스너
  autoUpdater.on('checking-for-update', () => {
    console.log('업데이트 확인 중...');
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('🆕 업데이트 발견됨:', info.version);
    console.log('📥 자동 다운로드를 시작합니다...');
    
    // 사용자에게 업데이트 시작 알림
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        autoDownload: true
      });
    }
    
    // 자동으로 업데이트 다운로드 시작
    autoUpdater.downloadUpdate();
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('✅ 최신 버전입니다.');
    
    // 사용자에게 최신 버전임을 알림 (선택적)
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-not-available');
    }
  });
  
  autoUpdater.on('error', (error) => {
    console.error('❌ 업데이트 오류:', error);
    
    // 사용자에게 업데이트 오류 알림
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-error', {
        message: error.message
      });
    }
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    const message = `다운로드 진행률: ${Math.round(progressObj.percent)}%`;
    console.log(message);
    
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-progress', {
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ 업데이트 다운로드 완료, 다음 실행 시 적용 예정');
    
    // 사용자에게 업데이트 완료 알림 (즉시 재시작하지 않음)
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-downloaded', {
        version: info.version,
        autoRestart: false, // 자동 재시작 비활성화
        installOnNextStart: true, // 다음 시작 시 설치
        userChoice: true // 사용자 선택 가능
      });
    }
    
    console.log('💡 업데이트가 준비되었습니다. 다음번 앱 시작 시 자동으로 적용됩니다.');
    console.log('🔄 즉시 적용하려면 앱을 재시작하세요.');
  });
}

// 앱 준비 상태 추적
let isAppReady = false;
let pendingProtocolCall = null;

// 시작 프로그램 등록 (OS별 자동 시작 설정)
function setupAutoLaunch() {
  try {
    const openAtLogin = app.getLoginItemSettings().openAtLogin;
    
    if (!openAtLogin) {
      console.log('🚀 시작 프로그램에 WebPrinter 등록 중...');
      
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,  // 숨겨진 상태로 시작
        name: 'WebPrinter',
        args: ['--hidden'] // 숨겨진 모드로 시작
      });
      
      console.log('✅ 시작 프로그램 등록 완료 - 부팅 시 자동 실행됩니다');
    } else {
      console.log('✅ 이미 시작 프로그램에 등록되어 있습니다');
    }
  } catch (error) {
    console.warn('⚠️ 시작 프로그램 등록 실패 (권한 부족):', error.message);
  }
}

// 앱 이벤트 핸들러
app.whenReady().then(async () => {
  registerProtocol();
  setupAutoUpdater();
  setupAutoLaunch(); // 시작 프로그램 등록
  
  // HTTP 서버 시작
  try {
    httpServer = await startHttpServer();
  } catch (error) {
    console.error('HTTP 서버 시작 실패:', error);
  }
  
  // 세션 데이터 복구
  loadSessionData();
  cleanOldSessions();
  
  // 앱 준비 완료 표시
  isAppReady = true;
  
  // 숨겨진 모드로 시작되었는지 확인
  const isHiddenMode = process.argv.includes('--hidden');
  if (isHiddenMode) {
    console.log('🔕 숨겨진 모드로 시작 - 백그라운드 서비스로 실행');
    isBackgroundService = true;
    
    // 독(Dock) 및 작업 표시줄에서 숨기기
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
  } else {
    console.log('🖥️ 일반 모드로 시작');
  }
  
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
      const isForced = params.force === 'true';
      
      if (isForced) {
        console.log('🚀 강제 실행 모드로 프린트 윈도우 생성 중...', sessionId);
      } else {
        console.log('프린트 윈도우 생성 중...', sessionId);
      }
      
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
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.show();
            printWindow.focus();
          }
        }
      }
      
      await createPrintWindow(sessionId, isForced);
      
      // 웹에게 서버 정보 응답 (콘솔 출력으로 웹 개발자가 확인 가능)
      if (isForced) {
        console.log(`🚀 WebPrinter 강제 실행 완료:`);
      } else {
        console.log(`WebPrinter 준비됨:`);
      }
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
    const printers = (printWindow && !printWindow.isDestroyed()) ? await printWindow.webContents.getPrintersAsync() : [];
    return { success: true, printers };
  } catch (error) {
    console.error('프린터 목록 가져오기 실패:', error);
    return { success: false, error: error.message };
  }
});

// PDF 관련 함수 제거됨

// Electron 내장 프린트 (간단하고 직접적인 방식)
ipcMain.handle('print-url', async (event, options) => {
  try {
    const { url, printerName, copies = 1, silent = false, paperSize = null } = options;
    
    if (!url) {
      throw new Error('인쇄할 URL이 없습니다');
    }
    
    console.log(`🖨️ Electron 직접 프린트 시작: ${url}`);
    
    // STEP 1: 프린트 전용 BrowserWindow 생성
    const printWindow = new BrowserWindow({
      show: false, // 숨겨진 창
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false, // 외부 리소스 로딩 허용
        plugins: true
      }
    });
    
    try {
      console.log('📄 URL 로딩 시작...');
      
      // STEP 2: URL 로드
      await printWindow.loadURL(url);
      console.log('✅ URL 로딩 완료');
      
      // STEP 3: DOM 완전 로드 대기
      console.log('⏳ DOM 완전 로드 대기 중...');
      await printWindow.webContents.executeJavaScript(`
        new Promise(resolve => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve);
          }
        })
      `);
      console.log('✅ DOM 로딩 완료');
      
      // STEP 4: 추가 동적 콘텐츠 로딩 대기 (AJAX, 이미지 등)
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('✅ 동적 콘텐츠 로딩 완료');
      
      // STEP 5: 용지 사이즈 및 프린트 옵션 설정
      const printOptions = {
        silent: false, // 항상 프린트 대화상자 표시
        printBackground: true, // 배경 인쇄
        marginsType: 1, // 최소 여백
        landscape: false, // 세로 방향
        copies: copies
      };
      
      // 프린터 설정
      if (printerName) {
        // 사용 가능한 프린터 확인
        const printers = await printWindow.webContents.getPrintersAsync();
        const selectedPrinter = printers.find(p => p.name === printerName);
        
        if (selectedPrinter) {
          printOptions.deviceName = printerName;
          console.log(`✅ 프린터 설정: ${printerName}`);
        } else {
          console.warn(`⚠️ 프린터 '${printerName}'를 찾을 수 없습니다. 기본 프린터 사용.`);
        }
      }
      
      // 용지 사이즈 설정 (웹에서 보낸 사이즈 사용)
      if (paperSize && paperSize.width && paperSize.height) {
        // 웹에서 전달받은 용지 사이즈 (mm → microns)
        printOptions.pageSize = {
          width: paperSize.width * 1000,
          height: paperSize.height * 1000
        };
        console.log(`📏 웹에서 지정한 용지 크기: ${paperSize.width}mm × ${paperSize.height}mm`);
      } else {
        console.error('❌ 용지 사이즈 정보가 없습니다. 웹에서 전달되지 않았습니다.');
        throw new Error('용지 사이즈가 지정되지 않았습니다. 웹에서 크기를 설정해주세요.');
      }
      
      console.log('🖨️ 프린트 옵션:', printOptions);
      
      // STEP 6: 프린트 실행
      return new Promise((resolve, reject) => {
        console.log('🚀 프린트 대화상자 열기...');
        
        printWindow.webContents.print(printOptions, (success, failureReason) => {
          // 프린트 윈도우 정리
          setTimeout(() => {
            if (!printWindow.isDestroyed()) {
              printWindow.close();
            }
          }, 1000);
          
          if (success) {
            console.log('✅ 프린트 대화상자 열림 성공');
            resolve({
              success: true,
              message: '프린트 대화상자가 열렸습니다.',
              method: 'Electron 직접 프린트',
              printerName: printerName || '기본 프린터',
              paperSize: `${paperSize.width}×${paperSize.height}mm`
            });
          } else {
            console.error('❌ 프린트 대화상자 열기 실패:', failureReason);
            reject(new Error(`프린트 실패: ${failureReason || '알 수 없는 오류'}`));
          }
        });
      });
      
    } catch (error) {
      // 오류 발생 시 윈도우 정리
      if (!printWindow.isDestroyed()) {
        printWindow.close();
      }
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Electron 프린트 실패:', error);
    return { 
      success: false, 
      error: error.message,
      method: 'Electron 직접 프린트'
    };
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

// 앱을 백그라운드로 숨기기 (서비스 모드 유지)
ipcMain.handle('hide-to-background', () => {
  console.log('🔄 사용자 요청에 의한 백그라운드 이동');
  
  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.hide(); // 창만 숨기기
    isBackgroundService = true; // 백그라운드 서비스 활성화
    
    if (process.platform === 'darwin') {
      // macOS: 독에서 앱 숨기기
      if (app.dock) {
        app.dock.hide();
      }
    }
    
    console.log('✅ 백그라운드 서비스 모드로 전환 완료 - HTTP 서버 유지 중...');
  }
});

// 앱 완전 종료
ipcMain.handle('quit-app', () => {
  console.log('🚪 사용자 요청에 의한 앱 완전 종료');
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
  console.log('🔄 사용자 요청에 의한 업데이트 설치 시작');
  
  // 백그라운드 서비스 모드 해제
  isBackgroundService = false;
  
  // 업데이트 설치 및 재시작
  autoUpdater.quitAndInstall();
  
  return { success: true, message: '업데이트를 설치하고 재시작합니다.' };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
}); 