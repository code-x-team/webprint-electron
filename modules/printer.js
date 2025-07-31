const { BrowserWindow, app, session } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

// ========== 메인 함수 ==========
async function printViaPDF(url, paperSize, printSelector, copies, silent, printerName, outputType = 'pdf', rotate180 = false) {
  try {
    console.log('PDF 생성 시작:', { url, paperSize, outputType, rotate180 });
    
    // PDF 생성 (A4 고정)
    const pdfBuffer = await generatePDF(url, paperSize, printSelector, rotate180);
    console.log('PDF 버퍼 생성 성공');
    
    if (outputType === 'pdf') {
      // PDF 미리보기
      const pdfPath = await savePermanentPDF(pdfBuffer);
      await openPDFPreview(pdfPath);
      return { success: true, pdfPath, shouldClose: true };
    } else {
      // 프린터로 직접 출력 (PDF → PNG → 인쇄)
      let tempPdfPath = null;
      let tempPngPath = null;
      
      try {
        // 1단계: PDF 임시 파일 생성
        console.log('📄 PDF 임시 파일 생성 시작...');
        tempPdfPath = await saveTempPDF(pdfBuffer);
        
        const pdfStats = await fs.stat(tempPdfPath);
        console.log('✅ PDF 임시 파일 생성 성공:', {
          경로: tempPdfPath,
          크기: `${(pdfStats.size / 1024).toFixed(2)}KB`
        });
        
        // 2단계: PDF를 PNG로 변환
        console.log('🔄 PDF → PNG 변환 시작...');
        tempPngPath = await convertPdfToPng(tempPdfPath);
        console.log('✅ PDF → PNG 변환 성공:', tempPngPath);
        
        const pngStats = await fs.stat(tempPngPath);
        console.log('📊 생성된 PNG 파일 정보:', {
          경로: tempPngPath,
          크기: `${(pngStats.size / 1024).toFixed(2)}KB`
        });
        
        // 3단계: PNG 이미지 인쇄
        console.log('🖨️ PNG 이미지 인쇄 시작...');
        await printImageDirectly(tempPngPath, printerName, copies);
        console.log('✅ PNG 이미지 인쇄 명령 완료');
        
        // 임시 파일 정리 (30초 후)
        setTimeout(async () => {
          try {
            if (tempPdfPath) await fs.unlink(tempPdfPath);
            if (tempPngPath) await fs.unlink(tempPngPath);
            console.log('🗑️ 임시 파일 삭제 완료');
          } catch (deleteError) {
            console.log('⚠️ 임시 파일 삭제 실패:', deleteError.message);
          }
        }, 30000);
        
        return { 
          success: true, 
          shouldClose: true, 
          message: '이미지로 변환하여 프린터 전송 완료' 
        };
        
      } catch (printError) {
        // 에러 발생 시 즉시 정리
        if (tempPdfPath) await fs.unlink(tempPdfPath).catch(() => {});
        if (tempPngPath) await fs.unlink(tempPngPath).catch(() => {});
        throw printError;
      }
    }
  } catch (error) {
    // 사용자 친화적 에러 메시지
    let errorMessage = error.message;
    if (error.message.includes('ERR_NAME_NOT_RESOLVED')) {
      errorMessage = 'URL에 접근할 수 없습니다. 인터넷 연결을 확인해주세요.';
    } else if (error.message.includes('ERR_CONNECTION_REFUSED')) {
      errorMessage = '서버에 연결할 수 없습니다.';
    }
    
    throw new Error(errorMessage);
  }
}

