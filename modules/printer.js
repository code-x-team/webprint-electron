const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const ptp = require('pdf-to-printer');

// ========== 메인 함수 ==========
async function printViaPDF(url, paperSize, printSelector, copies, silent, printerName, outputType = 'pdf', rotate180 = false) {
  try {
    // 먼저 요소 개수 확인
    const elementCount = await getElementCount(url, printSelector);
    console.log(`발견된 ${printSelector} 요소 개수:`, elementCount);
    
    if (outputType === 'pdf') {
      // PDF 모드: 기존 방식 (병합된 1개 PDF)
      const pdfBuffer = await generatePDF(url, paperSize, printSelector, rotate180);
      const pdfPath = await savePermanentPDF(pdfBuffer);
      await openPDFPreview(pdfPath);
      const message = elementCount > 1 ? `${elementCount}개 페이지 PDF가 생성되었습니다` : 'PDF가 생성되었습니다';
      return { success: true, pdfPath, message, shouldClose: true };
      
    } else {
      // 프린터 모드: 개별 PDF 생성 → 순차 인쇄
      console.log(`개별 PDF 생성 시작 - 총 ${elementCount}개 페이지`);
      
      for (let i = 0; i < elementCount; i++) {
        const currentPage = i + 1;
        console.log(`${currentPage}/${elementCount} 페이지 처리 중...`);
        
        // 진행 상황 알림 (선택적)
        try {
          const { notifyWindow } = require('./window');
          notifyWindow(null, null, {
            type: 'progress',
            message: `${currentPage}/${elementCount} 페이지 인쇄 중...`,
            current: currentPage,
            total: elementCount
          });
        } catch (notifyError) {
          // 알림 실패 무시
        }
        
        try {
          // 개별 PDF 생성
          const pdfBuffer = await generatePDFByIndex(url, paperSize, printSelector, i, rotate180);
          
          // 임시 저장
          const tempPdfPath = await saveTempPDF(pdfBuffer, `page_${currentPage}`);
          
          // 프린터로 전송
          const printOptions = {
            printer: printerName === 'system-default' ? undefined : printerName,
            copies: 1, // 개별 인쇄는 항상 1부
            silent: silent
          };
          
          // undefined 옵션 제거
          Object.keys(printOptions).forEach(key => {
            if (printOptions[key] === undefined) {
              delete printOptions[key];
            }
          });
          
          await ptp.print(tempPdfPath, printOptions);
          console.log(`${currentPage}/${elementCount} 페이지 인쇄 완료`);
          
          // 5초 후 임시 파일 삭제
          setTimeout(async () => {
            try {
              await fs.unlink(tempPdfPath);
            } catch (deleteError) {
              // 삭제 실패 무시
            }
          }, 5000);
          
        } catch (pageError) {
          console.error(`${currentPage}/${elementCount} 페이지 처리 실패:`, pageError);
          // 개별 페이지 실패해도 계속 진행
        }
      }
      
      const message = elementCount > 1 ? 
        `${elementCount}개 페이지가 순차적으로 프린터로 전송되었습니다.` : 
        '인쇄 작업이 프린터로 전송되었습니다.';
        
      return { 
        success: true, 
        shouldClose: true, 
        message: message
      };
    }
    
  } catch (error) {
    let errorMessage = error.message;
    
    // 에러 메시지 사용자 친화적으로 변환
    if (error.message.includes('ERR_NAME_NOT_RESOLVED')) {
      errorMessage = 'URL에 접근할 수 없습니다. 인터넷 연결을 확인해주세요.';
    } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {
      errorMessage = '서버에 연결할 수 없습니다.';
    } else if (error.message.includes('printer')) {
      errorMessage = '프린터 오류가 발생했습니다. 프린터 연결을 확인해주세요.';
    }
    
    throw new Error(errorMessage);
  }
}

