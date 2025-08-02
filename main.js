const { app, Tray, Menu, dialog } = require('electron');
const path = require('path');

// macOS 렌더링 최적화 및 모듈 로딩 안정화
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('js-flags', '--expose-gc');
}

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
try {
  const { autoUpdater: updater } = require('electron-updater');
  autoUpdater = updater;
} catch (error) {
  console.log('Auto-updater not available');
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, process.platform === 'win32' ? 'assets/icon-32.png' : 'assets/icon.png');
    tray = new Tray(iconPath);
    
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
        console.log('업데이트 확인 및 전체 프로세스 시작');
        await performUpdateProcess();
      }
    },
    { type: 'separator' },
    {
      label: '🛑 종료',
      click: () => {
        const { dialog } = require('electron');
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
  if (!autoUpdater) {
    console.log('업데이트 기능을 사용할 수 없습니다');
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: '업데이트 기능을 사용할 수 없습니다.'
      });
    }
    return;
  }

  try {
    console.log('🔍 업데이트 확인 중...');
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: '업데이트를 확인하고 있습니다...'
      });
    }

    // 업데이트 확인
    const updateInfo = await checkUpdateAvailable();
    
    if (!updateInfo) {
      console.log('📋 최신 버전입니다');
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'WebPrinter 업데이트',
          content: '이미 최신 버전입니다.'
        });
      }
      return;
    }
    
    const { currentVersion, newVersion } = updateInfo;
    console.log(`📦 새 버전 발견: ${currentVersion} → ${newVersion}`);
    
    // 사용자 확인 (트레이에서 호출된 경우만)
    const { dialog } = require('electron');
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
    if (tray && !tray.isDestroyed()) {
      tray.displayBalloon({
        title: 'WebPrinter 업데이트',
        content: `버전 ${newVersion} 다운로드 중...`
      });
    }

    // 다운로드 진행률 이벤트 리스너 추가
    const progressHandler = (progressObj) => {
      const percent = Math.round(progressObj.percent);
      console.log(`다운로드 진행률: ${percent}%`);
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
        content: '다운로드 완료. 설치를 시작합니다...'
      });
    }

    // 잠깐 대기 후 설치 및 재시작
    setTimeout(() => {
      console.log('🚀 업데이트 설치 및 재시작');
      allowQuit = true;
      global.isQuitting = true;
      autoUpdater.quitAndInstall();
    }, 2000);

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
  if (!autoUpdater || process.env.NODE_ENV === 'development' || process.defaultApp) {
    console.log('❌ AutoUpdater를 사용할 수 없습니다');
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
    
    // 이벤트 리스너 추가
    autoUpdater.on('error', (error) => {
      console.error('❌ 업데이트 오류:', error);
    });

    autoUpdater.on('checking-for-update', () => {
      console.log('🔍 업데이트 확인 중...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('📦 업데이트 사용 가능:', info.version);
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('✅ 최신 버전 사용 중:', info.version);
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
    console.log('🔥 프로토콜 호출로 앱 재시작/복원');
    
    // 백그라운드 서비스 복원
    if (!server) {
      console.log('🔄 백그라운드 서비스 재시작');
      restoreServices();
    }
    
    // 프로토콜 URL 처리
    const protocolUrl = commandLine.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) {
      handleProtocolCall(protocolUrl);
    }
  });

  // macOS에서 프로토콜 처리
  app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('🔥 macOS 프로토콜 호출:', url);
    
    if (!server) {
      restoreServices();
    }
    
    handleProtocolCall(url);
  });
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

async function checkUpdateAvailable() {
  console.log('🔍 [Debug] checkUpdateAvailable 함수 시작');
  
  if (!autoUpdater) {
    console.log('❌ [Debug] autoUpdater가 없습니다');
    return null;
  }

  if (process.env.NODE_ENV === 'development' || process.defaultApp) {
    console.log('⚠️ [Debug] 개발 환경에서는 업데이트 확인 건너뜀');
    return null;
  }

  try {
    console.log('🔍 [Debug] autoUpdater.checkForUpdates() 호출 중...');
    const updateCheckResult = await autoUpdater.checkForUpdates();
    console.log('📋 [Debug] updateCheckResult:', updateCheckResult);
    
    if (!updateCheckResult) {
      console.log('❌ [Debug] updateCheckResult가 null/undefined');
      return null;
    }

    if (!updateCheckResult.updateInfo) {
      console.log('❌ [Debug] updateCheckResult.updateInfo가 없습니다');
      return null;
    }

    const currentVersion = app.getVersion();
    const newVersion = updateCheckResult.updateInfo.version;
    console.log(`📋 [Debug] 버전 비교: 현재=${currentVersion}, 최신=${newVersion}`);
    
    if (currentVersion === newVersion) {
      console.log('✅ [Debug] 현재 버전이 최신 버전과 동일함');
      return null;
    }
    
    console.log('🎯 [Debug] 새 버전 발견!');
    return { currentVersion, newVersion };
  } catch (error) {
    console.error('❌ [Debug] 업데이트 확인 실패:', error);
    console.error('❌ [Debug] 에러 스택:', error.stack);
    return null;
  }
}

