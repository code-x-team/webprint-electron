// 전역 상태
let serverInfo = null;
let receivedUrls = {};
let currentPaperSize = null;
let availablePrinters = [];
let isPrinting = false;
let currentSide = 'front'; // 현재 보고 있는 면

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    UIManager.init();
    UIManager.showLoading(true);
    
    // 1단계: 애플리케이션 초기화
    await new Promise(resolve => setTimeout(resolve, 500));
    UIManager.updateLoadingStep('init', '애플리케이션을 초기화하고 있습니다...');
    
    IPCHandler.init({
        onServerInfo: handleServerInfo,
        onUrlsReceived: handleUrlsReceived,
        onLoadingComplete: () => UIManager.completeLoading()
    });
    
    initializeEventListeners();
    
    // 2단계: 서버 연결 확인
    await new Promise(resolve => setTimeout(resolve, 300));
    UIManager.updateLoadingStep('server', '서버와 연결을 확인하고 있습니다...');
    
    // 3단계: 프린터 목록 로드
    await new Promise(resolve => setTimeout(resolve, 300));
    UIManager.updateLoadingStep('printers', '사용 가능한 프린터를 검색하고 있습니다...');
    await loadPrinters();
    
    // 4단계: 준비 완료
    await new Promise(resolve => setTimeout(resolve, 200));
    UIManager.updateLoadingStep('ready', '모든 준비가 완료되었습니다!');
    
    setTimeout(() => {
        IPCHandler.requestShowWindow();
        UIManager.completeLoading();
    }, 500);
});

// 이벤트 리스너 설정
function initializeEventListeners() {
    UIManager.elements.refreshPrintersBtn.addEventListener('click', loadPrinters);
    UIManager.elements.printButton.addEventListener('click', executePrint);
    UIManager.elements.cancelButton.addEventListener('click', () => IPCHandler.hideToBackground());
    UIManager.elements.printerSelect.addEventListener('change', updateUI);
    
    // 앞면/뒷면 선택 이벤트
    document.querySelectorAll('input[name="side-selection"]').forEach(radio => {
        radio.addEventListener('change', handleSideChange);
    });
}

// 앞면/뒷면 전환 처리
function handleSideChange() {
    const selectedRadio = document.querySelector('input[name="side-selection"]:checked');
    currentSide = selectedRadio ? selectedRadio.value : 'front';
    
    // 미리보기 업데이트
    showPreviewForSide(currentSide);
    updatePreviewHeader();
}

// 선택된 면의 미리보기 표시
function showPreviewForSide(side) {
    if (!receivedUrls) return;
    
    let url;
    if (side === 'front') {
        url = receivedUrls.frontPreviewUrl || receivedUrls.previewUrl;
    } else {
        url = receivedUrls.backPreviewUrl;
    }
    
    if (url) {
        UIManager.showPreview(url);
        UIManager.showStatus(`${side === 'front' ? '앞면' : '뒷면'} 미리보기 로드 중...`, 'info');
    }
}

// 미리보기 헤더 업데이트
function updatePreviewHeader() {
    const indicator = document.getElementById('preview-side-indicator');
    if (indicator) {
        indicator.textContent = `(${currentSide === 'front' ? '앞면' : '뒷면'})`;
    }
}

// 서버 정보 처리
function handleServerInfo(info) {
    serverInfo = info;
    UIManager.updateServerInfo(info);
}

// URL 수신 처리
function handleUrlsReceived(urlData) {
    receivedUrls = urlData;
    
    if (urlData.paperSize) {
        currentPaperSize = urlData.paperSize;
        UIManager.displayPaperSize(currentPaperSize);
    }
    
    // 현재 선택된 면의 미리보기 표시
    showPreviewForSide(currentSide);
    updatePreviewHeader();
    
    updateUI();
}

