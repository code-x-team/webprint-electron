const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');
const { printViaPDF } = require('./printer');
const { getServerPort, getSessionData, getAllSessions } = require('./server');
const { createSplashWindow, closeSplashWindow, updateSplashProgress } = require('./splash');

let printWindow = null;
let currentSession = null;
let isCreatingWindow = false; // 창 생성 중복 방지 플래그
let lastWindowActionTime = 0; // 마지막 창 액션 시간
const WINDOW_ACTION_COOLDOWN = 2000; // 2초 쿨다운

// 미리 생성된 숨겨진 윈도우 (백그라운드 대기)
let preloadedWindow = null;
let isPreloading = false;

// 창 생성 대기 큐
let windowCreationQueue = [];
let isProcessingWindowQueue = false;

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 백그라운드에서 윈도우 미리 생성
async function preloadPrintWindow() {
  if (isPreloading || preloadedWindow) return;
  
  isPreloading = true;
  console.log('🔄 백그라운드에서 윈도우 미리 생성 시작...');
  
  try {
    preloadedWindow = new BrowserWindow({
      width: 1000,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
        backgroundThrottling: false // 백그라운드에서도 성능 유지
      },
      title: 'WebPrinter - 인쇄 미리보기',
      show: false, // 절대 표시하지 않음
      autoHideMenuBar: true,
      backgroundColor: '#f5f5f5',
      webSecurity: false
    });

    // HTML 미리 로드
    await preloadedWindow.loadFile('print-preview.html');
    
    // 완전히 로드될 때까지 대기
    await new Promise((resolve) => {
      preloadedWindow.webContents.once('did-finish-load', () => {
        console.log('✅ 백그라운드 윈도우 로드 완료');
        resolve();
      });
    });
    
    // 창이 닫히면 null로 설정
    preloadedWindow.on('closed', () => {
      preloadedWindow = null;
    });
    
  } catch (error) {
    console.error('❌ 백그라운드 윈도우 생성 실패:', error);
    preloadedWindow = null;
  } finally {
    isPreloading = false;
  }
}

// 앱 시작 시 미리 창 생성 (export 하여 main.js에서 호출)
async function initializeWindows() {
  // 백그라운드에서 미리 창 생성
  await preloadPrintWindow();
}

// 창 생성 큐 처리 함수
async function processWindowCreationQueue() {
  if (isProcessingWindowQueue || windowCreationQueue.length === 0) {
    return;
  }
  
  isProcessingWindowQueue = true;
  
  while (windowCreationQueue.length > 0) {
    const { sessionId, resolve } = windowCreationQueue.shift();
    console.log('🪟 [Queue] 창 생성 처리:', sessionId);
    
    try {
      const result = await _createPrintWindow(sessionId);
      resolve(result);
    } catch (error) {
      console.error('❌ [Queue] 창 생성 실패:', error);
      resolve(null);
    }
    
    // 각 창 생성 사이에 지연
    await new Promise(r => setTimeout(r, 500));
  }
  
  isProcessingWindowQueue = false;
}

async function createPrintWindow(sessionId = null) {
  return new Promise((resolve) => {
    // 큐에 추가하고 처리
    windowCreationQueue.push({ sessionId, resolve });
    processWindowCreationQueue();
  });
}

