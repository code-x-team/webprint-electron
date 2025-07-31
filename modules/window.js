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
    // 창을 숨기고 백그라운드로
    if (!global.isQuitting) {
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
  if (printWindow && !printWindow.isDestroyed() && currentSession === sessionId) {
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