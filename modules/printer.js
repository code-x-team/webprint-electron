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
      // 프린터로 직접 출력 (PDF → PNG → 인쇄)
      console.log('프린터 출력 준비 중 (PDF → PNG → 인쇄)...');
      let tempPdfPath = null;
      let tempPngPath = null;
      
      try {
        // 1단계: PDF 임시 파일 생성
        tempPdfPath = await saveTempPDF(pdfBuffer);
        console.log('임시 PDF 파일 준비 완료');
        
        // 2단계: PDF를 PNG로 변환 시도
        try {
          tempPngPath = await convertPdfToPng(tempPdfPath);
          console.log('PDF → PNG 변환 완료, 이미지 인쇄 시작...');
          
          // 3단계: PNG 이미지 인쇄
          await printImageDirectly(tempPngPath, printerName, copies);
          console.log('이미지 인쇄 명령 완료');
          
          // 작업 완료 알림
          var successMessage = '이미지로 변환하여 프린터 전송 완료';
          
        } catch (convertError) {
          console.log('PNG 변환 실패, PDF 직접 인쇄로 fallback:', convertError.message);
          
          // Fallback: PDF 직접 인쇄
          await printDirectly(tempPdfPath, printerName, copies);
          console.log('PDF 직접 인쇄 명령 완료');
          
          // 작업 완료 알림
          var successMessage = 'PDF 파일로 프린터 전송 완료';
        }
        
        // 출력 후 임시 파일들 삭제 (PDF + PNG)
        setTimeout(async () => {
          try {
            if (tempPdfPath) {
              await fs.unlink(tempPdfPath);
              console.log('임시 PDF 파일 삭제 완료:', tempPdfPath);
            }
            if (tempPngPath) {
              await fs.unlink(tempPngPath);
              console.log('임시 PNG 파일 삭제 완료:', tempPngPath);
            }
          } catch (deleteError) {
            console.warn('임시 파일 삭제 실패:', deleteError.message);
          }
        }, 10000); // 10초 대기
        
        // 작업 완료 알림
        return { success: true, shouldClose: true, message: successMessage };
      } catch (printError) {
        console.error('이미지 인쇄 과정에서 오류:', printError);
        
        // 임시 파일들 즉시 삭제
        if (tempPdfPath) {
          try {
            await fs.unlink(tempPdfPath);
            console.log('오류 발생 후 임시 PDF 파일 삭제:', tempPdfPath);
          } catch (deleteError) {
            console.warn('오류 후 PDF 파일 삭제 실패:', deleteError.message);
          }
        }
        if (tempPngPath) {
          try {
            await fs.unlink(tempPngPath);
            console.log('오류 발생 후 임시 PNG 파일 삭제:', tempPngPath);
          } catch (deleteError) {
            console.warn('오류 후 PNG 파일 삭제 실패:', deleteError.message);
          }
        }
        
        throw printError;
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
  try {
    const tempDir = os.tmpdir();
    const tempFileName = `webprinter_temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.pdf`;
    const tempPath = path.join(tempDir, tempFileName);
    
    console.log('임시 PDF 파일 생성:', tempPath);
    
    // 임시 디렉토리 존재 확인
    await fs.mkdir(tempDir, { recursive: true });
    
    // PDF 파일 쓰기
    await fs.writeFile(tempPath, pdfBuffer);
    
    // 파일 생성 확인
    const stats = await fs.stat(tempPath);
    console.log('임시 PDF 파일 생성 완료:', { 
      path: tempPath, 
      size: stats.size,
      bufferSize: pdfBuffer.length 
    });
    
    if (stats.size !== pdfBuffer.length) {
      throw new Error('PDF 파일 크기가 일치하지 않습니다');
    }
    
    return tempPath;
  } catch (error) {
    console.error('임시 PDF 파일 생성 실패:', error);
    throw new Error(`임시 파일 생성 실패: ${error.message}`);
  }
}