// _createPrintWindow 함수의 수정된 부분
async function _createPrintWindow(sessionId = null) {
  const now = Date.now();
  
  // 쿨다운 체크: 너무 빨리 연속 호출되면 무시
  if (now - lastWindowActionTime < WINDOW_ACTION_COOLDOWN) {
    console.log('🛡️ 창 생성 쿨다운 중 - 기존 창 반환');
    if (printWindow && !printWindow.isDestroyed()) {
      return currentSession;
    }
  }
  
  lastWindowActionTime = now;
  
  // 이미 창이 있고 정상 상태라면 재사용
  if (printWindow && !printWindow.isDestroyed()) {
    console.log('🪟 기존 창 재사용 - 창 표시 및 데이터 전송');
    if (sessionId) currentSession = sessionId;
    
    // 창이 숨겨져 있으면 다시 표시
    if (!printWindow.isVisible()) {
      console.log('🪟 숨겨진 창을 다시 표시합니다');
      printWindow.show();
      printWindow.focus();
    }
    
    // 로딩 재시작
    printWindow.webContents.send('restart-loading', { session: currentSession });
    
    // 데이터 전송 (지연 후)
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.webContents.send('server-info', { port: getServerPort(), session: currentSession });
        
        const urlData = getSessionData(currentSession);
        if (urlData) {
          printWindow.webContents.send('urls-received', urlData);
        }
      }
    }, 500);
    
    console.log('🪟 기존 창 재사용 완료');
    return currentSession;
  }

  // 스플래시 윈도우 표시
  const splash = createSplashWindow();
  
  // 새 세션 ID 생성
  if (!sessionId) sessionId = generateSessionId();
  currentSession = sessionId;
  
  console.log('🪟 새 창 생성 시작 - 세션 ID:', sessionId);
  isCreatingWindow = true; // 창 생성 시작

  try {
    let isUsingPreloaded = false; // 미리 생성된 윈도우 사용 여부
    
    // 미리 생성된 윈도우가 있으면 사용
    if (preloadedWindow && !preloadedWindow.isDestroyed()) {
      console.log('✨ 미리 생성된 윈도우 사용');
      printWindow = preloadedWindow;
      preloadedWindow = null;
      isUsingPreloaded = true; // 플래그 설정
      
      // 새 창을 백그라운드에서 다시 준비
      setTimeout(() => preloadPrintWindow(), 1000);
    } else {
      // 새 창 생성
      updateSplashProgress('창을 준비하는 중...');
      
      printWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload.js'),
          backgroundThrottling: false
        },
        title: 'WebPrinter - 인쇄 미리보기',
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#f5f5f5',
        webSecurity: false
      });

      updateSplashProgress('페이지를 로드하는 중...');
      await printWindow.loadFile('print-preview.html');
    }

    // 미리 생성된 윈도우를 사용하는 경우 즉시 처리
    if (isUsingPreloaded) {
      console.log('🪟 미리 생성된 창 사용 - 즉시 표시');
      isCreatingWindow = false;
      
      // 바로 스플래시 닫고 창 표시
      setTimeout(() => {
        closeSplashWindow();
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.show();
          printWindow.focus();
          
          // 데이터 전송
          setTimeout(() => {
            if (printWindow && !printWindow.isDestroyed()) {
              printWindow.webContents.send('server-info', {
                port: getServerPort(),
                session: sessionId
              });
              
              let urlData = getSessionData(sessionId);
              if (!urlData) {
                const sessions = Object.keys(getAllSessions());
                if (sessions.length > 0) {
                  const latestSession = sessions.sort((a, b) => 
                    (getAllSessions()[b].timestamp || 0) - (getAllSessions()[a].timestamp || 0)
                  )[0];
                  urlData = getAllSessions()[latestSession];
                  currentSession = latestSession;
                }
              }
              
              if (urlData) {
                printWindow.webContents.send('urls-received', urlData);
              } else {
                printWindow.webContents.send('show-waiting-message', {
                  title: '인쇄 데이터 대기 중',
                  message: '웹페이지에서 인쇄 요청을 기다리고 있습니다.'
                });
                setTimeout(() => {
                  printWindow.webContents.send('loading-complete', { reason: 'waiting_for_data' });
                }, 500);
              }
            }
          }, 500);
        }
      }, 2000);
    } else {
      // 새로 생성된 창의 경우에만 ready-to-show 이벤트 사용
      printWindow.once('ready-to-show', () => {
        console.log('🪟 창 ready-to-show 이벤트 - 창 생성 완료');
        isCreatingWindow = false; // 창 생성 완료
        
        // 스플래시 닫고 메인 창 표시
        setTimeout(() => {
          closeSplashWindow();
          if (printWindow && !printWindow.isDestroyed() && !printWindow.isVisible()) {
            printWindow.show();
            printWindow.focus();
          }
        }, 2000); // 부드러운 전환을 위한 짧은 지연
      });

      // 콘텐츠 로드 완료 시 데이터 전송
      printWindow.webContents.once('did-finish-load', () => {
        updateSplashProgress('데이터를 준비하는 중...');
        
        setTimeout(() => {
          if (printWindow && !printWindow.isDestroyed()) {
            // 서버 정보 전송
            printWindow.webContents.send('server-info', {
              port: getServerPort(),
              session: sessionId
            });
            
            // URL 데이터 확인 및 전송
            let urlData = getSessionData(sessionId);
            if (!urlData) {
              // 최근 세션 데이터 확인
              const sessions = Object.keys(getAllSessions());
              if (sessions.length > 0) {
                const latestSession = sessions.sort((a, b) => 
                  (getAllSessions()[b].timestamp || 0) - (getAllSessions()[a].timestamp || 0)
                )[0];
                urlData = getAllSessions()[latestSession];
                currentSession = latestSession;
              }
            }
            
            if (urlData) {
              printWindow.webContents.send('urls-received', urlData);
            } else {
              // 대기 메시지 표시
              printWindow.webContents.send('show-waiting-message', {
                title: '인쇄 데이터 대기 중',
                message: '웹페이지에서 인쇄 요청을 기다리고 있습니다.'
              });
              setTimeout(() => {
                printWindow.webContents.send('loading-complete', { reason: 'waiting_for_data' });
              }, 500);
            }
            
            // 스플래시가 아직 열려있다면 닫기 (백업)
            closeSplashWindow();
          }
        }, 1000);
      });
    }

    // 창 닫기 이벤트 처리 (공통)
    printWindow.on('close', (event) => {
      console.log('🪟 창 닫기 이벤트 발생');
      
      // 창이 닫힐 때도 쿨다운 적용
      lastWindowActionTime = Date.now();
      
      // 완전 종료가 아닌 경우 숨기기만 함
      if (!global.isQuitting) {
        console.log('🪟 창 닫기 - 백그라운드로 전환');
        event.preventDefault();
        printWindow.hide();
        
        // macOS dock 숨기기
        if (process.platform === 'darwin' && app.dock) {
          app.dock.hide();
        }
      } else {
        console.log('🪟 완전 종료 - 창 정리');
      }
    });

    // 창이 완전히 닫혔을 때
    printWindow.on('closed', () => {
      console.log('🪟 창 완전히 닫힘 - 변수 정리');
      printWindow = null;
      currentSession = null;
      isCreatingWindow = false;
      closeSplashWindow(); // 혹시 남아있을 스플래시 정리
    });

  } catch (error) {
    console.error('❌ 창 생성 중 오류:', error);
    closeSplashWindow();
    isCreatingWindow = false;
    throw error;
  }

  console.log('🪟 새 창 생성 완료 - 반환 세션 ID:', sessionId);
  return sessionId;
}

