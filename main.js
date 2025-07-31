const { app, BrowserWindow, ipcMain, protocol, Tray, Menu } = require('electron');
const path = require('path');
const url = require('url');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron'); 

let printWindow = null;
let httpServer = null;
let serverPort = null;
let currentSession = null;
let receivedUrls = {};
let tray = null;
let isQuitting = false;

// 세션 데이터 저장 경로
const sessionDataPath = path.join(os.homedir(), '.webprinter-sessions.json');

// 세션 데이터 저장 (영구 저장소)
function saveSessionData() {
  try {
    const sessionData = {
      lastSaved: new Date().toISOString(),
      currentSession: currentSession,
      receivedUrls: receivedUrls
    };
    
    fs.writeFileSync(sessionDataPath, JSON.stringify(sessionData, null, 2));
    console.log('💾 세션 데이터 저장 완료:', Object.keys(receivedUrls).length, '개 세션');
  } catch (error) {
    console.warn('⚠️ 세션 데이터 저장 실패:', error.message);
  }
}

// 세션 데이터 복구
function loadSessionData() {
  try {
    if (!fs.existsSync(sessionDataPath)) {
      console.log('📂 저장된 세션 데이터가 없습니다.');
      return;
    }
    
    const data = fs.readFileSync(sessionDataPath, 'utf8');
    const sessionData = JSON.parse(data);
    
    // 24시간 이내 데이터만 복구
    const savedTime = new Date(sessionData.lastSaved);
    const now = new Date();
    const hoursDiff = (now - savedTime) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      console.log('🕒 저장된 세션 데이터가 24시간 이상 경과하여 무시됩니다.');
      fs.unlinkSync(sessionDataPath); // 오래된 파일 삭제
      return;
    }
    
    // 데이터 복구
    receivedUrls = sessionData.receivedUrls || {};
    const sessionCount = Object.keys(receivedUrls).length;
    
    if (sessionCount > 0) {
      console.log('🔄 세션 데이터 복구 완료:', sessionCount, '개 세션');
      
      // 각 세션의 상세 정보 출력
      Object.keys(receivedUrls).forEach(sessionId => {
        const urls = receivedUrls[sessionId];
        console.log(`📋 세션 ${sessionId}: preview=${!!urls.previewUrl}, print=${!!urls.printUrl}, size=${urls.paperSize?.width}x${urls.paperSize?.height}mm`);
      });
    } else {
      console.log('📂 복구할 세션 데이터가 없습니다.');
    }
  } catch (error) {
    console.warn('⚠️ 세션 데이터 복구 실패:', error.message);
    // 손상된 파일 삭제
    try {
      fs.unlinkSync(sessionDataPath);
    } catch (e) {
      // 무시
    }
  }
}

// 오래된 세션 정리
function cleanOldSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24시간
  let cleanedCount = 0;
  
  Object.keys(receivedUrls).forEach(sessionId => {
    const sessionData = receivedUrls[sessionId];
    if (sessionData.timestamp && (now - sessionData.timestamp) > maxAge) {
      delete receivedUrls[sessionId];
      cleanedCount++;
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`🧹 오래된 세션 ${cleanedCount}개 정리 완료`);
    saveSessionData(); // 정리 후 저장
  }
}

// 언인스톨 감지 및 정리 함수들
function setupUninstallDetection() {
  // 언인스톨 감지 상태
  let failureCount = 0;
  const maxFailures = 3;
  
  // 3분마다 앱 실행 파일이 존재하는지 확인 (더 빠른 감지)
  const detectionInterval = setInterval(() => {
    try {
      const appPath = process.execPath;
      const parentDir = path.dirname(appPath);
      
      // 개발 모드에서는 체크하지 않음
      if (process.defaultApp || process.env.NODE_ENV === 'development') {
        return;
      }
      
      // 실행 파일이나 주요 디렉토리가 삭제되었는지 확인
      if (!fs.existsSync(appPath) || !fs.existsSync(parentDir)) {
        failureCount++;
        console.log(`🚨 앱 파일 감지 실패 (${failureCount}/${maxFailures})`);
        
        if (failureCount >= maxFailures) {
          console.log('🚨 앱이 언인스톨된 것으로 확인됨');
          clearInterval(detectionInterval);
          cleanupAndExit('언인스톨 감지');
        }
        return;
      }
      
      // 패키지 리소스 확인 (프로덕션 빌드인 경우)
      if (!process.defaultApp && process.resourcesPath) {
        const resourcesExist = fs.existsSync(process.resourcesPath);
        if (!resourcesExist) {
          failureCount++;
          console.log(`🚨 앱 리소스 감지 실패 (${failureCount}/${maxFailures})`);
          
          if (failureCount >= maxFailures) {
            console.log('🚨 앱 리소스가 삭제된 것으로 확인됨');
            clearInterval(detectionInterval);
            cleanupAndExit('리소스 삭제 감지');
          }
          return;
        }
      }
      
      // 정상 상태면 카운터 리셋
      if (failureCount > 0) {
        console.log('✅ 앱 파일 정상 감지됨 - 카운터 리셋');
        failureCount = 0;
      }
      
    } catch (error) {
      console.warn('⚠️ 언인스톨 감지 체크 오류:', error.message);
      // 오류 발생 시에도 카운터 증가
      failureCount++;
      
      if (failureCount >= maxFailures) {
        console.log('🚨 반복적인 오류로 인한 정리 시작');
        clearInterval(detectionInterval);
        cleanupAndExit('반복 오류 감지');
      }
    }
  }, 3 * 60 * 1000); // 3분마다 체크
  
  console.log('🔍 언인스톨 자동 감지 시스템 활성화 (3분 간격, 3회 실패 시 정리)');
}

