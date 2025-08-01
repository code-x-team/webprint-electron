// diagnostic.js - WebPrinter 진단 스크립트
const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

console.log('🔍 WebPrinter 진단 시작...\n');

class WebPrinterDiagnostic {
  constructor() {
    this.results = {
      electron: { status: 'pending', message: '' },
      paths: { status: 'pending', message: '' },
      modules: { status: 'pending', message: '' },
      server: { status: 'pending', message: '' },
      window: { status: 'pending', message: '' },
      ipc: { status: 'pending', message: '' }
    };
  }

  // 1. Electron 환경 체크
  checkElectron() {
    console.log('1️⃣ Electron 환경 체크...');
    
    try {
      const version = process.versions.electron;
      const nodeVersion = process.versions.node;
      const chromiumVersion = process.versions.chrome;
      
      this.results.electron = {
        status: 'success',
        message: `Electron: ${version}, Node: ${nodeVersion}, Chromium: ${chromiumVersion}`
      };
      
      console.log(`✅ Electron ${version} 정상`);
      console.log(`   Node.js: ${nodeVersion}`);
      console.log(`   Chromium: ${chromiumVersion}`);
      
    } catch (error) {
      this.results.electron = {
        status: 'error',
        message: error.message
      };
      console.error('❌ Electron 체크 실패:', error.message);
    }
  }

  // 2. 경로 체크
  checkPaths() {
    console.log('\n2️⃣ 경로 체크...');
    
    const paths = {
      '실행 경로': process.execPath,
      '작업 디렉토리': process.cwd(),
      '리소스 경로': process.resourcesPath || 'N/A',
      '__dirname': __dirname,
      'app.getPath("userData")': app.getPath('userData'),
      'app.getPath("temp")': app.getPath('temp')
    };
    
    let hasIssue = false;
    
    Object.entries(paths).forEach(([name, path]) => {
      console.log(`   ${name}: ${path}`);
      
      // 한글이나 특수문자 체크
      if (path && /[가-힣]/.test(path)) {
        console.warn(`   ⚠️ 경로에 한글 포함됨`);
        hasIssue = true;
      }
    });
    
    this.results.paths = {
      status: hasIssue ? 'warning' : 'success',
      message: hasIssue ? '경로에 한글이 포함되어 있습니다' : '모든 경로 정상'
    };
  }

  // 3. 필수 모듈 체크
  checkModules() {
    console.log('\n3️⃣ 필수 모듈 체크...');
    
    const requiredModules = [
      { name: 'http', check: () => require('http') },
      { name: 'fs', check: () => require('fs') },
      { name: 'path', check: () => require('path') },
      { name: 'electron', check: () => require('electron') }
    ];
    
    const optionalModules = [
      { name: 'express', check: () => require('express') },
      { name: 'cors', check: () => require('cors') },
      { name: 'pdf-to-printer', check: () => require('pdf-to-printer') }
    ];
    
    let allRequired = true;
    
    // 필수 모듈
    console.log('   필수 모듈:');
    requiredModules.forEach(module => {
      try {
        module.check();
        console.log(`   ✅ ${module.name}`);
      } catch (error) {
        console.error(`   ❌ ${module.name} - ${error.message}`);
        allRequired = false;
      }
    });
    
    // 선택 모듈
    console.log('   선택 모듈:');
    optionalModules.forEach(module => {
      try {
        module.check();
        console.log(`   ✅ ${module.name}`);
      } catch (error) {
        console.log(`   ⚠️ ${module.name} - 설치되지 않음`);
      }
    });
    
    this.results.modules = {
      status: allRequired ? 'success' : 'error',
      message: allRequired ? '필수 모듈 모두 정상' : '필수 모듈 누락'
    };
  }

