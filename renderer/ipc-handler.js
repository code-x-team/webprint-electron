const IPCHandler = {
    callbacks: {
        onServerInfo: null,
        onUrlsReceived: null,
        onLoadingComplete: null,
        onSessionChanged: null
    },
  
    init(callbacks) {
        this.callbacks = callbacks;
        this.setupListeners();
    },
  
    setupListeners() {
        if (!window.electronAPI) {
            console.error('Electron API not available');
            return;
        }
  
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
        
        // 세션 변경 이벤트 추가
        if (window.electronAPI.onSessionChanged) {
            window.electronAPI.onSessionChanged((data) => {
                if (this.callbacks.onSessionChanged) {
                    this.callbacks.onSessionChanged(data);
                }
            });
        }
    },
  
    async getServerInfo() {
        if (!window.electronAPI) {
            console.error('Electron API not available');
            return null;
        }
        try {
            return await window.electronAPI.getServerInfo();
        } catch (error) {
            console.error('Failed to get server info:', error);
            return null;
        }
    },
    
    async getSessionData(sessionId) {
        if (!window.electronAPI || !window.electronAPI.getSessionData) {
            console.error('getSessionData API not available');
            return null;
        }
        try {
            return await window.electronAPI.getSessionData(sessionId);
        } catch (error) {
            console.error('Failed to get session data:', error);
            return null;
        }
    },
  
    async getPrinters() {
        if (!window.electronAPI) {
            console.error('Electron API not available');
            return { success: false, printers: [], error: 'Electron API를 사용할 수 없습니다' };
        }
        try {
            return await window.electronAPI.getPrinters();
        } catch (error) {
            console.error('Failed to get printers:', error);
            return { success: false, printers: [], error: error.message };
        }
    },
  
    async printUrl(params) {
        if (!window.electronAPI) {
            throw new Error('Electron API를 사용할 수 없습니다');
        }
        
        // 파라미터 검증
        if (!params || typeof params !== 'object') {
            throw new Error('잘못된 인쇄 매개변수입니다');
        }
        
        if (!params.url) {
            throw new Error('인쇄할 URL이 지정되지 않았습니다');
        }
        
        if (!params.paperSize || !params.paperSize.width || !params.paperSize.height) {
            throw new Error('용지 크기가 올바르지 않습니다');
        }
        
        // 기본값 설정
        const printParams = {
            url: params.url,
            paperSize: params.paperSize,
            printSelector: params.printSelector || '.print_wrap',
            printerName: params.printerName || '',
            copies: params.copies || 1,
            silent: params.silent !== false,
            outputType: params.outputType || 'pdf',
            rotate180: params.rotate180 || false
        };
        
        try {
            const result = await window.electronAPI.printUrl(printParams);
            if (!result) {
                throw new Error('인쇄 응답을 받지 못했습니다');
            }
            return result;
        } catch (error) {
            console.error('Print error:', error);
            throw error;
        }
    },
  
    async hideToBackground() {
        if (window.electronAPI) {
            try {
                await window.electronAPI.hideToBackground();
            } catch (error) {
                console.error('Failed to hide window:', error);
            }
        }
    },
  
    requestShowWindow() {
        if (window.electronAPI && window.electronAPI.requestShowWindow) {
            try {
                window.electronAPI.requestShowWindow();
            } catch (error) {
                console.error('Failed to show window:', error);
            }
        }
    }
};