async function handleProtocolCall(protocolUrl) {
  console.log('🔗 [Debug] 프로토콜 호출:', protocolUrl);
  
  try {
    const parsedUrl = new URL(protocolUrl);
    const action = parsedUrl.hostname;
    const params = Object.fromEntries(parsedUrl.searchParams);
    
    console.log(`🎯 [Debug] 액션: ${action}, 파라미터:`, params);
    
    if (action === 'print') {
      console.log('🖨️ [Debug] print 액션 - 업데이트 확인 시작');
      
      // 업데이트 확인
      const updateInfo = await checkUpdateAvailable();
      console.log('📋 [Debug] 업데이트 확인 결과:', updateInfo);
      
      if (updateInfo) {
        console.log('📦 [Debug] 새 버전 발견 - 사용자에게 확인 요청');
        const { dialog } = require('electron');
        const choice = dialog.showMessageBoxSync(null, {
          type: 'info',
          buttons: ['취소', '확인'],
          defaultId: 1,
          title: 'WebPrinter 업데이트',
          message: '새로운 버전이 있습니다. 업데이트하시겠습니까?',
          detail: `현재 버전: v${updateInfo.currentVersion}\n새 버전: v${updateInfo.newVersion}\n\n업데이트를 진행하시겠습니까?`
        });

        console.log(`👤 [Debug] 사용자 선택: ${choice === 1 ? '확인' : '취소'}`);

        if (choice === 1) {
          // 확인 선택 시 - 인쇄창을 열지 않고 업데이트 프로세스 실행
          console.log('✅ [Debug] 사용자가 업데이트를 선택했습니다');
          await performUpdateProcess();
          return;
        }
        // 취소 선택 시 - 그냥 인쇄창을 열어줌
        console.log('❌ [Debug] 사용자가 업데이트를 취소 - 인쇄창을 엽니다');
      } else {
        console.log('✅ [Debug] 업데이트 없음 - 바로 인쇄창을 엽니다');
      }
      
      // 프로토콜 호출시 창 생성/표시
      console.log('🪟 [Debug] 인쇄창 생성 중...');
      const { createPrintWindow } = require('./modules/window');
      await createPrintWindow(params.session);
      console.log('✅ [Debug] 인쇄창 생성 완료');
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
  // second-instance 이벤트는 setupImmortalMode()에서 처리됨
  // 중복 방지를 위해 여기서는 트레이 알림만 처리
  app.on('second-instance', (event, commandLine) => {
    // 두 번째 인스턴스가 실행되면 트레이 아이콘 강조만
    if (tray && !tray.isDestroyed()) {
      if (process.platform === 'win32') {
        tray.displayBalloon({
          title: 'WebPrinter',
          content: '이미 실행 중입니다.'
        });
      }
    }
  });

  app.whenReady().then(async () => {
    try {
      // 새 인스턴스 시작 시 상태 초기화
      allowQuit = false;
      global.isQuitting = false;
      console.log('🔄 새 인스턴스 시작 - 상태 초기화');
      
      registerProtocol();
      setupAutoUpdater();
      setupAutoLaunch();
      
      // 불사조 모드 초기화
      setupImmortalMode();
      setupErrorRecovery();
      
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
        console.log('🖥️ 일반 모드 - 창 표시 가능');
        
        // 프로토콜로 호출된 경우에만 창 열기
        const protocolUrl = process.argv.find(arg => arg.startsWith('webprinter://'));
        if (protocolUrl) {
          handleProtocolCall(protocolUrl);
        } else {
          // 일반 실행도 백그라운드에서 시작 (더 조용한 UX)
          console.log('💡 일반 실행 - 백그라운드에서 대기');
        }
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

  app.on('open-url', (event, protocolUrl) => {
    event.preventDefault();
    handleProtocolCall(protocolUrl);
  });

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