// ========== 요소 개수 확인 함수 ==========
async function getElementCount(url, printSelector) {
  const tempWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      offscreen: true
    }
  });
  
  try {
    await tempWindow.loadURL(url);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const count = await tempWindow.webContents.executeJavaScript(`
      (function() {
        const elements = document.querySelectorAll('${printSelector}');
        return elements.length;
      })()
    `);
    
    return count;
  } finally {
    if (tempWindow && !tempWindow.isDestroyed()) {
      tempWindow.close();
    }
  }
}

// ========== 개별 PDF 생성 함수 ==========
async function generatePDFByIndex(url, paperSize, printSelector, index, rotate180 = false) {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      offscreen: true,
      backgroundThrottling: false
    }
  });
  
  try {
    // URL 로드 및 대기
    await pdfWindow.loadURL(url);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 특정 인덱스의 요소만 선택하여 인쇄
    if (printSelector) {
      await pdfWindow.webContents.executeJavaScript(`
        (function() {
          const targetElements = document.querySelectorAll('${printSelector}');
          if (targetElements.length > ${index} && targetElements[${index}]) {
            // 기존 body 내용을 제거하고 특정 인덱스의 요소만 추가
            document.body.innerHTML = '';
            document.body.appendChild(targetElements[${index}].cloneNode(true));
            
            // 스타일 적용
            const element = document.body.firstChild;
            element.style.cssText = \`
              width: ${paperSize.width}mm !important;
              height: ${paperSize.height}mm !important;
              margin: 0 auto !important;
              transform: ${rotate180 ? 'rotate(180deg)' : 'none'} !important;
              transform-origin: center center !important;
              display: block !important;
            \`;
            
            // body 스타일 설정
            document.body.style.cssText = \`
              margin: 0 !important;
              padding: 0 !important;
              display: flex !important;
              justify-content: center !important;
              align-items: center !important;
              min-height: 100vh !important;
            \`;
          }
          return true;
        })()
      `);

      await pdfWindow.webContents.insertCSS(`
        @page {
          margin: 0mm 0mm 0mm 0mm; 
          padding: 0;
          size: A4;
        }
        
        @media print {
          body {
            padding: 0;
            margin: 0;
          }
          .print-content {
            padding: 0;
            margin: 0;
          }
        }
      `);
    }
    
    // PDF 생성 옵션
    const pdfOptions = {
      pageSize: 'A4',
      marginsType: 1, // 0=기본, 1=없음, 2=최소
      margins: { 
        top: 0, 
        bottom: 0, 
        left: 0, 
        right: 0 
      },
      printBackground: true,
      landscape: false
    };
    
    // PDF 생성
    const pdfBuffer = await pdfWindow.webContents.printToPDF(pdfOptions);
    return pdfBuffer;
    
  } finally {
    // 윈도우 정리
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

// ========== PDF 생성 함수 ==========
async function generatePDF(url, paperSize, printSelector, rotate180 = false) {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 1600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      offscreen: true,
      backgroundThrottling: false
    }
  });
  
  try {
    // URL 로드 및 대기
    await pdfWindow.loadURL(url);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 특정 요소들을 선택하여 인쇄
    if (printSelector) {
      await pdfWindow.webContents.executeJavaScript(`
        (function() {
          const targetElements = document.querySelectorAll('${printSelector}');
          if (targetElements.length > 0) {
            // 기존 body 내용을 제거
            document.body.innerHTML = '';
            
            // 모든 대상 요소들을 body에 추가
            targetElements.forEach((targetElement, index) => {
              const clonedElement = targetElement.cloneNode(true);
              
              // 스타일 적용
              clonedElement.style.cssText = \`
                width: ${paperSize.width}mm !important;
                height: ${paperSize.height}mm !important;
                margin: 0 auto !important;
                transform: ${rotate180 ? 'rotate(180deg)' : 'none'} !important;
                transform-origin: center center !important;
                page-break-after: \${index < targetElements.length - 1 ? 'always' : 'auto'} !important;
                display: block !important;
              \`;
              
              document.body.appendChild(clonedElement);
            });
            
            // body 스타일 설정
            document.body.style.cssText = \`
              margin: 0 !important;
              padding: 0 !important;
            \`;
          }
          return targetElements.length;
        })()
      `);

      await pdfWindow.webContents.insertCSS(`
        @page {
          margin: 0mm 0mm 0mm 0mm; 
          padding: 0;
          size: A4;
        }
        
        @media print {
          body {
            padding: 0;
            margin: 0;
          }
          .print-content {
            padding: 0;
            margin: 0;
          }
        }
      `);
    }
    
    // PDF 생성 옵션
    const pdfOptions = {
      pageSize: 'A4',
      marginsType: 1, // 0=기본, 1=없음, 2=최소
      margins: { 
        top: 0, 
        bottom: 0, 
        left: 0, 
        right: 0 
      },
      printBackground: true,
      landscape: false
    };
    
    // PDF 생성
    const pdfBuffer = await pdfWindow.webContents.printToPDF(pdfOptions);
    return pdfBuffer;
    
  } finally {
    // 윈도우 정리
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

// ========== 파일 저장 함수 ==========
async function saveTempPDF(pdfBuffer, pagePrefix = '') {
  const tempDir = os.tmpdir();
  const prefix = pagePrefix ? `${pagePrefix}_` : '';
  const tempFileName = `webprinter_temp_${prefix}${Date.now()}.pdf`;
  const tempPath = path.join(tempDir, tempFileName);
  
  await fs.writeFile(tempPath, pdfBuffer);
  return tempPath;
}

async function savePermanentPDF(pdfBuffer) {
  // Downloads/WebPrinter 폴더에 저장
  const saveDirectory = path.join(os.homedir(), 'Downloads', 'WebPrinter');
  await fs.mkdir(saveDirectory, { recursive: true });
  
  // 타임스탬프가 포함된 파일명 생성
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19);
  
  const fileName = `WebPrinter_${timestamp}.pdf`;
  const filePath = path.join(saveDirectory, fileName);
  
  await fs.writeFile(filePath, pdfBuffer);
  return filePath;
}