async function convertPdfToPng(pdfPath) {
  console.log('PDF를 PNG로 변환 시작 (pdfjs-dist 사용):', pdfPath);
  
  try {
    // PDF 파일을 base64로 읽기
    const pdfBuffer = await fs.readFile(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    console.log('PDF 파일 로드 완료, 크기:', pdfBuffer.length);
    
    // PDF 렌더링을 위한 새 윈도우 생성
    const pdfWindow = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
        offscreen: true,
        backgroundThrottling: false
      }
    });
    
    try {
      // pdfjs-dist를 사용한 PDF 렌더링 HTML
      const pdfRenderHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background: white; }
            canvas { display: block; border: 1px solid #ccc; }
          </style>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
        </head>
        <body>
          <canvas id="pdfCanvas"></canvas>
          <script>
            async function renderPdf() {
              try {
                console.log('PDF 렌더링 시작...');
                
                // PDF 데이터 디코딩
                const pdfData = atob('${pdfBase64}');
                const uint8Array = new Uint8Array(pdfData.length);
                for (let i = 0; i < pdfData.length; i++) {
                  uint8Array[i] = pdfData.charCodeAt(i);
                }
                
                // PDF 문서 로드
                const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
                console.log('PDF 로드 완료, 페이지 수:', pdf.numPages);
                
                // 첫 번째 페이지 가져오기
                const page = await pdf.getPage(1);
                console.log('첫 번째 페이지 로드 완료');
                
                // 뷰포트 설정 (A4 크기, 고해상도)
                const scale = 2.0;
                const viewport = page.getViewport({ scale: scale });
                
                // 캔버스 설정
                const canvas = document.getElementById('pdfCanvas');
                const context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                console.log('캔버스 크기 설정:', viewport.width, 'x', viewport.height);
                
                // PDF 페이지를 캔버스에 렌더링
                const renderContext = {
                  canvasContext: context,
                  viewport: viewport
                };
                
                await page.render(renderContext).promise;
                console.log('PDF 렌더링 완료!');
                
                // 렌더링 완료 신호
                window.pdfRenderComplete = true;
                
              } catch (error) {
                console.error('PDF 렌더링 오류:', error);
                window.pdfRenderError = error.message;
              }
            }
            
            // 페이지 로드 후 PDF 렌더링 시작
            window.onload = () => {
              setTimeout(renderPdf, 100);
            };
          </script>
        </body>
        </html>
      `;
      
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pdfRenderHtml)}`);
      
      // PDF 렌더링 완료까지 대기 (최대 30초)
      let attempts = 0;
      const maxAttempts = 60; // 30초 (500ms * 60)
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const isComplete = await pdfWindow.webContents.executeJavaScript('window.pdfRenderComplete || false');
        const hasError = await pdfWindow.webContents.executeJavaScript('window.pdfRenderError || null');
        
        if (hasError) {
          throw new Error(`PDF 렌더링 오류: ${hasError}`);
        }
        
        if (isComplete) {
          console.log('PDF 렌더링 완료 확인됨');
          break;
        }
        
        attempts++;
      }
      
      if (attempts >= maxAttempts) {
        throw new Error('PDF 렌더링 시간 초과');
      }
      
      // 추가 안정화 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 렌더링된 페이지 캡처
      const image = await pdfWindow.capturePage();
      
      // PNG 임시 파일 경로 생성
      const tempDir = os.tmpdir();
      const pngFileName = `webprinter_temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
      const pngPath = path.join(tempDir, pngFileName);
      
      // PNG 파일 저장
      await fs.writeFile(pngPath, image.toPNG());
      
      console.log('PDF → PNG 변환 완료:', pngPath);
      
      // 파일 크기 확인
      const stats = await fs.stat(pngPath);
      console.log('PNG 파일 크기:', stats.size);
      
      if (stats.size < 5000) { // 최소 5KB 이상이어야 함
        throw new Error('생성된 PNG 파일이 너무 작습니다 (렌더링 실패 가능성)');
      }
      
      pdfWindow.close();
      return pngPath;
      
    } catch (renderError) {
      console.error('PDF 렌더링 실패:', renderError);
      if (pdfWindow && !pdfWindow.isDestroyed()) {
        pdfWindow.close();
      }
      throw renderError;
    }
    
  } catch (error) {
    console.error('pdfjs PDF to PNG 변환 실패:', error);
    throw new Error(`pdfjs PDF to PNG 변환 실패: ${error.message}`);
  }
}

async function printImageDirectly(imagePath, printerName, copies = 1) {
  console.log('printImageDirectly 시작:', { imagePath, printerName, copies, platform: process.platform });
  
  try {
    if (process.platform === 'win32') {
      // Windows에서 이미지 인쇄 (훨씬 더 안정적)
      const escapedPath = imagePath.replace(/'/g, "''");
      const escapedPrinterName = printerName.replace(/'/g, "''");
      
      if (printerName && printerName !== 'system-default') {
        console.log('Windows 이미지 인쇄 시작...');
        
        // 인쇄 전 작업 수 확인
        const { stdout: beforeJobs } = await execAsync(`powershell -command "Get-PrintJob -PrinterName '${escapedPrinterName}' | Measure-Object | Select-Object -ExpandProperty Count"`).catch(() => ({ stdout: '0' }));
        console.log('인쇄 전 작업 수:', beforeJobs.trim());
        
        // Windows 내장 mspaint를 이용한 이미지 인쇄 (가장 확실한 방법)
        try {
          await execAsync(`powershell -command "
            $process = Start-Process -FilePath 'mspaint' -ArgumentList '/pt','${escapedPath}','${escapedPrinterName}' -WindowStyle Hidden -PassThru
            Start-Sleep -Seconds 5
            if (!$process.HasExited) {
              $process.Kill()
            }
          "`);
          console.log('mspaint 인쇄 명령 완료');
        } catch (paintError) {
          console.log('mspaint 실패, PowerShell 이미지 인쇄 시도...');
          
          // PowerShell을 통한 직접 이미지 인쇄
          await execAsync(`powershell -command "
            Add-Type -AssemblyName System.Drawing
            Add-Type -AssemblyName System.Drawing.Printing
            
            $image = [System.Drawing.Image]::FromFile('${escapedPath}')
            $printDoc = New-Object System.Drawing.Printing.PrintDocument
            $printDoc.PrinterSettings.PrinterName = '${escapedPrinterName}'
            
            $printDoc.add_PrintPage({
              param($sender, $e)
              $e.Graphics.DrawImage($image, $e.MarginBounds)
            })
            
            if ($printDoc.PrinterSettings.IsValid) {
              $printDoc.Print()
              Write-Host 'PowerShell 이미지 인쇄 완료'
            } else {
              throw 'Printer not valid'
            }
            
            $image.Dispose()
          "`);
        }
        
        // 인쇄 후 작업 수 확인
        await new Promise(resolve => setTimeout(resolve, 3000));
        const { stdout: afterJobs } = await execAsync(`powershell -command "Get-PrintJob -PrinterName '${escapedPrinterName}' | Measure-Object | Select-Object -ExpandProperty Count"`).catch(() => ({ stdout: '0' }));
        console.log('인쇄 후 작업 수:', afterJobs.trim());
        
        if (parseInt(afterJobs.trim()) > parseInt(beforeJobs.trim())) {
          console.log('✅ 이미지 인쇄 작업이 프린터 큐에 추가됨');
        } else {
          console.log('❌ 이미지 인쇄 작업이 큐에 추가되지 않음');
          throw new Error('이미지 인쇄 작업이 프린터 큐에 전달되지 않았습니다');
        }
        
      } else {
        // 기본 프린터 사용
        console.log('기본 프린터로 이미지 인쇄');
        await execAsync(`powershell -command "Start-Process -FilePath '${escapedPath}' -Verb Print -WindowStyle Hidden"`);
      }
      
      console.log('Windows 이미지 인쇄 완료');
      
    } else if (process.platform === 'darwin') {
      // macOS: 이미지 인쇄
      let printCmd = `lpr -# ${copies}`;
      if (printerName && printerName !== 'system-default') {
        printCmd += ` -P "${printerName}"`;
      }
      printCmd += ` "${imagePath}"`;
      
      console.log('macOS 이미지 인쇄 명령 실행:', printCmd);
      const result = await execAsync(printCmd);
      console.log('macOS 이미지 인쇄 결과:', result);
      
    } else {
      // Linux: 이미지 인쇄
      let printCmd = `lp -n ${copies}`;
      if (printerName && printerName !== 'system-default') {
        printCmd += ` -d "${printerName}"`;
      }
      printCmd += ` "${imagePath}"`;
      
      console.log('Linux 이미지 인쇄 명령 실행:', printCmd);
      const result = await execAsync(printCmd);
      console.log('Linux 이미지 인쇄 결과:', result);
    }
    
    console.log('printImageDirectly 성공 완료');
    
  } catch (error) {
    console.error('이미지 인쇄 상세 오류:', {
      message: error.message,
      code: error.code,
      stderr: error.stderr,
      stdout: error.stdout
    });
    
    throw new Error(`이미지 인쇄 실패: ${error.message}`);
  }
}

