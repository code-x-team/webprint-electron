const { contextBridge, ipcRenderer } = require('electron');

// 안전한 API를 window.electronAPI에 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 프린터 관련 API
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  
  // URL 인쇄 API
  printUrl: (options) => ipcRenderer.invoke('print-url', options),
  
  // 서버 정보 API
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  
  // 앱 제어 API
  hideToBackground: () => ipcRenderer.invoke('hide-to-background'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  
  // 창 표시 제어 API
  requestShowWindow: () => ipcRenderer.send('request-show-window'),
  reportLoadingReady: () => ipcRenderer.send('loading-ready'),
  
  // 업데이트 관련 API
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 이벤트 리스너
  onServerInfo: (callback) => {
    ipcRenderer.on('server-info', (event, info) => callback(info));
  },
  
  onUrlsReceived: (callback) => {
    ipcRenderer.on('urls-received', (event, urlData) => callback(urlData));
  },
  
  onSessionRestored: (callback) => {
    ipcRenderer.on('session-restored', (event, sessionInfo) => callback(sessionInfo));
  },
  
  onShowWaitingMessage: (callback) => {
    ipcRenderer.on('show-waiting-message', (event, messageData) => callback(messageData));
  },
  
  onShowToast: (callback) => {
    ipcRenderer.on('show-toast', (event, toastData) => callback(toastData));
  },
  
  onLoadingComplete: (callback) => {
    ipcRenderer.on('loading-complete', (event, data) => callback(data));
  },
  
  onRestartLoading: (callback) => {
    ipcRenderer.on('restart-loading', (event, data) => callback(data));
  },
  
  // 업데이트 이벤트 리스너
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, info) => callback(info));
  },
  
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, progress) => callback(progress));
  },
  
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, info) => callback(info));
  },
  
  onUpdateNotAvailable: (callback) => {
    ipcRenderer.on('update-not-available', (event) => callback());
  },
  
  onUpdateError: (callback) => {
    ipcRenderer.on('update-error', (event, error) => callback(error));
  }
}); 