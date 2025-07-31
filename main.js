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
      // Windows - 여러 경로 시도
      const possiblePaths = [
        path.join(__dirname, 'icon-32.png'),  // 작은 아이콘 우선
        path.join(__dirname, 'icon.png'),
        path.join(process.resourcesPath, 'icon-32.png'),
        path.join(process.resourcesPath, 'icon.png')
      ];
      
      iconPath = possiblePaths.find(p => {
        try {
          return require('fs').existsSync(p);
        } catch {
          return false;
        }
      }) || possiblePaths[0]; // 없으면 첫 번째 경로 사용
      
    } else if (process.platform === 'linux') {
      iconPath = path.join(__dirname, 'icon.png');
    } else {
      // macOS는 트레이 아이콘 생성하지 않음 (Dock 사용)
      console.log('🍎 macOS - Dock 아이콘 사용, 트레이 아이콘 생성 안함');
      return;
    }
    
    console.log('🎯 트레이 아이콘 경로:', iconPath);
    
    // 파일 존재 확인
    if (!require('fs').existsSync(iconPath)) {
      console.warn('⚠️ 트레이 아이콘 파일이 없음:', iconPath);
      console.log('📁 현재 디렉토리:', __dirname);
      console.log('📂 파일 목록:', require('fs').readdirSync(__dirname).filter(f => f.includes('icon')));
    }
    
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        {
          label: '📂 WebPrinter 열기',
          click: () => {
            if (printWindow) {
              printWindow.show();
              printWindow.focus();
            } else {
              createPrintWindow();
            }
          }
        },
        {
          label: '📊 상태 정보',
          click: () => {
            const statusInfo = [
              `버전: ${app.getVersion()}`,
              `서버 포트: ${serverPort || '미실행'}`,
              `활성 세션: ${Object.keys(receivedUrls).length}개`,
              `메모리 사용: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
              `실행 시간: ${Math.round(process.uptime() / 60)}분`
            ].join('\n');
            
            dialog.showMessageBox(null, {
              type: 'info',
              title: 'WebPrinter 상태',
              message: '현재 상태 정보',
              detail: statusInfo,
              buttons: ['확인']
            });
          }
        },
        { type: 'separator' },
        {
          label: '⚙️ 백그라운드 모드 해제',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'question',
              title: '백그라운드 모드 해제',
              message: '부팅 시 자동 실행을 해제하시겠습니까?',
              detail: '다음 부팅부터는 수동으로 실행해야 합니다.',
              buttons: ['해제', '취소'],
              defaultId: 1,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) {
                app.setLoginItemSettings({
                  openAtLogin: false
                });
                
                dialog.showMessageBox(null, {
                  type: 'info',
                  title: 'WebPrinter',
                  message: '백그라운드 자동 실행이 해제되었습니다.',
                  detail: '다음 부팅부터는 자동으로 시작되지 않습니다.',
                  buttons: ['확인']
                });
              }
            });
          }
        },
        {
          label: '🔄 앱 재시작',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'question',
              title: 'WebPrinter 재시작',
              message: 'WebPrinter를 재시작하시겠습니까?',
              detail: '모든 세션이 초기화됩니다.',
              buttons: ['재시작', '취소'],
              defaultId: 1,
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
          label: '🛑 완전 종료 (프로세스 종료)',
          click: () => {
            dialog.showMessageBox(null, {
              type: 'warning',
              title: 'WebPrinter 완전 종료',
              message: '정말로 WebPrinter를 완전히 종료하시겠습니까?',
              detail: [
                '• 백그라운드 서비스가 완전히 중지됩니다',
                '• 웹에서 더 이상 호출할 수 없게 됩니다', 
                '• 다시 사용하려면 수동으로 실행해야 합니다',
                '• 시작 프로그램에서도 제거됩니다'
              ].join('\n'),
              buttons: ['완전 종료', '취소'],
              defaultId: 1,
              cancelId: 1
            }).then((result) => {
              if (result.response === 0) {
                cleanupAndExit('사용자 완전 종료');
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: '🔽 창 숨기기',
          click: () => {
            if (printWindow && !printWindow.isDestroyed()) {
              printWindow.hide();
            }
          }
        }
      ]);
      
      tray.setToolTip('WebPrinter - 우클릭으로 메뉴 열기');
      tray.setContextMenu(contextMenu);
      
      // 트레이 더블클릭 시 창 열기
      tray.on('double-click', () => {
        if (printWindow) {
          printWindow.show();
          printWindow.focus();
        } else {
          createPrintWindow();
        }
      });
      
      console.log('✅ 시스템 트레이 생성 완료 (개선된 메뉴)');
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
    console.log('🔄 기존 창 재사용');
    printWindow.show();
    printWindow.focus();
    
    // 세션 ID만 업데이트
    if (sessionId) {
      currentSession = sessionId;
    }
    
    // 서버 정보 다시 전송
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.webContents.send('server-info', {
          port: serverPort,
          session: currentSession
        });
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
    // DOM 완전 로드 후 부드럽게 표시
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.show();
        printWindow.focus();
      }
    }, 100); // 깜박거림 방지를 위한 최소 지연
    
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
  
  // HTTP 서버 시작
  try {
    await startHttpServer();
  } catch (error) {
    console.error('HTTP 서버 시작 실패:', error);
  }
  
  // 세션 데이터 복구
  loadSessionData();
  cleanOldSessions();
  
  // 앱 준비 완료 표시
  isAppReady = true;
  
  // 숨겨진 모드로 시작되었는지 확인
  const isHiddenMode = process.argv.includes('--hidden');
  if (isHiddenMode) {
    console.log('🔕 숨겨진 모드로 시작 - 백그라운드 서비스로 실행');
    
    // 독(Dock) 및 작업 표시줄에서 숨기기
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
  } else {
    console.log('🖥️ 일반 모드로 시작');
    // 시작 시에는 창을 생성하지 않음 - 데이터를 받았을 때만 창 생성
    console.log('💡 인쇄 데이터를 기다리는 중... (트레이 아이콘에서 대기)');
    
    // macOS의 경우 Dock 아이콘 숨기기 (트레이 전용 앱으로 동작)
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
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
  } else {
    console.log('📴 WebPrinter 서비스 종료 중...');
    
    // HTTP 서버 정리
    if (httpServer) {
      stopHttpServer();
    }
    
    // 트레이 정리
    if (tray) {
      tray.destroy();
    }
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

// 인쇄 실행 (안정화된 일반 인쇄 전용)
ipcMain.handle('print-url', async (event, options) => {
  let tempPrintWindow = null;
  
  try {
    const { url, printerName, copies = 1, paperSize = null, printSelector = '#print_wrap', silent = false } = options || {};
    
    // 필수 매개변수 검증
    if (!paperSize) {
      throw new Error('용지 크기 정보가 누락되었습니다. 웹에서 paperSize 객체를 전달해주세요.');
    }
    
    if (!paperSize.width || !paperSize.height) {
      throw new Error(`용지 크기가 불완전합니다. width: ${paperSize.width}, height: ${paperSize.height}. 웹에서 paper_width와 paper_height를 모두 전달해주세요.`);
    }
    
    if (paperSize.width <= 0 || paperSize.height <= 0) {
      throw new Error(`용지 크기가 유효하지 않습니다. width: ${paperSize.width}mm, height: ${paperSize.height}mm. 양수 값이어야 합니다.`);
    }
    
    // 용지 크기 범위 검증 (경고만 출력, 중단하지 않음)
    const minSize = 5; // 최소 5mm (완화)
    const maxSize = 3000; // 최대 3000mm (완화)
    
    if (paperSize.width < minSize || paperSize.height < minSize) {
      console.warn(`⚠️ 용지 크기가 작음 (계속 진행): width: ${paperSize.width}mm, height: ${paperSize.height}mm. 권장 최소: ${minSize}mm`);
    }
    
    if (paperSize.width > maxSize || paperSize.height > maxSize) {
      console.warn(`⚠️ 용지 크기가 큼 (계속 진행): width: ${paperSize.width}mm, height: ${paperSize.height}mm. 권장 최대: ${maxSize}mm`);
    }
    
    console.log('✅ 용지 크기 검증 통과:', { width: paperSize.width, height: paperSize.height });
    
    // printSelector 안전 처리
    const safePrintSelector = printSelector || '#print_wrap';
    
    // 세로 방향용 effectiveWidth/Height 계산
    const effectiveWidth = Math.min(paperSize.width, paperSize.height);
    const effectiveHeight = Math.max(paperSize.width, paperSize.height);
    
    if (!url) {
      throw new Error('인쇄할 URL이 없습니다');
    }
    
    console.log(`🖨️ Electron 인쇄 시작: ${url}`);
    console.log(`📏 용지 사이즈: ${paperSize.width}mm × ${paperSize.height}mm (웹에서 전달받음)`);
    console.log(`📐 세로 방향 변환: ${effectiveWidth}mm × ${effectiveHeight}mm`);
    console.log(`🎯 인쇄 영역: ${safePrintSelector}`);
    console.log(`📄 복사본: ${copies}매`);
    console.log(`🔇 Silent 모드: ${silent ? '활성화 (대화상자 없음)' : '비활성화 (대화상자 표시)'}`);
    
    // 프린트 윈도우 생성
    tempPrintWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
        plugins: true
      }
    });
    
    // 윈도우 정리 함수
    const cleanupWindow = () => {
      if (tempPrintWindow && !tempPrintWindow.isDestroyed()) {
        tempPrintWindow.close();
        tempPrintWindow = null;
      }
    };
    
    tempPrintWindow.on('closed', () => tempPrintWindow = null);
    
    // URL 로딩 (타임아웃 추가)
    console.log('📄 URL 로딩 중...');
    
    try {
      // 30초 타임아웃으로 URL 로딩
      await Promise.race([
        tempPrintWindow.loadURL(url),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('URL 로딩 타임아웃 (30초)')), 30000)
        )
      ]);
      console.log('✅ URL 로딩 완료');
    } catch (loadError) {
      console.error('❌ URL 로딩 실패:', loadError.message);
      throw new Error(`URL 로딩 실패: ${loadError.message}`);
    }
    
    // 페이지 완전 로딩 대기 (개선된 버전)
    console.log('⏳ 페이지 렌더링 및 JavaScript 실행 대기 중...');
    
    try {
      await Promise.race([
        tempPrintWindow.webContents.executeJavaScript(`
          new Promise((resolve) => {
            // DOM 상태 확인 함수
            const checkPageReady = () => {
              const isReady = document.readyState === 'complete';
              const hasBody = !!document.body;
              const bodyHasContent = document.body && document.body.innerHTML.length > 100;
              
              console.log('📊 페이지 상태:', {
                readyState: document.readyState,
                hasBody: hasBody,
                bodyContentLength: document.body?.innerHTML?.length || 0,
                title: document.title || 'no title'
              });
              
              return isReady && hasBody && bodyHasContent;
            };
            
            // 이미 준비되었으면 추가 대기
            if (checkPageReady()) {
              console.log('✅ 페이지가 이미 준비됨 - 1초 추가 대기');
              setTimeout(resolve, 1000);
            } else {
              // 로드 이벤트 대기
              const handleLoad = () => {
                console.log('✅ 로드 이벤트 발생 - 2초 추가 대기');
                setTimeout(resolve, 2000);
              };
              
              if (document.readyState === 'complete') {
                handleLoad();
              } else {
                window.addEventListener('load', handleLoad, { once: true });
                
                // DOMContentLoaded도 함께 대기
                if (document.readyState === 'loading') {
                  document.addEventListener('DOMContentLoaded', () => {
                    console.log('✅ DOMContentLoaded 완료');
                  }, { once: true });
                }
              }
            }
          })
        `),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('페이지 렌더링 타임아웃 (15초)')), 15000)
        )
      ]);
      
      console.log('✅ 페이지 렌더링 및 JavaScript 실행 완료');
    } catch (renderError) {
      console.warn('⚠️ 페이지 렌더링 타임아웃 - 현재 상태로 진행:', renderError.message);
      // 타임아웃이어도 진행 (부분적으로 로드된 페이지라도 인쇄 시도)
    }
    
    // 인쇄 영역 처리 (#print_wrap 요소 확인)
    console.log(`🎯 인쇄 영역 적용 중: ${safePrintSelector}`);
    
    try {
      // JavaScript 코드를 문자열로 구성 (백틱 중첩 문제 해결)
      const jsCode = [
        '(() => {',
        `  const selector = '${safePrintSelector.replace(/'/g, "\\'")}';`,
        '  console.log("🔍 인쇄 영역 검색 시작:", selector);',
        '  ',
        '  try {',
        '    // DOM 완전 로드 확인',
        '    if (document.readyState !== "complete") {',
        '      console.warn("⚠️ DOM이 아직 완전히 로드되지 않았습니다");',
        '    }',
        '    ',
        '    // 인쇄 영역 검색',
        '    const targetElement = document.querySelector(selector);',
        '    ',
        '    if (!targetElement) {',
        '      console.log("📄 페이지 구조 분석:");',
        '      console.log("- 전체 body HTML 길이:", document.body?.innerHTML?.length || 0);',
        '      console.log("- ID가 있는 요소들:", Array.from(document.querySelectorAll("[id]")).map(el => "#" + el.id).slice(0, 10));',
        '      console.log("- 클래스가 있는 요소들:", Array.from(document.querySelectorAll("[class]")).map(el => "." + el.className.split(" ")[0]).slice(0, 10));',
        '      ',
        '      return { success: false, error: "인쇄 영역을 찾을 수 없음" };',
        '    }',
        '    ',
        '    console.log("✅ 대상 요소 발견:", {',
        '      tagName: targetElement.tagName,',
        '      id: targetElement.id || "none",',
        '      className: targetElement.className || "none",',
        '      contentLength: targetElement.innerHTML?.length || 0',
        '    });',
        '    ',
        '    // 요소가 비어있는지 확인',
        '    const hasContent = targetElement.innerHTML.trim().length > 0 || targetElement.textContent.trim().length > 0;',
        '    if (!hasContent) {',
        '      console.warn("⚠️ 인쇄 영역이 비어있습니다.");',
        '      return { success: false, error: "인쇄 영역이 비어있음" };',
        '    }',
        '    ',
        '    // 인쇄용 스타일 생성',
        '    const printStyle = document.createElement("style");',
        '    printStyle.id = "webprinter-print-style";',
        '    ',
        '    // 웹에서 88x244mm로 이미 완성된 #print_wrap을 그대로 사용',
        `    console.log("📏 배치 정보:", {`,
        `      paperSetting: "A4 (프린터 호환)",`,
        `      contentSource: "웹에서 ${effectiveWidth}x${effectiveHeight}mm로 완성된 #print_wrap",`,
        `      electronRole: "위치만 조정 (크기/여백 변경 금지)",`,
        `      position: "맨위 정중앙 + 180도 회전"`,
        `    });`,
        '    ',
        '    const cssText = `',
        '      @media print {',
        '        @page { size: A4; margin: 0; }',
        '        .webprinter-print-target {',
        '          /* 웹에서 완성된 크기 그대로 유지 */',
        '          margin: 0 !important;',
        '          padding: 0 !important;',
        '          border: 0 !important;',
        '          box-sizing: border-box !important;',
        '          /* 위치만 조정: 맨위 정중앙 */',
        '          position: absolute !important;',
        '          top: 0mm !important;',
        '          left: 50% !important;',
        '          transform: translateX(-50%) rotate(180deg) !important;',
        '          transform-origin: center top !important;',
        '          /* 색상 정확도 */',
        '          -webkit-print-color-adjust: exact !important;',
        '          print-color-adjust: exact !important;',
        '        }',
        '      }',
        '    `;',
        '    ',
        '    printStyle.textContent = cssText;',
        '    document.head.appendChild(printStyle);',
        '    ',
        '    // #print_wrap 요소에 인쇄용 클래스 추가',
        '    targetElement.classList.add("webprinter-print-target");',
        '    ',
        '    console.log("🎨 #print_wrap에 180도 회전 스타일 적용 완료");',
        '    return { success: true };',
        '    ',
        '  } catch (error) {',
        '    console.error("인쇄 처리 중 오류:", error);',
        '    return { success: false, error: error.message };',
        '  }',
        '})()'
      ].join('\n');
      
      const elementFound = await tempPrintWindow.webContents.executeJavaScript(jsCode);
      
      if (!elementFound.success) {
        console.log('⚠️ 인쇄 영역 처리 실패');
        // 미리보기 창에 메시지 전송
        if (printWindow && !printWindow.isDestroyed()) {
          printWindow.webContents.send('show-toast', {
            message: '⚠️ 지정된 인쇄 영역을 찾을 수 없습니다',
            type: 'warning',
            duration: 4000
          });
        }
      }
      
    } catch (error) {
      console.error('🚨 인쇄 영역 처리 중 치명적 오류:', error);
      // 오류 발생 시에도 인쇄는 계속 진행
    }
    let printers = [];
    let selectedPrinter = null;
    
    try {
      printers = await tempPrintWindow.webContents.getPrintersAsync();
      
      // 프린터 선택 로직 개선
      if (printerName && printers.length > 0) {
        // 지정된 프린터 이름으로 검색
        selectedPrinter = printers.find(p => p.name === printerName);
        if (selectedPrinter) {
          console.log(`✅ 지정된 프린터 선택됨: ${selectedPrinter.name}`);
        } else {
          console.warn(`⚠️ 프린터 ${printerName}를 찾을 수 없습니다.`);
        }
      }
      
      // 프린터가 지정되지 않았거나 찾을 수 없는 경우
      if (!selectedPrinter && printers.length > 0) {
        // 기본 프린터 찾기
        selectedPrinter = printers.find(p => p.isDefault);
        
        if (selectedPrinter) {
          console.log(`🎯 기본 프린터 자동 선택됨: ${selectedPrinter.name}`);
        } else {
          // 기본 프린터가 없으면 첫 번째 프린터 사용
          selectedPrinter = printers[0];
          console.log(`📌 첫 번째 프린터 자동 선택됨: ${selectedPrinter.name}`);
        }
      }
      
    } catch (e) {
      console.warn('프린터 목록 조회 실패:', e.message);
      // 프린터 목록 조회 실패 시 사용자가 대화상자에서 직접 선택
    }
    
    // 인쇄 옵션 설정
    const printOptions = {
      silent: silent,  // Silent print 옵션 (true면 대화상자 없이 바로 인쇄)
      printBackground: true,
      color: true,
      margins: {
        marginType: 'none'  // 여백 없음으로 설정 (라벨 프린터에 적합)
      },
      landscape: false,  // 항상 세로 방향으로 고정
      copies: Math.max(1, Math.min(copies, 10)),  // 최대 10매 제한
      collate: true,
      scaleFactor: 100,
      duplexMode: 'simplex',  // 단면 인쇄
      shouldPrintBackgrounds: true,
      shouldPrintSelectionOnly: false
    };
    
    // 프린트 지정
    if (selectedPrinter) {
      printOptions.deviceName = selectedPrinter.name;
      console.log(`🖨️ 사용할 프린터: ${selectedPrinter.name}`);
      console.log(`📊 프린터 상태: ${selectedPrinter.status || '알 수 없음'}`);
    } else {
      if (silent) {
        // Silent 모드에서는 기본 프린터 사용
        console.log(`🖨️ Silent 모드 - 시스템 기본 프린터 사용`);
        // Windows에서는 빈 문자열이 기본 프린터를 의미함
        printOptions.deviceName = '';
      } else {
        console.log(`🖨️ 프린터 미지정 - 사용자가 대화상자에서 선택`);
      }
    }
    
              // 용지 사이즈 설정 (A4 강제 사용으로 단순화)
    
    // 프린터 호환성을 위해 항상 A4 사용 (CSS에서 내용 배치 조정)
    printOptions.pageSize = 'A4';
    console.log(`📄 프린터 호환성을 위해 A4 용지 강제 사용`);
    console.log(`📐 실제 내용 크기: ${effectiveWidth}mm × ${effectiveHeight}mm (CSS로 배치)`);
    console.log(`🎯 A4 용지(210x297mm)에 ${effectiveWidth}x${effectiveHeight}mm 내용을 중앙 상단에 배치`);
    
    console.log('🖨️ 최종 프린트 옵션:', JSON.stringify(printOptions, null, 2));
    
    // 디버깅을 위한 상세 정보 출력
    console.log('🔍 프린트 디버깅 정보:');
    console.log('  📄 pageSize 타입:', typeof printOptions.pageSize);
    console.log('  📄 pageSize 값:', printOptions.pageSize);
    console.log('  🖨️ deviceName:', printOptions.deviceName || '(기본 프린터)');
    console.log('  🔇 silent 모드:', printOptions.silent);
    console.log('  📐 margins:', JSON.stringify(printOptions.margins));
    console.log('  📊 scaleFactor:', printOptions.scaleFactor);
    console.log('  🔄 landscape:', printOptions.landscape);
    
    // 프린트 실행
    return new Promise((resolve, reject) => {
      console.log('🚀 프린트 명령 실행...');
      
      const timeoutDuration = 60000;  // 60초 타임아웃
      const timeoutId = setTimeout(() => {
        cleanupWindow();
        reject(new Error(`프린트 실행 타임아웃 (${timeoutDuration/1000}초)`));
      }, timeoutDuration);
      
      try {
        tempPrintWindow.webContents.print(printOptions, (success, failureReason) => {
          clearTimeout(timeoutId);
          
          console.log('=== 인쇄 결과 ===');
          console.log('성공 여부:', success);
          console.log('실패 이유:', failureReason);
          console.log('================');
          
          // 창 정리 (1초 후)
          setTimeout(cleanupWindow, 1000);
          
          if (success) {
            const resultMessage = silent 
              ? '프린터로 직접 전송되었습니다.' 
              : '프린트 대화상자가 열렸습니다.';
              
            console.log(`✅ ${resultMessage}`);
            resolve({
              success: true,
              message: resultMessage,
              method: silent ? 'Silent 직접 인쇄' : 'Electron 대화상자 인쇄',
              printerName: selectedPrinter?.name || '기본 프린터',
              paperSize: `${effectiveWidth}mm × ${effectiveHeight}mm`,
              copies: printOptions.copies,
              printSelector: safePrintSelector === '#print_wrap' ? '#print_wrap (기본)' : safePrintSelector,
              silent: silent
            });
          } else {
            const errorMsg = failureReason || '사용자가 취소했거나 알 수 없는 오류';
            console.error('❌ 프린트 실패:', errorMsg);
            reject(new Error(`프린트 실패: ${errorMsg}`));
          }
        });
        
      } catch (printError) {
        clearTimeout(timeoutId);
        cleanupWindow();
        console.error('프린트 실행 중 예외:', printError);
        reject(new Error(`프린트 실행 오류: ${printError.message}`));
      }
    });
    
  } catch (error) {
    console.error('❌ Electron 프린트 실패:', error);
    
    if (tempPrintWindow && !tempPrintWindow.isDestroyed()) {
      tempPrintWindow.close();
    }
    
    return { 
      success: false, 
      error: error.message,
      method: 'Electron 대화상자 인쇄'
    };
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