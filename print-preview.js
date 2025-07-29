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
    statusMessage: document.getElementById('status-message'),
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
    console.log('🎧 URL 수신 이벤트 리스너 등록 중...');
    window.electronAPI.onUrlsReceived((urlData) => {
        console.log('📨 IPC 메시지 수신됨!', urlData);
        receivedUrls = urlData;
        handleUrlsReceived();
    });
    console.log('✅ 이벤트 리스너 등록 완료');
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
    elements.printButton.addEventListener('click', executePrint);
    elements.cancelButton.addEventListener('click', closeApp);
    elements.printerSelect.addEventListener('change', updateUI);
    elements.copiesInput.addEventListener('input', updateUI);
}

// 서버 정보 표시
function displayServerInfo() {
    if (serverInfo) {
        elements.statusText.textContent = `WebPrinter 준비 완료 - 포트: ${serverInfo.port}`;
        elements.serverDisplay.textContent = `세션: ${serverInfo.session}`;
        
        // 간단한 대기 메시지
        elements.loadingText.innerHTML = `
            <div style="text-align: center; font-size: 1.1rem; color: #2196f3;">
                <div style="margin: 40px 0;">
                    <div style="font-size: 2rem; margin-bottom: 15px;">🖨️</div>
                    <p><strong>웹페이지에서 인쇄 요청을 기다리는 중...</strong></p>
                    <p style="font-size: 0.9rem; color: #666; margin-top: 10px;">
                        브라우저에서 "출력하기" 버튼을 클릭하세요
                    </p>
                </div>
            </div>
        `;
    }
}

// URL 정보 수신 처리
async function handleUrlsReceived() {
    console.log('✅ URL 정보 수신됨:', receivedUrls);
    
    // 용지 사이즈 정보 저장
    if (receivedUrls.paperSize) {
        currentPaperSize = receivedUrls.paperSize;
        console.log('📐 용지 사이즈 설정됨:', currentPaperSize);
        
        // 용지 사이즈 정보 표시
        const paperSizeText = `${currentPaperSize.width}mm × ${currentPaperSize.height}mm (${currentPaperSize.name})`;
        elements.serverDisplay.innerHTML = `
            <div>세션: ${serverInfo.session}</div>
            <div>용지: ${paperSizeText}</div>
        `;
    }
    
    // 즉시 로딩 화면 숨김
    hideLoading();
    
    // 미리보기 URL이 있으면 즉시 자동으로 표시
    if (receivedUrls.previewUrl) {
        console.log('🖼️ 미리보기 자동 표시 시작');
        showStatus('📥 URL 수신 완료! 미리보기를 로드합니다...', 'info');
        
        // 즉시 미리보기 표시
        await showPreviewUrl();
    } else if (receivedUrls.printUrl) {
        console.log('🖨️ 인쇄 URL만 수신됨');
        showStatus('인쇄용 URL이 수신되었습니다. (미리보기 없음)', 'info');
        
        // 미리보기 URL이 없으면 인쇄 URL로 미리보기 표시
        receivedUrls.previewUrl = receivedUrls.printUrl;
        await showPreviewUrl();
    }
    
    updateUI();
}

// URL이 PDF인지 확인
function isPdfUrl(url) {
    if (!url) return false;
    
    // PDF 파일 확장자 체크
    const pdfExtensions = ['.pdf'];
    const urlLower = url.toLowerCase();
    
    // 확장자로 판단
    if (pdfExtensions.some(ext => urlLower.includes(ext))) {
        return true;
    }
    
    // Content-Type으로 판단 (나중에 확장 가능)
    // URL에 pdf 키워드가 있는지 확인
    if (urlLower.includes('pdf') || urlLower.includes('document')) {
        return true;
    }
    
    return false;
}

// 미리보기 URL 표시 (디버깅 강화)
async function showPreviewUrl() {
    console.log('🎯 showPreviewUrl 호출됨');
    console.log('📋 receivedUrls:', receivedUrls);
    
    if (!receivedUrls.previewUrl) {
        console.error('❌ previewUrl이 없음');
        showStatus('미리보기 URL이 없습니다.', 'error');
        return;
    }
    
    try {
        const url = receivedUrls.previewUrl;
        const isPdf = isPdfUrl(url);
        
        console.log(`🔍 URL 분석: ${url}`);
        console.log(`📄 PDF 여부: ${isPdf}`);
        
        if (isPdf) {
            console.log('📄 PDF 미리보기 시작');
            showPdfPreview(url);
        } else {
            console.log('🌐 웹페이지 미리보기 시작');
            await showHtmlPreview(url);
        }
    } catch (error) {
        console.error('❌ 미리보기 표시 실패:', error);
        showStatus('미리보기를 표시할 수 없습니다.', 'error');
    }
}

// PDF 미리보기 (iframe 사용)
function showPdfPreview(url) {
    showStatus('📄 PDF 문서를 로드하는 중...', 'info');
    
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '4px';
    iframe.style.backgroundColor = '#525659';
    iframe.title = 'PDF 미리보기';
    
    iframe.onload = () => {
        showStatus('📄 PDF 미리보기 완료! 인쇄를 진행하세요.', 'success');
    };
    
    iframe.onerror = () => {
        showStatus('❌ PDF 로드 실패. URL을 확인해주세요.', 'error');
    };
    
    elements.pdfViewer.classList.add('hidden');
    elements.previewContainer = document.querySelector('.preview-container');
    elements.previewContainer.innerHTML = '';
    elements.previewContainer.appendChild(iframe);
}

