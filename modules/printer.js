const { BrowserWindow, app, session } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

async function printViaPDF(url, paperSize, printSelector, copies, silent, printerName, outputType = 'pdf', rotate180 = false) {
  try {
    console.log('PDF 생성 시작:', { url, paperSize, outputType, rotate180 });
    
    // PDF 생성 (A4 고정)
    const pdfBuffer = await generatePDF(url, paperSize, printSelector, rotate180);
    console.log('PDF 버퍼 생성 성공');
    
    if (outputType === 'pdf') {
      // PDF 미리보기
      console.log('PDF 저장 중...');
      const pdfPath = await savePermanentPDF(pdfBuffer);
      console.log('PDF 저장 성공:', pdfPath);
      
      console.log('PDF 미리보기 열기 중...');
      await openPDFPreview(pdfPath);
      console.log('PDF 프로세스 완료');
      
      // 작업 완료 알림
      return { success: true, pdfPath, shouldClose: true };
    } else {
      // 프린터로 직접 출력
      console.log('프린터 출력 준비 중...');
      const tempPdfPath = await saveTempPDF(pdfBuffer);
      try {
        await printDirectly(tempPdfPath, printerName, copies);
        // 출력 후 임시 파일 삭제
        setTimeout(async () => {
          try {
            await fs.unlink(tempPdfPath);
          } catch (error) {}
        }, 5000);
        
        // 작업 완료 알림
        return { success: true, shouldClose: true };
      } catch (error) {
        await fs.unlink(tempPdfPath).catch(() => {});
        throw error;
      }
    }
  } catch (error) {
    console.error('printViaPDF 오류:', error);
    
    // 사용자 친화적 에러 메시지
    let errorMessage = error.message;
    if (error.message.includes('ERR_NAME_NOT_RESOLVED')) {
      errorMessage = 'URL에 접근할 수 없습니다. 인터넷 연결을 확인해주세요.';
    } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {
      errorMessage = '서버에 연결할 수 없습니다.';
    } else if (error.message.includes('macOS PDF')) {
      errorMessage = 'PDF 생성 중 오류가 발생했습니다. 다시 시도해주세요.';
    }
    
    throw new Error(errorMessage);
  }
}

