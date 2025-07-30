const { app, BrowserWindow, ipcMain, protocol, Tray, Menu } = require('electron');
const path = require('path');
const url = require('url');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron'); 

let printWindow = null;
let httpServer = null;
let serverPort = null;
let currentSession = null;
let receivedUrls = {};
let tray = null;
let isQuitting = false;

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

// 언인스톨 감지 및 정리 함수들
function setupUninstallDetection() {
  // 5분마다 앱 실행 파일이 존재하는지 확인
  setInterval(() => {
    try {
      const appPath = process.execPath;
      const parentDir = path.dirname(appPath);
      
      // 실행 파일이나 주요 디렉토리가 삭제되었는지 확인
      if (!fs.existsSync(appPath) || !fs.existsSync(parentDir)) {
        console.log('🚨 앱이 언인스톨된 것을 감지했습니다.');
        cleanupAndExit('언인스톨 감지');
        return;
      }
      
      // 패키지 리소스 확인 (프로덕션 빌드인 경우)
      if (!process.defaultApp && process.resourcesPath) {
        const resourcesExist = fs.existsSync(process.resourcesPath);
        if (!resourcesExist) {
          console.log('🚨 앱 리소스가 삭제된 것을 감지했습니다.');
          cleanupAndExit('리소스 삭제 감지');
          return;
        }
      }
      
      // 정상 상태
      console.log('✅ 앱 무결성 체크 완료');
      
    } catch (error) {
      console.warn('⚠️ 언인스톨 감지 체크 오류:', error.message);
    }
  }, 5 * 60 * 1000); // 5분마다 체크
  
  console.log('🔍 언인스톨 자동 감지 시스템 활성화 (5분 간격)');
}

function cleanupAndExit(reason = '수동 종료') {
  console.log(`📴 앱 완전 종료 시작... (사유: ${reason})`);
  
  try {
    // 1. 시작 프로그램에서 제거
    app.setLoginItemSettings({
      openAtLogin: false,
      openAsHidden: false
    });
    console.log('✅ 시작 프로그램에서 제거 완료');
    
    // 2. 세션 데이터 정리
    if (fs.existsSync(sessionDataPath)) {
      fs.unlinkSync(sessionDataPath);
      console.log('✅ 세션 데이터 정리 완료');
    }
    
    // 3. HTTP 서버 정리
    if (httpServer) {
      stopHttpServer();
      console.log('✅ HTTP 서버 정리 완료');
    }
    
    // 4. 트레이 정리
    if (tray) {
      tray.destroy();
      console.log('✅ 시스템 트레이 정리 완료');
    }
    
    // 5. 모든 창 강제 종료
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    });
    console.log('✅ 모든 창 정리 완료');
    
  } catch (error) {
    console.error('⚠️ 정리 중 오류 발생:', error.message);
  }
  
  // 6. 완전 종료
  isQuitting = true;
  console.log('🔚 WebPrinter 완전 종료');
  app.quit();
  
  // 강제 종료 (마지막 수단)
  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

