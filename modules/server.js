const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');

let httpServer = null;
let serverPort = null;
let receivedUrls = {};

const sessionDataPath = path.join(os.homedir(), '.webprinter-sessions.json');

function saveSessionData() {
  try {
    fs.writeFileSync(sessionDataPath, JSON.stringify({
      lastSaved: new Date().toISOString(),
      receivedUrls: receivedUrls
    }, null, 2));
  } catch (error) {
    // 저장 실패 무시
  }
}

function loadSessionData() {
  try {
    if (!fs.existsSync(sessionDataPath)) return;
    
    const data = JSON.parse(fs.readFileSync(sessionDataPath, 'utf8'));
    const savedTime = new Date(data.lastSaved);
    const hoursDiff = (new Date() - savedTime) / (1000 * 60 * 60);
    
    if (hoursDiff <= 24) {
      receivedUrls = data.receivedUrls || {};
    } else {
      fs.unlinkSync(sessionDataPath);
    }
  } catch (error) {
    try { fs.unlinkSync(sessionDataPath); } catch (e) {}
  }
}

function cleanOldSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  
  Object.keys(receivedUrls).forEach(sessionId => {
    if (receivedUrls[sessionId].timestamp && (now - receivedUrls[sessionId].timestamp) > maxAge) {
      delete receivedUrls[sessionId];
    }
  });
  
  saveSessionData();
}

async function startHttpServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    
    app.use(cors({ origin: '*', credentials: true }));
    app.use(express.json({ limit: '10mb' }));
    
    app.post('/send-urls', (req, res) => {
      try {
        const { session, preview_url, print_url, paper_width, paper_height, paper_size, print_selector } = req.body;
        
        if (!session || (!preview_url && !print_url)) {
          return res.status(400).json({ error: 'Invalid request' });
        }
        
        const paperWidth = parseFloat(paper_width);
        const paperHeight = parseFloat(paper_height);
        
        if (isNaN(paperWidth) || isNaN(paperHeight) || paperWidth <= 0 || paperHeight <= 0) {
          return res.status(400).json({ error: 'Invalid paper size' });
        }
        
        receivedUrls[session] = {
          previewUrl: preview_url,
          printUrl: print_url,
          paperSize: { name: paper_size || 'Custom', width: paperWidth, height: paperHeight },
          printSelector: print_selector || '#print_wrap',
          timestamp: Date.now(),
          receivedAt: new Date().toISOString()
        };
        
        saveSessionData();
        
        // 윈도우로 알림 전송
        const { notifyWindow } = require('./window');
        notifyWindow(session, receivedUrls[session]);
        
        res.json({ success: true, session, paperSize: receivedUrls[session].paperSize });
      } catch (error) {
        res.status(500).json({ error: 'Processing failed' });
      }
    });
    
    app.get('/status', (req, res) => {
      const packageInfo = require('../package.json');
      res.json({ status: 'running', version: packageInfo.version });
    });
    
    app.get('/version', (req, res) => {
      const packageInfo = require('../package.json');
      res.json({ version: packageInfo.version, name: packageInfo.name });
    });
    
    const tryPort = async (port) => {
      const server = app.listen(port, 'localhost', () => {
        serverPort = server.address().port;
        httpServer = server;
        resolve(server);
      });
      
      server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE' && port < 18740) {
          await tryPort(port + 1);
        } else {
          reject(err);
        }
      });
    };
    
    tryPort(18731);
  });
}

function stopHttpServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    serverPort = null;
  }
}

module.exports = {
  startHttpServer,
  stopHttpServer,
  loadSessionData,
  saveSessionData,
  cleanOldSessions,
  getServerPort: () => serverPort,
  getSessionData: (sessionId) => receivedUrls[sessionId],
  getAllSessions: () => receivedUrls,
  clearSession: (sessionId) => delete receivedUrls[sessionId]
};