async function generatePDF(url, paperSize, printSelector, rotate180 = false) {
  console.log('generatePDF 시작');
  
  // macOS에서 가비지 컬렉션 실행
  if (process.platform === 'darwin' && global.gc) {
    global.gc();
  }
  
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      offscreen: true,
      backgroundThrottling: false,
      webgl: false,
      enableWebSQL: false,
      allowRunningInsecureContent: true,
      plugins: true
    }
  });
  
  console.log('BrowserWindow 생성 완료');
  
  // 디버깅을 위한 이벤트 리스너
  pdfWindow.webContents.on('did-start-loading', () => {
    console.log('페이지 로딩 시작');
  });
  
  pdfWindow.webContents.on('did-navigate', (event, url) => {
    console.log('페이지 탐색:', url);
  });
  
  pdfWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('페이지 로드 실패:', errorCode, errorDescription);
  });
  
  pdfWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    console.log('인증서 오류 무시:', url);
    event.preventDefault();
    callback(true);
  });
  
  try {
    // URL 로드 with timeout
    console.log('URL 로드 시작:', url);
    
    const loadPromise = pdfWindow.loadURL(url, {
      // 추가 옵션
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('페이지 로드 타임아웃')), 30000)
    );
    
    await Promise.race([loadPromise, timeoutPromise]);
    console.log('URL 로드 완료');
    
    // 페이지 로드 대기
    console.log('페이지 로드 대기 중...');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('페이지 로드 완료 대기 타임아웃'));
      }, 15000);
      
      let resolved = false;
      
      const handleLoad = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log('페이지 로드 이벤트 발생');
          // macOS에서 추가 대기 시간
          const waitTime = process.platform === 'darwin' ? 3000 : 2000;
          setTimeout(resolve, waitTime);
        }
      };
      
      // 여러 이벤트 중 먼저 발생하는 것을 사용
      pdfWindow.webContents.once('did-finish-load', handleLoad);
      pdfWindow.webContents.once('did-stop-loading', handleLoad);
      
      // 백업: dom-ready 이벤트
      pdfWindow.webContents.once('dom-ready', () => {
        console.log('dom-ready 이벤트 발생');
        setTimeout(handleLoad, 1000);
      });
    });
    
    console.log('DOM 준비 대기 중...');
    // DOM이 완전히 준비될 때까지 대기
    await pdfWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (document.readyState === 'complete') {
          setTimeout(resolve, 1000);
        } else {
          window.addEventListener('load', () => setTimeout(resolve, 1000));
        }
      })
    `);
    console.log('DOM 준비 완료');
    
    console.log('DOM 조작 시작...');
    // DOM 조작 및 스타일 적용
    const jsResult = await pdfWindow.webContents.executeJavaScript(`
      (function() {
        try {
          console.log('DOM 조작 시작');
          // 대상 요소 찾기
          const selector = '${printSelector}';
          let targetElement = document.querySelector(selector);
          
          if (!targetElement) {
            // 대체 선택자 시도
            const fallbacks = ['body', '.print-content', '#main', '.container'];
            for (const fallback of fallbacks) {
              targetElement = document.querySelector(fallback);
              if (targetElement) {
                console.log('Using fallback selector:', fallback);
                break;
              }
            }
          }
          
          if (!targetElement) {
            throw new Error('인쇄 대상 요소를 찾을 수 없습니다: ' + selector);
          }
          
          console.log('Target element found:', targetElement.tagName);
          
          // 원본 스타일 저장
          const originalStyles = targetElement.getAttribute('style') || '';
          
          // A4 크기 설정 (210mm x 297mm)
          document.documentElement.style.cssText = 'margin: 0; padding: 0; width: 210mm; height: 297mm;';
          document.body.style.cssText = 'margin: 0; padding: 0; width: 210mm; height: 297mm; overflow: hidden; background: white;';
          
          // 다른 요소 숨기기
          const allElements = document.body.querySelectorAll('*');
          allElements.forEach(el => {
            if (!el.contains(targetElement) && !targetElement.contains(el) && el !== targetElement) {
              el.style.display = 'none';
            }
          });
          
          // 타겟 요소의 부모들 보이기
          let parent = targetElement.parentElement;
          while (parent && parent !== document.body) {
            parent.style.display = 'block';
            parent.style.margin = '0';
            parent.style.padding = '0';
            parent = parent.parentElement;
          }
          
          // 콘텐츠 크기 및 위치 설정
          const customWidth = ${paperSize.width};
          const customHeight = ${paperSize.height};
          const rotate = ${rotate180};
          
          // 상단 중앙 배치
          targetElement.style.cssText = \`
            position: absolute !important;
            top: 0 !important;
            left: 50% !important;
            transform: translateX(-50%) \${rotate ? 'rotate(180deg)' : ''} !important;
            transform-origin: top center !important;
            width: \${customWidth}mm !important;
            height: \${customHeight}mm !important;
            max-width: \${customWidth}mm !important;
            max-height: \${customHeight}mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: white !important;
          \`;
          
          // macOS 스타일 조정
          if (${process.platform === 'darwin'}) {
            // 모든 input과 textarea 숨기기 (Text Input 문제 해결)
            const inputs = document.querySelectorAll('input, textarea');
            inputs.forEach(el => el.style.visibility = 'hidden');
          }
          
          console.log('DOM 조작 완료');
          
          return { 
            success: true, 
            elementFound: true, 
            selector: selector,
            width: customWidth,
            height: customHeight
          };
        } catch (e) {
          console.error('DOM 조작 오류:', e);
          return { success: false, error: e.message };
        }
      })()
    `).catch(error => {
      console.error('DOM 조작 실패:', error);
      throw new Error('페이지 처리 중 오류가 발생했습니다');
    });
    
    console.log('DOM 조작 결과:', jsResult);
    
    if (!jsResult.success) {
      throw new Error(jsResult.error || 'DOM 조작 실패');
    }
    
    console.log('PDF 생성 옵션 설정...');
    // PDF 생성 옵션 (A4 고정)
    const pdfOptions = {
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      landscape: false,
      preferCSSPageSize: false
    };
    
    // macOS에서 추가 대기
    if (process.platform === 'darwin') {
      console.log('macOS 추가 대기...');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('printToPDF 호출...');
    const pdfBuffer = await pdfWindow.webContents.printToPDF(pdfOptions);
    console.log('PDF 생성 완료, 크기:', pdfBuffer.length);
    
    return pdfBuffer;
    
  } catch (error) {
    console.error('PDF 생성 오류:', error);
    
    // macOS 특정 오류 처리
    if (process.platform === 'darwin' && error.message.includes('TIProperty')) {
      throw new Error('macOS PDF 생성 오류. 잠시 후 다시 시도해주세요.');
    }
    
    throw error;
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      // 창 닫기 전 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      pdfWindow.close();
      console.log('PDF 창 닫기 완료');
    }
  }
}