function notifyWindow(sessionId, urlData) {
  const now = Date.now();
  
  // 이미 창이 생성 중이거나 큐에서 처리 중이면 무시
  if (isProcessingWindowQueue || windowCreationQueue.length > 0) {
    console.log('🔔 창 생성이 이미 진행 중 - HTTP 알림 무시');
    return;
  }
  
  // 쿨다운 체크
  if (now - lastWindowActionTime < WINDOW_ACTION_COOLDOWN) {
    console.log('🛡️ notifyWindow 쿨다운 중 - 중복 HTTP 요청 무시');
    return;
  }
  
  // 창이 이미 보이는 상태면 데이터만 업데이트
  if (printWindow && !printWindow.isDestroyed() && printWindow.isVisible()) {
    console.log('🔔 창이 이미 표시됨 - 데이터만 업데이트');
    printWindow.webContents.send('urls-received', urlData);
    printWindow.focus();
    return;
  }
  
  lastWindowActionTime = now;
  
  // 창이 없거나 숨겨져 있으면 생성/표시
  if (!printWindow || printWindow.isDestroyed()) {
    console.log('🔔 백그라운드에서 새 요청 수신, 미리보기 창을 엽니다:', sessionId);
    createPrintWindow(sessionId).then(() => {
      // 창 생성 후 데이터 전송
      setTimeout(() => {
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.webContents.send('urls-received', urlData);
        }
      }, 1000);
    });
  } else {
    // 창이 존재하지만 숨겨진 상태
    if (sessionId) currentSession = sessionId;
    console.log('🔔 숨겨진 창을 표시하고 데이터 업데이트');
    
    // 창 표시
    printWindow.show();
    printWindow.focus();
    
    // 데이터 전송
    if (printWindow.webContents.isLoading()) {
      printWindow.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.webContents.send('urls-received', urlData);
          }
        }, 500);
      });
    } else {
      printWindow.webContents.send('urls-received', urlData);
    }
  }
}

