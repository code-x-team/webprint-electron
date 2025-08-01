const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');
const { printViaPDF } = require('./printer');
const { getServerPort, getSessionData, getAllSessions } = require('./server');

let printWindow = null;
let currentSession = null;

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

async function createPrintWindow(sessionId = null) {
  if (printWindow && !printWindow.isDestroyed()) {
    if (sessionId) currentSession = sessionId;
    
    // 기존 창에 새 세션 데이터 전송
    printWindow.webContents.send('restart-loading', { session: currentSession });
    
    // 세션 데이터가 있으면 즉시 전송
    const urlData = getSessionData(currentSession);
    if (urlData) {
      console.log('기존 창에 세션 데이터 전송:', currentSession);
      printWindow.webContents.send('urls-received', urlData);
    }
    
    printWindow.show();
    printWindow.focus();
    return;
  }

  if (!sessionId) sessionId = generateSessionId();
  currentSession = sessionId;

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
    console.log('창 준비 완료, 세션:', currentSession);
    
    // 서버 정보 전송
    printWindow.webContents.send('server-info', {
      port: getServerPort(),
      session: currentSession
    });
    
    // 세션 데이터가 있으면 즉시 전송
    const urlData = getSessionData(currentSession);
    if (urlData) {
      console.log('초기 세션 데이터 전송:', urlData);
      printWindow.webContents.send('urls-received', urlData);
    } else {
      // 세션 데이터가 없으면 최신 세션 확인
      const sessions = Object.keys(getAllSessions());
      if (sessions.length > 0) {
        const latestSession = sessions.sort((a, b) => 
          (getAllSessions()[b].timestamp || 0) - (getAllSessions()[a].timestamp || 0)
        )[0];
        const latestData = getAllSessions()[latestSession];
        if (latestData) {
          currentSession = latestSession;
          console.log('최신 세션 데이터 사용:', latestSession);
          printWindow.webContents.send('urls-received', latestData);
        }
      }
    }
    
    // 창 표시 (백그라운드 모드가 아닌 경우)
    if (!global.startupMode) {
      printWindow.show();
      printWindow.focus();
    }
  });

  printWindow.on('close', (event) => {
    if (!global.isQuitting) {
      console.log('창 닫기 - 백그라운드로 전환');
      event.preventDefault();
      printWindow.hide();
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
    }
  });

  printWindow.on('closed', () => {
    printWindow = null;
    currentSession = null;
  });

  return sessionId;
}

function notifyWindow(sessionId, urlData) {
  console.log('notifyWindow 호출:', { sessionId, currentSession, hasWindow: !!printWindow });
  
  // 창이 없거나 닫혀있으면 새로 생성
  if (!printWindow || printWindow.isDestroyed()) {
    console.log('새 창 생성 필요');
    createPrintWindow(sessionId);
    
    // 창이 준비되면 데이터 전송
    const checkAndSend = () => {
      if (printWindow && !printWindow.isDestroyed()) {
        console.log('창 준비됨, 데이터 전송');
        printWindow.webContents.send('urls-received', urlData);
        printWindow.show();
        printWindow.focus();
      } else {
        // 창이 아직 준비되지 않았으면 재시도
        setTimeout(checkAndSend, 100);
      }
    };
    
    setTimeout(checkAndSend, 300);
    
  } else if (currentSession === sessionId) {
    // 같은 세션이면 데이터만 업데이트
    console.log('동일 세션 데이터 업데이트');
    printWindow.webContents.send('urls-received', urlData);
    printWindow.show();
    printWindow.focus();
    
  } else {
    // 다른 세션이면 새 세션으로 전환
    console.log('새 세션으로 전환:', sessionId);
    currentSession = sessionId;
    
    // 새 세션 알림
    printWindow.webContents.send('session-changed', { session: sessionId });
    
    // 데이터 전송
    setTimeout(() => {
      printWindow.webContents.send('urls-received', urlData);
      printWindow.show();
      printWindow.focus();
    }, 100);
  }
}

function setupIpcHandlers() {
  // 창 표시 요청
  ipcMain.on('request-show-window', () => {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.show();
      printWindow.focus();
    }
  });

  // 로딩 준비 완료
  ipcMain.on('loading-ready', () => {
    console.log('렌더러 프로세스 준비 완료');
  });

  // 프린터 목록 가져오기
  ipcMain.handle('get-printers', async () => {
    try {
      console.log('프린터 목록 요청');
      const printers = (printWindow && !printWindow.isDestroyed()) 
        ? await printWindow.webContents.getPrintersAsync() 
        : [];
      
      console.log(`프린터 ${printers.length}개 발견`);
      return { 
        success: true, 
        printers: printers,
        totalCount: printers.length
      };
    } catch (error) {
      console.error('프린터 목록 가져오기 실패:', error);
      return { success: false, error: error.message, printers: [] };
    }
  });

  // 인쇄 실행
  ipcMain.handle('print-url', async (event, params) => {
    try {
      console.log('인쇄 요청:', params);
      
      if (!params.url) {
        throw new Error('인쇄할 URL이 없습니다');
      }
      
      if (!params.paperSize || !params.paperSize.width || !params.paperSize.height) {
        throw new Error('용지 크기가 지정되지 않았습니다');
      }
      
      const outputType = params.outputType || 'pdf';
      
      if (outputType === 'printer' && !params.printerName) {
        throw new Error('프린터가 선택되지 않았습니다');
      }
      
      const result = await printViaPDF(
        params.url,
        params.paperSize,
        params.printSelector || '.print_wrap',
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

  // 서버 정보 가져오기
  ipcMain.handle('get-server-info', () => ({
    port: getServerPort(),
    session: currentSession,
    running: !!getServerPort()
  }));

  // 세션 데이터 가져오기
  ipcMain.handle('get-session-data', (event, sessionId) => {
    console.log('세션 데이터 요청:', sessionId);
    const data = getSessionData(sessionId || currentSession);
    console.log('반환할 데이터:', data ? '있음' : '없음');
    return data;
  });

  // 백그라운드로 숨기기
  ipcMain.handle('hide-to-background', () => {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.hide();
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
    }
  });

  // 앱 종료
  ipcMain.handle('quit-app', () => {
    global.isQuitting = true;
    app.quit();
    return { success: true };
  });

  // 앱 버전 가져오기
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