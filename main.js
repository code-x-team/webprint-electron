const { app, Tray, Menu, dialog } = require('electron');
const path = require('path');

// macOS 렌더링 최적화 및 모듈 로딩 안정화
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('js-flags', '--expose-gc');
}

// 프로토콜 호출 관리 변수 추가
let pendingProtocolCall = null;
let isProcessingProtocol = false;
let protocolCallQueue = [];

// 강화된 모듈 해상도 시스템
function setupModulePaths() {
  const possibleNodeModulesPaths = [
    path.join(__dirname, 'node_modules'),
    path.join(process.cwd(), 'node_modules'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'node_modules') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'node_modules') : null
  ].filter(Boolean);
  
  // NODE_PATH 환경변수 설정
  const separator = process.platform === 'win32' ? ';' : ':';
  process.env.NODE_PATH = possibleNodeModulesPaths.join(separator);
  
  // Module.globalPaths에 추가
  if (require('module').globalPaths) {
    possibleNodeModulesPaths.forEach(modulePath => {
      if (!require('module').globalPaths.includes(modulePath)) {
        require('module').globalPaths.push(modulePath);
      }
    });
  }
  
  // Windows 전용 추가 설정
  if (process.platform === 'win32') {
    // 실행 파일 경로 기반 추가
    const execDir = path.dirname(process.execPath);
    const additionalPaths = [
      path.join(execDir, 'resources', 'app', 'node_modules'),
      path.join(execDir, 'resources', 'node_modules'),
      path.join(execDir, '..', 'resources', 'app', 'node_modules')
    ];
    
    additionalPaths.forEach(additionalPath => {
      if (!process.env.NODE_PATH.includes(additionalPath)) {
        process.env.NODE_PATH += separator + additionalPath;
        if (require('module').globalPaths) {
          require('module').globalPaths.push(additionalPath);
        }
      }
    });
  }
  
  console.log('🔧 설정된 모듈 경로들:', process.env.NODE_PATH.split(separator));
}

setupModulePaths();

const { startHttpServer, stopHttpServer, loadSessionData, cleanOldSessions } = require('./modules/server');
const { createPrintWindow, setupIpcHandlers, closeAllWindows } = require('./modules/window');
const { cleanupOldPDFs } = require('./modules/printer');

let tray = null;
let autoUpdater = null;
let server = null;
global.isQuitting = false;

// 불사조 모드 변수
let allowQuit = false;
let watchdogTimer = null;

// electron-updater 조건부 로드
console.log('📦 [Debug] electron-updater 모듈 로드 시도 중...');
try {
  const { autoUpdater: updater } = require('electron-updater');
  autoUpdater = updater;
  console.log('✅ [Debug] electron-updater 모듈 로드 성공');
  console.log('🔍 [Debug] autoUpdater 객체:', typeof autoUpdater);
} catch (error) {
  console.error('❌ [Debug] electron-updater 모듈 로드 실패:', error.message);
  console.log('⚠️ [Debug] Auto-updater를 사용할 수 없습니다');
}

