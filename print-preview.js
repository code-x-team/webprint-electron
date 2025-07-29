// 전역 변수
let serverInfo = null;
let availablePrinters = [];
let receivedUrls = {};
let currentPaperSize = null;

// DOM 요소들
const elements = {
    statusText: document.getElementById('status-text'),
    serverDisplay: document.getElementById('server-display'),
    previewLoading: document.getElementById('preview-loading'),
    loadingText: document.getElementById('loading-text'),
    pdfViewer: document.getElementById('pdf-viewer'),
    printerSelect: document.getElementById('printer-select'),
    refreshPrintersBtn: document.getElementById('refresh-printers'),
    copiesInput: document.getElementById('copies'),
    silentPrintCheckbox: document.getElementById('silent-print'),
    statusMessage: document.getElementById('status-message'),
    showPreviewBtn: document.getElementById('show-preview'),
    printButton: document.getElementById('print-button'),
    cancelButton: document.getElementById('cancel-button')
};

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    initializeEventListeners();
    await loadPrinters();
    await initializeUpdater();
    
    // 메인 프로세스에서 서버 정보 이벤트 리스너 등록
    window.electronAPI.onServerInfo((info) => {
        serverInfo = info;
        displayServerInfo();
    });
    
    // URL 정보 수신 이벤트 리스너 등록
    window.electronAPI.onUrlsReceived((urlData) => {
        receivedUrls = urlData;
        handleUrlsReceived();
    });
});

// 업데이트 기능 초기화
async function initializeUpdater() {
    try {
        // 앱 버전 표시
        const version = await window.electronAPI.getAppVersion();
        console.log('현재 앱 버전:', version);
        
        // 업데이트 이벤트 리스너 등록
        window.electronAPI.onUpdateAvailable((info) => {
            showStatus(`새 버전 ${info.version}이 발견되었습니다. 업데이트를 다운로드합니다.`, 'info');
        });
        
        window.electronAPI.onUpdateProgress((progress) => {
            showStatus(`업데이트 다운로드 중... ${progress.percent}%`, 'info');
        });
        
        window.electronAPI.onUpdateDownloaded((info) => {
            showStatus(`업데이트 다운로드 완료! 버전 ${info.version}으로 업데이트하려면 재시작이 필요합니다.`, 'success');
            
            // 3초 후 자동 재시작 확인
            setTimeout(() => {
                if (confirm('업데이트를 적용하기 위해 앱을 재시작하시겠습니까?')) {
                    window.electronAPI.installUpdate();
                }
            }, 3000);
        });
        
    } catch (error) {
        console.error('업데이트 초기화 실패:', error);
    }
}

// 이벤트 리스너 초기화
function initializeEventListeners() {
    elements.refreshPrintersBtn.addEventListener('click', loadPrinters);
    elements.showPreviewBtn.addEventListener('click', showPreviewUrl);
    elements.printButton.addEventListener('click', executePrint);
    elements.cancelButton.addEventListener('click', closeApp);
    elements.printerSelect.addEventListener('change', updateUI);
    elements.copiesInput.addEventListener('input', updateUI);
}

// 서버 정보 표시
function displayServerInfo() {
    if (serverInfo) {
        elements.statusText.textContent = `서버 실행 중 - 포트: ${serverInfo.port}, 세션: ${serverInfo.session}`;
        elements.serverDisplay.textContent = `http://localhost:${serverInfo.port} (세션: ${serverInfo.session})`;
        
        elements.loadingText.innerHTML = `
            <div style="text-align: left; font-size: 0.9rem;">
                <p><strong>웹에서 다음 정보로 URL을 전송하세요:</strong></p>
                <p>• 서버 주소: <code>http://localhost:${serverInfo.port}</code> (포트: 50000-50010)</p>
                <p>• 엔드포인트: <code>POST /send-urls</code></p>
                <p>• 세션 ID: <code>${serverInfo.session}</code></p>
                <br>
                <p>전송할 데이터:</p>
                <p>• <code>preview_url</code>: 미리보기용 URL</p>
                <p>• <code>print_url</code>: 실제 인쇄용 URL</p>
                <p>• <code>paper_width/height</code>: 용지 크기 (244×88mm)</p>
            </div>
        `;
    }
}

// URL 정보 수신 처리
function handleUrlsReceived() {
    console.log('URL 정보 수신됨:', receivedUrls);
    
    // 용지 사이즈 정보 저장
    if (receivedUrls.paperSize) {
        currentPaperSize = receivedUrls.paperSize;
        console.log('용지 사이즈 설정됨:', currentPaperSize);
        
        // 용지 사이즈 정보 표시
        const paperSizeText = `${currentPaperSize.width}mm × ${currentPaperSize.height}mm (${currentPaperSize.name})`;
        elements.serverDisplay.innerHTML = `
            <div>서버: http://localhost:${serverInfo.port}</div>
            <div>용지 사이즈: ${paperSizeText}</div>
        `;
    }
    
    hideLoading();
    
    // 미리보기 URL이 있으면 자동으로 표시
    if (receivedUrls.previewUrl) {
        showPreviewUrl();
        showStatus('URL 정보가 수신되었습니다!', 'success');
    } else if (receivedUrls.printUrl) {
        showStatus('인쇄용 URL이 수신되었습니다. (미리보기 없음)', 'info');
    }
    
    updateUI();
}

