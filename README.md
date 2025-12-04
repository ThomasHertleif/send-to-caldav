# Send to CalDAV

A browser extension that allows you to create CalDAV calendar events directly from any web page.

## Features
- Create calendar events from the current page, link or selected text. (context menu or toolbar button) 

## Build and Install

### Firefox
1. `npm install`
1. Build the extension: `npm run build:firefox`
1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
1. Click **"Load Temporary Add-on..."**.
1. Load the `manifest.json` from the `dist` folder

### Chrome / Chromium

1. `npm install`
1. Build the extension: `npm run build:chrome`
1. Open Chrome and navigate to `chrome://extensions`.
1. Enable **Developer mode** in the top right corner.
1. Click **"Load unpacked"**.
1. Select the project's `dist` folder.
