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

// 대기 메시지 표시 함수
function showWaitingMessage(messageData) {
    const { title, message, details } = messageData;
    
    // 프리뷰 영역에 대기 메시지 표시
    const previewFrame = document.getElementById('preview-frame');
    const previewContainer = previewFrame.parentElement;
    
    // 기존 내용 숨기기
    previewFrame.style.display = 'none';
    
    // 대기 메시지 HTML 생성
    const waitingMessageHtml = `
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            text-align: center;
            padding: 20px;
            color: #666;
        ">
            <div style="
                font-size: 48px;
                margin-bottom: 20px;
                animation: pulse 2s infinite;
            ">⏳</div>
            <h2 style="
                font-size: 24px;
                color: #333;
                margin-bottom: 10px;
            ">${title}</h2>
            <p style="
                font-size: 16px;
                color: #666;
                margin-bottom: 10px;
            ">${message}</p>
            <p style="
                font-size: 14px;
                color: #999;
                max-width: 400px;
            ">${details}</p>
        </div>
        <style>
            @keyframes pulse {
                0% { opacity: 0.5; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.1); }
                100% { opacity: 0.5; transform: scale(1); }
            }
        </style>
    `;
    
    // 대기 메시지 컨테이너 생성 또는 업데이트
    let waitingContainer = document.getElementById('waiting-message-container');
    if (!waitingContainer) {
        waitingContainer = document.createElement('div');
        waitingContainer.id = 'waiting-message-container';
        waitingContainer.style.cssText = 'width: 100%; height: 100%; background: #f5f5f5;';
        previewContainer.appendChild(waitingContainer);
    }
    
    waitingContainer.innerHTML = waitingMessageHtml;
    waitingContainer.style.display = 'block';
    
    // 상태 메시지도 업데이트
    showStatus(message, 'info');
}

