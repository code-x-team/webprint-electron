# WebPrinter Product Overview

WebPrinter is a cross-platform Electron desktop application that enables web pages to trigger local printing through a custom protocol handler. It serves as a bridge between web applications and local printers, providing seamless printing capabilities with custom paper sizes and real-time preview functionality.

## Core Functionality

**Protocol Handler**: Responds to `webprinter://print` URLs from web browsers to launch the application
**HTTP Server**: Runs on ports 18731-18740 to receive print job data from web pages via REST API
**Print Preview**: Displays web content in an iframe with real-time preview before printing
**Custom Paper Sizes**: Supports non-standard paper dimensions (e.g., 244mm×88mm labels)
**Background Service**: Runs as a system tray application with auto-start capabilities

## Target Use Cases

- **Label Printing**: Custom-sized labels and receipts from web applications
- **Document Printing**: Web-based document management systems requiring local printer access
- **POS Systems**: Point-of-sale web applications needing direct printer integration
- **Enterprise Applications**: Internal web tools requiring seamless printing workflows

## Key Features

- **Dual URL Support**: Separate preview and print URLs for optimized workflows
- **Session Management**: Persistent session data with 24-hour retention
- **Auto-Updates**: GitHub Releases integration with user-controlled installation
- **Cross-Platform**: Native support for Windows and macOS
- **Security**: Sandboxed renderer process with IPC communication bridge
- **Korean Language**: Primary UI language with comprehensive Korean documentation

## Architecture

The application follows a standard Electron architecture with enhanced security through context isolation and preload scripts. It operates as both a protocol handler and HTTP server, enabling seamless integration between web applications and local printing infrastructure.