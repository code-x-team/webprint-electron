// WebPrinter Test Application
const WebPrinterApp = {
  // Configuration
  config: {
      ports: [18731, 18732, 18733, 18734, 18735],
      timeout: 500,
      retryDelay: 1000,
      maxRetries: 2
  },

  // State
  state: {
      webPrinterPort: null,
      isConnecting: false
  },

  // DOM Elements
  elements: {},

  // Initialize
  init() {
      this.cacheElements();
      this.bindEvents();
      this.checkWebPrinter();
  },

  // Cache DOM elements
  cacheElements() {
      this.elements = {
          form: document.getElementById('print-form'),
          previewFrontUrl: document.getElementById('preview-front-url'),
          previewBackUrl: document.getElementById('preview-back-url'),
          printFrontUrl: document.getElementById('print-front-url'),
          printBackUrl: document.getElementById('print-back-url'),
          paperWidth: document.getElementById('paper-width'),
          paperHeight: document.getElementById('paper-height'),
          printBtn: document.getElementById('print-btn'),
          status: document.getElementById('status'),
          installNotice: document.getElementById('install-notice'),
          statusIndicator: document.getElementById('status-indicator'),
          connectionStatus: document.getElementById('connection-status')
      };
  },

  // Bind events
  bindEvents() {
      this.elements.form.addEventListener('submit', (e) => {
          e.preventDefault();
          this.startPrint();
      });



      // Enter key shortcut
      document.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
              const activeElement = document.activeElement;
              if (activeElement && activeElement.tagName === 'INPUT') {
                  e.preventDefault();
                  this.startPrint();
              }
          }
      });
  },

  // Show status message
  showStatus(message, type = 'info') {
      const status = this.elements.status;
      status.textContent = message;
      status.className = `status ${type}`;
      status.style.display = 'block';
      
      if (type === 'success' || type === 'error') {
          setTimeout(() => {
              status.style.display = 'none';
          }, 3000);
      }
  },

  // Find WebPrinter server
  async findWebPrinter() {
      for (const port of this.config.ports) {
          try {
              const response = await fetch(`http://localhost:${port}/status`, {
                  method: 'GET',
                  signal: AbortSignal.timeout(this.config.timeout)
              });
              
              if (response.ok) {
                  const data = await response.json();
                  if (data.status === 'running') {
                      return port;
                  }
              }
          } catch (e) {
              // Continue to next port
          }
      }
      
      return null;
  },

  // Update connection status
  updateConnectionStatus(isConnected) {
      const indicator = this.elements.statusIndicator;
      const statusText = this.elements.connectionStatus;
      
      if (isConnected) {
          indicator.className = 'status-indicator connected';
          statusText.textContent = '연결됨';
          this.elements.installNotice.style.display = 'none';
      } else {
          indicator.className = 'status-indicator disconnected';
          statusText.textContent = '연결 안됨';
          this.elements.installNotice.style.display = 'block';
      }
  },

  // Check WebPrinter on load
  async checkWebPrinter() {
      const port = await this.findWebPrinter();
      if (port) {
          this.showStatus('WebPrinter가 실행 중입니다', 'success');
          this.state.webPrinterPort = port;
          this.updateConnectionStatus(true);
      } else {
          this.updateConnectionStatus(false);
      }
  },

  // Validate form inputs
  validateInputs() {
      const previewFrontUrl = this.elements.previewFrontUrl.value.trim();
      const previewBackUrl = this.elements.previewBackUrl.value.trim();
      const printFrontUrl = this.elements.printFrontUrl.value.trim();
      const printBackUrl = this.elements.printBackUrl.value.trim();
      const paperWidth = parseFloat(this.elements.paperWidth.value);
      const paperHeight = parseFloat(this.elements.paperHeight.value);

      if (!previewFrontUrl && !printFrontUrl) {
          this.showStatus('최소한 앞면 URL을 입력하세요.', 'error');
          return null;
      }

      if (!paperWidth || !paperHeight || paperWidth <= 0 || paperHeight <= 0) {
          this.showStatus('올바른 용지 크기를 입력하세요.', 'error');
          return null;
      }

      return { previewFrontUrl, previewBackUrl, printFrontUrl, printBackUrl, paperWidth, paperHeight };
  },

  // Send data to WebPrinter
  async sendToWebPrinter(port, sessionId, data) {
      const response = await fetch(`http://localhost:${port}/send-urls`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              session: sessionId,
              front_preview_url: data.previewFrontUrl,
              back_preview_url: data.previewBackUrl,
              front_print_url: data.printFrontUrl,
              back_print_url: data.printBackUrl,
              paper_width: data.paperWidth,
              paper_height: data.paperHeight,
              paper_size: 'Custom',
              print_selector: '.print_wrap'
          })
      });

      const result = await response.json();
      
      if (!result.success) {
          throw new Error(result.error || '전송 실패');
      }
      
      return result;
  },

  // Start print process
  async startPrint() {
      if (this.state.isConnecting) return;

      const data = this.validateInputs();
      if (!data) return;

      this.state.isConnecting = true;
      this.elements.printBtn.disabled = true;
      
      this.showStatus('WebPrinter 연결 중...', 'info');

      try {
          // 1. Launch WebPrinter via protocol
          const sessionId = 'web_' + Date.now();
          const protocolUrl = `webprinter://print?session=${sessionId}`;
          window.location.href = protocolUrl;
          
          // 2. Wait and find server
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay));
          
          let port = await this.findWebPrinter();
          
          // Retry once if not found
          if (!port) {
              await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * 2));
              port = await this.findWebPrinter();
          }
          
          if (!port) {
              throw new Error('WebPrinter를 찾을 수 없습니다');
          }

          this.state.webPrinterPort = port;

          // 3. Send print data
          await this.sendToWebPrinter(port, sessionId, data);
          
          this.showStatus('✅ 인쇄 정보를 전송했습니다!', 'success');
          this.updateConnectionStatus(true);

      } catch (error) {
          this.showStatus(`❌ ${error.message}`, 'error');
          this.updateConnectionStatus(false);
      } finally {
          this.state.isConnecting = false;
          this.elements.printBtn.disabled = false;
      }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  WebPrinterApp.init();
});