function cleanupAndExit(reason = '수동 종료') {
  console.log(`📴 앱 완전 종료 시작... (사유: ${reason})`);
  
  // 재진입 방지
  if (global.isCleaningUp) {
    console.log('⚠️ 이미 정리 중입니다.');
    return;
  }
  global.isCleaningUp = true;
  
  try {
    // 1. 시작 프로그램에서 제거
    app.setLoginItemSettings({
      openAtLogin: false,
      openAsHidden: false
    });
    console.log('✅ 시작 프로그램에서 제거 완료');
    
    // Windows 레지스트리에서도 제거
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      exec('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "WebPrinter" /f', (error) => {
        if (!error) console.log('✅ 레지스트리에서 시작 프로그램 제거 완료');
      });
    }
    
    // 2. 세션 데이터 정리
    if (fs.existsSync(sessionDataPath)) {
      try {
        fs.unlinkSync(sessionDataPath);
        console.log('✅ 세션 데이터 정리 완료');
      } catch (e) {
        console.warn('⚠️ 세션 데이터 삭제 실패:', e.message);
      }
    }
    
    // 3. HTTP 서버 정리
    if (httpServer) {
      stopHttpServer();
      console.log('✅ HTTP 서버 정리 완료');
    }
    
    // 4. 트레이 정리
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      tray = null;
      console.log('✅ 시스템 트레이 정리 완료');
    }
    
    // 5. 모든 창 강제 종료
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    });
    printWindow = null;
    console.log('✅ 모든 창 정리 완료');
    
    // 6. IPC 핸들러 정리
    ipcMain.removeAllListeners();
    console.log('✅ IPC 핸들러 정리 완료');
    
  } catch (error) {
    console.error('⚠️ 정리 중 오류 발생:', error.message);
  }
  
  // 6. 완전 종료
  isQuitting = true;
  console.log('🔚 WebPrinter 완전 종료');
  app.quit();
  
  // 강제 종료 (마지막 수단)
  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

// 시스템 트레이 생성 (개선된 버전)
function createTray() {
  try {
    let iconPath;
    
    // 플랫폼별 아이콘 경로 설정
    if (process.platform === 'win32') {
      // Windows - 여러 경로 시도 (ico 우선, 그다음 png)
      const possiblePaths = [
        path.join(__dirname, 'icon-32.ico'),
        path.join(__dirname, 'icon.ico'),
        path.join(__dirname, 'icon-32.png'),  
        path.join(__dirname, 'icon.png'),
        path.join(process.resourcesPath, 'icon-32.ico'),
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'icon-32.png'),
        path.join(process.resourcesPath, 'icon.png')
      ];
      
      iconPath = possiblePaths.find(p => {
        try {
          const exists = require('fs').existsSync(p);
          if (exists) {
            console.log('✅ 트레이 아이콘 발견:', p);
          }
          return exists;
        } catch {
          return false;
        }
      });
      
      if (!iconPath) {
        console.warn('⚠️ 적절한 트레이 아이콘을 찾을 수 없음');
        console.log('📁 현재 디렉토리:', __dirname);
        console.log('📂 사용 가능한 파일들:', require('fs').readdirSync(__dirname).filter(f => f.includes('icon')));
        // 기본값으로 첫 번째 경로 사용
        iconPath = possiblePaths[2]; // icon-32.png
      }
      
    } else if (process.platform === 'linux') {
      iconPath = path.join(__dirname, 'icon.png');
    } else {
      // macOS는 트레이 아이콘 생성하지 않음 (Dock 사용)
      console.log('🍎 macOS - Dock 아이콘 사용, 트레이 아이콘 생성 안함');
      return;
    }
    
    console.log('🎯 최종 트레이 아이콘 경로:', iconPath);
    
    // Tray 생성 시도
    try {
      tray = new Tray(iconPath);
      console.log('✅ 트레이 객체 생성 성공');
    } catch (trayError) {
      console.error('❌ 트레이 객체 생성 실패:', trayError.message);
      
      // 대체 아이콘으로 재시도
      const fallbackIcon = path.join(__dirname, 'icon.png');
      if (require('fs').existsSync(fallbackIcon) && fallbackIcon !== iconPath) {
        console.log('🔄 대체 아이콘으로 재시도:', fallbackIcon);
        try {
          tray = new Tray(fallbackIcon);
          console.log('✅ 대체 아이콘으로 트레이 생성 성공');
        } catch (fallbackError) {
          console.error('❌ 대체 아이콘으로도 실패:', fallbackError.message);
          throw fallbackError;
        }
      } else {
        throw trayError;
      }
    }
          const contextMenu = Menu.buildFromTemplate([
        {
          label: '🔄 앱 재시작',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'question',
              title: 'WebPrinter 재시작',
              message: 'WebPrinter를 재시작하시겠습니까?',
              detail: '모든 세션이 초기화됩니다.',
              buttons: ['재시작', '취소'],
              defaultId: 0,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) {
                app.relaunch();
                cleanupAndExit('사용자 재시작');
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: '🛑 종료',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'question',
              title: 'WebPrinter 종료',
              message: 'WebPrinter를 종료하시겠습니까?',
              detail: '백그라운드 서비스가 중지됩니다.',
              buttons: ['종료', '취소'],
              defaultId: 0,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) {
                console.log('🛑 사용자가 트레이에서 종료를 선택함');
                isQuitting = true; // 종료 플래그 설정
                
                // 트레이 즉시 정리
                if (tray && !tray.isDestroyed()) {
                  tray.destroy();
                  tray = null;
                  console.log('✅ 트레이 즉시 정리 완료');
                }
                
                // HTTP 서버 정리
                if (httpServer) {
                  stopHttpServer();
                  console.log('✅ HTTP 서버 정리 완료');
                }
                
                console.log('📴 앱 종료 중...');
                app.quit();
                
                // 강제 종료 (마지막 수단)
                setTimeout(() => {
                  console.log('🔚 강제 종료 실행');
                  process.exit(0);
                }, 3000);
              }
            });
          }
        }
      ]);
      
      tray.setToolTip('WebPrinter - 우클릭으로 메뉴 열기 | 더블클릭으로 창 열기');
      tray.setContextMenu(contextMenu);
      
      // 트레이 클릭 이벤트들
      tray.on('click', () => {
        console.log('🖱️ 트레이 아이콘 클릭됨');
      });
      
      tray.on('right-click', () => {
        console.log('🖱️ 트레이 아이콘 우클릭됨 - 컨텍스트 메뉴 표시');
      });
      
      // 트레이 더블클릭 시 창 열기
      tray.on('double-click', () => {
        console.log('🖱️ 트레이 아이콘 더블클릭됨 - 창 열기');
        if (printWindow) {
          printWindow.show();
          printWindow.focus();
        } else {
          createPrintWindow();
        }
      });
      
      // 트레이가 실제로 표시되는지 확인
      if (tray && !tray.isDestroyed()) {
        console.log('✅ 시스템 트레이 생성 완료 (개선된 메뉴)');
        console.log('💡 사용법: 트레이 아이콘을 우클릭하면 메뉴가 나타납니다');
        console.log('💡 종료방법: 트레이 우클릭 → "백그라운드 종료" 또는 "완전 종료"');
        
        // 5초 후 서버 상태와 함께 알림 표시
        setTimeout(() => {
          const serverStatus = httpServer && httpServer.listening ? 
            `서버 실행 중: http://localhost:${serverPort}` : 
            '서버 시작 대기 중...';
          
          tray.displayBalloon({
            iconType: 'info',
            title: 'WebPrinter 백그라운드 실행 중',
            content: `${serverStatus}\n트레이 아이콘 우클릭으로 메뉴 확인`
          });
        }, 5000);
      } else {
        console.error('❌ 트레이 객체가 생성되었지만 파괴된 상태');
      }
    } catch (error) {
      console.warn('⚠️ 시스템 트레이 생성 실패:', error.message);
    }
  }

