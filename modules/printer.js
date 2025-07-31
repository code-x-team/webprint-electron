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
    const pdfBuffer = await generatePDF(url, paperSize, printSelector, rotate180);
    
    if (outputType === 'pdf') {
      const pdfPath = await savePermanentPDF(pdfBuffer);
      await openPDFPreview(pdfPath);
      return { success: true, pdfPath, shouldClose: true };
    } else {
      let tempPdfPath = null;
      let tempPngPath = null;
      
      try {
       


        function printPDF(pdfPath) {
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = pdfPath;
          
          iframe.onload = () => {
            iframe.contentWindow.print();
            // 인쇄 후 iframe 제거
            setTimeout(() => {
              document.body.removeChild(iframe);
            }, 1000);
          };
          
          document.body.appendChild(iframe);
        }

        tempPdfPath = await saveTempPDF(pdfBuffer);
        printPDF(tempPdfPath)


        // tempPngPath = await convertPdfToPng(tempPdfPath);
        // await printImageDirectly(tempPngPath, printerName, copies);
        
        setTimeout(async () => {
          try {
            if (tempPdfPath) await fs.unlink(tempPdfPath);
            if (tempPngPath) await fs.unlink(tempPngPath);
          } catch (deleteError) {}
        }, 30000);
        
        return { 
          success: true, 
          shouldClose: true, 
          message: '이미지로 변환하여 프린터 전송 완료' 
        };
        
      } catch (printError) {
        if (tempPdfPath) await fs.unlink(tempPdfPath).catch(() => {});
        if (tempPngPath) await fs.unlink(tempPngPath).catch(() => {});
        throw printError;
      }
    }
  } catch (error) {
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
    await pdfWindow.loadURL(url);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    await pdfWindow.webContents.executeJavaScript(`
      (function() {
        const targetElement = document.querySelector('${printSelector}');
        if (targetElement) {
          document.body.innerHTML = '';
          document.body.appendChild(targetElement);
          
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
    
    const pdfOptions = {
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      landscape: false
    };
    
    const pdfBuffer = await pdfWindow.webContents.printToPDF(pdfOptions);
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
    
    const A4_WIDTH_300DPI = 2480;
    const A4_HEIGHT_300DPI = 3508;
    
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
                const pdfData = atob('${pdfBase64}');
                const uint8Array = new Uint8Array(pdfData.length);
                for (let i = 0; i < pdfData.length; i++) {
                  uint8Array[i] = pdfData.charCodeAt(i);
                }
                
                const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
                const page = await pdf.getPage(1);
                
                const scale = 300 / 72;
                const viewport = page.getViewport({ scale: scale });
                
                const canvas = document.getElementById('pdfCanvas');
                const context = canvas.getContext('2d');
                
                canvas.width = ${A4_WIDTH_300DPI};
                canvas.height = ${A4_HEIGHT_300DPI};
                
                context.imageSmoothingEnabled = false;
                context.fillStyle = '#FFFFFF';
                context.fillRect(0, 0, canvas.width, canvas.height);
                
                const offsetX = (${A4_WIDTH_300DPI} - viewport.width) / 2;
                const offsetY = 0;
                
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
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const image = await pdfWindow.capturePage();
      
      const tempDir = os.tmpdir();
      const pngFileName = `webprinter_temp_${Date.now()}.png`;
      const pngPath = path.join(tempDir, pngFileName);
      
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
    if (process.platform === 'win32') {
      const cleanImagePath = imagePath.replace(/\//g, '\\');
      
      try {
        const paintCommand = `mspaint.exe /pt "${cleanImagePath}" "${printerName}"`;
        await execAsync(paintCommand, { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (paintError) {
        const psCommand = `powershell -command "
          Add-Type -AssemblyName System.Drawing, System.Drawing.Printing
          $image = [System.Drawing.Image]::FromFile('${imagePath.replace(/'/g, "''")}')
          $printDoc = New-Object System.Drawing.Printing.PrintDocument
          $printDoc.PrinterSettings.PrinterName = '${printerName.replace(/'/g, "''")}'
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
          }
          $image.Dispose()
        "`;
        await execAsync(psCommand);
      }
      
    } else if (process.platform === 'darwin') {
      let printCmd = `lpr -# ${copies}`;
      if (printerName && printerName !== 'system-default') {
        printCmd += ` -P "${printerName}"`;
      }
      printCmd += ` -o fit-to-page=false -o scaling=100 "${imagePath}"`;
      await execAsync(printCmd);
      
    } else {
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
  try {
    if (process.platform === 'win32') {
      await execAsync(`start "" "${pdfPath}"`);
    } else if (process.platform === 'darwin') {
      await execAsync(`open "${pdfPath}"`);
    } else {
      await execAsync(`xdg-open "${pdfPath}"`);
    }
  } catch (error) {
    throw new Error(`PDF 뷰어 실행 실패`);
  }
}

async function cleanupOldPDFs() {
  try {
    const webprinterDir = path.join(os.homedir(), 'Downloads', 'WebPrinter');
    const exists = await fs.access(webprinterDir).then(() => true).catch(() => false);
    if (!exists) return;
    
    const files = await fs.readdir(webprinterDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;
    
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