// 시스템 트레이 생성 (개선된 버전)
function createTray() {
  if (process.platform === 'win32' || process.platform === 'linux') {
    const iconPath = path.join(__dirname, 'icon.png'); // 트레이 아이콘 필요
    
    try {
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        {
          label: '📂 WebPrinter 열기',
          click: () => {
            if (printWindow) {
              printWindow.show();
              printWindow.focus();
            } else {
              createPrintWindow();
            }
          }
        },
        {
          label: '📊 상태 정보',
          click: () => {
            const statusInfo = [
              `버전: ${app.getVersion()}`,
              `서버 포트: ${serverPort || '미실행'}`,
              `활성 세션: ${Object.keys(receivedUrls).length}개`,
              `메모리 사용: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
              `실행 시간: ${Math.round(process.uptime() / 60)}분`
            ].join('\n');
            
            dialog.showMessageBox(null, {
              type: 'info',
              title: 'WebPrinter 상태',
              message: '현재 상태 정보',
              detail: statusInfo,
              buttons: ['확인']
            });
          }
        },
        { type: 'separator' },
        {
          label: '⚙️ 백그라운드 모드 해제',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'question',
              title: '백그라운드 모드 해제',
              message: '부팅 시 자동 실행을 해제하시겠습니까?',
              detail: '다음 부팅부터는 수동으로 실행해야 합니다.',
              buttons: ['해제', '취소'],
              defaultId: 1,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) {
                app.setLoginItemSettings({
                  openAtLogin: false
                });
                
                dialog.showMessageBox(null, {
                  type: 'info',
                  title: 'WebPrinter',
                  message: '백그라운드 자동 실행이 해제되었습니다.',
                  detail: '다음 부팅부터는 자동으로 시작되지 않습니다.',
                  buttons: ['확인']
                });
              }
            });
          }
        },
        {
          label: '🔄 앱 재시작',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'question',
              title: 'WebPrinter 재시작',
              message: 'WebPrinter를 재시작하시겠습니까?',
              detail: '모든 세션이 초기화됩니다.',
              buttons: ['재시작', '취소'],
              defaultId: 1,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) {
                app.relaunch();
                cleanupAndExit('사용자 재시작');
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: '🛑 완전 종료 (프로세스 종료)',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'warning',
              title: 'WebPrinter 완전 종료',
              message: '정말로 WebPrinter를 완전히 종료하시겠습니까?',
              detail: [
                '• 백그라운드 서비스가 완전히 중지됩니다',
                '• 웹에서 더 이상 호출할 수 없게 됩니다', 
                '• 다시 사용하려면 수동으로 실행해야 합니다',
                '• 시작 프로그램에서도 제거됩니다'
              ].join('\n'),
              buttons: ['완전 종료', '취소'],
              defaultId: 1,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) {
                cleanupAndExit('사용자 완전 종료');
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: '🔽 창 숨기기',
          click: () => {
            if (printWindow && !printWindow.isDestroyed()) {
              printWindow.hide();
            }
          }
        }
      ]);
      
      tray.setToolTip('WebPrinter - 우클릭으로 메뉴 열기');
      tray.setContextMenu(contextMenu);
      
      // 트레이 더블클릭 시 창 열기
      tray.on('double-click', () => {
        if (printWindow) {
          printWindow.show();
          printWindow.focus();
        } else {
          createPrintWindow();
        }
      });
      
      console.log('✅ 시스템 트레이 생성 완료 (개선된 메뉴)');
    } catch (error) {
      console.warn('⚠️ 시스템 트레이 생성 실패:', error.message);
    }
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
    const expressApp = express();
    
    // CORS 설정
    expressApp.use(cors({
      origin: '*',
      credentials: true
    }));
    
    expressApp.use(express.json({ limit: '10mb' }));
    
    // URL 정보 전송 엔드포인트
    expressApp.post('/send-urls', (req, res) => {
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
        const silentPrint = Boolean(req.body.silent_print); // Silent 인쇄 옵션
        const printSelector = req.body.print_selector || '#print_wrap'; // 기본값: #print_wrap
        
        // 용지 사이즈 검증
        if (!paperWidth || !paperHeight || paperWidth <= 0 || paperHeight <= 0) {
          console.error('❌ 잘못된 용지 사이즈:', { paperWidth, paperHeight });
          return res.status(400).json({ 
            error: 'Invalid paper size. Width and height must be positive numbers.',
            received: { paperWidth, paperHeight, paperSize }
          });
        }
        
        // CSS 선택자 기본 검증 (보안 목적)
        if (printSelector && printSelector !== '#print_wrap') {
          // #print_wrap이 아닌 다른 선택자는 보안 검증
          const dangerousPatterns = [
            /javascript:/i,
            /expression\s*\(/i,
            /url\s*\(/i,
            /<script/i,
            /on[a-z]+\s*=/i
          ];
          
          const isDangerous = dangerousPatterns.some(pattern => pattern.test(printSelector));
          if (isDangerous) {
            console.error('❌ 보안상 위험한 선택자:', printSelector);
            return res.status(400).json({ 
              error: 'Invalid selector: contains potentially dangerous content',
              received: { printSelector }
            });
          }
          
          console.log(`🎯 커스텀 인쇄 영역 선택자: ${printSelector}`);
        } else {
          console.log('🎯 기본 인쇄 영역: #print_wrap');
        }
        
        console.log(`📏 웹에서 전달받은 용지 사이즈: ${paperWidth}mm × ${paperHeight}mm (${paperSize})`);
        console.log(`🔇 Silent 인쇄 모드: ${silentPrint ? '활성화' : '비활성화'}`);
        
        const urlData = {
          paperSize: {
            name: paperSize,
            width: paperWidth,
            height: paperHeight
          },
          silentPrint: silentPrint,  // Silent 모드 저장
          printSelector: printSelector  // 인쇄 영역 선택자 저장
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
    expressApp.get('/status', (req, res) => {
      const packageInfo = require('./package.json');
      res.json({ 
        status: 'running', 
        session: currentSession,
        version: packageInfo.version,
        name: packageInfo.name
      });
    });

    // 버전 정보 전용 엔드포인트
    expressApp.get('/version', (req, res) => {
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
      const server = expressApp.listen(port, 'localhost', () => {
        serverPort = server.address().port;
        httpServer = server;
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
  // 기존 창이 있고 숨겨져 있으면 재사용
  if (printWindow && !printWindow.isDestroyed()) {
    console.log('🔄 기존 창 재사용');
    printWindow.show();
    printWindow.focus();
    
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
      await startHttpServer();
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

  // 창 닫기 이벤트 처리
  printWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'win32') {
      event.preventDefault();
      printWindow.hide();
      console.log('🔄 창을 숨김 (백그라운드 실행 중)');
    }
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

// 자동 업데이트 설정 (개선됨)
function setupAutoUpdater() {
  // 자동 다운로드 설정
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  // 개발 모드에서는 업데이트 비활성화
  if (process.env.NODE_ENV === 'development' || process.defaultApp) {
    console.log('🔧 개발 모드 - 자동 업데이트 비활성화');
    return;
  }
  
  // 업데이트 확인 (앱 시작 시)
  setTimeout(() => {
    console.log('🔄 업데이트 확인 시작...');
    autoUpdater.checkForUpdates();
  }, 3000);
  
  // 30분마다 업데이트 체크
  setInterval(() => {
    console.log('🔄 정기 업데이트 확인 중...');
    autoUpdater.checkForUpdates();
  }, 30 * 60 * 1000);
  
  // 업데이트 이벤트 리스너
  autoUpdater.on('checking-for-update', () => {
    console.log('업데이트 확인 중...');
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('🆕 업데이트 발견됨:', info.version);
    
    // 사용자에게 업데이트 시작 알림
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        autoDownload: true
      });
    }
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('✅ 최신 버전입니다.');
  });
  
  autoUpdater.on('error', (error) => {
    console.error('❌ 업데이트 오류:', error.message);
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
    console.log('✅ 업데이트 다운로드 완료');
    
    // 사용자에게 업데이트 완료 알림
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-downloaded', {
        version: info.version,
        autoRestart: false,
        installOnNextStart: true,
        userChoice: true
      });
    }
    
    // 앱 종료 시 자동 설치
    console.log('💡 다음번 앱 시작 시 자동으로 업데이트가 적용됩니다.');
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
  setupAutoLaunch();
  createTray();
  setupUninstallDetection(); // 언인스톨 감지 시스템 활성화
  
  // HTTP 서버 시작
  try {
    await startHttpServer();
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
    
    // 독(Dock) 및 작업 표시줄에서 숨기기
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
  } else {
    console.log('🖥️ 일반 모드로 시작');
    // 일반 시작 시 창 생성
    createPrintWindow();
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
    
    // 기존 창 활성화
    if (printWindow) {
      if (printWindow.isMinimized()) printWindow.restore();
      printWindow.focus();
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
          await startHttpServer();
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

// 모든 창이 닫혔을 때 처리
app.on('window-all-closed', () => {
  // 앱을 종료하지 않고 백그라운드에서 계속 실행
  console.log('🔄 모든 창이 닫혔지만 백그라운드 서비스는 계속 실행됩니다.');
});

// 앱이 완전히 종료되기 전 처리
app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    console.log('⚠️ 종료가 취소되었습니다. 백그라운드에서 계속 실행됩니다.');
  } else {
    console.log('📴 WebPrinter 서비스 종료 중...');
    
    // HTTP 서버 정리
    if (httpServer) {
      stopHttpServer();
    }
    
    // 트레이 정리
    if (tray) {
      tray.destroy();
    }
  }
});

// macOS에서 앱이 활성화되면 처리
app.on('activate', () => {
  // macOS에서는 독에서 클릭했을 때 창 표시
  if (!printWindow) {
    createPrintWindow();
  } else {
    printWindow.show();
    printWindow.focus();
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

// 인쇄 실행 (커스텀 용지 사이즈 지원 개선)
ipcMain.handle('print-url', async (event, options) => {
  let tempPrintWindow = null;
  
  try {
    const { url, printerName, copies = 1, silent = false, paperSize = null, printSelector = '#print_wrap' } = options;
    
    if (!url) {
      throw new Error('인쇄할 URL이 없습니다');
    }
    
    console.log(`🖨️ Electron 인쇄 시작: ${url}`);
    console.log(`📏 용지 사이즈: ${paperSize?.width}mm × ${paperSize?.height}mm`);
    console.log(`🔇 Silent 모드: ${silent ? '활성화 (바로 인쇄)' : '비활성화 (대화상자 표시)'}`);
    console.log(`🎯 인쇄 영역: ${printSelector}`);
    
    // 프린트 윈도우 생성
    tempPrintWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        plugins: true
      }
    });
    
    // 윈도우 정리 함수
    const cleanupWindow = () => {
      if (tempPrintWindow && !tempPrintWindow.isDestroyed()) {
        tempPrintWindow.close();
        tempPrintWindow = null;
      }
    };
    
    tempPrintWindow.on('closed', () => tempPrintWindow = null);
    
    // URL 로딩
    console.log('📄 URL 로딩 중...');
    
    try {
      await tempPrintWindow.loadURL(url);
      console.log('✅ URL 로딩 완료');
    } catch (loadError) {
      console.error('❌ URL 로딩 실패:', loadError);
      throw loadError;
    }
    
    // 페이지 완전 로딩 대기
    console.log('⏳ 페이지 렌더링 대기 중...');
    await tempPrintWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (document.readyState === 'complete') {
          setTimeout(resolve, 2000); // 2초 추가 대기
        } else {
          window.addEventListener('load', () => {
            setTimeout(resolve, 2000); // 2초 추가 대기
          });
        }
      })
    `);
    
    console.log('✅ 페이지 렌더링 완료');
    
    // 선택적 인쇄 처리 (#print_wrap 요소 확인)
    console.log(`🎯 인쇄 영역 적용 중: ${printSelector}`);
    
    try {
      const elementFound = await tempPrintWindow.webContents.executeJavaScript(`
        (() => {
          const selector = '${printSelector.replace(/'/g, "\\'")}'; // 문자열 이스케이프
          console.log('🔍 선택자 검색 중:', selector);
          
          try {
            const targetElement = document.querySelector(selector);
            
            if (!targetElement) {
              console.warn('⚠️ #print_wrap 요소를 찾을 수 없습니다. 전체 페이지를 인쇄합니다.');
              return { success: false, error: '요소를 찾을 수 없음', fallbackToFullPage: true };
            }
            
            console.log('✅ 대상 요소 발견:', targetElement.tagName);
            
            // 1. 인쇄용 스타일 생성
            const printStyle = document.createElement('style');
            printStyle.id = 'webprinter-selective-print';
            printStyle.textContent = \`
              @media print {
                /* 모든 요소 숨기기 */
                body > * {
                  display: none !important;
                }
                
                /* 선택된 요소와 부모 경로만 표시 */
                body {
                  margin: 0 !important;
                  padding: 0 !important;
                }
                
                .webprinter-print-target {
                  display: block !important;
                  visibility: visible !important;
                  opacity: 1 !important;
                  position: static !important;
                  width: 100% !important;
                  height: auto !important;
                  margin: 0 !important;
                  padding: 10px !important;
                  background: white !important;
                  color: black !important;
                }
                
                /* 부모 요소들도 표시되도록 */
                .webprinter-print-target * {
                  visibility: visible !important;
                }
              }
            \`;
            document.head.appendChild(printStyle);
            
            // 2. 대상 요소에 특별 클래스 추가
            targetElement.classList.add('webprinter-print-target');
            
            // 3. 부모 요소들에도 표시 클래스 추가 (경로 확보)
            let parent = targetElement.parentElement;
            while (parent && parent !== document.body) {
              parent.style.setProperty('display', 'block', 'important');
              parent = parent.parentElement;
            }
            
            console.log('🎨 선택적 인쇄 스타일 적용 완료');
            
            return { 
              success: true, 
              elementTag: targetElement.tagName,
              elementId: targetElement.id || '',
              elementClass: targetElement.className || ''
            };
            
          } catch (error) {
            console.error('❌ 선택자 처리 오류:', error);
            return { success: false, error: error.message };
          }
        })()
      `);
      
      if (elementFound.success) {
        console.log(`✅ 선택적 인쇄 설정 완료:`, elementFound);
      } else if (elementFound.fallbackToFullPage) {
        console.log(`⚠️ #print_wrap을 찾을 수 없어 전체 페이지를 인쇄합니다.`);
      } else {
        console.warn(`⚠️ 선택적 인쇄 실패: ${elementFound.error}`);
        // 실패해도 전체 페이지 인쇄로 계속 진행
      }
      
    } catch (jsError) {
      console.error('❌ 선택적 인쇄 JavaScript 실행 실패:', jsError);
      // 실패해도 전체 페이지 인쇄로 계속 진행
    }
    
    // 프린터 목록 가져오기
    let printers = [];
    let selectedPrinter = null;
    
    try {
      printers = await tempPrintWindow.webContents.getPrintersAsync();
      console.log(`📋 사용 가능한 프린터: ${printers.length}개`);
      
      if (silent && printers.length === 0) {
        throw new Error('Silent 모드에서 사용 가능한 프린터가 없습니다.');
      }
      
      // 프린터 선택 로직 개선
      if (printerName && printers.length > 0) {
        // 지정된 프린터 이름으로 검색
        selectedPrinter = printers.find(p => p.name === printerName);
        if (selectedPrinter) {
          console.log(`✅ 지정된 프린터 선택됨: ${selectedPrinter.name}`);
        } else {
          console.warn(`⚠️ 프린터 '${printerName}'를 찾을 수 없습니다.`);
        }
      }
      
      // 프린터가 지정되지 않았거나 찾을 수 없는 경우
      if (!selectedPrinter && printers.length > 0) {
        // 기본 프린터 찾기
        selectedPrinter = printers.find(p => p.isDefault);
        
        if (selectedPrinter) {
          console.log(`🎯 기본 프린터 자동 선택됨: ${selectedPrinter.name}`);
        } else {
          // 기본 프린터가 없으면 첫 번째 프린터 사용
          selectedPrinter = printers[0];
          console.log(`📌 첫 번째 프린터 자동 선택됨: ${selectedPrinter.name}`);
        }
      }
      
      if (silent && !selectedPrinter) {
        throw new Error('Silent 모드에서 사용할 프린터를 찾을 수 없습니다.');
      }
      
    } catch (e) {
      console.warn('프린터 목록 조회 실패:', e.message);
      if (silent) {
        throw new Error(`Silent 모드 실패: ${e.message}`);
      }
    }
    
    // 인쇄 옵션 설정 (Silent 모드 최적화)
    const printOptions = {
      silent: silent,
      printBackground: true,
      color: true,
      margins: {
        marginType: silent ? 'none' : 'default'  // Silent 모드에서는 여백 최소화
      },
      landscape: false,
      copies: Math.max(1, Math.min(copies, silent ? 5 : 100)),  // Silent 모드에서는 최대 5매 제한
      collate: true,
      scaleFactor: 100,
      duplexMode: 'simplex'  // 단면 인쇄
    };
    
    // Silent 모드 추가 설정
    if (silent) {
      printOptions.shouldPrintBackgrounds = true;
      printOptions.shouldPrintSelectionOnly = false;
      
      // 안전장치: Silent 모드에서는 복사본 제한
      if (printOptions.copies > 5) {
        console.warn('⚠️ Silent 모드에서 복사본이 5매로 제한됩니다.');
        printOptions.copies = 5;
      }
    }
    
    // 프린터 지정
    if (selectedPrinter) {
      printOptions.deviceName = selectedPrinter.name;
      console.log(`🖨️ 사용할 프린터: ${selectedPrinter.name}`);
      
      // Silent 모드에서는 프린터 상태 추가 확인
      if (silent) {
        console.log(`📊 프린터 상태: ${selectedPrinter.status || '알 수 없음'}`);
        console.log(`🔧 프린터 설명: ${selectedPrinter.description || '없음'}`);
      }
    }
    
    // 커스텀 용지 사이즈 설정 (중요!)
    if (paperSize?.width && paperSize?.height) {
      // 표준 용지 사이즈 확인 (확장된 목록)
      const standardSizes = {
        '210x297': 'A4',
        '297x420': 'A3', 
        '148x210': 'A5',
        '216x279': 'Letter',
        '216x356': 'Legal',
        '105x148': 'A6',
        '74x105': 'A7',
        '52x74': 'A8',
        '88x105': 'A9',
        '26x37': 'A10',
        '279x432': 'Tabloid',
        '102x152': '4x6',
        '127x203': '5x8',
        '80x120': 'Label 80x120',  // 라벨 프린터용
        '100x150': 'Label 100x150',
        '57x32': 'Receipt 57mm',   // 영수증 프린터용
        '80x80': 'Receipt 80mm'
      };
      
      const sizeKey = `${Math.round(paperSize.width)}x${Math.round(paperSize.height)}`;
      const standardSize = standardSizes[sizeKey];
      
      if (standardSize) {
        printOptions.pageSize = standardSize;
        console.log(`📄 표준 용지 사이즈 사용: ${standardSize} (${paperSize.width}×${paperSize.height}mm)`);
      } else {
        // 커스텀 사이즈 - Electron은 microns (마이크론) 단위 사용
        // 1mm = 1000 microns
        printOptions.pageSize = {
          width: Math.round(paperSize.width * 1000),   // mm to microns
          height: Math.round(paperSize.height * 1000)  // mm to microns
        };
        console.log(`📐 커스텀 용지 사이즈 설정: ${paperSize.width}mm × ${paperSize.height}mm`);
        console.log(`📐 마이크론 단위: ${printOptions.pageSize.width} × ${printOptions.pageSize.height} microns`);
      }
    } else {
      console.error('❌ 용지 사이즈 정보가 없습니다.');
      throw new Error('용지 사이즈가 지정되지 않았습니다.');
    }
    
    console.log('🖨️ 최종 프린트 옵션:', JSON.stringify(printOptions, null, 2));
    
    // Silent 모드 추가 로그
    if (silent) {
      console.log('🔇 Silent 모드 활성화 - 사용자 확인 없이 즉시 인쇄를 시작합니다.');
      console.log(`📋 인쇄 매수: ${printOptions.copies}매`);
      console.log(`🎯 대상 프린터: ${printOptions.deviceName || '시스템 기본값'}`);
    }
    
    // 프린트 실행
    return new Promise((resolve, reject) => {
      console.log('🚀 프린트 명령 실행...');
      
      const timeoutDuration = silent ? 30000 : 60000;  // Silent 모드에서는 30초 타임아웃
      const timeoutId = setTimeout(() => {
        cleanupWindow();
        reject(new Error(`프린트 실행 타임아웃 (${timeoutDuration/1000}초)`));
      }, timeoutDuration);
      
      try {
        tempPrintWindow.webContents.print(printOptions, (success, failureReason) => {
          clearTimeout(timeoutId);
          
          console.log('=== 인쇄 결과 ===');
          console.log('성공 여부:', success);
          console.log('실패 이유:', failureReason);
          console.log('Silent 모드:', silent);
          console.log('================');
          
          // 창 정리
          setTimeout(cleanupWindow, silent ? 500 : 1000);  // Silent 모드에서는 빠른 정리
          
          if (success) {
            const resultMessage = silent 
              ? '바로 인쇄가 완료되었습니다.' 
              : '프린트 대화상자가 열렸습니다.';
              
            console.log(`✅ ${resultMessage}`);
            resolve({
              success: true,
              message: resultMessage,
              method: silent ? 'Silent 자동 인쇄' : 'Electron 대화상자 인쇄',
              printerName: selectedPrinter?.name || '기본 프린터',
              paperSize: `${paperSize.width}mm × ${paperSize.height}mm`,
              copies: printOptions.copies,
              silent: silent,
              printSelector: printSelector === '#print_wrap' ? '#print_wrap (기본)' : printSelector
            });
          } else {
            const errorMsg = failureReason || '사용자가 취소했거나 알 수 없는 오류';
            console.error('❌ 프린트 실패:', errorMsg);
            
            if (silent) {
              reject(new Error(`Silent 인쇄 실패: ${errorMsg}`));
            } else {
              reject(new Error(`프린트 실패: ${errorMsg}`));
            }
          }
        });
        
      } catch (printError) {
        clearTimeout(timeoutId);
        cleanupWindow();
        console.error('프린트 실행 중 예외:', printError);
        reject(new Error(`프린트 실행 오류: ${printError.message}`));
      }
    });
    
  } catch (error) {
    console.error('❌ Electron 프린트 실패:', error);
    
    if (tempPrintWindow && !tempPrintWindow.isDestroyed()) {
      tempPrintWindow.close();
    }
    
    return { 
      success: false, 
      error: error.message,
      method: options.silent ? 'Silent 자동 인쇄' : 'Electron 대화상자 인쇄'
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
    printWindow.hide();
    
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
    
    console.log('✅ 백그라운드 서비스 모드로 전환 완료');
  }
});

// 앱 완전 종료
ipcMain.handle('quit-app', () => {
  console.log('🚪 사용자 요청에 의한 앱 완전 종료');
  cleanupAndExit('IPC 요청');
  return { success: true, message: '앱을 완전히 종료합니다.' };
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
  
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  
  return { success: true, message: '업데이트를 설치하고 재시작합니다.' };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});