  // 4. HTTP 서버 테스트
  async checkServer() {
    console.log('\n4️⃣ HTTP 서버 테스트...');
    
    return new Promise((resolve) => {
      const testServer = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      });
      
      const testPort = 18799;
      
      testServer.listen(testPort, 'localhost', () => {
        console.log(`   ✅ 테스트 서버 시작 (포트 ${testPort})`);
        
        // 서버 접속 테스트
        http.get(`http://localhost:${testPort}`, (res) => {
          console.log(`   ✅ 서버 응답 확인 (상태: ${res.statusCode})`);
          
          this.results.server = {
            status: 'success',
            message: 'HTTP 서버 정상 작동'
          };
          
          testServer.close();
          resolve();
          
        }).on('error', (error) => {
          console.error(`   ❌ 서버 접속 실패:`, error.message);
          
          this.results.server = {
            status: 'error',
            message: error.message
          };
          
          testServer.close();
          resolve();
        });
        
      }).on('error', (error) => {
        console.error(`   ❌ 서버 시작 실패:`, error.message);
        
        this.results.server = {
          status: 'error',
          message: error.message
        };
        
        resolve();
      });
    });
  }

  // 5. BrowserWindow 테스트
  async checkWindow() {
    console.log('\n5️⃣ BrowserWindow 테스트...');
    
    return new Promise((resolve) => {
      try {
        const testWindow = new BrowserWindow({
          width: 400,
          height: 300,
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });
        
        testWindow.once('ready-to-show', () => {
          console.log('   ✅ 윈도우 생성 성공');
          
          this.results.window = {
            status: 'success',
            message: 'BrowserWindow 정상 작동'
          };
          
          testWindow.close();
          resolve();
        });
        
        // HTML 컨텐츠 로드
        testWindow.loadURL('data:text/html,<h1>Test</h1>');
        
        // 타임아웃
        setTimeout(() => {
          if (!testWindow.isDestroyed()) {
            testWindow.close();
          }
          resolve();
        }, 3000);
        
      } catch (error) {
        console.error('   ❌ 윈도우 생성 실패:', error.message);
        
        this.results.window = {
          status: 'error',
          message: error.message
        };
        
        resolve();
      }
    });
  }

  // 6. IPC 통신 테스트
  async checkIPC() {
    console.log('\n6️⃣ IPC 통신 테스트...');
    
    const { ipcMain } = require('electron');
    
    return new Promise((resolve) => {
      try {
        // IPC 핸들러 등록
        ipcMain.handle('test-ping', () => 'pong');
        
        console.log('   ✅ IPC 핸들러 등록 성공');
        
        // 테스트 윈도우 생성
        const testWindow = new BrowserWindow({
          width: 400,
          height: 300,
          show: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
          }
        });
        
        testWindow.webContents.once('did-finish-load', async () => {
          try {
            // IPC 테스트 실행
            const result = await testWindow.webContents.executeJavaScript(`
              window.electronAPI ? 'API Available' : 'API Not Found'
            `);
            
            if (result === 'API Available') {
              console.log('   ✅ Preload API 정상');
              this.results.ipc = {
                status: 'success',
                message: 'IPC 통신 정상'
              };
            } else {
              console.log('   ⚠️ Preload API 없음');
              this.results.ipc = {
                status: 'warning',
                message: 'Preload API를 찾을 수 없음'
              };
            }
            
          } catch (error) {
            console.error('   ❌ IPC 테스트 실패:', error.message);
            this.results.ipc = {
              status: 'error',
              message: error.message
            };
          }
          
          testWindow.close();
          resolve();
        });
        
        // preload.js가 없어도 테스트 진행
        testWindow.loadURL('data:text/html,<h1>IPC Test</h1>').catch(() => {
          console.log('   ⚠️ Preload 스크립트 없음');
          this.results.ipc = {
            status: 'warning',
            message: 'Preload 스크립트를 찾을 수 없음'
          };
          testWindow.close();
          resolve();
        });
        
      } catch (error) {
        console.error('   ❌ IPC 설정 실패:', error.message);
        this.results.ipc = {
          status: 'error',
          message: error.message
        };
        resolve();
      }
    });
  }

  // 결과 요약
  printSummary() {
    console.log('\n📊 진단 결과 요약');
    console.log('==================');
    
    let hasError = false;
    let hasWarning = false;
    
    Object.entries(this.results).forEach(([category, result]) => {
      const icon = result.status === 'success' ? '✅' : 
                   result.status === 'warning' ? '⚠️' : '❌';
      
      console.log(`${icon} ${category}: ${result.message}`);
      
      if (result.status === 'error') hasError = true;
      if (result.status === 'warning') hasWarning = true;
    });
    
    console.log('\n🏁 최종 진단:');
    if (hasError) {
      console.log('❌ 심각한 문제가 발견되었습니다. 위의 오류를 해결해야 합니다.');
    } else if (hasWarning) {
      console.log('⚠️ 경고 사항이 있지만 실행은 가능합니다.');
    } else {
      console.log('✅ 모든 테스트를 통과했습니다!');
    }
    
    // 권장 사항
    console.log('\n💡 권장 사항:');
    if (this.results.paths.status === 'warning') {
      console.log('- 설치 경로를 영문으로 변경하세요');
    }
    if (this.results.modules.status === 'warning') {
      console.log('- npm install을 실행하여 선택 모듈을 설치하세요');
    }
    if (this.results.server.status === 'error') {
      console.log('- 방화벽이나 바이러스 백신 설정을 확인하세요');
      console.log('- 다른 프로그램이 포트를 사용 중인지 확인하세요');
    }
  }

  // 진단 실행
  async run() {
    this.checkElectron();
    this.checkPaths();
    this.checkModules();
    await this.checkServer();
    await this.checkWindow();
    await this.checkIPC();
    this.printSummary();
    
    // 진단 완료 후 종료
    setTimeout(() => {
      app.quit();
    }, 1000);
  }
}

// 실행
app.whenReady().then(() => {
  const diagnostic = new WebPrinterDiagnostic();
  diagnostic.run();
});

app.on('window-all-closed', () => {
  app.quit();
});