const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 인쇄 기능
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  printUrl: (options) => ipcRenderer.invoke('print-url', options),
  
  // 앱 정보
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 앱 제어
  hideToBackground: () => ipcRenderer.invoke('hide-to-background'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  requestShowWindow: () => ipcRenderer.send('request-show-window'),
  
  // 메인 이벤트 리스너
  onServerInfo: (callback) => {
    ipcRenderer.on('server-info', (event, info) => callback(info));
  },
  
  onUrlsReceived: (callback) => {
    ipcRenderer.on('urls-received', (event, urlData) => callback(urlData));
  },
  
  onShowWaitingMessage: (callback) => {
    ipcRenderer.on('show-waiting-message', (event, messageData) => callback(messageData));
  },
  
  onLoadingComplete: (callback) => {
    ipcRenderer.on('loading-complete', (event, data) => callback(data));
  },
  
  // 업데이트 이벤트 (선택적)
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (event, info) => callback(info));
  }
});