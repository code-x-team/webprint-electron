const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');
const { printViaPDF } = require('./printer');
const { getServerPort, getSessionData, getAllSessions } = require('./server');

let printWindow = null;
let currentSession = null;
let isCreatingWindow = false; // 창 생성 중복 방지 플래그
let lastWindowActionTime = 0; // 마지막 창 액션 시간
const WINDOW_ACTION_COOLDOWN = 2000; // 2초 쿨다운

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function createPrintWindow(sessionId = null) {
  const now = Date.now();
  
  // 쿨다운 체크: 너무 빨리 연속 호출되면 무시
  if (now - lastWindowActionTime < WINDOW_ACTION_COOLDOWN) {
    console.log('🛡️ 창 생성 쿨다운 중 - 중복 요청 무시');
    return currentSession;
  }
  
  // 창이 생성 중이면 대기
  if (isCreatingWindow) {
    console.log('🪟 창 생성 중 - 잠시 대기');
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (!isCreatingWindow) {
          clearInterval(checkInterval);
          resolve(currentSession);
        }
      }, 100);
    });
  }
  
  lastWindowActionTime = now;
  
  if (printWindow && !printWindow.isDestroyed()) {
    console.log('🪟 기존 창 재사용 - 창 표시 및 데이터 전송');
    if (sessionId) currentSession = sessionId;
    
    // 창이 숨겨져 있으면 다시 표시
    if (!printWindow.isVisible()) {
      console.log('🪟 숨겨진 창을 다시 표시합니다');
      printWindow.show();
      printWindow.focus();
    }
    
    printWindow.webContents.send('restart-loading', { session: currentSession });
    
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

  if (!sessionId) sessionId = generateSessionId();
  currentSession = sessionId;
  
  console.log('🪟 새 창 생성 시작 - 세션 ID:', sessionId);
  isCreatingWindow = true; // 창 생성 시작

  printWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload.js')
    },
    title: 'WebPrinter - 인쇄 미리보기',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f5',
    webSecurity: false
  });

  printWindow.loadFile('print-preview.html');

  printWindow.once('ready-to-show', () => {
    console.log('🪟 창 ready-to-show 이벤트 - 창 생성 완료');
    isCreatingWindow = false; // 창 생성 완료
    
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed() && !printWindow.isVisible()) {
        printWindow.show();
        printWindow.focus();
      }
    }, 5000);
    
    printWindow.webContents.once('did-finish-load', () => {
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
      }, 1000);
    });
  });

  printWindow.on('close', (event) => {
    console.log('🪟 창 닫기 이벤트 발생');
    
    // 창이 닫힐 때도 쿨다운 적용 (즉시 재생성 방지)
    lastWindowActionTime = Date.now();
    
    // 트레이에서 완전 종료가 아닌 경우에만 숨기기
    if (!global.isQuitting) {
      console.log('🪟 창 닫기 - 백그라운드로 전환');
      event.preventDefault();
      printWindow.hide();
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
    } else {
      console.log('🪟 완전 종료 - 창 정리');
      // 완전 종료 시에는 정상적으로 닫히도록 허용
    }
  });

  printWindow.on('closed', () => {
    console.log('🪟 창 완전히 닫힘 - 변수 정리');
    printWindow = null;
    currentSession = null;
    isCreatingWindow = false; // 창 생성 플래그도 해제
  });

  console.log('🪟 새 창 생성 완료 - 반환 세션 ID:', sessionId);
  return sessionId;
}

function notifyWindow(sessionId, urlData) {
  const now = Date.now();
  
  // 쿨다운 체크: HTTP 요청이 너무 빨리 와도 중복 방지
  if (now - lastWindowActionTime < WINDOW_ACTION_COOLDOWN) {
    console.log('🛡️ notifyWindow 쿨다운 중 - 중복 HTTP 요청 무시');
    return;
  }
  
  // 창이 이미 보이는 상태면 데이터만 업데이트 (중복 생성 방지)
  if (printWindow && !printWindow.isDestroyed() && printWindow.isVisible()) {
    console.log('🔔 창이 이미 표시됨 - 데이터만 업데이트');
    printWindow.webContents.send('urls-received', urlData);
    printWindow.focus();
    return;
  }
  
  // 창이 생성 중이면 무시 (프로토콜에서 이미 처리 중)
  if (isCreatingWindow) {
    console.log('🔔 창 생성 중 - HTTP 요청 무시');
    return;
  }
  
  lastWindowActionTime = now;
  
  // 창이 없거나 닫혀있으면 새로 생성
  if (!printWindow || printWindow.isDestroyed()) {
    console.log('🔔 백그라운드에서 새 요청 수신, 미리보기 창을 엽니다:', sessionId);
    createPrintWindow(sessionId);
    
    // 창 생성 후 데이터 전송
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.webContents.send('urls-received', urlData);
        printWindow.show();
        printWindow.focus();
      }
    }, 1000);
  } else {
    // 창이 존재하지만 숨겨진 상태 - 표시하고 데이터 업데이트
    if (sessionId) currentSession = sessionId;
    console.log('🔔 숨겨진 창을 표시하고 데이터 업데이트');
    
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
    
    // 창을 앞으로 가져오기
    printWindow.show();
    printWindow.focus();
  }
}

function setupIpcHandlers() {
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
  getCurrentSession: () => currentSession,
  closeAllWindows: () => {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.destroy();
    }
    printWindow = null;
  }
};