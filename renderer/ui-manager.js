const UIManager = {
  elements: {
      statusText: null,
      serverDisplay: null,
      previewFrame: null,
      printerSelect: null,
      copiesInput: null,
      statusMessage: null,
      printButton: null,
      cancelButton: null,
      loadingOverlay: null,
      refreshPrintersBtn: null
  },

  init() {
      this.elements = {
          statusText: document.getElementById('status-text'),
          serverDisplay: document.getElementById('server-display'),
          previewFrame: document.getElementById('preview-frame'),
          printerSelect: document.getElementById('printer-select'),
          copiesInput: document.getElementById('copies'),
          statusMessage: document.getElementById('status-message'),
          printButton: document.getElementById('print-button'),
          cancelButton: document.getElementById('cancel-button'),
          loadingOverlay: document.getElementById('loading-overlay'),
          refreshPrintersBtn: document.getElementById('refresh-printers')
      };
  },

  showLoading(show = true) {
      if (this.elements.loadingOverlay) {
          this.elements.loadingOverlay.classList.toggle('hidden', !show);
      }
  },

  showStatus(message, type = 'info') {
      const elem = this.elements.statusMessage;
      if (elem) {
          elem.textContent = message;
          elem.className = `status-message ${type}`;
          elem.style.display = 'block';
          
          if (type === 'success' || type === 'error') {
              setTimeout(() => {
                  elem.style.display = 'none';
              }, 3000);
          }
      }
  },

  updateServerInfo(serverInfo) {
      if (serverInfo) {
          this.elements.statusText.textContent = `준비 완료 - 포트: ${serverInfo.port}`;
          this.elements.serverDisplay.textContent = `세션: ${serverInfo.session}`;
      }
  },

  updatePrinterList(printers) {
      const select = this.elements.printerSelect;
      while (select.children.length > 1) {
          select.removeChild(select.lastChild);
      }
      
      printers.forEach(printer => {
          const option = document.createElement('option');
          option.value = printer.name;
          option.textContent = `${printer.displayName || printer.name} ${printer.isDefault ? '(기본)' : ''}`;
          select.appendChild(option);
      });
      
      const defaultPrinter = printers.find(p => p.isDefault);
      if (defaultPrinter) {
          select.value = defaultPrinter.name;
      }
  },

  showPreview(url) {
      const iframe = this.elements.previewFrame;
      iframe.style.display = 'block';
      iframe.src = url;
      
      iframe.onload = () => {
          this.showStatus('웹페이지 로드 완료', 'success');
      };
      
      iframe.onerror = () => {
          this.showStatus('웹페이지 로드 실패', 'error');
      };
  },

  updatePrintButton(enabled) {
      this.elements.printButton.disabled = !enabled;
  },

  setPrintButtonLoading(loading) {
      const btn = this.elements.printButton;
      btn.disabled = loading;
      btn.textContent = loading ? '📄 PDF 생성 중...' : '📄 PDF 미리보기';
  },

  displayPaperSize(paperSize) {
      if (paperSize && this.elements.serverDisplay) {
          const sizeText = `${paperSize.width}mm × ${paperSize.height}mm`;
          this.elements.serverDisplay.innerHTML += `<br>용지: ${sizeText}`;
      }
  }
};