// Toast 알림 기능
function showToast(message, type = 'info', duration = 3000) {
    // 기존 toast 제거
    const existingToast = document.getElementById('toast-notification');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Toast 컨테이너 생성
    const toast = document.createElement('div');
    toast.id = 'toast-notification';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        max-width: 350px;
        word-wrap: break-word;
        transform: translateX(400px);
        opacity: 0;
        transition: all 0.3s ease;
    `;
    
    // 타입별 색상 설정
    const colors = {
        success: 'linear-gradient(135deg, #28a745, #20c997)',
        error: 'linear-gradient(135deg, #dc3545, #fd7e14)', 
        warning: 'linear-gradient(135deg, #ffc107, #fd7e14)',
        info: 'linear-gradient(135deg, #007bff, #6f42c1)'
    };
    
    toast.style.background = colors[type] || colors.info;
    toast.textContent = message;
    
    // DOM에 추가
    document.body.appendChild(toast);
    
    // 애니메이션으로 표시
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
    }, 10);
    
    // 자동 제거
    setTimeout(() => {
        toast.style.transform = 'translateX(400px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, duration);
    
    // 클릭 시 즉시 제거
    toast.addEventListener('click', () => {
        toast.style.transform = 'translateX(400px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    });
}

// IPC 통신 상태 점검 함수
async function checkIpcCommunication() {
    console.log('🔍 IPC 통신 상태 점검 시작...');
    
    const checks = {
        electronAPI: false,
        getServerInfo: false,
        getPrinters: false,
        getAppVersion: false,
        printUrl: false,
        eventListeners: false,
        totalPassed: 0,
        totalTests: 6
    };
    
    try {
        // 1. electronAPI 객체 존재 확인
        if (typeof window.electronAPI === 'object' && window.electronAPI !== null) {
            checks.electronAPI = true;
            checks.totalPassed++;
            console.log('✅ electronAPI 객체 존재 확인');
        } else {
            console.error('❌ electronAPI 객체가 존재하지 않습니다');
            showToast('❌ IPC 통신 실패: electronAPI 객체 없음', 'error', 5000);
            return checks;
        }
        
        // 2. 서버 정보 API 테스트
        try {
            const serverData = await window.electronAPI.getServerInfo();
            if (serverData && typeof serverData === 'object') {
                checks.getServerInfo = true;
                checks.totalPassed++;
                console.log('✅ getServerInfo API 정상:', serverData);
            }
        } catch (error) {
            console.error('❌ getServerInfo API 실패:', error);
        }
        
        // 3. 프린터 목록 API 테스트
        try {
            const printerResult = await window.electronAPI.getPrinters();
            if (printerResult && typeof printerResult === 'object') {
                checks.getPrinters = true;
                checks.totalPassed++;
                console.log('✅ getPrinters API 정상:', printerResult);
            }
        } catch (error) {
            console.error('❌ getPrinters API 실패:', error);
        }
        
        // 4. 앱 버전 API 테스트
        try {
            const version = await window.electronAPI.getAppVersion();
            if (version && typeof version === 'string') {
                checks.getAppVersion = true;
                checks.totalPassed++;
                console.log('✅ getAppVersion API 정상:', version);
            }
        } catch (error) {
            console.error('❌ getAppVersion API 실패:', error);
        }
        
        // 5. printUrl API 존재 확인 (실제 호출은 안함)
        if (typeof window.electronAPI.printUrl === 'function') {
            checks.printUrl = true;
            checks.totalPassed++;
            console.log('✅ printUrl API 함수 존재 확인');
        } else {
            console.error('❌ printUrl API 함수가 존재하지 않습니다');
        }
        
        // 6. 이벤트 리스너 함수들 존재 확인
        const eventFunctions = ['onServerInfo', 'onUrlsReceived', 'onUpdateAvailable', 'onUpdateDownloaded'];
        const existingFunctions = eventFunctions.filter(fn => typeof window.electronAPI[fn] === 'function');
        
        if (existingFunctions.length === eventFunctions.length) {
            checks.eventListeners = true;
            checks.totalPassed++;
            console.log('✅ 모든 이벤트 리스너 함수 존재 확인');
        } else {
            console.error('❌ 일부 이벤트 리스너 함수 누락:', {
                expected: eventFunctions,
                found: existingFunctions
            });
        }
        
        // 결과 분석 및 Toast 표시
        const successRate = (checks.totalPassed / checks.totalTests * 100).toFixed(0);
        
        if (checks.totalPassed === checks.totalTests) {
            showToast(`✅ IPC 통신 정상 작동 (${successRate}%)`, 'success', 4000);
            console.log('🎉 모든 IPC 통신 테스트 통과!');
        } else if (checks.totalPassed >= checks.totalTests * 0.7) {
            showToast(`⚠️ IPC 통신 부분 작동 (${successRate}%)`, 'warning', 5000);
            console.warn('⚠️ 일부 IPC 기능에 문제가 있습니다');
        } else {
            showToast(`❌ IPC 통신 심각한 문제 (${successRate}%)`, 'error', 6000);
            console.error('❌ IPC 통신에 심각한 문제가 있습니다');
        }
        
        // 상세 결과 로그
        console.log('📊 IPC 통신 점검 결과:', {
            성공률: `${successRate}%`,
            통과: checks.totalPassed,
            전체: checks.totalTests,
            세부결과: {
                'electronAPI 객체': checks.electronAPI ? '✅' : '❌',
                'getServerInfo': checks.getServerInfo ? '✅' : '❌',
                'getPrinters': checks.getPrinters ? '✅' : '❌',
                'getAppVersion': checks.getAppVersion ? '✅' : '❌',
                'printUrl 함수': checks.printUrl ? '✅' : '❌',
                '이벤트 리스너': checks.eventListeners ? '✅' : '❌'
            }
        });
        
    } catch (error) {
        console.error('🚨 IPC 통신 점검 중 예외 발생:', error);
        showToast('🚨 IPC 통신 점검 중 오류 발생', 'error', 5000);
    }
    
    return checks;
}

// IPC 통신 실패 시 복구 시도 함수
async function attemptIpcRecovery() {
    console.log('🔧 IPC 통신 복구 시도 중...');
    showToast('🔧 IPC 통신 복구 시도 중...', 'warning', 3000);
    
    try {
        // 페이지 새로고침으로 IPC 재연결 시도
        setTimeout(() => {
            window.location.reload();
        }, 3000);
        
        return true;
    } catch (error) {
        console.error('IPC 복구 실패:', error);
        showToast('❌ IPC 복구 실패 - 앱을 다시 시작해주세요', 'error', 10000);
        return false;
    }
}

// 실시간 IPC 통신 상태 모니터링
function startIpcMonitoring() {
    let consecutiveFailures = 0;
    const maxFailures = 3;
    
    setInterval(async () => {
        try {
            // 주기적으로 간단한 API 호출로 연결 상태 확인
            await window.electronAPI.getAppVersion();
            consecutiveFailures = 0; // 성공 시 실패 카운터 리셋
        } catch (error) {
            consecutiveFailures++;
            console.warn(`IPC 연결 확인 실패 (${consecutiveFailures}/${maxFailures}):`, error);
            
            if (consecutiveFailures >= maxFailures) {
                showToast('🚨 IPC 연결이 끊어졌습니다!', 'error', 8000);
                attemptIpcRecovery();
            }
        }
    }, 10000); // 10초마다 체크
}

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 print-preview.js 초기화 시작...');
    
    // IPC 통신 상태 점검 (우선 실행)
    const ipcStatus = await checkIpcCommunication();
    
    // IPC 통신이 정상적이면 모니터링 시작
    if (ipcStatus.totalPassed >= ipcStatus.totalTests * 0.7) {
        startIpcMonitoring();
        console.log('📡 IPC 통신 모니터링 시작됨');
    }
    
    initializeEventListeners();
    await loadPrinters();
    await initializeUpdater();
    
    // 메인 프로세스에서 서버 정보 이벤트 리스너 등록
    window.electronAPI.onServerInfo((info) => {
        serverInfo = info;
        displayServerInfo();
        showToast('📡 서버 정보 수신 완료', 'info', 2000);
    });
    
    // URL 정보 수신 이벤트 리스너 등록
    console.log('🎧 URL 수신 이벤트 리스너 등록 중...');
    window.electronAPI.onUrlsReceived((urlData) => {
        console.log('📨 IPC 메시지 수신됨!', urlData);
        receivedUrls = urlData;
        handleUrlsReceived();
        showToast('📄 URL 정보 수신 완료', 'success', 2000);
    });
    
    // 세션 복구 이벤트 리스너 등록
    window.electronAPI.onSessionRestored((sessionInfo) => {
        console.log('🔄 세션 복구 정보 수신됨!', sessionInfo);
        handleSessionRestored(sessionInfo);
        showToast('🔄 세션 복구 완료', 'info', 2000);
    });
    
    // 대기 메시지 이벤트 리스너 등록
    window.electronAPI.onShowWaitingMessage((messageData) => {
        console.log('⏳ 대기 메시지 표시:', messageData);
        showWaitingMessage(messageData);
    });
    
    // Toast 메시지 이벤트 리스너 등록
    window.electronAPI.onShowToast((toastData) => {
        const { message, type, duration } = toastData;
        showToast(message, type, duration);
    });
    
    console.log('✅ 이벤트 리스너 등록 완료');
});

// 업데이트 기능 초기화
async function initializeUpdater() {
    try {
        // 앱 버전 표시
        const version = await window.electronAPI.getAppVersion();
        console.log('현재 앱 버전:', version);
        showToast(`📱 WebPrinter v${version} 실행됨`, 'info', 2500);
        
        // 자동 업데이트 이벤트 리스너 등록
        window.electronAPI.onUpdateAvailable((info) => {
            console.log('🆕 업데이트 발견:', info);
            showToast(`🆕 새 버전 발견: v${info.version || 'latest'}`, 'info', 4000);
            if (info.autoDownload) {
                showStatus(`🆕 v${info.version} 업데이트 발견! 자동 다운로드를 시작합니다...`, 'info');
            } else {
                showStatus(`새 버전 ${info.version}이 발견되었습니다.`, 'info');
            }
        });
        
        window.electronAPI.onUpdateProgress((progress) => {
            const percent = Math.round(progress.percent);
            showStatus(`📥 업데이트 다운로드 중... ${percent}% (${Math.round(progress.transferred / 1024 / 1024)}MB / ${Math.round(progress.total / 1024 / 1024)}MB)`, 'info');
            if (percent % 25 === 0) { // 25% 간격으로 toast 표시
                showToast(`📥 업데이트 다운로드 ${percent}%`, 'info', 1500);
            }
            console.log(`다운로드 진행률: ${percent}%`);
        });
        
        window.electronAPI.onUpdateDownloaded((info) => {
            console.log('✅ 업데이트 다운로드 완료:', info);
            showToast('✅ 업데이트 다운로드 완료!', 'success', 4000);
            
            if (info.userChoice) {
                // 사용자 선택 가능한 업데이트 알림
                showStatus(`✅ v${info.version} 업데이트 준비 완료!`, 'success');
                
                // 업데이트 선택 UI 생성
                const statusContainer = document.querySelector('.status-container');
                if (statusContainer) {
                    const updateChoice = document.createElement('div');
                    updateChoice.id = 'update-choice';
                    updateChoice.style.cssText = `
                        margin-top: 15px;
                        padding: 15px;
                        background: linear-gradient(135deg, #e8f5e8, #c8e6c9);
                        border: 1px solid #4caf50;
                        border-radius: 8px;
                        text-align: center;
                    `;
                    
                    updateChoice.innerHTML = `
                        <div style="margin-bottom: 10px; font-weight: 600; color: #2e7d32;">
                            🚀 새 버전이 준비되었습니다!
                        </div>
                        <div style="margin-bottom: 15px; font-size: 14px; color: #388e3c;">
                            • 지금 재시작: 즉시 새 버전으로 업데이트<br>
                            • 나중에: 다음번 실행 시 자동 적용
                        </div>
                        <div>
                            <button id="install-now-btn" style="
                                background: linear-gradient(135deg, #4caf50, #388e3c);
                                color: white;
                                border: none;
                                padding: 10px 20px;
                                border-radius: 6px;
                                font-weight: 600;
                                margin-right: 10px;
                                cursor: pointer;
                            ">🔄 지금 재시작</button>
                            <button id="install-later-btn" style="
                                background: linear-gradient(135deg, #ff9800, #f57c00);
                                color: white;
                                border: none;
                                padding: 10px 20px;
                                border-radius: 6px;
                                font-weight: 600;
                                cursor: pointer;
                            ">⏰ 나중에</button>
                        </div>
                    `;
                    
                    // 기존 업데이트 선택 UI 제거
                    const existing = document.getElementById('update-choice');
                    if (existing) {
                        existing.remove();
                    }
                    
                    statusContainer.appendChild(updateChoice);
                    
                    // 버튼 이벤트 리스너
                    document.getElementById('install-now-btn').addEventListener('click', async () => {
                        showStatus('🔄 업데이트를 설치하고 재시작합니다...', 'info');
                        showToast('🔄 업데이트 설치 중...', 'info', 3000);
                        updateChoice.remove();
                        
                        try {
                            await window.electronAPI.installUpdate();
                        } catch (error) {
                            console.error('업데이트 설치 실패:', error);
                            showStatus('업데이트 설치에 실패했습니다.', 'error');
                            showToast('❌ 업데이트 설치 실패', 'error', 4000);
                        }
                    });
                    
                    document.getElementById('install-later-btn').addEventListener('click', () => {
                        showStatus('📋 다음번 실행 시 자동으로 업데이트됩니다.', 'info');
                        showToast('📋 업데이트가 예약되었습니다', 'info', 3000);
                        updateChoice.remove();
                    });
                }
            } else {
                // 기존 자동 재시작 방식 (호환성)
                showStatus(`✅ v${info.version} 다운로드 완료! 다음 실행 시 적용됩니다.`, 'success');
            }
        });
        
        window.electronAPI.onUpdateNotAvailable(() => {
            console.log('✅ 최신 버전 사용 중');
            showToast('✅ 최신 버전 사용 중', 'success', 2000);
            // 최신 버전일 때는 별도 알림 표시하지 않음 (콘솔에만 기록)
        });
        
        window.electronAPI.onUpdateError((error) => {
            console.warn('⚠️ 업데이트 확인 실패:', error.message);
            showToast('⚠️ 업데이트 확인 실패', 'warning', 3000);
            // 업데이트 오류는 사용자에게 표시하지 않음 (백그라운드 작업)
        });
        
    } catch (error) {
        console.error('업데이트 초기화 실패:', error);
        showToast('⚠️ 업데이트 시스템 초기화 실패', 'warning', 3000);
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
    
    // 대기 메시지 숨기기
    const waitingContainer = document.getElementById('waiting-message-container');
    if (waitingContainer) {
        waitingContainer.style.display = 'none';
    }
    
    // 프리뷰 프레임 다시 표시
    const previewFrame = document.getElementById('preview-frame');
    if (previewFrame) {
        previewFrame.style.display = 'block';
    }
    
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
    
    // Silent 인쇄 정보 표시 (로그만)
    if (typeof receivedUrls.silentPrint === 'boolean') {
        console.log(`ℹ️ 웹에서 전달된 Silent 설정: ${receivedUrls.silentPrint} (무시됨 - 일반 인쇄만 지원)`);
    }
    
    // 인쇄 영역 선택자 표시
    if (receivedUrls.printSelector) {
        console.log(`🎯 인쇄 영역: ${receivedUrls.printSelector}`);
        if (receivedUrls.printSelector === '#print_wrap') {
            showToast(`🎯 #print_wrap 영역만 인쇄됩니다`, 'info', 3000);
        } else {
            showToast(`🎯 선택적 인쇄: ${receivedUrls.printSelector}`, 'info', 3000);
        }
        
        // 서버 디스플레이에 선택자 정보 추가
        if (elements.serverDisplay) {
            const currentHTML = elements.serverDisplay.innerHTML;
            elements.serverDisplay.innerHTML = currentHTML + `<div>인쇄 영역: ${receivedUrls.printSelector}</div>`;
        }
    } else {
        // 기본값도 #print_wrap 표시
        console.log('🎯 기본 인쇄 영역: #print_wrap');
        showToast('🎯 #print_wrap 영역만 인쇄됩니다', 'info', 3000);
        
        if (elements.serverDisplay) {
            const currentHTML = elements.serverDisplay.innerHTML;
            elements.serverDisplay.innerHTML = currentHTML + `<div>인쇄 영역: #print_wrap</div>`;
        }
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

// 세션 복구 처리
function handleSessionRestored(sessionInfo) {
    const { sessionId, restoredFromSaved, dataAge } = sessionInfo;
    
    if (restoredFromSaved) {
        // 저장된 세션에서 복구된 경우
        showStatus(`🔄 이전 세션이 복구되었습니다! (${dataAge} 생성)`, 'info');
        
        // 복구 알림을 상태 표시 영역에 추가
        setTimeout(() => {
            const statusContainer = document.querySelector('.status-container');
            if (statusContainer) {
                const restoreNotice = document.createElement('div');
                restoreNotice.id = 'restore-notice';
                restoreNotice.style.cssText = `
                    margin-top: 10px;
                    padding: 12px;
                    background: linear-gradient(135deg, #e3f2fd, #bbdefb);
                    border: 1px solid #2196f3;
                    border-radius: 8px;
                    font-size: 14px;
                    color: #1565c0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                `;
                
                restoreNotice.innerHTML = `
                    <span style="font-size: 16px;">🔄</span>
                    <div>
                        <strong>세션 복구됨</strong><br>
                        이전에 설정한 URL과 용지 크기가 자동으로 복원되었습니다.<br>
                        <small>데이터 생성 시간: ${dataAge}</small>
                    </div>
                `;
                
                // 기존 알림이 있으면 제거
                const existing = document.getElementById('restore-notice');
                if (existing) {
                    existing.remove();
                }
                
                statusContainer.appendChild(restoreNotice);
                
                // 5초 후 자동으로 숨기기
                setTimeout(() => {
                    if (restoreNotice.parentNode) {
                        restoreNotice.style.opacity = '0';
                        restoreNotice.style.transition = 'opacity 0.5s ease';
                        setTimeout(() => {
                            restoreNotice.remove();
                        }, 500);
                    }
                }, 5000);
            }
        }, 1000);
    } else {
        // 현재 세션 데이터 사용
        console.log('✅ 현재 세션 데이터 사용 중:', sessionId);
    }
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
    showToast('🖨️ 프린터 목록 확인 중...', 'info', 2000);
    
    try {
        const result = await window.electronAPI.getPrinters();
        
        if (result.success) {
            availablePrinters = result.printers;
            updatePrinterSelect();
            showStatus(`프린터 ${availablePrinters.length}개를 찾았습니다.`, 'success');
            showToast(`✅ 프린터 ${availablePrinters.length}개 발견`, 'success', 2500);
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('프린터 로드 실패:', error);
        showStatus('프린터 목록을 불러올 수 없습니다.', 'error');
        showToast('❌ 프린터 목록 로드 실패', 'error', 4000);
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



// 인쇄 중복 실행 방지 플래그
let isPrinting = false;

// 인쇄 실행
async function executePrint() {
    // 중복 실행 방지
    if (isPrinting) {
        showToast('⚠️ 이미 인쇄가 진행 중입니다', 'warning', 3000);
        console.warn('⚠️ 인쇄 중복 실행 방지');
        return;
    }
    
    // 필수 정보 확인
    if (!receivedUrls.printUrl) {
        showToast('❌ 인쇄할 URL이 없습니다', 'error', 5000);
        return;
    }

    const printerName = elements.printerSelect.value;
    const copies = parseInt(elements.copiesInput.value) || 1;
    const silent = false; // 기본값 설정 (일반 인쇄만 사용)
    
    console.log(`🖨️ 인쇄 실행 준비: copies=${copies}, printer=${printerName}`);
    
    // 인쇄 플래그 설정
    isPrinting = true;
    
    // 버튼 비활성화
    if (elements.printButton) {
        elements.printButton.disabled = true;
        elements.printButton.textContent = '🔄 인쇄 중...';
    }
    
    // 인쇄 전 IPC 통신 상태 재확인
    console.log('🔍 인쇄 전 IPC 통신 상태 재확인...');
    showToast('🔍 인쇄 시스템 점검 중...', 'info', 2000);
    
    try {
        // 필수 API들이 정상 작동하는지 확인
        await window.electronAPI.getAppVersion();
        await window.electronAPI.getPrinters();
        
        if (!printerName) {
            showToast('⚠️ 프린터를 선택해주세요', 'warning', 3000);
            showStatus('프린터를 선택해주세요.', 'error');
            return;
        }
        
        const printUrl = receivedUrls.printUrl || receivedUrls.previewUrl;
        
        if (!printUrl) {
            showToast('❌ 인쇄할 URL이 없습니다', 'error', 3000);
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
        
        showToast('🖨️ 인쇄 요청 전송 중...', 'info', 3000);
        showStatus('🖨️ 웹페이지 로딩 및 프린트 준비 중...', 'info');
        
        // 진행 상태를 단계별로 표시
        setTimeout(() => {
            showStatus('📄 페이지 로딩 중...', 'info');
        }, 500);
        
        setTimeout(() => {
            showStatus('⏳ DOM 완전 로드 대기 중...', 'info');
        }, 2000);
        
        setTimeout(() => {
            showStatus('🔧 프린트 옵션 설정 중...', 'info');
        }, 4000);
        
        setTimeout(() => {
            showStatus('🚀 프린트 대화상자 열기...', 'info');
        }, 5000);
        
        try {
            console.log('📤 Electron 직접 프린트 요청 전송 중...');
            const result = await window.electronAPI.printUrl({
                url: printUrl,
                printerName: printerName,
                copies: copies,
                paperSize: currentPaperSize, // 용지 사이즈 정보 전달
                printSelector: receivedUrls.printSelector // 선택적 인쇄 영역 정보 전달
            });
            
            console.log('📥 Electron 직접 프린트 응답:', result);
            
            if (result.success) {
                console.log('✅ 인쇄 작업이 성공적으로 시작되었습니다:', result);
                showToast('🖨️ 인쇄 작업이 시작되었습니다!', 'success', 4000);
                
                // 성공 정보 표시
                const statusElement = document.getElementById('status');
                if (statusElement) {
                    statusElement.innerHTML = `
                        <strong>✅ 인쇄 시작 완료</strong><br>
                        🖨️ 프린터: ${result.printerName}<br>
                        📄 복사본: ${result.copies}매<br>
                        📄 용지: ${result.paperSize}
                    `;
                    if (result.printSelector) {
                        statusElement.innerHTML += `<br><small>🎯 인쇄 영역: ${result.printSelector}</small>`;
                    }
                }
                
                // 인쇄 시작 후 창 숨기기 (1초 후)
                setTimeout(() => {
                    closeApp();
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
            
            showToast(`❌ 인쇄 실패: ${error.message}`, 'error', 5000);
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
        
    } catch (ipcError) {
        console.error('❌ IPC 통신 실패:', ipcError);
        showToast('❌ IPC 통신 오류 - 앱을 다시 시작해주세요', 'error', 6000);
        showStatus('❌ 시스템 통신 오류가 발생했습니다.', 'error');
        elements.printButton.disabled = false;
        
        // IPC 복구 시도
        attemptIpcRecovery();
    } finally {
        // 인쇄 플래그 리셋
        isPrinting = false;
        
        // 버튼 상태 복원
        if (elements.printButton) {
            elements.printButton.disabled = false;
            elements.printButton.textContent = '🖨️ 인쇄하기';
        }
        
        console.log('🔄 인쇄 프로세스 정리 완료');
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