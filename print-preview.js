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
        
        // 자동 업데이트 이벤트 리스너 등록
        window.electronAPI.onUpdateAvailable((info) => {
            console.log('🆕 업데이트 발견:', info);
            if (info.autoDownload) {
                showStatus(`🆕 v${info.version} 업데이트 발견! 자동 다운로드를 시작합니다...`, 'info');
            } else {
                showStatus(`새 버전 ${info.version}이 발견되었습니다.`, 'info');
            }
        });
        
        window.electronAPI.onUpdateProgress((progress) => {
            const percent = Math.round(progress.percent);
            showStatus(`📥 업데이트 다운로드 중... ${percent}% (${Math.round(progress.transferred / 1024 / 1024)}MB / ${Math.round(progress.total / 1024 / 1024)}MB)`, 'info');
            console.log(`다운로드 진행률: ${percent}%`);
        });
        
        window.electronAPI.onUpdateDownloaded((info) => {
            console.log('✅ 업데이트 다운로드 완료:', info);
            
            if (info.autoRestart) {
                // 자동 재시작 카운트다운
                let countdown = info.countdown || 5;
                const countdownInterval = setInterval(() => {
                    showStatus(`✅ v${info.version} 다운로드 완료! ${countdown}초 후 자동 재시작됩니다...`, 'success');
                    countdown--;
                    
                    if (countdown <= 0) {
                        clearInterval(countdownInterval);
                        showStatus(`🔄 업데이트 적용 중... 잠시만 기다려주세요.`, 'info');
                    }
                }, 1000);
            } else {
                showStatus(`✅ v${info.version} 다운로드 완료! 재시작이 필요합니다.`, 'success');
            }
        });
        
        window.electronAPI.onUpdateNotAvailable(() => {
            console.log('✅ 최신 버전 사용 중');
            // 최신 버전일 때는 별도 알림 표시하지 않음 (콘솔에만 기록)
        });
        
        window.electronAPI.onUpdateError((error) => {
            console.warn('⚠️ 업데이트 확인 실패:', error.message);
            // 업데이트 오류는 사용자에게 표시하지 않음 (백그라운드 작업)
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

// PDF 관련 함수 제거됨

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
        console.log(`🔍 URL 분석: ${url}`);
        console.log('🌐 웹페이지 미리보기 시작');
        await showHtmlPreview(url);
    } catch (error) {
        console.error('❌ 미리보기 표시 실패:', error);
        showStatus('미리보기를 표시할 수 없습니다.', 'error');
    }
}

// PDF 미리보기 함수 제거됨

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
    
    // iframe 표시 준비
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
    
    // 프린터 옵션 추가
    availablePrinters.forEach(printer => {
        const option = document.createElement('option');
        option.value = printer.name;
        option.textContent = `🖨️ ${printer.displayName || printer.name} ${printer.isDefault ? '(기본)' : ''}`;
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
    
    console.log('🖨️ 인쇄 실행 시작:', {
        printerName,
        copies,
        printUrl,
        silent,
        paperSize: currentPaperSize
    });
    
    showStatus('인쇄를 실행하는 중...', 'info');
    elements.printButton.disabled = true;
    
    try {
        console.log('📤 메인 프로세스로 인쇄 요청 전송 중...');
        const result = await window.electronAPI.printUrl({
            url: printUrl,
            printerName: printerName,
            copies: copies,
            silent: silent,
            paperSize: currentPaperSize // 용지 사이즈 정보 전달
        });
        
        console.log('📥 메인 프로세스 응답:', result);
        
        if (result.success) {
            if (result.message) {
                showStatus(`🖨️ ${result.message}`, 'success');
            } else {
                showStatus('🖨️ 인쇄가 완료되었습니다!', 'success');
            }
            
            // 추가 정보가 있으면 표시
            if (result.printerName) {
                const statusElement = document.getElementById('status');
                if (statusElement) {
                    statusElement.innerHTML += `<br><small>사용 프린터: ${result.printerName}</small>`;
                }
            }
            
            // 인쇄 대화상자가 열린 후 백그라운드로 이동 (1초만 대기)
            setTimeout(() => {
                showStatus('🖨️ 인쇄 대화상자가 열렸습니다. WebPrinter를 백그라운드로 이동합니다.', 'info');
                setTimeout(() => {
                    closeApp();
                }, 500); // 메시지 표시 후 0.5초만 더 대기
            }, 1000);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('❌ 인쇄 실패 (상세):', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        showStatus(`❌ 인쇄 실패: ${error.message || '알 수 없는 오류'}`, 'error');
        elements.printButton.disabled = false;
        
        // 디버깅을 위한 추가 정보
        console.log('🔍 디버깅 정보:', {
            receivedUrls,
            printerName: elements.printerSelect.value,
            printerOptions: Array.from(elements.printerSelect.options).map(opt => opt.value),
            availablePrinters
        });
    }
}

// 앱을 백그라운드로 이동 (완전 종료하지 않음)
function closeApp() {
    console.log('🔄 앱을 백그라운드로 이동합니다...');
    window.electronAPI.hideToBackground();
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