function createTray() {
  try {
    // 플랫폼별 트레이 아이콘 설정
    let iconPath;
    if (process.platform === 'win32') {
      iconPath = path.join(__dirname, 'assets/icon-32.png');
    } else if (process.platform === 'darwin') {
      // macOS는 Template 아이콘 사용 (다크/라이트 모드 자동 적응)
      iconPath = path.join(__dirname, 'assets/iconTemplate.png');
    } else {
      iconPath = path.join(__dirname, 'assets/icon.png');
    }
    
    tray = new Tray(iconPath);
    
    // macOS Template 아이콘 설정
    if (process.platform === 'darwin') {
      tray.setTemplateImage(iconPath);
    }
    
    updateTrayMenu();
    
    tray.setToolTip('WebPrinter - 백그라운드에서 실행 중');
    
    // 모든 기본 동작 방지 및 커스텀 동작 설정
    tray.on('click', (event) => {
      event.preventDefault();
      updateTrayMenu();
      tray.popUpContextMenu();
    });
    
    tray.on('double-click', (event) => {
      event.preventDefault();
      updateTrayMenu();
      tray.popUpContextMenu();
    });
    
    tray.on('right-click', (event) => {
      event.preventDefault();
      updateTrayMenu();
      tray.popUpContextMenu();
    });
    
    // Windows 특정 이벤트 처리
    if (process.platform === 'win32') {
      tray.on('mouse-move', (event) => {
        // 마우스 움직임 시에도 기본 툴팁만 표시
        event.preventDefault();
      });
    }
    
  } catch (error) {
    console.error('트레이 생성 실패:', error);
  }
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  
  // Electron app에서 버전 가져오기
  const appVersion = app.getVersion();
  
  const menuTemplate = [
    {
      label: '📋 WebPrinter v' + appVersion,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '🔄 업데이트 확인',
      click: async () => {
        console.log('🔄 [Debug] 트레이 - 업데이트 확인 버튼 클릭됨');
        try {
          await performUpdateProcess();
          console.log('✅ [Debug] 트레이 - performUpdateProcess 완료');
        } catch (error) {
          console.error('❌ [Debug] 트레이 - performUpdateProcess 실패:', error);
          dialog.showMessageBoxSync(null, {
            type: 'error',
            buttons: ['확인'],
            title: '업데이트 오류',
            message: '업데이트 확인 중 오류가 발생했습니다.',
            detail: error.message
          });
        }
      }
    },
    { type: 'separator' },
    {
      label: '🛑 종료',
      click: () => {
        const choice = dialog.showMessageBoxSync(null, {
          type: 'warning',
          buttons: ['취소', '종료'],
          defaultId: 0,
          title: 'WebPrinter 종료',
          message: '정말로 WebPrinter를 종료하시겠습니까?',
          detail: '종료하면 웹페이지에서 인쇄 기능을 사용할 수 없습니다.'
        });
        
        if (choice === 1) {
          console.log('트레이에서 종료 확인됨');
          performCompleteShutdown();
        }
      }
    }
  ];
  
  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}

