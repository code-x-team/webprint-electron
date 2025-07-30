# WebPrinter Project Structure

## Root Directory Organization

```
webprinter/
├── main.js                 # Electron main process entry point
├── preload.js             # IPC security bridge script
├── print-preview.html     # Print preview UI template
├── print-preview.js       # Renderer process application logic
├── web-example.html       # Web integration demonstration
├── index.html             # Alternative web integration example
├── package.json           # Project configuration and dependencies
├── yarn.lock              # Dependency lock file
├── installer.nsh          # Windows NSIS installer script
└── README.md              # Korean documentation
```

## Configuration Directories

### `.cursor/rules/`
Development guidelines and architecture documentation:
- `webprinter-architecture.mdc` - System architecture overview
- `development-patterns.mdc` - Coding standards and patterns
- `ipc-debugging-guide.mdc` - IPC communication troubleshooting
- `toast-notification-guide.mdc` - UI notification system
- `troubleshooting-guide.mdc` - General problem resolution
- `web-integration.mdc` - Web API integration patterns

### `.github/`
CI/CD automation and project metadata:
- `workflows/build.yml` - Automated build and release pipeline
- Issue templates and repository configuration

### `.kiro/`
AI assistant steering rules and project guidance:
- `steering/product.md` - Product overview and use cases
- `steering/tech.md` - Technology stack and build system
- `steering/structure.md` - Project organization (this file)

## Build Artifacts

### `dist/`
Generated during build process:
- Platform-specific installers (DMG, EXE)
- Packaged application bundles
- Distribution-ready artifacts

### `node_modules/`
Package manager dependencies (excluded from version control)

## File Responsibilities

### Core Application Files
- **main.js**: Protocol handler, HTTP server, system tray, session management, auto-updates
- **preload.js**: Secure IPC API exposure using contextBridge
- **print-preview.html**: UI structure with CSS styling and layout
- **print-preview.js**: Client-side logic, IPC communication, Toast notifications

### Integration Examples  
- **web-example.html**: Comprehensive web integration demo with GitHub API
- **index.html**: Simplified web integration example

### Configuration
- **package.json**: Electron-builder config, protocol registration, dependencies
- **installer.nsh**: Windows installer customization script

## Naming Conventions

### Files
- **Kebab-case**: HTML files (`print-preview.html`, `web-example.html`)
- **Camel-case**: JavaScript files (`main.js`, `preload.js`)
- **Lowercase**: Configuration files (`package.json`, `readme.md`)

### Code Elements
- **camelCase**: JavaScript variables and functions (`receivedUrls`, `showPreviewUrl`)
- **kebab-case**: HTML IDs and CSS classes (`preview-container`, `install-guide`)
- **PascalCase**: Constructor functions and classes (rare in this codebase)

## Development Workflow

### Local Development
1. Modify source files in root directory
2. Test using `npm start` or `npm run dev`
3. Debug with Chrome DevTools when needed

### Build Process
1. Version sync with `npm run sync-version`
2. Platform builds with `npm run build-{platform}`
3. GitHub Actions handles CI/CD automatically

### File Dependencies
- `main.js` → `preload.js` (preload script path)
- `main.js` → `print-preview.html` (window content)
- `print-preview.html` → `print-preview.js` (script inclusion)
- `package.json` → All files (build configuration)

## Security Boundaries

### Main Process (Privileged)
- File system access
- Network server operations  
- System integration (tray, protocols)
- Native printer APIs

### Renderer Process (Sandboxed)
- DOM manipulation
- User interface logic
- Limited IPC communication via preload script
- No direct Node.js access

### Preload Script (Bridge)
- Controlled API surface exposure
- IPC message routing
- Security policy enforcement