// HTML 웹페이지 미리보기 (iframe 사용 - 안정적)
async function showHtmlPreview(url) {
    console.log(`🌐 showHtmlPreview 시작: ${url}`);
    showStatus('🌐 웹페이지를 로드하는 중...', 'info');
    
    // 웹페이지는 iframe으로 안정적으로 표시
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '4px';
    iframe.style.backgroundColor = 'white';
    
    console.log('📦 iframe 생성 완료');
    
    // 로딩 상태 표시
    let loadingTimeout;
    
    iframe.onload = () => {
        console.log('✅ iframe 로드 완료!');
        clearTimeout(loadingTimeout);
        showStatus('✅ 웹페이지 로드 완료! 인쇄를 진행하세요.', 'success');
    };
    
    iframe.onerror = () => {
        console.error('❌ iframe 로드 실패!');
        clearTimeout(loadingTimeout);
        showStatus('❌ 웹페이지 로드 실패. URL을 확인해주세요.', 'error');
    };
    
    // 타임아웃 설정 (15초)
    loadingTimeout = setTimeout(() => {
        console.warn('⚠️ iframe 로드 타임아웃');
        showStatus('⚠️ 웹페이지 로드가 느립니다. 네트워크를 확인해주세요.', 'warning');
    }, 15000);
    
    // 기존 뷰어 숨기고 iframe 표시
    elements.pdfViewer.classList.add('hidden');
    elements.previewContainer = document.querySelector('.preview-container');
    
    console.log('🎨 previewContainer 찾음:', elements.previewContainer);
    
    elements.previewContainer.innerHTML = '';
    elements.previewContainer.appendChild(iframe);
    
    console.log('🎉 iframe DOM에 추가 완료');
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
    
    // PDF 저장 옵션 추가 (최상단)
    const pdfOption = document.createElement('option');
    pdfOption.value = 'PDF_SAVE';
    pdfOption.textContent = '📄 PDF로 저장';
    pdfOption.style.fontWeight = 'bold';
    pdfOption.style.color = '#e91e63';
    elements.printerSelect.appendChild(pdfOption);
    
    // 구분선 추가
    const separatorOption = document.createElement('option');
    separatorOption.disabled = true;
    separatorOption.textContent = '────────────────';
    elements.printerSelect.appendChild(separatorOption);
    
    // 새 프린터 옵션 추가
    availablePrinters.forEach(printer => {
        const option = document.createElement('option');
        option.value = printer.name;
        option.textContent = `🖨️ ${printer.displayName || printer.name} ${printer.isDefault ? '(기본)' : ''}`;
        elements.printerSelect.appendChild(option);
    });
    
    // 기본 프린터 자동 선택 (PDF 옵션이 있으므로 기본값은 PDF로 설정)
    elements.printerSelect.value = 'PDF_SAVE';
}



// 인쇄 실행
async function executePrint() {
    const printerName = elements.printerSelect.value;
    const copies = parseInt(elements.copiesInput.value) || 1;
    const silent = false; // 항상 대화상자 표시
    
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
    
    // PDF 저장 모드 확인
    const isPdfSave = printerName === 'PDF_SAVE';
    
    if (isPdfSave) {
        showStatus('PDF 파일을 생성하는 중...', 'info');
    } else {
        showStatus('인쇄를 실행하는 중...', 'info');
    }
    elements.printButton.disabled = true;
    
    try {
        const result = await window.electronAPI.printUrl({
            url: printUrl,
            printerName: printerName,
            copies: copies,
            silent: silent,
            paperSize: currentPaperSize, // 용지 사이즈 정보 전달
            isPdfSave: isPdfSave // PDF 저장 모드 플래그
        });
        
        if (result.success) {
            if (isPdfSave) {
                if (result.saved) {
                    showStatus(`📄 PDF 파일이 저장되었습니다! (${result.filePath})`, 'success');
                    
                    // 3초 후 앱 종료 (PDF 저장은 조금 더 오래 표시)
                    setTimeout(() => {
                        closeApp();
                    }, 3000);
                } else {
                    showStatus('PDF 저장이 취소되었습니다.', 'warning');
                    elements.printButton.disabled = false;
                    return; // 앱 종료하지 않음
                }
            } else {
                showStatus('🖨️ 인쇄가 완료되었습니다!', 'success');
                
                // 2초 후 앱 종료
                setTimeout(() => {
                    closeApp();
                }, 2000);
            }
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
    console.log('🙈 hideLoading 호출됨');
    console.log('📋 previewLoading 요소:', elements.previewLoading);
    
    if (elements.previewLoading) {
        elements.previewLoading.classList.add('hidden');
        console.log('✅ 로딩 화면 숨김 완료');
    } else {
        console.error('❌ previewLoading 요소를 찾을 수 없음');
    }
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