const IPCHandler = {
  callbacks: {
      onServerInfo: null,
      onUrlsReceived: null,
      onLoadingComplete: null
  },

  init(callbacks) {
      this.callbacks = callbacks;
      this.setupListeners();
  },

  setupListeners() {
      if (!window.electronAPI) return;

      window.electronAPI.onServerInfo((info) => {
          if (this.callbacks.onServerInfo) {
              this.callbacks.onServerInfo(info);
          }
      });

      window.electronAPI.onUrlsReceived((urlData) => {
          if (this.callbacks.onUrlsReceived) {
              this.callbacks.onUrlsReceived(urlData);
          }
      });

      window.electronAPI.onLoadingComplete(() => {
          if (this.callbacks.onLoadingComplete) {
              this.callbacks.onLoadingComplete();
          }
      });

      window.electronAPI.onShowWaitingMessage((msg) => {
          UIManager.showStatus(msg.message, 'info');
      });
  },

  async getServerInfo() {
      if (!window.electronAPI) return null;
      return await window.electronAPI.getServerInfo();
  },

  async getPrinters() {
      if (!window.electronAPI) return { success: false, printers: [] };
      return await window.electronAPI.getPrinters();
  },

  async printUrl(params) {
      if (!window.electronAPI) throw new Error('IPC 통신 불가');
      return await window.electronAPI.printUrl(params);
  },

  async hideToBackground() {
      if (window.electronAPI) {
          window.electronAPI.hideToBackground();
      }
  },

  requestShowWindow() {
      if (window.electronAPI && window.electronAPI.requestShowWindow) {
          window.electronAPI.requestShowWindow();
      }
  }
};