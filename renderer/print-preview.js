// 전역 상태
let serverInfo = null;
let receivedUrls = {};
let currentPaperSize = null;
let availablePrinters = [];
let isPrinting = false;

// Toast 알림 시스템
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    
    const colors = {
        success: 'linear-gradient(135deg, #28a745, #20c997)',
        error: 'linear-gradient(135deg, #dc3545, #fd7e14)',
        warning: 'linear-gradient(135deg, #ffc107, #fd7e14)',
        info: 'linear-gradient(135deg, #007bff, #6f42c1)'
    };
    
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type]};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 400px;
        font-weight: 500;
        font-size: 14px;
        line-height: 1.5;
        transform: translateX(400px);
        transition: transform 0.3s ease;
        cursor: pointer;
    `;
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 10);
    
    toast.addEventListener('click', () => {
        toast.style.transform = 'translateX(400px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    });
    
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.transform = 'translateX(400px)';
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }
    }, duration);
}

// IPC 통신 상태 점검
async function checkIpcCommunication() {
    console.log('🔍 IPC 통신 상태 점검 시작...');
    
    const checks = {
        electronAPI: false,
        getServerInfo: false,
        getPrinters: false,
        getAppVersion: false,
        printUrl: false,
        eventListeners: false,
        totalTests: 6,
        totalPassed: 0
    };
    
    // 1. electronAPI 객체 확인
    if (typeof window.electronAPI === 'object' && window.electronAPI !== null) {
        checks.electronAPI = true;
        checks.totalPassed++;
        console.log('✅ electronAPI 객체 존재 확인');
    } else {
        console.error('❌ electronAPI 객체가 존재하지 않습니다');
        showToast('❌ IPC 통신 실패: electronAPI 객체 없음', 'error', 5000);
        return checks;
    }
    
    // 2. getServerInfo API 테스트
    try {
        const serverInfo = await Promise.race([
            window.electronAPI.getServerInfo(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        if (serverInfo && typeof serverInfo === 'object') {
            checks.getServerInfo = true;
            checks.totalPassed++;
            console.log('✅ getServerInfo API 정상');
        }
    } catch (error) {
        console.error('❌ getServerInfo API 실패:', error);
    }
    
    // 3. getPrinters API 테스트
    try {
        const result = await Promise.race([
            window.electronAPI.getPrinters(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        if (result && typeof result === 'object') {
            checks.getPrinters = true;
            checks.totalPassed++;
            console.log('✅ getPrinters API 정상');
        }
    } catch (error) {
        console.error('❌ getPrinters API 실패:', error);
    }
    
    // 4. getAppVersion API 테스트
    try {
        const version = await Promise.race([
            window.electronAPI.getAppVersion(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        if (version) {
            checks.getAppVersion = true;
            checks.totalPassed++;
            console.log('✅ getAppVersion API 정상');
        }
    } catch (error) {
        console.error('❌ getAppVersion API 실패:', error);
    }
    
    // 5. printUrl 함수 존재 확인
    if (typeof window.electronAPI.printUrl === 'function') {
        checks.printUrl = true;
        checks.totalPassed++;
        console.log('✅ printUrl 함수 존재 확인');
    } else {
        console.error('❌ printUrl 함수가 없습니다');
    }
    
    // 6. 이벤트 리스너 함수들 확인
    const listeners = ['onServerInfo', 'onUrlsReceived', 'onShowWaitingMessage', 'onLoadingComplete'];
    let allListenersExist = true;
    
    for (const listener of listeners) {
        if (typeof window.electronAPI[listener] !== 'function') {
            allListenersExist = false;
            console.error(`❌ ${listener} 이벤트 리스너가 없습니다`);
        }
    }
    
    if (allListenersExist) {
        checks.eventListeners = true;
        checks.totalPassed++;
        console.log('✅ 모든 이벤트 리스너 확인됨');
    }
    
    // 결과 요약
    const successRate = Math.round((checks.totalPassed / checks.totalTests) * 100);
    console.log(`📊 IPC 통신 점검 결과: ${checks.totalPassed}/${checks.totalTests} (${successRate}%)`);
    
    if (checks.totalPassed === checks.totalTests) {
        console.log('✅ 모든 IPC 통신 테스트 통과!');
        showToast(`✅ IPC 통신 정상 작동 (${successRate}%)`, 'success', 4000);
    } else if (checks.totalPassed >= checks.totalTests * 0.7) {
        console.warn('⚠️ IPC 통신 부분적으로 작동 중');
        showToast(`⚠️ IPC 통신 부분 작동 (${successRate}%)`, 'warning', 5000);
    } else {
        console.error('❌ IPC 통신에 심각한 문제가 있습니다');
        showToast(`❌ IPC 통신 심각한 문제 (${successRate}%)`, 'error', 6000);
    }
    
    return checks;
}

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 WebPrinter 초기화 시작');
    
    UIManager.init();
    UIManager.showLoading(true);
    
    // IPC 통신 점검
    const ipcStatus = await checkIpcCommunication();
    
    if (!ipcStatus.electronAPI) {
        UIManager.completeLoading();
        UIManager.showStatus('IPC 통신 오류: 앱을 다시 시작해주세요', 'error');
        return;
    }
    
    // 1단계: 애플리케이션 초기화
    await new Promise(resolve => setTimeout(resolve, 300));
    UIManager.updateLoadingStep('init', '애플리케이션을 초기화하고 있습니다...');
    
    // IPC 핸들러 설정
    IPCHandler.init({
        onServerInfo: handleServerInfo,
        onUrlsReceived: handleUrlsReceived,
        onLoadingComplete: () => UIManager.completeLoading(),
        onSessionChanged: handleSessionChanged,
        onShowWaitingMessage: handleShowWaitingMessage
    });
    
    initializeEventListeners();
    
    // 2단계: 서버 연결 확인
    await new Promise(resolve => setTimeout(resolve, 200));
    UIManager.updateLoadingStep('server', '서버와 연결을 확인하고 있습니다...');
    
    try {
        const serverInfo = await Promise.race([
            IPCHandler.getServerInfo(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('서버 응답 시간 초과')), 5000))
        ]);
        console.log('서버 정보:', serverInfo);
        
        if (serverInfo) {
            handleServerInfo(serverInfo);
            
            // 세션 데이터 확인
            if (serverInfo.session) {
                console.log('기존 세션 확인:', serverInfo.session);
                const sessionData = await Promise.race([
                    IPCHandler.getSessionData(serverInfo.session),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('세션 데이터 시간 초과')), 3000))
                ]);
                if (sessionData) {
                    console.log('기존 세션 데이터 발견');
                    handleUrlsReceived(sessionData);
                }
            }
        }
    } catch (error) {
        console.error('서버 정보 가져오기 실패:', error);
        showToast('⚠️ 서버 연결 실패: ' + error.message, 'warning', 3000);
    }
    
    // 3단계: 프린터 목록 로드
    await new Promise(resolve => setTimeout(resolve, 200));
    UIManager.updateLoadingStep('printers', '사용 가능한 프린터를 검색하고 있습니다...');
    await loadPrinters();
    
    // 4단계: 준비 완료
    await new Promise(resolve => setTimeout(resolve, 200));
    UIManager.updateLoadingStep('ready', '모든 준비가 완료되었습니다!');
    
    setTimeout(() => {
        IPCHandler.requestShowWindow();
        UIManager.completeLoading();
        showToast('✅ WebPrinter 준비 완료', 'success', 2000);
    }, 500);
    
    // IPC 모니터링 시작
    startIpcMonitoring();
});

// IPC 모니터링
let consecutiveFailures = 0;

function startIpcMonitoring() {
    console.log('📡 IPC 통신 모니터링 시작됨');
    
    setInterval(async () => {
        try {
            await window.electronAPI.getAppVersion();
            if (consecutiveFailures > 0) {
                console.log('✅ IPC 통신 복구됨');
                showToast('✅ 연결 복구됨', 'success', 2000);
            }
            consecutiveFailures = 0;
        } catch (error) {
            consecutiveFailures++;
            console.warn(`⚠️ IPC 통신 실패 (${consecutiveFailures}회)`);
            
            if (consecutiveFailures >= 3) {
                console.error('❌ IPC 통신 3회 연속 실패');
                showToast('🔧 연결 복구 시도 중...', 'warning', 3000);
                attemptIpcRecovery();
            }
        }
    }, 10000); // 10초마다 체크
}

// IPC 복구 시도
async function attemptIpcRecovery() {
    console.log('🔧 IPC 복구 시도 시작');
    
    try {
        // 서버 정보 재요청
        const serverInfo = await IPCHandler.getServerInfo();
        if (serverInfo) {
            consecutiveFailures = 0;
            showToast('✅ 연결이 복구되었습니다', 'success', 3000);
            return;
        }
    } catch (error) {
        console.error('복구 실패:', error);
    }
    
    // 복구 실패 시 페이지 새로고침
    showToast('🔄 페이지를 새로고침합니다...', 'info', 2000);
    setTimeout(() => {
        window.location.reload();
    }, 2000);
}

// 이벤트 리스너 설정
function initializeEventListeners() {
    UIManager.elements.refreshPrintersBtn.addEventListener('click', loadPrinters);
    UIManager.elements.printButton.addEventListener('click', executePrint);
    UIManager.elements.printerSelect.addEventListener('change', updateUI);
}

// 서버 정보 처리
function handleServerInfo(info) {
    serverInfo = info;
    UIManager.updateServerInfo(info);
}

// 세션 변경 처리
function handleSessionChanged(data) {
    console.log('세션 변경됨:', data.session);
    showToast('🔄 새 인쇄 작업', 'info', 2000);
}

// 대기 메시지 처리
function handleShowWaitingMessage(messageData) {
    console.log('대기 메시지 수신:', messageData);
    if (messageData && messageData.message) {
        UIManager.showStatus(messageData.message, 'info');
    }
}

// URL 수신 처리
function handleUrlsReceived(urlData) {
    console.log('📥 URL 데이터 수신:', urlData);
    receivedUrls = urlData;
    
    if (urlData.paperSize) {
        currentPaperSize = urlData.paperSize;
        UIManager.displayPaperSize(currentPaperSize);
    }
    
    if (urlData.previewUrl || urlData.printUrl) {
        const url = urlData.previewUrl || urlData.printUrl;
        UIManager.showPreview(url);
        UIManager.showStatus('미리보기 로드 중...', 'info');
        showToast('📄 인쇄 데이터 수신됨', 'success', 2000);
    }
    
    updateUI();
}

// 프린터 목록 로드
async function loadPrinters() {
    UIManager.showStatus('프린터 목록을 불러오는 중...', 'info');
    showToast('🖨️ 프린터 목록 확인 중...', 'info', 2000);
    
    try {
        const result = await IPCHandler.getPrinters();
        
        if (result.success) {
            availablePrinters = result.printers;
            UIManager.updatePrinterList(availablePrinters);
            UIManager.showStatus(`프린터 ${availablePrinters.length}개를 찾았습니다.`, 'success');
            showToast(`✅ 프린터 ${availablePrinters.length}개 발견`, 'success', 2500);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        UIManager.showStatus('프린터 목록을 불러올 수 없습니다.', 'error');
        showToast('❌ 프린터 목록 로드 실패', 'error', 4000);
        
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
    console.log('🖨️ 인쇄 실행 시작');
    console.log('현재 상태:', { isPrinting, receivedUrls, currentPaperSize });
    
    if (isPrinting) {
        console.log('이미 인쇄 중입니다');
        return;
    }
    
    if (!receivedUrls || (!receivedUrls.printUrl && !receivedUrls.previewUrl)) {
        showToast('❌ 인쇄할 데이터가 없습니다', 'error', 3000);
        return;
    }
    
    isPrinting = true;
    UIManager.setPrintButtonLoading(true);
    showToast('🔍 인쇄 시스템 점검 중...', 'info', 2000);
    
    try {
        const printUrl = receivedUrls.printUrl || receivedUrls.previewUrl;
        
        if (!printUrl || !currentPaperSize) {
            throw new Error('인쇄 정보가 부족합니다');
        }
        
        const outputType = UIManager.getSelectedOutputType();
        const rotate180 = UIManager.isRotate180Checked();
        
        console.log('인쇄 매개변수:', {
            url: printUrl,
            paperSize: currentPaperSize,
            outputType: outputType,
            rotate180: rotate180,
            printerName: UIManager.elements.printerSelect.value
        });
        
        UIManager.showStatus(outputType === 'pdf' ? 'PDF 생성 중...' : '인쇄 중...', 'info');
        showToast('🖨️ 인쇄 요청 전송 중...', 'info', 3000);
        
        const result = await IPCHandler.printUrl({
            url: printUrl,
            printerName: UIManager.elements.printerSelect.value,
            copies: 1, // 고정값 1매
            paperSize: currentPaperSize,
            printSelector: receivedUrls.printSelector || '.print_wrap',
            silent: true,
            outputType: outputType,
            rotate180: rotate180
        });
        
        console.log('인쇄 결과:', result);
        
        if (result.success) {
            if (outputType === 'pdf') {
                UIManager.showStatus('PDF 미리보기가 열렸습니다!', 'success');
                showToast('✅ PDF 미리보기가 열렸습니다!', 'success', 4000);
            } else {
                const message = result.message || '프린터로 전송되었습니다!';
                UIManager.showStatus(message, 'success');
                showToast(`✅ ${message}`, 'success', 4000);
            }
            
            // 성공 시 창 닫기 처리
            if (result.shouldClose) {
                console.log('작업 완료, 백그라운드로 전환');
                setTimeout(() => {
                    IPCHandler.hideToBackground();
                }, 2000);
            }
        } else {
            throw new Error(result.error || '알 수 없는 오류가 발생했습니다');
        }
    } catch (error) {
        console.error('인쇄 오류:', error);
        UIManager.showStatus(`출력 실패: ${error.message}`, 'error');
        showToast(`❌ 출력 실패: ${error.message}`, 'error', 5000);
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