// 프로토콜 핸들러 등록 (강화)
function registerProtocol() {
  const protocolName = 'webprinter';
  
  try {
    let registrationSuccess = false;
    
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        registrationSuccess = app.setAsDefaultProtocolClient(protocolName, process.execPath, [path.resolve(process.argv[1])]);
        console.log(`🔗 프로토콜 핸들러 등록 (개발 모드): ${registrationSuccess ? '성공' : '실패'}`);
      }
    } else {
      registrationSuccess = app.setAsDefaultProtocolClient(protocolName);
      console.log(`🔗 프로토콜 핸들러 등록: ${registrationSuccess ? '성공' : '실패'}`);
      
      // Windows에서 추가 레지스트리 등록 시도
      if (process.platform === 'win32' && !registrationSuccess) {
        console.log('📝 Windows 레지스트리에 수동으로 프로토콜 등록 시도...');
        const { exec } = require('child_process');
        const appPath = process.execPath.replace(/\\/g, '\\\\');
        
        const commands = [
          `reg add "HKCR\\webprinter" /ve /d "URL:WebPrinter Protocol" /f`,
          `reg add "HKCR\\webprinter" /v "URL Protocol" /d "" /f`,
          `reg add "HKCR\\webprinter\\DefaultIcon" /ve /d "${appPath},0" /f`,
          `reg add "HKCR\\webprinter\\shell\\open\\command" /ve /d "\\"${appPath}\\" \\"%1\\"" /f`
        ];
        
        commands.forEach(cmd => {
          exec(cmd, (error) => {
            if (error) {
              console.warn(`⚠️ 레지스트리 명령 실패: ${cmd}`);
            } else {
              console.log(`✅ 레지스트리 명령 성공: ${cmd}`);
              registrationSuccess = true;
            }
          });
        });
      }
      
      // 등록 상태 확인
      setTimeout(() => {
        const isDefault = app.isDefaultProtocolClient(protocolName);
        console.log(`📋 기본 프로토콜 클라이언트 최종 상태: ${isDefault ? '등록됨' : '등록 안됨'}`);
        
        if (!isDefault && process.platform === 'win32') {
          console.warn('⚠️ 프로토콜 등록 실패 - 관리자 권한으로 재시도가 필요할 수 있습니다.');
        }
      }, 2000);
      
      // 시스템에 등록된 프로토콜 핸들러 정보 표시
      if (process.platform === 'darwin') {
        console.log(`💡 테스트 URL: webprinter://print?session=test`);
        console.log(`💡 터미널에서 테스트: open "webprinter://print?session=test"`);
      }
    }
  } catch (error) {
    console.error('❌ 프로토콜 핸들러 등록 실패:', error);
  }
}

