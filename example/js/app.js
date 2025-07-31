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
          previewUrl: document.getElementById('preview-url'),
          printUrl: document.getElementById('print-url'),
          paperWidth: document.getElementById('paper-width'),
          paperHeight: document.getElementById('paper-height'),
          printBtn: document.getElementById('print-btn'),
          status: document.getElementById('status'),
          installNotice: document.getElementById('install-notice')
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

  // Check WebPrinter on load
  async checkWebPrinter() {
      const port = await this.findWebPrinter();
      if (port) {
          this.showStatus('WebPrinter가 실행 중입니다', 'success');
          this.state.webPrinterPort = port;
          this.elements.installNotice.style.display = 'none';
      } else {
          this.elements.installNotice.style.display = 'block';
      }
  },

  // Validate form inputs
  validateInputs() {
      const previewUrl = this.elements.previewUrl.value.trim();
      const printUrl = this.elements.printUrl.value.trim();
      const paperWidth = parseFloat(this.elements.paperWidth.value);
      const paperHeight = parseFloat(this.elements.paperHeight.value);

      if (!previewUrl && !printUrl) {
          this.showStatus('URL을 입력하세요.', 'error');
          return null;
      }

      if (!paperWidth || !paperHeight || paperWidth <= 0 || paperHeight <= 0) {
          this.showStatus('올바른 용지 크기를 입력하세요.', 'error');
          return null;
      }

      return { previewUrl, printUrl, paperWidth, paperHeight };
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
              preview_url: data.previewUrl,
              print_url: data.printUrl,
              paper_width: data.paperWidth,
              paper_height: data.paperHeight,
              paper_size: 'Custom',
              print_selector: '#print_wrap'
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
          this.elements.installNotice.style.display = 'none';

      } catch (error) {
          this.showStatus(`❌ ${error.message}`, 'error');
          this.elements.installNotice.style.display = 'block';
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