async function performUpdateProcess() {
  console.log('🚀 [Debug] performUpdateProcess 함수 시작');
  
  // autoUpdater 상태 확인
  console.log('🔍 [Debug] autoUpdater 상태:', !!autoUpdater);
  if (!autoUpdater) {
    console.log('❌ [Debug] autoUpdater가 없습니다 - 업데이트 불가');
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: '업데이트 기능을 사용할 수 없습니다.'
      });
    }
    return;
  }

  // 환경 확인
  const isDev = process.env.NODE_ENV === 'development';
  const isDefaultApp = process.defaultApp;
  console.log(`🔍 [Debug] 환경 체크: isDev=${isDev}, isDefaultApp=${isDefaultApp}`);

  try {
    console.log('🔍 업데이트 확인 중...');
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: '업데이트를 확인하고 있습니다...'
      });
    }

    // 이벤트 기반 처리를 위한 Promise
    const updateCheckPromise = new Promise((resolve, reject) => {
      let eventHandled = false;

      const onUpdateAvailable = (info) => {
        if (eventHandled) return;
        eventHandled = true;
        console.log('🎯 [Debug] update-available 이벤트 발생:', info);
        resolve({ hasUpdate: true, updateInfo: info });
      };

      const onUpdateNotAvailable = (info) => {
        if (eventHandled) return;
        eventHandled = true;
        console.log('✅ [Debug] update-not-available 이벤트 발생:', info);
        resolve({ hasUpdate: false, updateInfo: info });
      };

      const onError = (error) => {
        if (eventHandled) return;
        eventHandled = true;
        console.error('❌ [Debug] 업데이트 확인 중 에러 이벤트:', error);
        reject(error);
      };

      // 이벤트 리스너 등록
      autoUpdater.once('update-available', onUpdateAvailable);
      autoUpdater.once('update-not-available', onUpdateNotAvailable);
      autoUpdater.once('error', onError);

      // 10초 타임아웃
      setTimeout(() => {
        if (!eventHandled) {
          eventHandled = true;
          autoUpdater.removeListener('update-available', onUpdateAvailable);
          autoUpdater.removeListener('update-not-available', onUpdateNotAvailable);
          autoUpdater.removeListener('error', onError);
          reject(new Error('업데이트 확인 타임아웃'));
        }
      }, 10000);
    });

    // 1단계: 업데이트 확인
    console.log('🔍 [Debug] autoUpdater.checkForUpdates() 호출 시작');
    const updateCheckResult = await autoUpdater.checkForUpdates();
    console.log('📋 [Debug] updateCheckResult 전체:', JSON.stringify(updateCheckResult, null, 2));

    // 이벤트 결과 대기
    const eventResult = await updateCheckPromise;
    console.log('📋 [Debug] 이벤트 결과:', eventResult);

    // 이벤트 기반으로 처리
    if (!eventResult.hasUpdate) {
      console.log('✅ [Debug] update-not-available 이벤트 - 최신 버전입니다');
      const currentVersion = app.getVersion();
      console.log(`📋 이미 최신 버전입니다 (v${currentVersion})`);
      
      // 다이얼로그로 명확하게 알림
      dialog.showMessageBoxSync(null, {
        type: 'info',
        buttons: ['확인'],
        title: 'WebPrinter 업데이트',
        message: '이미 최신 버전입니다.',
        detail: `현재 버전: v${currentVersion}\n\n업데이트가 필요하지 않습니다.`
      });
      
      // 추가로 트레이 풍선 알림도 표시
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'WebPrinter 업데이트',
          content: '이미 최신 버전입니다.'
        });
      }
      return;
    }

    // 업데이트가 있는 경우
    const currentVersion = app.getVersion();
    const newVersion = eventResult.updateInfo.version;
    console.log(`📋 [Debug] 버전 정보:`);
    console.log(`  - 현재 버전: "${currentVersion}"`);
    console.log(`  - 새 버전: "${newVersion}"`);
    console.log(`  - updateInfo:`, JSON.stringify(eventResult.updateInfo, null, 2));
    
    console.log(`📦 새 버전 발견: ${currentVersion} → ${newVersion}`);
    
    // 사용자 확인 (트레이에서 호출된 경우만)
    const choice = dialog.showMessageBoxSync(null, {
      type: 'question',
      buttons: ['취소', '업데이트'],
      defaultId: 1,
      title: 'WebPrinter 업데이트',
      message: `새 버전 ${newVersion}이 사용 가능합니다.`,
      detail: '업데이트를 다운로드하고 설치하시겠습니까?\n앱이 재시작됩니다.'
    });

    if (choice !== 1) {
      console.log('사용자가 업데이트를 취소했습니다');
      return;
    }

    // 2단계: 다운로드
    console.log('📥 업데이트 다운로드 중...');
    
    // 초기 다운로드 시작 알림
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: `버전 ${newVersion} 다운로드 시작...`
      });
    }

    // 다운로드 진행률 표시를 위한 변수
    let lastPercent = 0;
    let lastBalloonTime = 0;

    // 다운로드 진행률 이벤트 리스너 추가
    const progressHandler = (progressObj) => {
      const percent = Math.round(progressObj.percent);
      const speed = (progressObj.bytesPerSecond / 1024 / 1024).toFixed(1); // MB/s
      const total = (progressObj.total / 1024 / 1024).toFixed(1); // MB
      const transferred = (progressObj.transferred / 1024 / 1024).toFixed(1); // MB
      
      console.log(`📥 다운로드 진행률: ${percent}% (${transferred}MB/${total}MB, ${speed}MB/s)`);
      
      // 10% 단위로 또는 2초마다 트레이 알림 업데이트
      const currentTime = Date.now();
      if (percent >= lastPercent + 10 || currentTime - lastBalloonTime > 2000) {
        if (tray && !tray.isDestroyed()) {
          tray.displayBalloon({
            title: 'WebPrinter 업데이트 다운로드',
            content: `진행률: ${percent}% (${transferred}MB/${total}MB)\n속도: ${speed}MB/s`
          });
        }
        lastPercent = percent;
        lastBalloonTime = currentTime;
      }
    };
    
    autoUpdater.on('download-progress', progressHandler);

    // 다운로드 시작
    await autoUpdater.downloadUpdate();

    // 진행률 이벤트 리스너 제거
    autoUpdater.removeListener('download-progress', progressHandler);

    console.log('✅ 업데이트 다운로드 완료');
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: '다운로드 완료! 설치를 준비 중입니다...'
      });
    }

    // 사용자에게 설치 확인
    const installChoice = dialog.showMessageBoxSync(null, {
      type: 'info',
      buttons: ['나중에', '지금 설치'],
      defaultId: 1,
      title: 'WebPrinter 업데이트 설치',
      message: '업데이트 다운로드가 완료되었습니다.',
      detail: `새 버전 ${newVersion}을 설치하시겠습니까?\n\n설치 후 프로그램이 자동으로 재시작됩니다.\n설치 화면이 나타나면 안내에 따라 진행해주세요.`
    });

    if (installChoice === 1) {
      console.log('🚀 사용자가 즉시 설치를 선택했습니다');
      
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'WebPrinter 업데이트',
          content: '설치를 시작합니다. 잠시 후 설치 화면이 나타납니다.'
        });
      }

      // 잠깐 대기 후 설치 시작 (인스톨 화면 표시)
      setTimeout(() => {
        console.log('🔧 업데이트 설치를 시작합니다');
        console.log('📋 [Debug] quitAndInstall 호출: isSilent=false, isForceRunAfter=true');
        
        // 최종 안내 메시지
        if (tray && !tray.isDestroyed()) {
          tray.displayBalloon({
            title: 'WebPrinter 설치 시작',
            content: '프로그램을 종료하고 설치를 시작합니다.\n설치 창이 나타나면 안내에 따라 진행해주세요.'
          });
        }
        
        allowQuit = true;
        global.isQuitting = true;
        
        // 추가 대기 후 설치 시작
        setTimeout(() => {
          console.log('🚀 [Debug] autoUpdater.quitAndInstall() 실행');
          try {
            // isSilent=false: 설치 UI 표시, isForceRunAfter=true: 설치 후 자동 실행
            autoUpdater.quitAndInstall(false, true);
          } catch (error) {
            console.error('❌ [Debug] quitAndInstall 실행 실패:', error);
            
            // 실패 시 대안으로 사일런트 설치
            console.log('🔄 [Debug] 대안으로 사일런트 설치 시도');
            autoUpdater.quitAndInstall(true, true);
          }
        }, 1000);
      }, 2000);
    } else {
      console.log('⏰ 사용자가 나중에 설치하기를 선택했습니다');
      
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'WebPrinter 업데이트',
          content: '업데이트가 준비되었습니다. 다음 실행 시 설치됩니다.'
        });
      }
    }

  } catch (error) {
    console.error('업데이트 프로세스 실패:', error);
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: '업데이트 중 오류가 발생했습니다: ' + error.message
      });
    }
  }
}