// HTTP 서버 시작
function startHttpServer() {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    
    // CORS 설정
    expressApp.use(cors({
      origin: '*',
      credentials: true
    }));
    
    expressApp.use(express.json({ limit: '10mb' }));
    
    // URL 정보 전송 엔드포인트
    expressApp.post('/send-urls', (req, res) => {
      try {
        const sessionId = req.body.session;
        const previewUrl = req.body.preview_url;
        const printUrl = req.body.print_url;
        
        if (!sessionId) {
          return res.status(400).json({ error: 'Session ID required' });
        }
        
        if (!previewUrl && !printUrl) {
          return res.status(400).json({ error: 'At least one URL required' });
        }
        
        // 용지 사이즈 정보 추출 (웹에서 반드시 전달해야 함)
        const paperWidth = parseFloat(req.body.paper_width);
        const paperHeight = parseFloat(req.body.paper_height);
        const paperSize = req.body.paper_size || 'Custom';
        const printSelector = req.body.print_selector || '#print_wrap'; // 기본값: #print_wrap
        
        // 용지 사이즈 검증 (완화된 버전)
        if (isNaN(paperWidth) || isNaN(paperHeight)) {
          console.error('❌ 용지 사이즈가 숫자가 아님:', { paperWidth, paperHeight });
          console.error('❌ 원본 데이터:', { paper_width: req.body.paper_width, paper_height: req.body.paper_height });
          return res.status(400).json({ 
            error: 'paper_width와 paper_height는 숫자여야 합니다.',
            received: { paper_width: req.body.paper_width, paper_height: req.body.paper_height }
          });
        }
        
        if (paperWidth <= 0 || paperHeight <= 0) {
          console.error('❌ 용지 사이즈가 0 이하:', { paperWidth, paperHeight });
          return res.status(400).json({ 
            error: '용지 크기는 양수여야 합니다.',
            received: { paperWidth, paperHeight }
          });
        }
        
        // 용지 크기 범위 검증 (경고만 출력, 중단하지 않음)
        const minSize = 5; // 최소 5mm (완화)
        const maxSize = 3000; // 최대 3000mm (완화)
        
        if (paperWidth < minSize || paperHeight < minSize) {
          console.warn('⚠️ 용지 사이즈가 작음 (계속 진행):', { paperWidth, paperHeight, minSize });
        }
        
        if (paperWidth > maxSize || paperHeight > maxSize) {
          console.warn('⚠️ 용지 사이즈가 큼 (계속 진행):', { paperWidth, paperHeight, maxSize });
        }
        
        console.log('✅ 용지 크기 검증 통과:', { paperWidth, paperHeight });
        
        // CSS 선택자 기본 검증 (보안 목적)
        if (printSelector && printSelector !== '#print_wrap') {
          // #print_wrap이 아닌 다른 선택자는 보안 검증
          const dangerousPatterns = [
            /javascript:/i,
            /expression\s*\(/i,
            /url\s*\(/i,
            /<script/i,
            /on[a-z]+\s*=/i
          ];
          
          const isDangerous = dangerousPatterns.some(pattern => pattern.test(printSelector));
          if (isDangerous) {
            console.error('❌ 보안상 위험한 선택자:', printSelector);
            return res.status(400).json({ 
              error: 'Invalid selector: contains potentially dangerous content',
              received: { printSelector }
            });
          }
          
          console.log(`🎯 커스텀 인쇄 영역 선택자: ${printSelector}`);
        } else {
          console.log('🎯 기본 인쇄 영역: #print_wrap');
        }
        
        console.log(`📏 웹에서 전달받은 용지 사이즈: ${paperWidth}mm × ${paperHeight}mm (${paperSize})`);
        
        const urlData = {
          paperSize: {
            name: paperSize,
            width: paperWidth,
            height: paperHeight
          },
          printSelector: printSelector  // 인쇄 영역 선택자 저장
        };
        
        if (previewUrl) {
          urlData.previewUrl = previewUrl;
        }
        
        if (printUrl) {
          urlData.printUrl = printUrl;
        }
        
        // 세션에 URL과 용지 정보 저장 (타임스탬프 포함)
        urlData.timestamp = Date.now();
        urlData.receivedAt = new Date().toISOString();
        receivedUrls[sessionId] = urlData;
        
        // 세션 데이터 영구 저장
        saveSessionData();
        
        console.log(`URL 정보 수신 완료 - 세션: ${sessionId}`);
        console.log('미리보기 URL:', urlData.previewUrl || '없음');
        console.log('인쇄 URL:', urlData.printUrl || '없음');
        console.log('용지 사이즈:', urlData.paperSize);
        
        // 미리보기 창이 있으면 URL 로드 알림
        console.log(`🔍 실시간 IPC 전송 조건 확인:`);
        console.log(`- printWindow 존재: ${!!printWindow}`);
        console.log(`- currentSession: ${currentSession}`);
        console.log(`- 요청 sessionId: ${sessionId}`);
        console.log(`- 세션 일치: ${currentSession === sessionId}`);
        
        if (printWindow && !printWindow.isDestroyed() && currentSession === sessionId) {
          // 렌더러가 준비될 때까지 대기 후 전송
          if (printWindow.webContents.isLoading()) {
            console.log('⏳ 렌더러 로딩 중 - 로드 완료 후 전송');
            printWindow.webContents.once('did-finish-load', () => {
              setTimeout(() => {
                if (printWindow && !printWindow.isDestroyed()) {
                  console.log('✅ 실시간 IPC 메시지 전송: urls-received');
                  printWindow.webContents.send('urls-received', urlData);
                }
              }, 500);
            });
          } else {
            console.log('✅ 즉시 IPC 메시지 전송: urls-received');
            printWindow.webContents.send('urls-received', urlData);
          }
        } else {
          console.log('⚠️ IPC 메시지 전송 조건 불충족 - 나중에 전송됩니다');
        }
        
        res.json({ 
          success: true, 
          message: 'URLs received successfully',
          session: sessionId,
          paperSize: urlData.paperSize
        });
        
      } catch (error) {
        console.error('URL 정보 처리 오류:', error);
        res.status(500).json({ error: 'URL processing failed' });
      }
    });
    
    // 서버 상태 확인 엔드포인트
    expressApp.get('/status', (req, res) => {
      const packageInfo = require('./package.json');
      res.json({ 
        status: 'running', 
        session: currentSession,
        version: packageInfo.version,
        name: packageInfo.name
      });
    });

    // 버전 정보 전용 엔드포인트
    expressApp.get('/version', (req, res) => {
      const packageInfo = require('./package.json');
      res.json({
        version: packageInfo.version,
        name: packageInfo.name,
        description: packageInfo.description,
        author: packageInfo.author,
        homepage: `https://github.com/code-x-team/webprint-electron`
      });
    });
    
    // 사용 가능한 포트 찾기 (18731-18740 범위)
    const PORT_RANGE_START = 18731;
    const PORT_RANGE_END = 18740;
    let portToTry = PORT_RANGE_START;
    
    // 포트 점유 프로세스 확인 및 종료 시도 (Windows)
    const checkAndKillPortProcess = async (port) => {
      if (process.platform === 'win32') {
        const { exec } = require('child_process');
        return new Promise((resolve) => {
          // 포트를 사용하는 프로세스 찾기
          exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
            if (stdout) {
              const lines = stdout.trim().split('\n');
              lines.forEach(line => {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') {
                  console.log(`⚠️ 포트 ${port}를 사용하는 프로세스 발견 (PID: ${pid})`);
                  // WebPrinter 프로세스인지 확인 후 종료
                  exec(`wmic process where ProcessId=${pid} get Name`, (err, procName) => {
                    if (procName && procName.toLowerCase().includes('webprint')) {
                      console.log(`🔧 이전 WebPrinter 프로세스 종료 시도 (PID: ${pid})`);
                      exec(`taskkill /f /pid ${pid}`, () => {
                        setTimeout(resolve, 1000); // 종료 대기
                      });
                    } else {
                      resolve();
                    }
                  });
                }
              });
            } else {
              resolve();
            }
          });
        });
      }
      return Promise.resolve();
    };
    
    const tryPort = async (port) => {
      // 포트 사용 중인 프로세스 확인 및 정리
      await checkAndKillPortProcess(port);
      
      const server = expressApp.listen(port, 'localhost', () => {
        serverPort = server.address().port;
        httpServer = server;
        console.log(`✅ HTTP 서버 시작됨: http://localhost:${serverPort}`);
        resolve(server);
      });
      
      server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE' && port < PORT_RANGE_END) {
          console.log(`⚠️ 포트 ${port} 사용 중, ${port + 1} 시도`);
          await tryPort(port + 1);
        } else if (err.code === 'EADDRINUSE' && port >= PORT_RANGE_END) {
          console.error(`❌ 모든 포트 (${PORT_RANGE_START}-${PORT_RANGE_END})가 사용 중입니다.`);
          reject(new Error('사용 가능한 포트가 없습니다'));
        } else {
          reject(err);
        }
      });
    };
    
    tryPort(portToTry);
  });
}

// HTTP 서버 중지
function stopHttpServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    serverPort = null;
    console.log('HTTP 서버 중지됨');
  }
}

// URL에서 매개변수 파싱
function parseProtocolUrl(protocolUrl) {
  try {
    const parsedUrl = new URL(protocolUrl);
    const action = parsedUrl.hostname;
    const params = {};
    
    parsedUrl.searchParams.forEach((value, key) => {
      params[key] = decodeURIComponent(value);
    });
    
    return { action, params };
  } catch (error) {
    console.error('URL 파싱 실패:', error);
    return null;
  }
}

