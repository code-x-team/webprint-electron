# WebPrinter Technology Stack

## Core Technologies

**Runtime**: Node.js with Electron 27.0.0
**UI Framework**: Vanilla HTML/CSS/JavaScript (no frontend frameworks)
**Backend**: Express.js HTTP server with CORS support
**Build System**: electron-builder with GitHub Actions CI/CD
**Package Manager**: Yarn (specified in packageManager field)

## Dependencies

### Production Dependencies
- `electron-updater`: GitHub Releases-based auto-update system
- `express`: HTTP server for web integration API
- `cors`: Cross-origin resource sharing middleware

### Development Dependencies
- `electron`: Desktop application framework
- `electron-builder`: Multi-platform build and packaging

## Architecture Patterns

**Main Process**: Handles protocol registration, HTTP server, system tray, auto-updates
**Renderer Process**: Print preview UI with iframe-based web content display  
**Preload Script**: Secure IPC bridge using contextBridge API
**IPC Communication**: Invoke/handle pattern for async operations, on/send for events

## Build Commands

```bash
# Development
npm start                    # Run in development mode
npm run dev                 # Run with DevTools enabled

# Production builds
npm run build               # Build for all platforms
npm run build-win          # Windows-only build
npm run build-mac          # macOS-only build

# Version management
npm run sync-version       # Sync package.json version with git tags
npm run publish            # Build and publish to GitHub Releases
```

## Development Setup

```bash
# Install dependencies
npm install

# Start development server
npm start

# For debugging with DevTools
npm run dev
```

## Platform-Specific Features

**Windows**: NSIS installer, registry protocol registration, system tray
**macOS**: DMG packaging, Info.plist protocol registration, dock integration
**Protocol Registration**: Automatic `webprinter://` scheme registration on install

## Security Configuration

- `nodeIntegration: false` - Disable Node.js in renderer
- `contextIsolation: true` - Isolate main world from isolated world
- `webSecurity: false` - Allow cross-origin requests for print content
- Preload script exposes limited API surface via contextBridge

## HTTP Server Configuration

- **Ports**: 18731-18740 (auto-discovery)
- **CORS**: Wildcard origin support for web integration
- **Endpoints**: `/send-urls` (POST), `/status` (GET), `/version` (GET)
- **JSON Limit**: 10MB for large print content

## File Structure

```
├── main.js              # Electron main process
├── preload.js           # IPC security bridge  
├── print-preview.html   # Print UI template
├── print-preview.js     # Renderer process logic
├── web-example.html     # Integration example
├── package.json         # Dependencies and build config
└── .github/workflows/   # CI/CD automation
```