function performCompleteShutdown() {
  console.log('🛑 완전 종료 프로세스 시작');
  allowQuit = true;
  global.isQuitting = true;
  
  // 감시자 정리
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  
  // 서버 정리
  if (server) {
    try {
      stopHttpServer();
    } catch (error) {
      console.log('서버 종료 중 오류:', error);
    }
  }
  
  // 트레이 정리
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  
  app.quit();
}

function registerProtocol() {
  const protocolName = 'webprinter';
  
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient(protocolName, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(protocolName);
  }
}

function setupAutoUpdater() {
  console.log('⚙️ [Debug] setupAutoUpdater 함수 시작');
  console.log('🔍 [Debug] autoUpdater:', !!autoUpdater);
  console.log('🔍 [Debug] NODE_ENV:', process.env.NODE_ENV);
  console.log('🔍 [Debug] process.defaultApp:', process.defaultApp);
  
  if (!autoUpdater) {
    console.log('❌ [Debug] autoUpdater 모듈이 로드되지 않았습니다');
    return;
  }
  
  if (process.env.NODE_ENV === 'development' || process.defaultApp) {
    console.log('❌ [Debug] 개발 환경이므로 AutoUpdater를 비활성화합니다');
    return;
  }
  
  try {
    // GitHub 릴리즈 설정
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'code-x-team',
      repo: 'webprint-electron',
      releaseType: 'release'
    });

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    
    // 기본 이벤트 리스너만 등록 (디버깅용)
    autoUpdater.on('checking-for-update', () => {
      console.log('🔍 [Event] checking-for-update');
    });

    autoUpdater.on('before-quit-for-update', () => {
      console.log('🔄 [Event] before-quit-for-update - 앱 종료 준비');
      allowQuit = true;
      global.isQuitting = true;
    });
    
    console.log('✅ 자동 업데이트 시스템 준비 완료 (수동 제어 모드)');
  } catch (error) {
    console.error('❌ 자동 업데이트 설정 실패:', error);
  }
}

