// 전역 상태
let serverInfo = null;
let receivedUrls = {};
let currentPaperSize = null;
let availablePrinters = [];
let isPrinting = false;

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    UIManager.init();
    
    IPCHandler.init({
        onServerInfo: handleServerInfo,
        onUrlsReceived: handleUrlsReceived,
        onLoadingComplete: () => UIManager.showLoading(false)
    });
    
    initializeEventListeners();
    await loadPrinters();
    
    setTimeout(() => {
        IPCHandler.requestShowWindow();
        UIManager.showLoading(false);
    }, 100);
});

// 이벤트 리스너 설정
function initializeEventListeners() {
    UIManager.elements.refreshPrintersBtn.addEventListener('click', loadPrinters);
    UIManager.elements.printButton.addEventListener('click', executePrint);
    UIManager.elements.cancelButton.addEventListener('click', () => IPCHandler.hideToBackground());
    UIManager.elements.printerSelect.addEventListener('change', updateUI);
    UIManager.elements.copiesInput.addEventListener('input', updateUI);
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
    
    if (urlData.previewUrl || urlData.printUrl) {
        const url = urlData.previewUrl || urlData.printUrl;
        UIManager.showPreview(url);
        UIManager.showStatus('미리보기 로드 중...', 'info');
    }
    
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
        UIManager.showStatus('프린터 목록을 불러올 수 없습니다.', 'error');
        
        // 기본 옵션 추가
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
    if (isPrinting || !receivedUrls.printUrl) return;
    
    isPrinting = true;
    UIManager.setPrintButtonLoading(true);
    
    try {
        const printUrl = receivedUrls.printUrl || receivedUrls.previewUrl;
        
        if (!printUrl || !currentPaperSize) {
            throw new Error('인쇄 정보가 부족합니다');
        }
        
        const outputType = UIManager.getSelectedOutputType();
        const rotate180 = UIManager.isRotate180Checked();
        
        UIManager.showStatus(outputType === 'pdf' ? 'PDF 생성 중...' : '인쇄 중...', 'info');
        
        const result = await IPCHandler.printUrl({
            url: printUrl,
            printerName: UIManager.elements.printerSelect.value,
            copies: parseInt(UIManager.elements.copiesInput.value) || 1,
            paperSize: currentPaperSize,
            printSelector: receivedUrls.printSelector || '#print_wrap',
            silent: true,
            outputType: outputType,
            rotate180: rotate180
        });
        
        if (result.success) {
            if (outputType === 'pdf') {
                UIManager.showStatus('PDF 미리보기가 열렸습니다!', 'success');
            } else {
                UIManager.showStatus('프린터로 전송되었습니다!', 'success');
            }
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        UIManager.showStatus(`출력 실패: ${error.message}`, 'error');
    } finally {
        isPrinting = false;
        UIManager.setPrintButtonLoading(false);
    }
}

// UI 상태 업데이트
function updateUI() {
    const hasUrl = receivedUrls.printUrl || receivedUrls.previewUrl;
    const outputType = UIManager.getSelectedOutputType();
    const printerSelected = outputType === 'pdf' || UIManager.elements.printerSelect.value;
    
    UIManager.updatePrintButton(hasUrl && printerSelected);
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