async function printDirectly(pdfPath, printerName, copies = 1) {
  console.log('printDirectly 시작:', { pdfPath, printerName, copies, platform: process.platform });
  
  try {
    if (process.platform === 'win32') {
      // Windows: 향상된 PowerShell 명령어 사용
      const escapedPath = pdfPath.replace(/'/g, "''");
      
      if (printerName && printerName !== 'system-default') {
        // 특정 프린터 지정 - 더 안정적인 방법 사용
        const escapedPrinterName = printerName.replace(/'/g, "''");
        console.log(`지정된 프린터로 인쇄: ${escapedPrinterName}`);
        
        // 프린터 존재 여부 확인
        try {
          const { stdout } = await execAsync(`powershell -command "Get-Printer | Where-Object {$_.Name -eq '${escapedPrinterName}'} | Select-Object Name"`);
          if (!stdout.trim().includes(printerName)) {
            throw new Error(`프린터 '${printerName}'를 찾을 수 없습니다.`);
          }
        } catch (checkError) {
          console.warn('프린터 확인 실패:', checkError.message);
        }
        
        // Windows에서 PDF를 프린터로 자동 전송 (Silent 인쇄)
        console.log('PDF 자동 인쇄 시작...');
        
        // 방법 1: 인쇄 작업 확인 및 Adobe Reader 사용
        try {
          console.log('Adobe Reader 자동 인쇄 시도...');
          
          // 인쇄 전 현재 인쇄 작업 수 확인
          const { stdout: beforeJobs } = await execAsync(`powershell -command "Get-PrintJob -PrinterName '${escapedPrinterName}' | Measure-Object | Select-Object -ExpandProperty Count"`).catch(() => ({ stdout: '0' }));
          console.log('인쇄 전 작업 수:', beforeJobs.trim());
          
          await execAsync(`powershell -command "
            $adobePath = @(
              'C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe',
              'C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe',
              'C:\\Program Files\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe'
            ) | Where-Object { Test-Path $_ } | Select-Object -First 1
            
            if ($adobePath) {
              Write-Host 'Adobe Reader 실행: ' $adobePath
              $process = Start-Process -FilePath $adobePath -ArgumentList '/t','${escapedPath}','${escapedPrinterName}' -WindowStyle Hidden -PassThru
              Start-Sleep -Seconds 8
              if (!$process.HasExited) {
                Write-Host 'Adobe Reader 프로세스가 아직 실행 중, 강제 종료'
                $process.Kill()
              }
              Write-Host 'Adobe Reader 인쇄 명령 완료'
            } else {
              throw 'Adobe not found'
            }
          "`);
          
          // 인쇄 후 작업 수 확인 (3초 대기 후)
          await new Promise(resolve => setTimeout(resolve, 3000));
          const { stdout: afterJobs } = await execAsync(`powershell -command "Get-PrintJob -PrinterName '${escapedPrinterName}' | Measure-Object | Select-Object -ExpandProperty Count"`).catch(() => ({ stdout: '0' }));
          console.log('인쇄 후 작업 수:', afterJobs.trim());
          
          if (parseInt(afterJobs.trim()) > parseInt(beforeJobs.trim())) {
            console.log('✅ 인쇄 작업이 프린터 큐에 추가됨');
          } else {
            console.log('❌ 인쇄 작업이 큐에 추가되지 않음');
            throw new Error('인쇄 작업이 프린터 큐에 전달되지 않았습니다');
          }
          
          console.log('Adobe Reader 자동 인쇄 완료');
          
        } catch (adobeError) {
          console.log('Adobe Reader 실패, SumatraPDF 시도...');
          
          // 방법 2: Windows 내장 print 명령어 (가장 확실한 방법)
          try {
            console.log('Windows 내장 print 명령어 시도...');
            
            // 인쇄 전 작업 수 확인
            const { stdout: beforeJobs } = await execAsync(`powershell -command "Get-PrintJob -PrinterName '${escapedPrinterName}' | Measure-Object | Select-Object -ExpandProperty Count"`).catch(() => ({ stdout: '0' }));
            console.log('인쇄 전 작업 수:', beforeJobs.trim());
            
            // Windows 내장 print 명령어 사용 (텍스트 파일용이지만 PDF도 때로 작동)
            await execAsync(`print /D:"${escapedPrinterName}" "${escapedPath}"`);
            
            // 인쇄 후 작업 수 확인
            await new Promise(resolve => setTimeout(resolve, 2000));
            const { stdout: afterJobs } = await execAsync(`powershell -command "Get-PrintJob -PrinterName '${escapedPrinterName}' | Measure-Object | Select-Object -ExpandProperty Count"`).catch(() => ({ stdout: '0' }));
            console.log('인쇄 후 작업 수:', afterJobs.trim());
            
            if (parseInt(afterJobs.trim()) > parseInt(beforeJobs.trim())) {
              console.log('✅ Windows print 명령어로 인쇄 성공');
            } else {
              throw new Error('Windows print 명령어 실패');
            }
            
          } catch (sumatraError) {
            console.log('SumatraPDF 실패, 기본 방법 시도...');
            
            // 방법 3: 실패 시 대체 방법 - PDF를 메모장으로 열어서 인쇄 (비상용)
            console.log('모든 자동 방법 실패, 사용자 개입 필요...');
            
            // PDF를 기본 뷰어로 열어서 사용자가 수동으로 인쇄하도록 안내
            await execAsync(`powershell -command "Start-Process -FilePath '${escapedPath}' -Verb Print -WindowStyle Normal"`);
            
            throw new Error(`자동 인쇄가 실패했습니다.\n\nPDF 뷰어가 열렸습니다. 다음 단계를 따라하세요:\n1. Ctrl+P를 누르세요\n2. 프린터를 '${printerName}'로 선택하세요\n3. 인쇄 버튼을 클릭하세요\n\n※ 향후 자동 인쇄를 위해 Adobe Reader 설치를 권장합니다`);
          }
        }

      } else {
        // 기본 프린터 사용 - 자동 인쇄
        console.log('기본 프린터로 자동 인쇄');
        
        // Adobe Reader 먼저 시도
        try {
          await execAsync(`powershell -command "
            $adobePath = @(
              'C:\\Program Files\\Adobe\\Acrobat DC\\Acrobat\\Acrobat.exe',
              'C:\\Program Files (x86)\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe',
              'C:\\Program Files\\Adobe\\Acrobat Reader DC\\Reader\\AcroRd32.exe'
            ) | Where-Object { Test-Path $_ } | Select-Object -First 1
            
            if ($adobePath) {
              Start-Process -FilePath $adobePath -ArgumentList '/t','${escapedPath}' -WindowStyle Hidden -Wait
            } else {
              throw 'Adobe not found'
            }
          "`);
          console.log('기본 프린터로 Adobe Reader 인쇄 완료');
        } catch (error) {
          // Adobe가 없으면 기본 방법 사용
          await execAsync(`powershell -command "
            $proc = Start-Process -FilePath '${escapedPath}' -Verb Print -PassThru -WindowStyle Hidden
            Start-Sleep -Seconds 5
            if (!$proc.HasExited) {
              $proc.CloseMainWindow()
              $proc.Kill()
            }
          "`);
          console.log('기본 프린터로 기본 방법 인쇄 완료');
        }
      }
      
      console.log('Windows 인쇄 명령 실행 완료');
      
      // 인쇄 작업 상태 확인 (선택적)
      try {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
        console.log('인쇄 작업 처리 대기 완료');
      } catch (waitError) {
        console.warn('인쇄 대기 중 오류:', waitError.message);
      }
      
    } else if (process.platform === 'darwin') {
      // macOS: lpr 명령어 사용
      let printCmd = `lpr -# ${copies}`;
      if (printerName && printerName !== 'system-default') {
        // 프린터 존재 여부 확인
        try {
          const { stdout } = await execAsync('lpstat -p');
          if (!stdout.includes(printerName)) {
            throw new Error(`프린터 '${printerName}'를 찾을 수 없습니다.`);
          }
        } catch (checkError) {
          console.warn('프린터 확인 실패:', checkError.message);
        }
        printCmd += ` -P "${printerName}"`;
      }
      printCmd += ` "${pdfPath}"`;
      
      console.log('macOS 인쇄 명령 실행:', printCmd);
      const result = await execAsync(printCmd);
      console.log('macOS 인쇄 결과:', result);
      
    } else {
      // Linux: lp 명령어 사용
      let printCmd = `lp -n ${copies}`;
      if (printerName && printerName !== 'system-default') {
        // 프린터 존재 여부 확인
        try {
          const { stdout } = await execAsync('lpstat -p');
          if (!stdout.includes(printerName)) {
            throw new Error(`프린터 '${printerName}'를 찾을 수 없습니다.`);
          }
        } catch (checkError) {
          console.warn('프린터 확인 실패:', checkError.message);
        }
        printCmd += ` -d "${printerName}"`;
      }
      printCmd += ` "${pdfPath}"`;
      
      console.log('Linux 인쇄 명령 실행:', printCmd);
      const result = await execAsync(printCmd);
      console.log('Linux 인쇄 결과:', result);
    }
    
    console.log('printDirectly 성공 완료');
    
  } catch (error) {
    console.error('프린터 출력 상세 오류:', {
      message: error.message,
      code: error.code,
      stderr: error.stderr,
      stdout: error.stdout
    });
    
    // 구체적인 에러 메시지 제공
    let errorMessage = '프린터로 출력할 수 없습니다.';
    
    if (error.message.includes('not found') || error.message.includes('찾을 수 없습니다')) {
      errorMessage = `선택한 프린터 '${printerName}'를 찾을 수 없습니다. 프린터가 설치되어 있고 온라인 상태인지 확인해주세요.`;
    } else if (error.code === 'ENOENT') {
      errorMessage = '인쇄 시스템에 접근할 수 없습니다. 시스템 권한을 확인해주세요.';
    } else if (error.stderr && error.stderr.includes('Access')) {
      errorMessage = '프린터에 접근할 수 없습니다. 프린터 권한을 확인해주세요.';
    } else if (error.stderr && error.stderr.includes('offline')) {
      errorMessage = '프린터가 오프라인 상태입니다. 프린터 연결을 확인해주세요.';
    }
    
    // 대체 방법 제안: PDF 파일을 바탕화면에 저장
    try {
      console.log('대체 방법: PDF 파일을 바탕화면에 저장...');
      const desktopPath = path.join(os.homedir(), 'Desktop');
      const fileName = `WebPrinter_${Date.now()}.pdf`;
      const desktopPdfPath = path.join(desktopPath, fileName);
      
      // PDF 파일을 바탕화면에 복사
      await fs.copyFile(pdfPath, desktopPdfPath);
      console.log('PDF 파일이 바탕화면에 저장됨:', desktopPdfPath);
      
      errorMessage += `\n\n대신 PDF 파일을 바탕화면에 저장했습니다: ${fileName}\n수동으로 열어서 인쇄해주세요.`;
      
      // 바탕화면 폴더 열기
      if (process.platform === 'win32') {
        await execAsync(`explorer "${desktopPath}"`);
      } else if (process.platform === 'darwin') {
        await execAsync(`open "${desktopPath}"`);
      }
      
    } catch (saveError) {
      console.error('바탕화면 저장 실패:', saveError.message);
    }
    
    throw new Error(errorMessage);
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
  cleanupOldPDFs,
  convertPdfToPng,
  printImageDirectly
};