// ========== PDF 미리보기 함수 ==========
async function openPDFPreview(pdfPath) {
  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);
  
  try {
    if (process.platform === 'win32') {
      // Windows
      await execAsync(`start "" "${pdfPath}"`);
    } else if (process.platform === 'darwin') {
      // macOS
      await execAsync(`open "${pdfPath}"`);
    } else {
      // Linux
      await execAsync(`xdg-open "${pdfPath}"`);
    }
  } catch (error) {
    throw new Error('PDF 뷰어 실행 실패');
  }
}

// ========== 프린터 관련 함수 ==========
async function getPrinters() {
  try {
    const printers = await ptp.getPrinters();
    
    // 시스템 기본 프린터 옵션 추가
    return [
      { name: 'system-default', displayName: '시스템 기본 프린터', isDefault: true },
      ...printers.map(printer => ({
        name: printer.name,
        displayName: printer.name,
        isDefault: printer.isDefault || false
      }))
    ];
  } catch (error) {
    console.error('프린터 목록 조회 실패:', error);
    return [{ name: 'system-default', displayName: '시스템 기본 프린터', isDefault: true }];
  }
}

// ========== 정리 함수 ==========
async function cleanupOldPDFs() {
  try {
    const webprinterDir = path.join(os.homedir(), 'Downloads', 'WebPrinter');
    
    // 디렉토리 존재 확인
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
          console.log(`오래된 PDF 삭제: ${file}`);
        }
      } catch (fileError) {
        // 파일 삭제 실패 무시
      }
    }
  } catch (error) {
    console.error('PDF 정리 중 오류:', error);
  }
}

// ========== 내보내기 ==========
module.exports = {
  printViaPDF,
  getPrinters,
  cleanupOldPDFs
};