// 세션 ID 생성
function generateSessionId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// 인쇄 미리보기 창 생성
async function createPrintWindow(sessionId = null, isForced = false) {
  // 기존 창이 있고 숨겨져 있으면 재사용
  if (printWindow && !printWindow.isDestroyed()) {
    console.log('🔄 기존 창 재사용 - 로딩 상태로 복원');
    // 즉시 표시하지 않고, 렌더러에서 로딩 준비 완료 신호를 받은 후 표시
    
    // 세션 ID만 업데이트
    if (sessionId) {
      currentSession = sessionId;
    }
    
    // 기존 창에 로딩 재시작 신호 전송
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('restart-loading', {
        reason: 'window_reused',
        session: currentSession
      });
      console.log('🔄 기존 창에 로딩 재시작 신호 전송');
    }
    
    // 서버 정보 다시 전송
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.webContents.send('server-info', {
          port: serverPort,
          session: currentSession
        });
        
        // 기존 창 재사용 시 로딩 완료 신호 전송
        setTimeout(() => {
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.webContents.send('loading-complete', {
              reason: 'window_reused',
              message: '기존 창 재사용 완료'
            });
            console.log('🏁 로딩 완료 신호 전송 완료 (창 재사용)');
          }
        }, 300);
      }
    }, 500);
    
    return;
  }
  
  // 기존 창이 파괴된 상태면 정리
  if (printWindow && printWindow.isDestroyed()) {
    printWindow = null;
  }

  // 세션 ID가 없으면 새로 생성
  if (!sessionId) {
    sessionId = generateSessionId();
  }
  currentSession = sessionId;

  // HTTP 서버가 실행 중이 아니면 시작
  if (!httpServer) {
    try {
      await startHttpServer();
    } catch (error) {
      console.error('HTTP 서버 시작 실패:', error);
      return;
    }
  }

  printWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'WebPrinter - 인쇄 미리보기',
    show: false, // 깜박거림 방지를 위해 false 유지
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f5', // 로딩 중 배경색 설정
    webSecurity: false // 웹 콘텐츠 로딩 성능 향상
  });

  // 인쇄 UI 로드
  printWindow.loadFile('print-preview.html');

  printWindow.once('ready-to-show', () => {
    // 로딩 화면이 완전히 준비될 때까지 창을 숨긴 상태로 유지
    console.log('🎬 창이 ready-to-show 상태이지만 로딩 준비까지 대기 중...');
    
    // 렌더러가 완전히 로드될 때까지 대기 후 IPC 전송
    printWindow.webContents.once('did-finish-load', () => {
      console.log('🎯 렌더러 프로세스 로드 완료');
      
      // 조금 더 대기 후 IPC 전송 (렌더러 스크립트 실행 완료 보장)
      setTimeout(() => {
        console.log('📡 IPC 메시지 전송 시작');
        
        // 서버 정보와 세션 ID를 렌더러 프로세스로 전송
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.webContents.send('server-info', {
            port: serverPort,
            session: sessionId
          });
          console.log('✅ server-info 전송 완료');
        }

        // 이미 받은 URL이 있으면 로드 (현재 세션 또는 복구된 최근 세션)
        console.log(`🔍 윈도우 생성 후 URL 확인:`);
        console.log(`- sessionId: ${sessionId}`);
        console.log(`- receivedUrls[sessionId] 존재: ${!!receivedUrls[sessionId]}`);
        
        let urlDataToSend = null;
        let usedSessionId = sessionId;
        
        if (receivedUrls[sessionId]) {
          // 현재 세션에 데이터가 있음
          urlDataToSend = receivedUrls[sessionId];
          console.log('✅ 현재 세션의 URL 데이터 발견');
        } else {
          // 현재 세션에 데이터가 없으면 복구된 세션 중 가장 최근 것 찾기
          const sessions = Object.keys(receivedUrls);
          if (sessions.length > 0) {
            // 타임스탬프 기준으로 가장 최근 세션 찾기
            let latestSession = sessions[0];
            let latestTimestamp = receivedUrls[latestSession].timestamp || 0;
            
            sessions.forEach(sid => {
              const timestamp = receivedUrls[sid].timestamp || 0;
              if (timestamp > latestTimestamp) {
                latestSession = sid;
                latestTimestamp = timestamp;
              }
            });
            
            urlDataToSend = receivedUrls[latestSession];
            usedSessionId = latestSession;
            
            console.log(`🔄 복구된 세션에서 가장 최근 데이터 사용: ${latestSession}`);
            console.log(`📅 데이터 생성 시간: ${new Date(latestTimestamp).toLocaleString()}`);
            
            // 현재 세션을 복구된 세션으로 업데이트
            currentSession = latestSession;
          }
        }
        
        if (urlDataToSend) {
          console.log('✅ URL 데이터를 윈도우로 전송');
          console.log('📤 전송할 데이터:', urlDataToSend);
          console.log('🔗 사용된 세션 ID:', usedSessionId);
          
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.webContents.send('urls-received', urlDataToSend);
            printWindow.webContents.send('session-restored', {
              sessionId: usedSessionId,
              restoredFromSaved: usedSessionId !== sessionId,
              dataAge: urlDataToSend.receivedAt ? new Date(urlDataToSend.receivedAt).toLocaleString() : '알 수 없음'
            });
            console.log('✅ urls-received 및 session-restored 전송 완료');
            
            // 모든 데이터 전송이 완료되었으므로 로딩 완료 신호 전송 (지연 없이)
            // URL 데이터가 있는 경우는 렌더러에서 자체적으로 로딩을 해제하므로 신호를 보내지 않음
          }
        } else {
          console.log('⚠️ 아직 URL 데이터가 없음 - 대기 중');
          
          // 데이터가 없을 때 안내 메시지 표시
          if (printWindow && !printWindow.isDestroyed()) {
            printWindow.webContents.send('show-waiting-message', {
              title: '인쇄 데이터 대기 중',
              message: '웹페이지에서 인쇄 요청을 기다리고 있습니다.',
              details: '웹페이지에서 WebPrinter를 통해 인쇄를 요청하면 자동으로 미리보기가 표시됩니다.'
            });
            
            // 대기 상황에서는 기본 초기화가 완료되었으므로 로딩 완료 신호 전송 (약간의 지연)
            setTimeout(() => {
              if (printWindow && !printWindow.isDestroyed()) {
                printWindow.webContents.send('loading-complete', {
                  reason: 'waiting_for_data',
                  message: '기본 초기화 완료'
                });
                console.log('🏁 로딩 완료 신호 전송 완료 (대기 상태)');
              }
            }, 500);
          }
        }
      }, 1000); // 1초 대기
    });
  });

  // 창 닫기 이벤트 처리
  printWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'win32') {
      event.preventDefault();
      printWindow.hide();
      console.log('🔄 창을 숨김 (백그라운드 실행 중)');
    }
  });

  printWindow.on('closed', () => {
    printWindow = null;
    currentSession = null;
    
    // 세션 데이터 정리
    if (sessionId && receivedUrls[sessionId]) {
      delete receivedUrls[sessionId];
      console.log(`세션 ${sessionId} 정리 완료`);
      
      // 세션 정리 후 저장
      saveSessionData();
    }
  });

  // DevTools는 프로덕션에서 사용하지 않음

  return sessionId;
}

