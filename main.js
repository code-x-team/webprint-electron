const { app, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const { startHttpServer, stopHttpServer, loadSessionData, cleanOldSessions } = require('./modules/server');
const { createPrintWindow, setupIpcHandlers, closeAllWindows } = require('./modules/window');
const { cleanupOldPDFs } = require('./modules/printer');

let tray = null;
global.isQuitting = false;

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
  } catch (error) {}
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
  if (process.env.NODE_ENV === 'development' || process.defaultApp) return;
  
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  setTimeout(() => autoUpdater.checkForUpdates(), 3000);
  setInterval(() => autoUpdater.checkForUpdates(), 30 * 60 * 1000);
  
  autoUpdater.on('update-downloaded', () => {
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: '새 버전이 다운로드되었습니다. 재시작 시 적용됩니다.'
      });
    }
  });
}

function setupAutoLaunch() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      name: 'WebPrinter'
    });
  } catch (error) {}
}

async function handleProtocolCall(protocolUrl) {
  try {
    const parsedUrl = new URL(protocolUrl);
    const action = parsedUrl.hostname;
    const params = Object.fromEntries(parsedUrl.searchParams);
    
    if (action === 'print') {
      await createPrintWindow(params.session);
    }
  } catch (error) {}
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