async function savePermanentPDF(pdfBuffer) {
  console.log('PDF 저장 시작, 버퍼 크기:', pdfBuffer.length);
  
  const saveDirectory = path.join(os.homedir(), 'Downloads', 'WebPrinter');
  
  try {
    await fs.mkdir(saveDirectory, { recursive: true });
    console.log('저장 디렉토리 생성/확인:', saveDirectory);
  } catch (error) {
    console.error('디렉토리 생성 실패:', error);
  }
  
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19);
  
  const fileName = `WebPrinter_${timestamp}.pdf`;
  const filePath = path.join(saveDirectory, fileName);
  
  console.log('PDF 파일 쓰기:', filePath);
  await fs.writeFile(filePath, pdfBuffer);
  console.log('PDF 저장 완료');
  
  return filePath;
}

async function saveTempPDF(pdfBuffer) {
  const tempDir = os.tmpdir();
  const tempFileName = `webprinter_temp_${Date.now()}.pdf`;
  const tempPath = path.join(tempDir, tempFileName);
  
  await fs.writeFile(tempPath, pdfBuffer);
  return tempPath;
}

async function printDirectly(pdfPath, printerName, copies = 1) {
  try {
    if (process.platform === 'win32') {
      // Windows: 기본 PDF 리더의 인쇄 기능 사용
      if (printerName && printerName !== 'system-default') {
        // 특정 프린터 지정
        await execAsync(`powershell -command "Start-Process -FilePath '${pdfPath}' -Verb PrintTo -ArgumentList '${printerName}' -WindowStyle Hidden"`);
      } else {
        // 기본 프린터 사용
        await execAsync(`powershell -command "Start-Process -FilePath '${pdfPath}' -Verb Print -WindowStyle Hidden"`);
      }
    } else if (process.platform === 'darwin') {
      // macOS: lpr 명령어 사용
      let printCmd = `lpr -# ${copies}`;
      if (printerName && printerName !== 'system-default') {
        printCmd += ` -P "${printerName}"`;
      }
      printCmd += ` "${pdfPath}"`;
      await execAsync(printCmd);
    } else {
      // Linux: lp 명령어 사용
      let printCmd = `lp -n ${copies}`;
      if (printerName && printerName !== 'system-default') {
        printCmd += ` -d "${printerName}"`;
      }
      printCmd += ` "${pdfPath}"`;
      await execAsync(printCmd);
    }
  } catch (error) {
    console.error('프린터 출력 오류:', error);
    throw new Error('프린터로 출력할 수 없습니다. 프린터 상태를 확인해주세요.');
  }
}

async function openPDFPreview(pdfPath) {
  console.log('PDF 미리보기 열기:', pdfPath);
  
  try {
    if (process.platform === 'win32') {
      await execAsync(`start "" "${pdfPath}"`);
    } else if (process.platform === 'darwin') {
      try {
        console.log('Preview 앱으로 열기 시도...');
        await execAsync(`open -a "Preview" "${pdfPath}"`);
        
        if (app.dock) {
          app.dock.show();
          app.dock.setBadge('PDF');
          setTimeout(() => {
            if (app.dock) {
              app.dock.hide();
              app.dock.setBadge('');
            }
          }, 3000);
        }
      } catch (error) {
        console.log('기본 PDF 뷰어로 열기 시도...');
        await execAsync(`open "${pdfPath}"`);
      }
    } else {
      await execAsync(`xdg-open "${pdfPath}"`);
    }
    
    console.log('PDF 미리보기 열기 성공');
  } catch (error) {
    console.error('PDF 미리보기 열기 실패:', error);
    const folderPath = path.dirname(pdfPath);
    
    if (process.platform === 'win32') {
      await execAsync(`explorer "${folderPath}"`);
    } else if (process.platform === 'darwin') {
      await execAsync(`open "${folderPath}"`);
    } else {
      await execAsync(`xdg-open "${folderPath}"`);
    }
    
    throw new Error(`PDF 뷰어 실행 실패. 저장 폴더를 확인하세요: ${folderPath}`);
  }
}

async function cleanupOldPDFs() {
  try {
    const webprinterDir = path.join(os.homedir(), 'Downloads', 'WebPrinter');
    const exists = await fs.access(webprinterDir).then(() => true).catch(() => false);
    if (!exists) return;
    
    const files = await fs.readdir(webprinterDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24시간
    
    for (const file of files) {
      if (!file.startsWith('WebPrinter_') || !file.endsWith('.pdf')) continue;
      
      const filePath = path.join(webprinterDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
        }
      } catch (fileError) {}
    }
    
    const remainingFiles = await fs.readdir(webprinterDir);
    if (remainingFiles.length === 0) {
      await fs.rmdir(webprinterDir);
    }
  } catch (error) {}
}

module.exports = {
  printViaPDF,
  cleanupOldPDFs
};