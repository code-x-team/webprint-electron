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
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '📋 WebPrinter 상태',
        enabled: false
      },
      {
        label: '✅ 백그라운드에서 실행 중',
        enabled: false
      },
      { type: 'separator' },
      {
        label: '🔄 재시작',
        click: () => {
          console.log('트레이에서 재시작');
          allowQuit = true;
          global.isQuitting = true;
          app.relaunch();
          app.quit();
        }
      },
      {
        label: '🛑 완전 종료',
        click: () => {
          console.log('트레이에서 완전 종료');
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
          
          app.quit();
        }
      }
    ]);
    
    tray.setToolTip('WebPrinter - 백그라운드에서 실행 중');
    tray.setContextMenu(contextMenu);
  } catch (error) {
    console.error('트레이 생성 실패:', error);
  }
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
  if (!autoUpdater || process.env.NODE_ENV === 'development' || process.defaultApp) return;
  
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    
    // 업데이트 확인
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('업데이트 확인 실패:', err);
      });
    }, 3000);
    
    // 주기적 업데이트 확인
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('업데이트 확인 실패:', err);
      });
    }, 30 * 60 * 1000);
    
    autoUpdater.on('update-downloaded', () => {
      if (tray && !tray.isDestroyed()) {
        tray.displayBalloon({
          title: 'WebPrinter 업데이트',
          content: '새 버전이 다운로드되었습니다. 재시작 시 적용됩니다.'
        });
      }
    });
    
    autoUpdater.on('error', (error) => {
      console.log('업데이트 오류:', error);
    });
  } catch (error) {
    console.log('자동 업데이트 설정 실패:', error);
  }
}

function setupAutoLaunch() {
  try {
    // 시작 인수 확인
    const isStartupLaunch = process.argv.includes('--startup');
    const isHidden = process.argv.includes('--hidden');
    
    console.log('🚀 시작 모드:', { isStartupLaunch, isHidden, argv: process.argv });
    
    // 백그라운드 모드 강제 적용 조건
    if (isHidden || isStartupLaunch) {
      console.log('🔕 백그라운드 모드 활성화됨');
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
    
    // 시작 시 숨김 모드로 실행
    if (isStartupLaunch || isHidden) {
      global.startupMode = true;
      console.log('🔕 숨김 모드로 시작됨');
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

async function handleProtocolCall(protocolUrl) {
  try {
    const parsedUrl = new URL(protocolUrl);
    const action = parsedUrl.hostname;
    const params = Object.fromEntries(parsedUrl.searchParams);
    
    if (action === 'print') {
      // 프로토콜 호출시 창 생성/표시
      const { createPrintWindow } = require('./modules/window');
      await createPrintWindow(params.session);
    }
  } catch (error) {
    console.error('프로토콜 처리 실패:', error);
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const protocolUrl = commandLine.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) {
      handleProtocolCall(protocolUrl);
    }
    // 두 번째 인스턴스가 실행되면 트레이 아이콘 강조
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
    if (!global.isQuitting) {
      event.preventDefault();
    } else {
      stopHttpServer();
      if (tray && !tray.isDestroyed()) {
        tray.destroy();
      }
      closeAllWindows();
    }
  });

  app.on('activate', () => {
    // 백그라운드 전용 앱이므로 activate 시 창을 열지 않음
  });
}