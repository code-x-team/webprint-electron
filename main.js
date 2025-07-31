const { app, Tray, Menu, dialog } = require('electron');
const path = require('path');

const { startHttpServer, stopHttpServer, loadSessionData, cleanOldSessions } = require('./modules/server');
const { createPrintWindow, setupIpcHandlers, closeAllWindows } = require('./modules/window');
const { cleanupOldPDFs } = require('./modules/printer');

let tray = null;
let autoUpdater = null;
global.isQuitting = false;

// electron-updater 조건부 로드
try {
  const { autoUpdater: updater } = require('electron-updater');
  autoUpdater = updater;
} catch (error) {
  console.log('Auto-updater not available');
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, process.platform === 'win32' ? 'assets/icon-32.png' : 'assets/icon.png');
    tray = new Tray(iconPath);
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '🔄 앱 재시작',
        click: () => {
          dialog.showMessageBox(null, {
            type: 'question',
            title: 'WebPrinter 재시작',
            message: 'WebPrinter를 재시작하시겠습니까?',
            buttons: ['재시작', '취소']
          }).then((result) => {
            if (result.response === 0) {
              app.relaunch();
              app.quit();
            }
          });
        }
      },
      { type: 'separator' },
      {
        label: '🛑 종료',
        click: () => {
          dialog.showMessageBox(null, {
            type: 'question',
            title: 'WebPrinter 종료',
            message: 'WebPrinter를 종료하시겠습니까?',
            buttons: ['종료', '취소']
          }).then((result) => {
            if (result.response === 0) {
              global.isQuitting = true;
              app.quit();
            }
          });
        }
      }
    ]);
    
    tray.setToolTip('WebPrinter - 우클릭으로 메뉴 열기');
    tray.setContextMenu(contextMenu);
    
    tray.on('double-click', () => {
      createPrintWindow();
    });
  } catch (error) {
    console.error('트레이 생성 실패:', error);
  }
}

function registerProtocol() {
  const protocolName = 'webprinter';
  
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(protocolName, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(protocolName);
  }
}

function setupAutoUpdater() {
  if (!autoUpdater || process.env.NODE_ENV === 'development' || process.defaultApp) return;
  
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    
    // 업데이트 확인
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('업데이트 확인 실패:', err);
      });
    }, 3000);
    
    // 주기적 업데이트 확인
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('업데이트 확인 실패:', err);
      });
    }, 30 * 60 * 1000);
    
    autoUpdater.on('update-downloaded', () => {
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'WebPrinter 업데이트',
          content: '새 버전이 다운로드되었습니다. 재시작 시 적용됩니다.'
        });
      }
    });
    
    autoUpdater.on('error', (error) => {
      console.log('업데이트 오류:', error);
    });
  } catch (error) {
    console.log('자동 업데이트 설정 실패:', error);
  }
}

function setupAutoLaunch() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      name: 'WebPrinter'
    });
  } catch (error) {
    console.error('자동 시작 설정 실패:', error);
  }
}

async function handleProtocolCall(protocolUrl) {
  try {
    const parsedUrl = new URL(protocolUrl);
    const action = parsedUrl.hostname;
    const params = Object.fromEntries(parsedUrl.searchParams);
    
    if (action === 'print') {
      await createPrintWindow(params.session);
    }
  } catch (error) {
    console.error('프로토콜 처리 실패:', error);
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const protocolUrl = commandLine.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) handleProtocolCall(protocolUrl);
  });

  app.whenReady().then(async () => {
    try {
      registerProtocol();
      setupAutoUpdater();
      setupAutoLaunch();
      createTray();
      setupIpcHandlers();
      
      await startHttpServer();
      loadSessionData();
      cleanOldSessions();
      cleanupOldPDFs();
      
      if (process.platform === 'darwin' && app.dock && tray && !tray.isDestroyed()) {
        app.dock.hide();
      }
      
      const protocolUrl = process.argv.find(arg => arg.startsWith('webprinter://'));
      if (protocolUrl) handleProtocolCall(protocolUrl);
    } catch (error) {
      console.error('앱 초기화 오류:', error);
      dialog.showErrorBox('WebPrinter 오류', '앱을 시작할 수 없습니다.\n' + error.message);
    }
  });

  app.on('open-url', (event, protocolUrl) => {
    event.preventDefault();
    handleProtocolCall(protocolUrl);
  });

  app.on('window-all-closed', () => {});

  app.on('before-quit', (event) => {
    if (!global.isQuitting) {
      event.preventDefault();
    } else {
      stopHttpServer();
      if (tray && !tray.isDestroyed()) {
        tray.destroy();
      }
      closeAllWindows();
    }
  });

  app.on('activate', () => {
    createPrintWindow();
  });
}