// 프린터 목록 로드
async function loadPrinters() {
    UIManager.showStatus('프린터 목록을 불러오는 중...', 'info');
    
    try {
        const result = await IPCHandler.getPrinters();
        
        if (result.success) {
            availablePrinters = result.printers;
            UIManager.updatePrinterList(availablePrinters);
            UIManager.showStatus(`프린터 ${availablePrinters.length}개를 찾았습니다.`, 'success');
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('프린터 목록 로드 실패:', error);
        UIManager.showStatus('프린터 목록을 불러올 수 없습니다. 시스템 기본 프린터를 사용합니다.', 'error');
        
        // 기본 옵션 추가
        availablePrinters = [{ name: 'system-default', displayName: '시스템 기본 프린터' }];
        const defaultOption = document.createElement('option');
        defaultOption.value = 'system-default';
        defaultOption.textContent = '시스템 기본 프린터';
        UIManager.elements.printerSelect.appendChild(defaultOption);
        UIManager.elements.printerSelect.value = 'system-default';
    }
    
    updateUI();
}

// 인쇄 실행
async function executePrint() {
    // 현재 선택된 면의 인쇄 URL 확인
    let printUrl;
    if (currentSide === 'front') {
        printUrl = receivedUrls.frontPrintUrl || receivedUrls.printUrl;
    } else {
        printUrl = receivedUrls.backPrintUrl;
    }
    
    if (isPrinting || !printUrl) return;
    
    isPrinting = true;
    UIManager.setPrintButtonLoading(true);
    
    try {
        if (!printUrl || !currentPaperSize) {
            throw new Error('인쇄 정보가 부족합니다');
        }
        
        const outputType = UIManager.getSelectedOutputType();
        const rotate180 = UIManager.isRotate180Checked();
        
        UIManager.showStatus(outputType === 'pdf' ? `${currentSide === 'front' ? '앞면' : '뒷면'} PDF 생성 중...` : `${currentSide === 'front' ? '앞면' : '뒷면'} 인쇄 중...`, 'info');
        
        const result = await IPCHandler.printUrl({
            url: printUrl,
            printerName: UIManager.elements.printerSelect.value,
            copies: 1, // 복사본 수 고정
            paperSize: currentPaperSize,
            printSelector: receivedUrls.printSelector || '.print_wrap',
            silent: true,
            outputType: outputType,
            rotate180: rotate180
        });
        
        if (result.success) {
            if (outputType === 'pdf') {
                UIManager.showStatus('PDF 미리보기가 열렸습니다!', 'success');
            } else {
                const message = result.message || '프린터로 전송되었습니다!';
                UIManager.showStatus(message, 'success');
                console.log('프린터 출력 성공:', result);
            }
            
            // 성공 시 창 닫기 처리 (shouldClose가 true인 경우)
            if (result.shouldClose) {
                console.log('작업 완료, 창을 닫고 백그라운드로 전환합니다.');
                setTimeout(() => {
                    IPCHandler.hideToBackground();
                }, 2000); // 2초 후 자동으로 백그라운드로 전환
            }
        } else {
            throw new Error(result.error || '알 수 없는 오류가 발생했습니다');
        }
    } catch (error) {
        // 사용자 안내 메시지인 경우 info로 표시
        if (error.message.includes('PDF 뷰어가 열렸습니다') || 
            error.message.includes('다음 단계를 따라하세요')) {
            UIManager.showStatus(error.message, 'info');
        } else {
            UIManager.showStatus(`출력 실패: ${error.message}`, 'error');
        }
    } finally {
        isPrinting = false;
        UIManager.setPrintButtonLoading(false);
    }
}

// UI 상태 업데이트
function updateUI() {
    // 현재 선택된 면의 URL 확인
    let hasUrl = false;
    if (currentSide === 'front') {
        hasUrl = receivedUrls.frontPrintUrl || receivedUrls.printUrl || receivedUrls.frontPreviewUrl || receivedUrls.previewUrl;
    } else {
        hasUrl = receivedUrls.backPrintUrl || receivedUrls.backPreviewUrl;
    }
    
    const hasPaperSize = currentPaperSize && currentPaperSize.width && currentPaperSize.height;
    const outputType = UIManager.getSelectedOutputType();
    
    // 프린터 출력 방식일 때는 프린터가 선택되어야 함
    let canPrint = hasUrl && hasPaperSize;
    if (outputType === 'printer') {
        const printerSelected = UIManager.elements.printerSelect.value && 
                              UIManager.elements.printerSelect.value !== '';
        canPrint = canPrint && printerSelected;
    }
    
    UIManager.updatePrintButton(canPrint);
    
    // 프린터 방식 선택 시 프린터 그룹 표시/숨김
    const printerGroup = UIManager.elements.printerGroup;
    if (printerGroup) {
        if (outputType === 'printer') {
            printerGroup.classList.add('show');
        } else {
            printerGroup.classList.remove('show');
        }
    }
}

// 키보드 단축키
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
        event.preventDefault();
        if (!UIManager.elements.printButton.disabled) {
            executePrint();
        }
    }
    
    if (event.key === 'Escape') {
        IPCHandler.hideToBackground();
    }
});