// 자동 업데이트 설정 (개선됨)
function setupAutoUpdater() {
  // 자동 다운로드 설정
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  // 개발 모드에서는 업데이트 비활성화
  if (process.env.NODE_ENV === 'development' || process.defaultApp) {
    console.log('🔧 개발 모드 - 자동 업데이트 비활성화');
    return;
  }
  
  // 업데이트 확인 (앱 시작 시)
  setTimeout(() => {
    console.log('🔄 업데이트 확인 시작...');
    autoUpdater.checkForUpdates();
  }, 3000);
  
  // 30분마다 업데이트 체크
  setInterval(() => {
    console.log('🔄 정기 업데이트 확인 중...');
    autoUpdater.checkForUpdates();
  }, 30 * 60 * 1000);
  
  // 업데이트 이벤트 리스너
  autoUpdater.on('checking-for-update', () => {
    console.log('업데이트 확인 중...');
  });
  
  autoUpdater.on('update-available', (info) => {
    console.log('🆕 업데이트 발견됨:', info.version);
    
    // 사용자에게 업데이트 시작 알림
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-available', {
        version: info.version,
        releaseDate: info.releaseDate,
        autoDownload: true
      });
    }
  });
  
  autoUpdater.on('update-not-available', () => {
    console.log('✅ 최신 버전입니다.');
  });
  
  autoUpdater.on('error', (error) => {
    console.error('❌ 업데이트 오류:', error.message);
    
    // 권한 관련 오류 처리
    if (error.message.includes('EACCES') || error.message.includes('permission') || error.message.includes('Access')) {
      console.warn('⚠️ 업데이트 권한 오류 감지 - 관리자 권한이 필요할 수 있습니다');
      
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.webContents.send('update-error', {
          error: '업데이트 설치에 관리자 권한이 필요합니다',
          requiresAdmin: true
        });
      }
    }
    
    // 네트워크 오류 처리
    if (error.message.includes('net::') || error.message.includes('ECONNREFUSED')) {
      console.warn('⚠️ 네트워크 연결 오류 - 나중에 다시 시도합니다');
      
      // 30분 후 재시도
      setTimeout(() => {
        console.log('🔄 업데이트 재시도...');
        autoUpdater.checkForUpdates();
      }, 30 * 60 * 1000);
    }
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    const message = `다운로드 진행률: ${Math.round(progressObj.percent)}%`;
    console.log(message);
    
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-progress', {
        percent: Math.round(progressObj.percent),
        transferred: progressObj.transferred,
        total: progressObj.total
      });
    }
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    console.log('✅ 업데이트 다운로드 완료');
    
    // 사용자에게 업데이트 완료 알림
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.webContents.send('update-downloaded', {
        version: info.version,
        autoRestart: false,
        installOnNextStart: true,
        userChoice: true
      });
    }
    
    // 앱 종료 시 자동 설치
    console.log('💡 다음번 앱 시작 시 자동으로 업데이트가 적용됩니다.');
  });
}

// 앱 준비 상태 추적
let isAppReady = false;
let pendingProtocolCall = null;

// 시작 프로그램 등록 (OS별 자동 시작 설정)
function setupAutoLaunch() {
  try {
    const loginSettings = app.getLoginItemSettings();
    const openAtLogin = loginSettings.openAtLogin;
    
    console.log('🔍 현재 시작 프로그램 설정:', loginSettings);
    
    if (!openAtLogin) {
      console.log('🚀 시작 프로그램에 WebPrinter 등록 중...');
      
      // 플랫폼별 처리
      if (process.platform === 'win32') {
        // Windows: 레지스트리 방식도 함께 시도
        const { exec } = require('child_process');
        const appPath = process.execPath;
        const regCommand = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "WebPrinter" /t REG_SZ /d "${appPath} --hidden" /f`;
        
        exec(regCommand, (error) => {
          if (error) {
            console.warn('⚠️ 레지스트리 등록 실패:', error.message);
          } else {
            console.log('✅ 레지스트리에 시작 프로그램 등록 성공');
          }
        });
      }
      
      // Electron API 방식 (모든 플랫폼)
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: true,  // 숨겨진 상태로 시작
        name: 'WebPrinter',
        args: ['--hidden'], // 숨겨진 모드로 시작
        path: process.execPath // 명시적 경로 지정
      });
      
      console.log('✅ 시작 프로그램 등록 완료 - 부팅 시 자동 실행됩니다');
    } else {
      console.log('✅ 이미 시작 프로그램에 등록되어 있습니다');
    }
  } catch (error) {
    console.warn('⚠️ 시작 프로그램 등록 실패 (권한 부족):', error.message);
  }
}

// 앱 이벤트 핸들러
app.whenReady().then(async () => {
  registerProtocol();
  setupAutoUpdater();
  setupAutoLaunch();
  createTray();
  setupUninstallDetection(); // 언인스톨 감지 시스템 활성화
  
  // HTTP 서버 자동 시작 (백그라운드 서비스 보장)
  console.log('🚀 백그라운드 HTTP 서버 시작 중...');
  try {
    await startHttpServer();
    console.log(`✅ 백그라운드 서버 실행 완료: http://localhost:${serverPort}`);
    console.log('🌐 웹에서 접근 가능 상태입니다');
    
    // 서버 상태 추가 확인
    setTimeout(() => {
      console.log('📡 서버 상태 재확인:');
      console.log(`   - 포트: ${serverPort}`);
      console.log(`   - 서버 객체: ${httpServer ? 'OK' : 'NULL'}`);
      console.log(`   - 리스닝: ${httpServer && httpServer.listening ? 'YES' : 'NO'}`);
    }, 2000);
    
  } catch (error) {
    console.error('❌ HTTP 서버 시작 실패:', error);
    console.error('⚠️ 웹에서 WebPrinter에 접근할 수 없습니다');
    
    // 5초 후 재시도
    setTimeout(async () => {
      console.log('🔄 HTTP 서버 재시도 중...');
      try {
        await startHttpServer();
        console.log(`✅ 재시도 성공: http://localhost:${serverPort}`);
      } catch (retryError) {
        console.error('❌ 재시도도 실패:', retryError.message);
      }
    }, 5000);
  }
  
  // 세션 데이터 복구
  loadSessionData();
  cleanOldSessions();
  
  // 앱 준비 완료 표시
  isAppReady = true;
  
  // 시작 모드 확인 및 설정
  const isHiddenMode = process.argv.includes('--hidden');
  console.log('='.repeat(50));
  if (isHiddenMode) {
    console.log('🔕 WebPrinter 백그라운드 모드 시작');
    console.log('📍 설치 완료 후 자동 실행됨');
  } else {
    console.log('🖥️ WebPrinter 일반 모드 시작');
  }
  
  console.log(`🌐 HTTP 서버: http://localhost:${serverPort || '포트 미정'}`);
  console.log(`🖱️ 트레이 메뉴: 우클릭으로 종료/재시작 가능`);
  console.log(`🔗 웹 호출: webprinter://print?session=테스트`);
  console.log('='.repeat(50));
  
  // 모든 플랫폼에서 Dock/작업표시줄에서 숨기기 (트레이 전용)
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }
  
  // 대기 중인 프로토콜 호출 처리
  if (pendingProtocolCall) {
    console.log('대기 중이던 프로토콜 호출 처리:', pendingProtocolCall);
    await handleProtocolCall(pendingProtocolCall);
    pendingProtocolCall = null;
  }
  
  // 앱이 이미 실행 중일 때 프로토콜 호출 처리
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const protocolUrl = commandLine.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) {
      handleProtocolCall(protocolUrl);
    }
    
    // 기존 창 활성화
    if (printWindow) {
      if (printWindow.isMinimized()) printWindow.restore();
      printWindow.focus();
    }
  });
});

