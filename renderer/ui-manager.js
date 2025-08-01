const UIManager = {
    elements: {
        statusText: null,
        serverDisplay: null,
        previewFrame: null,
        previewPlaceholder: null,
        printerSelect: null,
        statusMessage: null,
        printButton: null,
        loadingOverlay: null,
        refreshPrintersBtn: null,
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
            previewPlaceholder: document.getElementById('preview-placeholder'),
            printerSelect: document.getElementById('printer-select'),
            statusMessage: document.getElementById('status-message'),
            printButton: document.getElementById('print-button'),
            loadingOverlay: document.getElementById('loading-overlay'),
            refreshPrintersBtn: document.getElementById('refresh-printers'),
            loadingMainText: document.getElementById('loading-main-text'),
            loadingProgress: document.getElementById('loading-progress')
        };
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
        return 'printer'; // 항상 프린터 출력
    },
  
    updatePrintButtonText() {
        const btn = this.elements.printButton;
        if (!btn.disabled || btn.textContent.includes('중...')) {
            btn.textContent = '🖨️ 인쇄하기';
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
        console.log('UIManager.showPreview 호출됨:', url);
        
        if (!url) {
            console.log('URL이 없어서 미리보기를 숨깁니다');
            this.hidePreview();
            return;
        }
        
        const iframe = this.elements.previewFrame;
        const placeholder = this.elements.previewPlaceholder;
        
        console.log('iframe 요소:', iframe);
        console.log('placeholder 요소:', placeholder);
        
        if (!iframe) {
            console.error('iframe 요소를 찾을 수 없습니다');
            this.showStatus('미리보기 요소를 찾을 수 없습니다', 'error');
            return;
        }
        
        this.showStatus('미리보기 로딩 중...', 'info');
        
        // iframe을 먼저 표시하고 placeholder 숨김
        iframe.style.display = 'block';
        iframe.style.visibility = 'visible';
        iframe.style.opacity = '1';
        
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        
        // iframe 이벤트 리스너 설정
        iframe.onload = () => {
            console.log('✅ iframe 로드 완료:', url);
            this.showStatus('미리보기 로드 완료', 'success');
            if (placeholder) {
                placeholder.style.display = 'none';
            }
            iframe.style.display = 'block';
        };
        
        iframe.onerror = (error) => {
            console.error('❌ iframe 로드 실패:', url, error);
            this.showStatus('미리보기 로드 실패', 'error');
            if (placeholder) {
                placeholder.style.display = 'flex';
            }
        };
        
        // 보안 정책으로 인한 로드 실패 감지
        const checkLoad = () => {
            try {
                // iframe의 contentDocument 접근을 시도해서 CORS 오류 감지
                const doc = iframe.contentDocument;
                if (doc && doc.readyState === 'complete') {
                    console.log('✅ iframe 콘텐츠 로드 확인됨');
                }
            } catch (e) {
                if (e.name === 'SecurityError') {
                    console.log('⚠️ CORS로 인한 접근 제한 (정상적인 외부 사이트 로드)');
                } else {
                    console.error('❌ iframe 콘텐츠 접근 오류:', e);
                }
            }
        };
        
        console.log('🔗 iframe src 설정 중:', url);
        iframe.src = url;
        console.log('🔗 iframe src 설정 완료, 현재 src:', iframe.src);
        
        // 로드 상태 체크 (여러 시점에서)
        setTimeout(checkLoad, 1000);
        setTimeout(checkLoad, 3000);
        setTimeout(checkLoad, 5000);
        
        // iframe 표시 강제 확인 (디버깅용)
        setTimeout(() => {
            this.debugIframeState();
        }, 2000);
    },
    
    hidePreview() {
        const iframe = this.elements.previewFrame;
        const placeholder = this.elements.previewPlaceholder;
        
        iframe.src = '';
        if (placeholder) {
            placeholder.style.display = 'flex';
        }
    },
  
    updatePrintButton(enabled) {
        this.elements.printButton.disabled = !enabled;
        this.updatePrintButtonText();
    },
  
    setPrintButtonLoading(loading, customText = null) {
        const btn = this.elements.printButton;
        btn.disabled = loading;
        if (loading) {
            btn.textContent = customText || '🖨️ 인쇄 중...';
            btn.classList.add('loading');
        } else {
            btn.classList.remove('loading');
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
        return false; // 180도 회전 기능 비활성화
    },
    
    // 디버깅용 iframe 상태 체크 함수
    debugIframeState() {
        const iframe = this.elements.previewFrame;
        const placeholder = this.elements.previewPlaceholder;
        
        console.group('🔍 iframe 디버그 정보');
        console.log('iframe 요소 존재:', !!iframe);
        console.log('placeholder 요소 존재:', !!placeholder);
        
        if (iframe) {
            console.log('iframe.src:', iframe.src);
            console.log('iframe.style.display:', iframe.style.display);
            console.log('iframe.style.visibility:', iframe.style.visibility);
            console.log('iframe.style.opacity:', iframe.style.opacity);
            console.log('iframe.style.zIndex:', iframe.style.zIndex);
            console.log('iframe 크기:', { width: iframe.offsetWidth, height: iframe.offsetHeight });
            console.log('iframe 위치:', { top: iframe.offsetTop, left: iframe.offsetLeft });
            
            try {
                const computedStyle = window.getComputedStyle(iframe);
                console.log('계산된 스타일:');
                console.log('- display:', computedStyle.display);
                console.log('- visibility:', computedStyle.visibility);
                console.log('- opacity:', computedStyle.opacity);
                console.log('- z-index:', computedStyle.zIndex);
            } catch (e) {
                console.log('스타일 계산 오류:', e);
            }
        }
        
        if (placeholder) {
            console.log('placeholder.style.display:', placeholder.style.display);
        }
        console.groupEnd();
    }
  };