function setupAutoLaunch() {
  try {
    // 시작 인수 확인
    const isStartupLaunch = process.argv.includes('--startup');
    const isHidden = process.argv.includes('--hidden');
    const isFirstRun = !app.getLoginItemSettings().wasOpenedAtLogin;
    
    console.log('🚀 시작 모드:', { isStartupLaunch, isHidden, isFirstRun, argv: process.argv });
    
    // 백그라운드 모드 강제 적용 조건
    // 1. 명시적 --hidden, --startup 매개변수
    // 2. 설치 후 첫 실행 (runAfterFinish에서 실행됨)
    if (isHidden || isStartupLaunch || isFirstRun) {
      console.log('🔕 백그라운드 모드 활성화됨');
      global.startupMode = true;
    }
    
    // macOS/Linux용 자동 시작 설정
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      name: 'WebPrinter',
      args: ['--hidden', '--startup']
    });
    
    // Windows용 레지스트리 등록 (보조)
    if (process.platform === 'win32') {
      const path = require('path');
      const { execSync } = require('child_process');
      
      try {
        const exePath = process.execPath;
        const startupArgs = '"' + exePath + '" --hidden --startup';
        
        // 현재 사용자 시작 프로그램에 등록
        execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "WebPrinter" /d "${startupArgs}" /f`, { windowsHide: true });
        console.log('✅ Windows 시작 프로그램 등록 완료');
        
        // Windows 스케줄러에도 등록 (백업)
        try {
          const taskCommand = `schtasks /create /tn "WebPrinter" /tr "${startupArgs}" /sc onlogon /f /rl highest`;
          execSync(taskCommand, { windowsHide: true });
          console.log('✅ Windows 스케줄 작업 등록 완료');
        } catch (taskError) {
          console.log('⚠️ Windows 스케줄 작업 등록 실패:', taskError.message);
        }
        
      } catch (error) {
        console.log('⚠️ Windows 시작 프로그램 등록 실패:', error.message);
      }
    }
    

  } catch (error) {
    console.error('⚠️ 자동 시작 설정 실패:', error.message);
  }
}

// 불사조 모드: 종료 방지 이벤트 리스너
function setupImmortalMode() {
  // 앱 종료 방지
  app.on('before-quit', (event) => {
    if (!allowQuit && !global.isQuitting) {
      console.log('🔥 종료 방지: 백그라운드로 전환');
      event.preventDefault();
      
      // 모든 창 숨기기
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach(window => {
        if (window && !window.isDestroyed()) {
          window.hide();
        }
      });
      
      // macOS dock 숨기기
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
      
      console.log('🔥 백그라운드 모드로 전환됨');
      return false;
    }
  });

  // 윈도우 닫기 방지
  app.on('window-all-closed', (event) => {
    if (!allowQuit && !global.isQuitting) {
      console.log('🔥 모든 창 닫힘 - 백그라운드 유지');
      // event.preventDefault(); // window-all-closed는 preventDefault 없음
      
      // macOS에서도 앱 종료 방지
      if (process.platform === 'darwin') {
        return false;
      }
    }
  });

  // 프로토콜 호출 시 복원
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('🔥 두 번째 인스턴스 실행 시도');
    
    // 백그라운드 서비스 복원
    if (!server) {
      console.log('🔄 백그라운드 서비스 재시작');
      restoreServices();
    }
    
    // 프로토콜 URL 처리
    const protocolUrl = commandLine.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) {
      console.log('🔗 프로토콜 URL 발견:', protocolUrl);
      
      // 프로토콜 큐에 추가하고 순차 처리
      protocolCallQueue.push(protocolUrl);
      processProtocolQueue();
    } else {
      // 프로토콜 없이 앱을 다시 실행한 경우 - 트레이 알림
      console.log('💡 일반 실행 시도 - 이미 실행 중임을 알림');
      if (tray && !tray.isDestroyed()) {
        if (process.platform === 'win32') {
          tray.displayBalloon({
            title: 'WebPrinter',
            content: '이미 실행 중입니다.'
          });
        }
      }
    }
  });

  // macOS에서 프로토콜 처리
  app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('🔥 macOS 프로토콜 호출:', url);
    
    if (!server) {
      restoreServices();
    }
    
    // 프로토콜 큐에 추가하고 순차 처리
    protocolCallQueue.push(url);
    processProtocolQueue();
  });
}

// 프로토콜 큐 처리 함수
async function processProtocolQueue() {
  if (isProcessingProtocol || protocolCallQueue.length === 0) {
    return;
  }
  
  isProcessingProtocol = true;
  
  while (protocolCallQueue.length > 0) {
    const protocolUrl = protocolCallQueue.shift();
    console.log('🔗 [Queue] 프로토콜 처리 시작:', protocolUrl);
    
    try {
      await handleProtocolCall(protocolUrl);
      
      // 각 호출 사이에 약간의 지연을 둠
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error('❌ [Queue] 프로토콜 처리 실패:', error);
    }
  }
  
  isProcessingProtocol = false;
  console.log('✅ [Queue] 프로토콜 큐 처리 완료');
}

// 3단계: 복원 시스템과 감시자
function startWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
  }
  
  watchdogTimer = setInterval(() => {
    if (!allowQuit && !global.isQuitting) {
      // 핵심 서비스들이 살아있는지 확인
      if (!server || !tray || tray.isDestroyed()) {
        console.log('🔄 핵심 서비스 복구 중...');
        restoreServices();
      }
    }
  }, 5000); // 5초마다 체크
  
  console.log('🐕 감시자 시작됨');
}

function restoreServices() {
  try {
    console.log('🔧 서비스 복구 시작...');
    
    // 서버 복구
    if (!server) {
      const httpServer = startHttpServer();
      if (httpServer) {
        server = httpServer;
        console.log('✅ HTTP 서버 복구됨');
      }
    }
    
    // 트레이 복구
    if (!tray || tray.isDestroyed()) {
      createTray();
      console.log('✅ 트레이 복구됨');
    }
    
    // IPC 핸들러 복구
    try {
      setupIpcHandlers();
      console.log('✅ IPC 핸들러 복구됨');
    } catch (error) {
      console.log('⚠️ IPC 핸들러 복구 실패:', error.message);
    }
    
  } catch (error) {
    console.error('❌ 서비스 복구 실패:', error);
  }
}

// 오류 복구 시스템
function setupErrorRecovery() {
  process.on('uncaughtException', (error) => {
    console.error('🚨 예상치 못한 오류:', error);
    
    if (!global.isQuitting && !allowQuit) {
      console.log('🔄 오류 복구 시도...');
      
      // 3초 후 서비스 복구 시도
      setTimeout(() => {
        try {
          restoreServices();
        } catch (restoreError) {
          console.error('❌ 복구 실패:', restoreError);
        }
      }, 3000);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 처리되지 않은 Promise 거부:', reason);
    // 로그만 남기고 계속 실행
  });
}

// 개선된 프로토콜 처리 함수
async function handleProtocolCall(protocolUrl) {
  console.log('🔗 [Debug] ===== 프로토콜 호출 시작 =====');
  console.log('🔗 [Debug] 프로토콜 URL:', protocolUrl);
  console.log('🔗 [Debug] 호출 시각:', new Date().toISOString());
  
  try {
    const parsedUrl = new URL(protocolUrl);
    const action = parsedUrl.hostname;
    const params = Object.fromEntries(parsedUrl.searchParams);
    
    console.log(`🎯 [Debug] 액션: ${action}, 파라미터:`, params);
    
    if (action === 'print') {
      console.log('🖨️ [Debug] print 액션 처리 시작');
      
      // 업데이트 확인 여부 플래그
      let shouldOpenWindow = true;
      
      // 업데이트 확인 (프로토콜 호출 시에만 체크, 개발환경에서는 건너뜀)
      if (autoUpdater && process.env.NODE_ENV !== 'development' && !process.defaultApp) {
        console.log('🔍 [Debug] 프로토콜 호출 - 업데이트 확인 시작');
        
        try {
          const updateCheckResult = await autoUpdater.checkForUpdates();
          console.log('📋 [Debug] 업데이트 확인 결과:', updateCheckResult);
          
          if (updateCheckResult && updateCheckResult.updateInfo) {
            const currentVersion = app.getVersion();
            const newVersion = updateCheckResult.updateInfo.version;
            
            if (currentVersion !== newVersion) {
              console.log('📦 [Debug] 새 버전 발견 - 사용자에게 확인 요청');
              const choice = dialog.showMessageBoxSync(null, {
                type: 'info',
                buttons: ['취소', '확인'],
                defaultId: 1,
                title: 'WebPrinter 업데이트',
                message: '새로운 버전이 있습니다. 업데이트하시겠습니까?',
                detail: `현재 버전: v${currentVersion}\n새 버전: v${newVersion}\n\n업데이트를 진행하시겠습니까?`
              });

              console.log(`👤 [Debug] 사용자 선택: ${choice === 1 ? '확인' : '취소'}`);

              if (choice === 1) {
                // 확인 선택 시 - 인쇄창을 열지 않고 업데이트 프로세스 실행
                console.log('✅ [Debug] 사용자가 업데이트를 선택했습니다');
                shouldOpenWindow = false;
                await performUpdateProcess();
              }
              // 취소 선택 시 - 그냥 인쇄창을 열어줌
              else {
                console.log('❌ [Debug] 사용자가 업데이트를 취소 - 인쇄창을 엽니다');
              }
            } else {
              console.log('✅ [Debug] 이미 최신 버전 - 바로 인쇄창을 엽니다');
            }
          } else {
            console.log('✅ [Debug] 업데이트 없음 - 바로 인쇄창을 엽니다');
          }
        } catch (error) {
          console.error('❌ [Debug] 프로토콜에서 업데이트 확인 실패:', error);
          console.log('⚠️ [Debug] 업데이트 확인 실패했지만 인쇄창을 엽니다');
        }
      } else {
        console.log('⚠️ [Debug] 개발 환경 또는 autoUpdater 없음 - 업데이트 확인 건너뜀');
      }
      
      // 업데이트를 선택하지 않았을 때만 창을 열기
      if (shouldOpenWindow) {
        console.log('🪟 [Debug] 인쇄창 생성 중...');
        console.log('🪟 [Debug] 세션 ID:', params.session);
        const { createPrintWindow } = require('./modules/window');
        const resultSessionId = await createPrintWindow(params.session);
        console.log('✅ [Debug] 인쇄창 생성 완료 - 세션 ID:', resultSessionId);
      } else {
        console.log('⚠️ [Debug] 업데이트 프로세스로 인해 인쇄창을 열지 않음');
      }
      
      
      console.log('🔗 [Debug] ===== 프로토콜 호출 완료 =====');
    } else {
      console.log(`❓ [Debug] 알 수 없는 액션: ${action}`);
    }
  } catch (error) {
    console.error('❌ [Debug] 프로토콜 처리 실패:', error);
    console.error('❌ [Debug] 에러 스택:', error.stack);
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // second-instance 이벤트는 setupImmortalMode()에서 통합 처리됨
  // 중복 방지를 위해 여기서는 별도 리스너를 등록하지 않음

 
app.whenReady().then(async () => {
  try {
    // 새 인스턴스 시작 시 상태 초기화
    allowQuit = false;
    global.isQuitting = false;
    console.log('🔄 새 인스턴스 시작 - 상태 초기화');
    
    console.log('🔧 [Debug] 프로토콜 등록 중...');
    registerProtocol();
    
    console.log('🔧 [Debug] AutoUpdater 설정 중...');
    setupAutoUpdater();
    
    console.log('🔧 [Debug] AutoLaunch 설정 중...');
    setupAutoLaunch();
    
    // 불사조 모드 초기화
    setupImmortalMode();
    setupErrorRecovery();
    
    // ===== 여기에 추가 =====
    // 백그라운드에서 윈도우 미리 준비
    console.log('🪟 백그라운드 윈도우 초기화 중...');
    const { initializeWindows } = require('./modules/window');
    await initializeWindows();
    // =====================
    
    createTray();
    setupIpcHandlers();
    
    server = await startHttpServer();
    loadSessionData();
    cleanOldSessions();
    cleanupOldPDFs();
    
    // 감시자 시작
    startWatchdog();
    
    // 시작 모드에 따른 UI 처리
    if (global.startupMode) {
      console.log('🔕 백그라운드 모드 - 창을 열지 않고 트레이에서만 실행');
      
      // 백그라운드 시작 알림 (선택적)
      if (tray && process.platform === 'win32') {
        tray.displayBalloon({
          iconType: 'info',
          title: 'WebPrinter',
          content: '백그라운드에서 실행되었습니다. 웹페이지에서 인쇄 기능을 사용할 수 있습니다.'
        });
      }
    } else {
      console.log('🖥️ 일반 모드 - 백그라운드에서 대기');
      
      // 프로토콜 호출은 second-instance 이벤트에서만 처리
      // 중복 실행 방지를 위해 초기 실행 시에는 프로토콜 처리하지 않음
      console.log('💡 프로토콜 호출은 second-instance 이벤트에서 처리됩니다');
    }
    
    // 모든 플랫폼에서 백그라운드 실행
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
    
    console.log('✅ WebPrinter가 백그라운드에서 실행 중입니다.');
  } catch (error) {
    console.error('앱 초기화 오류:', error);
    dialog.showErrorBox('WebPrinter 오류', '앱을 시작할 수 없습니다.\n' + error.message);
  }
});

  // open-url 이벤트는 setupImmortalMode()에서 통합 처리됨

  app.on('window-all-closed', () => {});

  app.on('before-quit', (event) => {
    console.log('before-quit 이벤트:', { allowQuit, isQuitting: global.isQuitting });
    
    if (!allowQuit && !global.isQuitting) {
      console.log('🔥 불사조 모드: 종료 방지 활성화');
      event.preventDefault();
      return;
    }
    
    console.log('🛑 앱 종료 진행');
    
    // 종료 시 모든 리소스 정리
    try {
      if (server) {
        stopHttpServer();
      }
      
      if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
      }
      
      if (tray && !tray.isDestroyed()) {
        tray.destroy();
      }
      
      closeAllWindows();
    } catch (error) {
      console.error('앱 종료 중 정리 오류:', error);
    }
  });

  app.on('activate', () => {
    // 백그라운드 전용 앱이므로 activate 시 창을 열지 않음
  });
}