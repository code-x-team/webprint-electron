// Windows용 강화된 모듈 로딩
let express, cors;

function loadModules() {
  const path = require('path');
  const Module = require('module');
  
  // Windows에서 절대 경로로 모듈 로딩 시도
  const modulePaths = [
    path.join(__dirname, '..', 'node_modules'),
    path.join(process.cwd(), 'node_modules'),
    path.join(process.resourcesPath, 'app', 'node_modules')
  ];
  
  for (const modulePath of modulePaths) {
    try {
      const expressPath = path.join(modulePath, 'express');
      const corsPath = path.join(modulePath, 'cors');
      
      express = require(expressPath);
      cors = require(corsPath);
      
      console.log('✅ 모듈 로딩 성공:', modulePath);
      return true;
    } catch (error) {
      continue;
    }
  }
  
  // 표준 방식으로 다시 시도
  try {
    express = require('express');
    cors = require('cors');
    console.log('✅ 표준 방식 모듈 로딩 성공');
    return true;
  } catch (error) {
    console.error('❌ 모든 모듈 로딩 시도 실패:', error.message);
    console.error('현재 디렉토리:', __dirname);
    console.error('프로세스 디렉토리:', process.cwd());
    if (process.resourcesPath) {
      console.error('리소스 경로:', process.resourcesPath);
    }
    process.exit(1);
  }
}

loadModules();

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
    console.error('세션 데이터 저장 실패:', error);
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
      console.log(`${Object.keys(receivedUrls).length}개의 세션 데이터를 불러왔습니다.`);
    } else {
      fs.unlinkSync(sessionDataPath);
      console.log('오래된 세션 데이터를 삭제했습니다.');
    }
  } catch (error) {
    console.error('세션 데이터 로드 실패:', error);
    try { 
      fs.unlinkSync(sessionDataPath); 
    } catch (e) {}
  }
}

function cleanOldSessions() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  let cleanedCount = 0;
  
  Object.keys(receivedUrls).forEach(sessionId => {
    if (receivedUrls[sessionId].timestamp && (now - receivedUrls[sessionId].timestamp) > maxAge) {
      delete receivedUrls[sessionId];
      cleanedCount++;
    }
  });
  
  if (cleanedCount > 0) {
    console.log(`${cleanedCount}개의 오래된 세션을 정리했습니다.`);
    saveSessionData();
  }
}

async function startHttpServer() {
  return new Promise((resolve, reject) => {
    const app = express();
    
    app.use(cors({ origin: '*', credentials: true }));
    app.use(express.json({ limit: '10mb' }));
    
    // 에러 핸들링 미들웨어
    app.use((err, req, res, next) => {
      console.error('서버 오류:', err);
      res.status(500).json({ error: '서버 처리 중 오류가 발생했습니다' });
    });
    
    app.post('/send-urls', (req, res) => {
      try {
        const { session, preview_url, print_url, paper_width, paper_height, paper_size, print_selector } = req.body;
        
        // 파라미터 검증
        if (!session) {
          return res.status(400).json({ error: '세션 ID가 없습니다' });
        }
        
        if (!preview_url && !print_url) {
          return res.status(400).json({ error: 'URL이 제공되지 않았습니다' });
        }
        
        const paperWidth = parseFloat(paper_width);
        const paperHeight = parseFloat(paper_height);
        
        if (isNaN(paperWidth) || isNaN(paperHeight) || paperWidth <= 0 || paperHeight <= 0) {
          return res.status(400).json({ error: '잘못된 용지 크기입니다' });
        }
        
        // 데이터 저장
        receivedUrls[session] = {
          previewUrl: preview_url,
          printUrl: print_url,
          paperSize: { 
            name: paper_size || 'Custom', 
            width: paperWidth, 
            height: paperHeight 
          },
          printSelector: print_selector || '#print_wrap',
          timestamp: Date.now(),
          receivedAt: new Date().toISOString()
        };
        
        saveSessionData();
        
        // 윈도우로 알림 전송
        try {
          const { notifyWindow } = require('./window');
          notifyWindow(session, receivedUrls[session]);
        } catch (notifyError) {
          console.error('윈도우 알림 실패:', notifyError);
        }
        
        res.json({ 
          success: true, 
          session, 
          paperSize: receivedUrls[session].paperSize,
          message: '인쇄 데이터가 성공적으로 수신되었습니다'
        });
      } catch (error) {
        console.error('URL 처리 오류:', error);
        res.status(500).json({ error: '요청 처리 중 오류가 발생했습니다' });
      }
    });
    
    app.get('/status', (req, res) => {
      try {
        const packageInfo = require('../package.json');
        res.json({ 
          status: 'running', 
          version: packageInfo.version,
          port: serverPort,
          sessions: Object.keys(receivedUrls).length
        });
      } catch (error) {
        res.json({ status: 'running', error: 'Version info not available' });
      }
    });
    
    app.get('/version', (req, res) => {
      try {
        const packageInfo = require('../package.json');
        res.json({ 
          version: packageInfo.version, 
          name: packageInfo.name 
        });
      } catch (error) {
        res.status(500).json({ error: 'Version info not available' });
      }
    });
    
    const tryPort = async (port) => {
      const server = app.listen(port, 'localhost', () => {
        serverPort = server.address().port;
        httpServer = server;
        console.log(`HTTP 서버가 포트 ${serverPort}에서 시작되었습니다.`);
        resolve(server);
      });
      
      server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE' && port < 18740) {
          console.log(`포트 ${port}가 사용 중입니다. 다음 포트를 시도합니다...`);
          await tryPort(port + 1);
        } else {
          console.error('서버 시작 실패:', err);
          reject(err);
        }
      });
    };
    
    tryPort(18731);
  });
}

function stopHttpServer() {
  if (httpServer) {
    try {
      httpServer.close(() => {
        console.log('HTTP 서버가 종료되었습니다.');
      });
    } catch (error) {
      console.error('서버 종료 오류:', error);
    }
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