// 미리보기 URL 표시
function showPreviewUrl() {
    if (!receivedUrls.previewUrl) {
        showStatus('미리보기 URL이 없습니다.', 'error');
        return;
    }
    
    try {
        // URL을 iframe으로 표시
        const iframe = document.createElement('iframe');
        iframe.src = receivedUrls.previewUrl;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.borderRadius = '4px';
        
        // 기존 뷰어 숨기고 iframe 표시
        elements.pdfViewer.classList.add('hidden');
        elements.previewContainer = document.querySelector('.preview-container');
        elements.previewContainer.innerHTML = '';
        elements.previewContainer.appendChild(iframe);
        
        showStatus('미리보기 페이지를 표시하고 있습니다.', 'info');
    } catch (error) {
        console.error('미리보기 표시 실패:', error);
        showStatus('미리보기를 표시할 수 없습니다.', 'error');
    }
}

// 프린터 목록 로드
async function loadPrinters() {
    showStatus('프린터 목록을 불러오는 중...', 'info');
    
    try {
        const result = await window.electronAPI.getPrinters();
        
        if (result.success) {
            availablePrinters = result.printers;
            updatePrinterSelect();
            showStatus(`프린터 ${availablePrinters.length}개를 찾았습니다.`, 'success');
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('프린터 로드 실패:', error);
        showStatus('프린터 목록을 불러올 수 없습니다.', 'error');
    }
    
    updateUI();
}

// 프린터 선택 박스 업데이트
function updatePrinterSelect() {
    // 기존 옵션 제거 (첫 번째 옵션 제외)
    while (elements.printerSelect.children.length > 1) {
        elements.printerSelect.removeChild(elements.printerSelect.lastChild);
    }
    
    // 새 옵션 추가
    availablePrinters.forEach(printer => {
        const option = document.createElement('option');
        option.value = printer.name;
        option.textContent = `${printer.displayName || printer.name} ${printer.isDefault ? '(기본)' : ''}`;
        elements.printerSelect.appendChild(option);
    });
    
    // 기본 프린터 자동 선택
    const defaultPrinter = availablePrinters.find(p => p.isDefault);
    if (defaultPrinter) {
        elements.printerSelect.value = defaultPrinter.name;
    }
}



// 인쇄 실행
async function executePrint() {
    const printerName = elements.printerSelect.value;
    const copies = parseInt(elements.copiesInput.value) || 1;
    const silent = elements.silentPrintCheckbox.checked;
    
    if (!printerName) {
        showStatus('프린터를 선택해주세요.', 'error');
        return;
    }
    
    // 인쇄용 URL이 없으면 미리보기 URL 사용
    const printUrl = receivedUrls.printUrl || receivedUrls.previewUrl;
    
    if (!printUrl) {
        showStatus('인쇄할 URL이 없습니다.', 'error');
        return;
    }
    
    showStatus('인쇄를 실행하는 중...', 'info');
    elements.printButton.disabled = true;
    
    try {
        const result = await window.electronAPI.printUrl({
            url: printUrl,
            printerName: printerName,
            copies: copies,
            silent: silent,
            paperSize: currentPaperSize // 용지 사이즈 정보 전달
        });
        
        if (result.success) {
            showStatus('인쇄가 완료되었습니다!', 'success');
            
            // 2초 후 앱 종료
            setTimeout(() => {
                closeApp();
            }, 2000);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('인쇄 실패:', error);
        showStatus('인쇄에 실패했습니다.', 'error');
        elements.printButton.disabled = false;
    }
}

// 앱 종료
function closeApp() {
    window.electronAPI.quitApp();
}

// UI 상태 업데이트
function updateUI() {
    const hasPrinter = elements.printerSelect.value !== '';
    const hasUrl = receivedUrls.printUrl || receivedUrls.previewUrl;
    const hasPreviewUrl = !!receivedUrls.previewUrl;
    
    // 버튼 활성화 상태
    elements.showPreviewBtn.disabled = !hasPreviewUrl;
    elements.printButton.disabled = !hasUrl || !hasPrinter;
}

// 상태 메시지 표시
function showStatus(message, type = 'info') {
    elements.statusMessage.textContent = message;
    elements.statusMessage.className = `status-message ${type}`;
    elements.statusMessage.style.display = 'block';
    
    // 성공/오류 메시지는 3초 후 자동 숨김
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            elements.statusMessage.style.display = 'none';
        }, 3000);
    }
}

// 로딩 숨김
function hideLoading() {
    elements.previewLoading.classList.add('hidden');
}

// 키보드 단축키
document.addEventListener('keydown', (event) => {
    // Ctrl+P 또는 Cmd+P로 인쇄
    if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
        event.preventDefault();
        if (!elements.printButton.disabled) {
            executePrint();
        }
    }
    
    // ESC로 취소
    if (event.key === 'Escape') {
        closeApp();
    }
});

// 윈도우 포커스 이벤트
window.addEventListener('focus', () => {
    // 포커스를 받았을 때 프린터 목록 새로고침
    loadPrinters();
}); 