// 단일 인스턴스 보장
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  // 프로토콜 URL 처리
  app.on('open-url', (event, protocolUrl) => {
    event.preventDefault();
    handleProtocolCall(protocolUrl);
  });

  // Windows에서 프로토콜 처리
  if (process.platform === 'win32') {
    const protocolUrl = process.argv.find(arg => arg.startsWith('webprinter://'));
    if (protocolUrl) {
      console.log('Windows 프로토콜 호출 감지:', protocolUrl);
      handleProtocolCall(protocolUrl);
    }
  }
}

// 프로토콜 호출 처리
async function handleProtocolCall(protocolUrl) {
  console.log('프로토콜 호출 받음:', protocolUrl);
  
  // 앱이 아직 준비되지 않았으면 대기
  if (!isAppReady) {
    console.log('앱이 준비 중입니다. 프로토콜 호출을 대기합니다...');
    pendingProtocolCall = protocolUrl;
    return;
  }
  
  const parsed = parseProtocolUrl(protocolUrl);
  if (!parsed) {
    console.error('잘못된 프로토콜 URL:', protocolUrl);
    return;
  }

  const { action, params } = parsed;

  switch (action) {
    case 'print':
      const sessionId = params.session || generateSessionId();
      const isForced = params.force === 'true';
      
      if (isForced) {
        console.log('🚀 강제 실행 모드로 프린트 윈도우 생성 중...', sessionId);
      } else {
        console.log('프린트 윈도우 생성 중...', sessionId);
      }
      
      await createPrintWindow(sessionId, isForced);
      
      // 웹에게 서버 정보 응답 (콘솔 출력으로 웹 개발자가 확인 가능)
      if (isForced) {
        console.log(`🚀 WebPrinter 강제 실행 완료:`);
      } else {
        console.log(`WebPrinter 준비됨:`);
      }
      console.log(`- 서버 주소: http://localhost:${serverPort}`);
      console.log(`- 세션 ID: ${sessionId}`);
      console.log(`- URL 전송 엔드포인트: POST /send-urls`);
      break;
    
    case 'server-info':
      // 서버 정보만 요청하는 경우
      if (!httpServer) {
        try {
          await startHttpServer();
        } catch (error) {
          console.error('HTTP 서버 시작 실패:', error);
          return;
        }
      }
      console.log(`서버 정보: http://localhost:${serverPort}`);
      break;
    
    default:
      console.error('알 수 없는 액션:', action);
  }
}

// 모든 창이 닫혔을 때 처리
app.on('window-all-closed', () => {
  // 앱을 종료하지 않고 백그라운드에서 계속 실행
  console.log('🔄 모든 창이 닫혔지만 백그라운드 서비스는 계속 실행됩니다.');
});

// 앱이 완전히 종료되기 전 처리
app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    console.log('⚠️ 종료가 취소되었습니다. 백그라운드에서 계속 실행됩니다.');
    console.log('💡 트레이 아이콘을 우클릭하여 "종료" 메뉴를 사용하세요.');
  } else {
    console.log('📴 WebPrinter 서비스 최종 종료 중...');
    
    // HTTP 서버 정리 (중복 체크)
    if (httpServer) {
      stopHttpServer();
      console.log('✅ HTTP 서버 최종 정리');
    }
    
    // 트레이 정리 (중복 체크)
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      tray = null;
      console.log('✅ 트레이 최종 정리');
    }
    
    console.log('🔚 WebPrinter 완전 종료됨');
  }
});

// macOS에서 앱이 활성화되면 처리
app.on('activate', () => {
  // macOS에서는 독에서 클릭했을 때 창 표시
  if (!printWindow) {
    createPrintWindow();
  } else {
    printWindow.show();
    printWindow.focus();
  }
});

// IPC 핸들러들

// 창 표시 요청 처리
ipcMain.on('request-show-window', () => {
  console.log('📢 렌더러에서 창 표시 요청 수신');
  if (printWindow && !printWindow.isDestroyed()) {
    console.log('🎬 창 표시 시작...');
    printWindow.show();
    printWindow.focus();
    console.log('✅ 창 표시 완료');
  }
});

// 로딩 준비 완료 신호 처리
ipcMain.on('loading-ready', () => {
  console.log('🎯 로딩 화면 준비 완료 신호 수신');
});

// 프린터 목록 가져오기
ipcMain.handle('get-printers', async () => {
  try {
    const printers = (printWindow && !printWindow.isDestroyed()) ? await printWindow.webContents.getPrintersAsync() : [];
    return { success: true, printers };
  } catch (error) {
    console.error('프린터 목록 가져오기 실패:', error);
    return { success: false, error: error.message };
  }
});