// ========== PDF 생성 함수 ==========
async function generatePDF(url, paperSize, printSelector, rotate180 = false) {
  // macOS 가비지 컬렉션
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
      backgroundThrottling: false
    }
  });
  
  try {
    // URL 로드
    console.log('URL 로드 시작:', url);
    await pdfWindow.loadURL(url);
    console.log('URL 로드 완료');
    
    // 페이지 렌더링 대기
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // DOM 조작 (printSelector 적용)
    await pdfWindow.webContents.executeJavaScript(`
      (function() {
        // 인쇄할 요소만 표시
        const targetElement = document.querySelector('${printSelector}');
        if (targetElement) {
          document.body.innerHTML = '';
          document.body.appendChild(targetElement);
          
          // 스타일 적용
          targetElement.style.cssText = \`
            width: ${paperSize.width}mm !important;
            height: ${paperSize.height}mm !important;
            transform: ${rotate180 ? 'rotate(180deg)' : 'none'} !important;
            transform-origin: center center !important;
          \`;
        }
        return true;
      })()
    `);
    
    // PDF 생성 옵션 (A4 고정)
    const pdfOptions = {
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      landscape: false
    };
    
    const pdfBuffer = await pdfWindow.webContents.printToPDF(pdfOptions);
    console.log('PDF 생성 완료, 크기:', pdfBuffer.length);
    
    return pdfBuffer;
    
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

// ========== PDF → PNG 변환 함수 ==========
async function convertPdfToPng(pdfPath) {
  try {
    const pdfBuffer = await fs.readFile(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    
    // A4 크기를 300 DPI 기준으로 설정
    const A4_WIDTH_300DPI = 2480;  // 8.27 inch × 300 DPI
    const A4_HEIGHT_300DPI = 3508; // 11.69 inch × 300 DPI
    
    const pdfWindow = new BrowserWindow({
      show: false,
      width: A4_WIDTH_300DPI,
      height: A4_HEIGHT_300DPI,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        webSecurity: false,
        offscreen: true,
        backgroundThrottling: false,
        zoomFactor: 1.0
      }
    });
    
    try {
      const pdfRenderHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body { 
              margin: 0; 
              padding: 0; 
              background: #FFFFFF; 
              overflow: hidden;
              width: ${A4_WIDTH_300DPI}px;
              height: ${A4_HEIGHT_300DPI}px;
            }
            canvas { 
              display: block; 
              background: #FFFFFF;
              position: absolute;
              top: 0;
              left: 0;
              image-rendering: pixelated;
              image-rendering: -moz-crisp-edges;
              image-rendering: crisp-edges;
            }
          </style>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
        </head>
        <body>
          <canvas id="pdfCanvas"></canvas>
          <script>
            async function renderPdf() {
              try {
                // PDF 데이터 디코딩
                const pdfData = atob('${pdfBase64}');
                const uint8Array = new Uint8Array(pdfData.length);
                for (let i = 0; i < pdfData.length; i++) {
                  uint8Array[i] = pdfData.charCodeAt(i);
                }
                
                // PDF 문서 로드
                const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
                const page = await pdf.getPage(1);
                
                // 300 DPI로 스케일링
                const scale = 300 / 72; // 4.16666...배
                const viewport = page.getViewport({ scale: scale });
                
                console.log('PDF 원본 크기:', viewport.width, 'x', viewport.height);
                
                // 캔버스 설정
                const canvas = document.getElementById('pdfCanvas');
                const context = canvas.getContext('2d');
                
                // 캔버스 크기를 A4 300DPI로 설정
                canvas.width = ${A4_WIDTH_300DPI};
                canvas.height = ${A4_HEIGHT_300DPI};
                
                // 고품질 렌더링 설정
                context.imageSmoothingEnabled = false;
                context.fillStyle = '#FFFFFF';
                context.fillRect(0, 0, canvas.width, canvas.height);
                
                // PDF를 상단 중앙에 배치
                const offsetX = (${A4_WIDTH_300DPI} - viewport.width) / 2;  // 가로 중앙
                const offsetY = 0;  // 상단에 배치
                
                console.log('PDF 배치:', { offsetX, offsetY });
                
                // PDF 렌더링
                const renderContext = {
                  canvasContext: context,
                  viewport: viewport,
                  intent: 'print',
                  transform: [1, 0, 0, 1, offsetX, offsetY]
                };
                
                await page.render(renderContext).promise;
                window.pdfRenderComplete = true;
                
              } catch (error) {
                window.pdfRenderError = error.message;
              }
            }
            
            window.onload = () => {
              setTimeout(renderPdf, 100);
            };
          </script>
        </body>
        </html>
      `;
      
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(pdfRenderHtml)}`);
      
      // 렌더링 완료 대기
      let attempts = 0;
      const maxAttempts = 60;
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const isComplete = await pdfWindow.webContents.executeJavaScript('window.pdfRenderComplete || false');
        const hasError = await pdfWindow.webContents.executeJavaScript('window.pdfRenderError || null');
        
        if (hasError) {
          throw new Error(`PDF 렌더링 오류: ${hasError}`);
        }
        
        if (isComplete) {
          break;
        }
        
        attempts++;
      }
      
      if (attempts >= maxAttempts) {
        throw new Error('PDF 렌더링 시간 초과');
      }
      
      // 안정화 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // PNG 캡처
      const image = await pdfWindow.capturePage();
      
      // PNG 임시 파일 경로 생성
      const tempDir = os.tmpdir();
      const pngFileName = `webprinter_temp_${Date.now()}.png`;
      const pngPath = path.join(tempDir, pngFileName);
      
      // PNG 파일 저장
      await fs.writeFile(pngPath, image.toPNG());
      
      pdfWindow.close();
      return pngPath;
      
    } catch (renderError) {
      if (pdfWindow && !pdfWindow.isDestroyed()) {
        pdfWindow.close();
      }
      throw renderError;
    }
    
  } catch (error) {
    throw new Error(`PDF to PNG 변환 실패: ${error.message}`);
  }
}

