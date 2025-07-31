const { BrowserWindow, app } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

async function printViaPDF(url, paperSize, printSelector, copies, silent, printerName) {
  try {
    const pdfBuffer = await generatePDF(url, paperSize, printSelector);
    const tempPdfPath = await saveTempPDF(pdfBuffer);
    await openPDFPreview(tempPdfPath);
    
    setTimeout(async () => {
      try {
        await cleanupTempFile(tempPdfPath);
      } catch (error) {}
    }, 30 * 60 * 1000);
    
    return { success: true, pdfPath: tempPdfPath };
  } catch (error) {
    throw error;
  }
}

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
    await pdfWindow.loadURL(url);
    
    await new Promise(resolve => {
      pdfWindow.webContents.once('did-finish-load', () => {
        setTimeout(resolve, 2000);
      });
    });
    
    const jsResult = await pdfWindow.webContents.executeJavaScript(`
      (function() {
        const targetElement = document.querySelector('${printSelector}');
        if (!targetElement) {
          throw new Error('인쇄 대상 요소를 찾을 수 없습니다: ${printSelector}');
        }
        
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.overflow = 'hidden';
        
        Array.from(document.body.children).forEach(child => {
          if (!child.contains(targetElement) && child !== targetElement) {
            child.style.display = 'none';
          }
        });
        
        targetElement.style.cssText = \`
          display: block !important;
          position: absolute !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) rotate(180deg) !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        \`;
        
        return { success: true };
      })()
    `);
    
    const pdfOptions = {
      pageSize: {
        width: paperSize.width * 1000,
        height: paperSize.height * 1000
      },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true,
      landscape: false
    };
    
    return await pdfWindow.webContents.printToPDF(pdfOptions);
    
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
  }
}

async function saveTempPDF(pdfBuffer) {
  const saveDirectory = path.join(os.homedir(), 'Downloads', 'WebPrinter');
  
  try {
    await fs.mkdir(saveDirectory, { recursive: true });
  } catch (error) {
    saveDirectory = os.tmpdir();
  }
  
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .substring(0, 19);
  
  const fileName = `WebPrinter_Print_${timestamp}.pdf`;
  const filePath = path.join(saveDirectory, fileName);
  
  await fs.writeFile(filePath, pdfBuffer);
  return filePath;
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

async function cleanupTempFile(filePath) {
  try {
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) return;
    
    await fs.unlink(filePath);
    
    const parentDir = path.dirname(filePath);
    const dirName = path.basename(parentDir);
    
    if (dirName === 'WebPrinter') {
      try {
        const files = await fs.readdir(parentDir);
        if (files.length === 0) {
          await fs.rmdir(parentDir);
        }
      } catch (dirError) {}
    }
  } catch (error) {}
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
      if (!file.startsWith('WebPrinter_Print_') || !file.endsWith('.pdf')) continue;
      
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