// 🖨️ 인쇄 처리 (PDF 방식 전용)
ipcMain.handle('print-url', async (event, { url, paperSize, printSelector, copies, silent, printerName }) => {
  console.log('🖨️ 인쇄 요청 처리 시작');
  
  try {
    // 입력값 검증
    if (!url) {
      throw new Error('인쇄할 URL이 필요합니다');
    }
    
    if (!paperSize || !paperSize.width || !paperSize.height) {
      throw new Error('용지 크기 정보가 필요합니다');
    }
    
    // 기본값 설정
    const safePrintSelector = printSelector || '#print_wrap';
    const safeCopies = Math.max(1, Math.min(copies || 1, 10));
    const safeSilent = silent !== false; // 기본값: silent
    
    console.log(`📄 인쇄 정보: ${paperSize.width}x${paperSize.height}mm, ${safeCopies}매, ${safePrintSelector}`);
    
    // PDF 방식으로 인쇄 실행
    const result = await printViaPDF(url, paperSize, safePrintSelector, safeCopies, safeSilent, printerName);
    
    if (result.success) {
      console.log('✅ 인쇄 완료');
      return { success: true, message: '인쇄가 완료되었습니다' };
    } else {
      throw new Error('인쇄 실행 실패');
    }
    
  } catch (error) {
    console.error('❌ 인쇄 오류:', error.message);
    return { success: false, error: error.message };
  }
});

// 서버 정보 가져오기
ipcMain.handle('get-server-info', () => {
  return {
    port: serverPort,
    session: currentSession,
    running: !!httpServer
  };
});

// 앱을 백그라운드로 숨기기 (서비스 모드 유지)
ipcMain.handle('hide-to-background', () => {
  console.log('🔄 사용자 요청에 의한 백그라운드 이동');
  
  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.hide();
    
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
    
    console.log('✅ 백그라운드 서비스 모드로 전환 완료');
  }
});

// 앱 완전 종료
ipcMain.handle('quit-app', () => {
  console.log('🚪 사용자 요청에 의한 앱 완전 종료');
  cleanupAndExit('IPC 요청');
  return { success: true, message: '앱을 완전히 종료합니다.' };
});

// 업데이트 관련 IPC 핸들러
ipcMain.handle('check-for-updates', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

ipcMain.handle('download-update', () => {
  autoUpdater.downloadUpdate();
});

ipcMain.handle('install-update', () => {
  console.log('🔄 사용자 요청에 의한 업데이트 설치 시작');
  
  isQuitting = true;
  autoUpdater.quitAndInstall(false, true);
  
  return { success: true, message: '업데이트를 설치하고 재시작합니다.' };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// 🔄 PDF 기반 인쇄 (실제 서비스용)
async function printViaPDF(url, paperSize, printSelector, copies, silent, printerName) {
  try {
    // 1. HTML → PDF 변환
    const pdfBuffer = await generatePDF(url, paperSize, printSelector);
    
    // 2. 임시 파일 저장
    const tempPdfPath = await saveTempPDF(pdfBuffer);
    
    // 3. 프린터로 전송
    const result = await printPDFFile(tempPdfPath, copies, silent, printerName);
    
    // 4. 임시 파일 정리
    await cleanupTempFile(tempPdfPath);
    
    return result;
    
  } catch (error) {
    throw new Error(`PDF 인쇄 실패: ${error.message}`);
  }
}

// 📄 PDF 생성 함수 (실제 서비스용)
async function generatePDF(url, paperSize, printSelector) {
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });
  
  try {
    // 1. HTML 로드
    await pdfWindow.loadURL(url);
    
    // 2. 특정 DIV 내용 취득 및 180도 회전 처리
    await pdfWindow.webContents.executeJavaScript(`
      (function() {
        const targetElement = document.querySelector('${printSelector}');
        if (!targetElement) {
          throw new Error('인쇄 대상 요소를 찾을 수 없습니다: ${printSelector}');
        }
        
        // 다른 모든 요소 숨기기
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        Array.from(document.body.children).forEach(child => {
          if (!child.contains(targetElement)) {
            child.style.display = 'none';
          }
        });
        
        // 180도 회전 및 정중앙 배치
        targetElement.style.transform = 'rotate(180deg)';
        targetElement.style.transformOrigin = 'center center';
        targetElement.style.position = 'absolute';
        targetElement.style.top = '50%';
        targetElement.style.left = '50%';
        targetElement.style.translate = '-50% -50%';
        targetElement.style.margin = '0';
        targetElement.style.padding = '0';
        
        // 색상 정확도 보장
        targetElement.style.webkitPrintColorAdjust = 'exact';
        targetElement.style.printColorAdjust = 'exact';
        
        return true;
      })()
    `);
    
    // 3. PDF 생성 옵션 (정확한 물리적 크기)
    const pdfOptions = {
      pageSize: {
        width: paperSize.width * 1000,    // mm to microns
        height: paperSize.height * 1000   // mm to microns
      },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      landscape: false
    };
    
    // 4. PDF 생성
    const pdfBuffer = await pdfWindow.webContents.printToPDF(pdfOptions);
    return pdfBuffer;
    
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

// 💾 임시 PDF 파일 저장
async function saveTempPDF(pdfBuffer) {
  const fs = require('fs').promises;
  const path = require('path');
  const os = require('os');
  
  const tempFilePath = path.join(os.tmpdir(), `webprinter_${Date.now()}.pdf`);
  await fs.writeFile(tempFilePath, pdfBuffer);
  
  return tempFilePath;
}

// 🖨️ PDF 파일 인쇄 (크로스 플랫폼)
async function printPDFFile(pdfPath, copies, silent, printerName) {
  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);
  
  if (process.platform === 'win32') {
    // Windows: 기본 PDF 뷰어 또는 명령줄 인쇄
    try {
      if (printerName) {
        // 지정된 프린터로 직접 인쇄
        await execAsync(`powershell -Command "Start-Process -FilePath '${pdfPath}' -ArgumentList '/t','/p','${printerName}' -WindowStyle Hidden"`);
      } else {
        // 기본 프린터로 인쇄
        await execAsync(`powershell -Command "Start-Process -FilePath '${pdfPath}' -Verb Print -WindowStyle Hidden"`);
      }
      return { success: true };
    } catch (error) {
      throw new Error(`Windows PDF 인쇄 실패: ${error.message}`);
    }
    
  } else if (process.platform === 'darwin') {
    // macOS: lp 명령어
    const printCmd = printerName ? 
      `lp -d "${printerName}" -n ${copies} "${pdfPath}"` : 
      `lp -n ${copies} "${pdfPath}"`;
    await execAsync(printCmd);
    return { success: true };
    
  } else {
    // Linux: lp 명령어
    const printCmd = printerName ? 
      `lp -d "${printerName}" -n ${copies} "${pdfPath}"` : 
      `lp -n ${copies} "${pdfPath}"`;
    await execAsync(printCmd);
    return { success: true };
  }
}

// 🗑️ 임시 파일 정리
async function cleanupTempFile(filePath) {
  try {
    const fs = require('fs').promises;
    await fs.unlink(filePath);
  } catch (error) {
    // 정리 실패는 중요하지 않음 (OS가 자동 정리)
  }
}