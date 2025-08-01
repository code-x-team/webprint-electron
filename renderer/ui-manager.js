const UIManager = {
    elements: {
        statusText: null,
        serverDisplay: null,
        previewFrame: null,
        printerSelect: null,
        statusMessage: null,
        printButton: null,
        cancelButton: null,
        loadingOverlay: null,
        refreshPrintersBtn: null,
        outputTypeRadios: null,
        printerGroup: null,
        rotate180Checkbox: null,
        loadingMainText: null,
        loadingProgress: null
    },
    
    loadingSteps: ['init', 'server', 'printers', 'ready'],
    currentStep: 0,
  
    init() {
        this.elements = {
            statusText: document.getElementById('status-text'),
            serverDisplay: document.getElementById('server-display'),
            previewFrame: document.getElementById('preview-frame'),
            printerSelect: document.getElementById('printer-select'),
            statusMessage: document.getElementById('status-message'),
            printButton: document.getElementById('print-button'),
            cancelButton: document.getElementById('cancel-button'),
            loadingOverlay: document.getElementById('loading-overlay'),
            refreshPrintersBtn: document.getElementById('refresh-printers'),
            outputTypeRadios: document.querySelectorAll('input[name="output-type"]'),
            printerGroup: document.getElementById('printer-group'),
            rotate180Checkbox: document.getElementById('rotate-180'),
            loadingMainText: document.getElementById('loading-main-text'),
            loadingProgress: document.getElementById('loading-progress')
        };
        
        // 출력 방식 변경 이벤트
        this.elements.outputTypeRadios.forEach(radio => {
            radio.addEventListener('change', () => this.handleOutputTypeChange());
        });
    },
  
    handleOutputTypeChange() {
        const selectedType = this.getSelectedOutputType();
        if (selectedType === 'printer') {
            this.elements.printerGroup.classList.add('show');
        } else {
            this.elements.printerGroup.classList.remove('show');
        }
        this.updatePrintButtonText();
    },
  
    getSelectedOutputType() {
        const selected = Array.from(this.elements.outputTypeRadios).find(r => r.checked);
        return selected ? selected.value : 'pdf';
    },
  
    updatePrintButtonText() {
        const outputType = this.getSelectedOutputType();
        const btn = this.elements.printButton;
        if (!btn.disabled || btn.textContent.includes('중...')) {
            btn.textContent = outputType === 'pdf' ? '📄 PDF 미리보기' : '🖨️ 프린터로 출력';
        }
    },
  
    showLoading(show = true) {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.classList.toggle('hidden', !show);
            if (show) {
                this.currentStep = 0;
                this.updateLoadingStep('init');
            }
        }
    },
    
    updateLoadingStep(stepName, customText = null) {
        const stepIndex = this.loadingSteps.indexOf(stepName);
        if (stepIndex === -1) return;
        
        // 이전 단계들을 완료로 표시
        for (let i = 0; i < stepIndex; i++) {
            const step = this.loadingSteps[i];
            const stepElement = document.getElementById(`step-${step}`);
            if (stepElement) {
                stepElement.classList.remove('active');
                stepElement.classList.add('completed');
                const icon = stepElement.querySelector('.step-icon');
                if (icon) {
                    icon.innerHTML = '✓';
                }
            }
        }
        
        // 현재 단계를 활성화
        const currentStepElement = document.getElementById(`step-${stepName}`);
        if (currentStepElement) {
            currentStepElement.classList.remove('completed');
            currentStepElement.classList.add('active');
            const icon = currentStepElement.querySelector('.step-icon');
            if (icon) {
                icon.innerHTML = stepIndex + 1;
            }
        }
        
        // 메인 텍스트 업데이트
        const messages = {
            init: '애플리케이션을 초기화하고 있습니다...',
            server: '서버와 연결을 확인하고 있습니다...',
            printers: '사용 가능한 프린터를 검색하고 있습니다...',
            ready: '모든 준비가 완료되었습니다!'
        };
        
        if (this.elements.loadingMainText) {
            this.elements.loadingMainText.textContent = customText || messages[stepName] || '로딩 중...';
        }
        
        if (this.elements.loadingProgress) {
            const progressPercent = Math.round(((stepIndex + 1) / this.loadingSteps.length) * 100);
            this.elements.loadingProgress.textContent = `${progressPercent}% 완료`;
        }
        
        this.currentStep = stepIndex;
    },
    
    completeLoading() {
        this.updateLoadingStep('ready');
        
        // 완료 후 잠시 대기 후 숨기기
        setTimeout(() => {
            this.showLoading(false);
        }, 800);
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
        this.updatePrintButtonText();
    },
  
    setPrintButtonLoading(loading) {
        const btn = this.elements.printButton;
        const outputType = this.getSelectedOutputType();
        btn.disabled = loading;
        if (loading) {
            btn.textContent = outputType === 'pdf' ? '📄 PDF 생성 중...' : '🖨️ 인쇄 중...';
        } else {
            this.updatePrintButtonText();
        }
    },
  
    displayPaperSize(paperSize) {
        if (paperSize && this.elements.serverDisplay) {
            const sizeText = `${paperSize.width}mm × ${paperSize.height}mm`;
            this.elements.serverDisplay.innerHTML += `<br>용지: ${sizeText}`;
        }
    },
  
    isRotate180Checked() {
        return this.elements.rotate180Checkbox && this.elements.rotate180Checkbox.checked;
    }
  };