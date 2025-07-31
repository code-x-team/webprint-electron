const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

async function printViaPDF(url, paperSize, printSelector, copies, silent, printerName, outputType = 'pdf', rotate180 = false) {
  try {
    // PDF 생성 (A4 고정)
    const pdfBuffer = await generatePDF(url, paperSize, printSelector, rotate180);
    
    if (outputType === 'pdf') {
      // PDF 미리보기
      const pdfPath = await savePermanentPDF(pdfBuffer);
      await openPDFPreview(pdfPath);
      return { success: true, pdfPath };
    } else {
      // 프린터로 직접 출력
      const tempPdfPath = await saveTempPDF(pdfBuffer);
      try {
        await printDirectly(tempPdfPath, printerName, copies);
        // 출력 후 임시 파일 삭제
        setTimeout(async () => {
          try {
            await fs.unlink(tempPdfPath);
          } catch (error) {}
        }, 5000);
        return { success: true };
      } catch (error) {
        await fs.unlink(tempPdfPath).catch(() => {});
        throw error;
      }
    }
  } catch (error) {
    throw error;
  }
}

async function generatePDF(url, paperSize, printSelector, rotate180 = false) {
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });
  
  try {
    // URL 로드
    await pdfWindow.loadURL(url);
    
    // 페이지 로드 대기
    await new Promise(resolve => {
      pdfWindow.webContents.once('did-finish-load', () => {
        setTimeout(resolve, 2000);
      });
    });
    
    // DOM 조작 및 스타일 적용
    const jsResult = await pdfWindow.webContents.executeJavaScript(`
      (function() {
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
        
        return { 
          success: true, 
          elementFound: true, 
          selector: selector,
          width: customWidth,
          height: customHeight
        };
      })()
    `).catch(error => {
      console.error('DOM 조작 실패:', error);
      throw new Error('페이지 처리 중 오류가 발생했습니다');
    });
    
    // PDF 생성 옵션 (A4 고정)
    const pdfOptions = {
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      landscape: false,
      preferCSSPageSize: false
    };
    
    return await pdfWindow.webContents.printToPDF(pdfOptions);
    
  } catch (error) {
    console.error('PDF 생성 오류:', error);
    throw error;
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

async function savePermanentPDF(pdfBuffer) {
  const saveDirectory = path.join(os.homedir(), 'Downloads', 'WebPrinter');
  
  try {
    await fs.mkdir(saveDirectory, { recursive: true });
  } catch (error) {
    console.error('디렉토리 생성 실패:', error);
  }
  
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19);
  
  const fileName = `WebPrinter_${timestamp}.pdf`;
  const filePath = path.join(saveDirectory, fileName);
  
  await fs.writeFile(filePath, pdfBuffer);
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
  try {
    if (process.platform === 'win32') {
      await execAsync(`start "" "${pdfPath}"`);
    } else if (process.platform === 'darwin') {
      try {
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
        await execAsync(`open "${pdfPath}"`);
      }
    } else {
      await execAsync(`xdg-open "${pdfPath}"`);
    }
  } catch (error) {
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