function setupIpcHandlers() {
  // 기존 핸들러 제거 (중복 방지)
  ipcMain.removeAllListeners('request-show-window');
  ipcMain.removeAllListeners('loading-ready');
  ipcMain.removeHandler('get-printers');
  ipcMain.removeHandler('print-url');
  ipcMain.removeHandler('get-server-info');
  ipcMain.removeHandler('hide-to-background');
  ipcMain.removeHandler('quit-app');
  ipcMain.removeHandler('get-app-version');
  
  // 핸들러 재등록
  ipcMain.on('request-show-window', () => {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.show();
      printWindow.focus();
    }
  });

  ipcMain.on('loading-ready', () => {});

  ipcMain.handle('get-printers', async () => {
    try {
      console.log('프린터 목록 가져오기 시작...');
      
      const electronPrinters = (printWindow && !printWindow.isDestroyed()) 
        ? await printWindow.webContents.getPrintersAsync() 
        : [];
      
      console.log('Electron에서 가져온 프린터:', electronPrinters.map(p => ({ 
        name: p.name, 
        status: p.status, 
        isDefault: p.isDefault 
      })));
      
      // 시스템 프린터 정보 추가 확인
      let systemPrinters = [];
      try {
        if (process.platform === 'win32') {
          const { execAsync } = require('util').promisify(require('child_process').exec);
          const { stdout } = await execAsync('powershell -command "Get-Printer | Select-Object Name, PrinterStatus | ConvertTo-Json"');
          systemPrinters = JSON.parse(stdout || '[]');
          console.log('Windows 시스템 프린터:', systemPrinters);
        }
      } catch (sysError) {
        console.warn('시스템 프린터 정보 가져오기 실패:', sysError.message);
      }
      
      // 프린터 목록 병합 및 상태 정보 보강
      const enhancedPrinters = electronPrinters.map(printer => {
        const sysPrinter = systemPrinters.find(sp => sp.Name === printer.name);
        return {
          ...printer,
          systemStatus: sysPrinter?.PrinterStatus || 'Unknown',
          available: printer.status === 0 // 0 = idle/available
        };
      });
      
      console.log('향상된 프린터 목록:', enhancedPrinters);
      
      return { 
        success: true, 
        printers: enhancedPrinters,
        totalCount: enhancedPrinters.length,
        availableCount: enhancedPrinters.filter(p => p.available).length
      };
    } catch (error) {
      console.error('프린터 목록 가져오기 실패:', error);
      return { success: false, error: error.message, printers: [] };
    }
  });

  ipcMain.handle('print-url', async (event, params) => {
    try {
      // 파라미터 검증
      if (!params.url) {
        throw new Error('인쇄할 URL이 없습니다');
      }
      
      if (!params.paperSize || !params.paperSize.width || !params.paperSize.height) {
        throw new Error('용지 크기가 지정되지 않았습니다');
      }
      
      // outputType 기본값 설정
      const outputType = params.outputType || 'pdf';
      
      // 프린터 출력 시 프린터 선택 확인
      if (outputType === 'printer' && !params.printerName) {
        throw new Error('프린터가 선택되지 않았습니다');
      }
      
      console.log('인쇄 시작:', {
        url: params.url,
        paperSize: params.paperSize,
        outputType: outputType,
        rotate180: params.rotate180,
        printerName: params.printerName
      });
      
      const result = await printViaPDF(
        params.url,
        params.paperSize,
        params.printSelector || '#print_wrap',
        params.copies || 1,
        params.silent !== false,
        params.printerName,
        outputType,
        params.rotate180 || false
      );
      
      return result;
    } catch (error) {
      console.error('인쇄 오류:', error);
      return { 
        success: false, 
        error: error.message || '알 수 없는 오류가 발생했습니다'
      };
    }
  });

  ipcMain.handle('get-server-info', () => ({
    port: getServerPort(),
    session: currentSession,
    running: !!getServerPort()
  }));

  ipcMain.handle('hide-to-background', () => {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.hide();
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
    }
  });

  ipcMain.handle('quit-app', () => {
    global.isQuitting = true;
    app.quit();
    return { success: true };
  });

  ipcMain.handle('get-app-version', () => app.getVersion());
}

module.exports = {
  createPrintWindow,
  notifyWindow,
  setupIpcHandlers,
  initializeWindows,
  getCurrentSession: () => currentSession,
  closeAllWindows: () => {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.destroy();
    }
    if (preloadedWindow && !preloadedWindow.isDestroyed()) {
      preloadedWindow.destroy();
    }
    printWindow = null;
    preloadedWindow = null;
    windowCreationQueue = [];
    isProcessingWindowQueue = false;
  }
};