// ========== PNG 인쇄 함수 ==========
async function printImageDirectly(imagePath, printerName, copies = 1) {
  try {
    console.log('🖨️ 이미지 인쇄 시작:', { imagePath, printerName, copies });
    
    if (process.platform === 'win32') {
      // Windows 경로 처리
      const cleanImagePath = imagePath.replace(/\//g, '\\');
      
      console.log('🎨 mspaint.exe로 인쇄 시도...');
      
      try {
        // mspaint로 직접 인쇄
        const paintCommand = `mspaint.exe /pt "${cleanImagePath}" "${printerName}"`;
        console.log('실행 명령어:', paintCommand);
        
        const result = await execAsync(paintCommand, { timeout: 15000 });
        console.log('✅ mspaint.exe 인쇄 명령 실행 완료');
        
        // 인쇄 완료 대기
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (paintError) {
        console.log('❌ mspaint.exe 실패:', paintError.message);
        
        // 대체 방법: PowerShell
        console.log('🔄 PowerShell 대체 방법 시도...');
        
        const psCommand = `powershell -command "
          Add-Type -AssemblyName System.Drawing, System.Drawing.Printing
          $image = [System.Drawing.Image]::FromFile('${imagePath.replace(/'/g, "''")}')
          $printDoc = New-Object System.Drawing.Printing.PrintDocument
          $printDoc.PrinterSettings.PrinterName = '${printerName.replace(/'/g, "''")}'
          
          # 여백 제거
          $printDoc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
          
          $printDoc.add_PrintPage({
            param($sender, $e)
            $pageWidth = $e.PageBounds.Width
            $pageHeight = $e.PageBounds.Height
            $destRect = New-Object System.Drawing.Rectangle(0, 0, $pageWidth, $pageHeight)
            $e.Graphics.DrawImage($image, $destRect)
          })
          
          if ($printDoc.PrinterSettings.IsValid) { 
            $printDoc.Print()
            Write-Host 'PowerShell 인쇄 완료' 
          }
          $image.Dispose()
        "`;
        
        await execAsync(psCommand);
        console.log('✅ PowerShell 인쇄 완료');
      }
      
    } else if (process.platform === 'darwin') {
      // macOS
      let printCmd = `lpr -# ${copies}`;
      if (printerName && printerName !== 'system-default') {
        printCmd += ` -P "${printerName}"`;
      }
      printCmd += ` -o fit-to-page=false -o scaling=100 "${imagePath}"`;
      await execAsync(printCmd);
      
    } else {
      // Linux
      let printCmd = `lp -n ${copies}`;
      if (printerName && printerName !== 'system-default') {
        printCmd += ` -d "${printerName}"`;
      }
      printCmd += ` -o fit-to-page=false -o scaling=100 "${imagePath}"`;
      await execAsync(printCmd);
    }
    
  } catch (error) {
    throw new Error(`이미지 인쇄 실패: ${error.message}`);
  }
}

// ========== 보조 함수 ==========
async function saveTempPDF(pdfBuffer) {
  const tempDir = os.tmpdir();
  const tempFileName = `webprinter_temp_${Date.now()}.pdf`;
  const tempPath = path.join(tempDir, tempFileName);
  
  await fs.writeFile(tempPath, pdfBuffer);
  return tempPath;
}

async function savePermanentPDF(pdfBuffer) {
  const saveDirectory = path.join(os.homedir(), 'Downloads', 'WebPrinter');
  await fs.mkdir(saveDirectory, { recursive: true });
  
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19);
  
  const fileName = `WebPrinter_${timestamp}.pdf`;
  const filePath = path.join(saveDirectory, fileName);
  
  await fs.writeFile(filePath, pdfBuffer);
  return filePath;
}

async function openPDFPreview(pdfPath) {
  console.log('PDF 미리보기 열기:', pdfPath);
  
  try {
    if (process.platform === 'win32') {
      await execAsync(`start "" "${pdfPath}"`);
    } else if (process.platform === 'darwin') {
      await execAsync(`open "${pdfPath}"`);
    } else {
      await execAsync(`xdg-open "${pdfPath}"`);
    }
  } catch (error) {
    console.error('PDF 미리보기 열기 실패:', error);
    throw new Error(`PDF 뷰어 실행 실패`);
  }
}

async function cleanupOldPDFs() {
  // 24시간 이상 된 PDF 파일 정리
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
  } catch (error) {}
}

// ========== 내보내기 ==========
module.exports = {
  printViaPDF,
  cleanupOldPDFs,
  convertPdfToPng,
  printImageDirectly
};