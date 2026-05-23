 Changelog

  1.0.10

  Bug Fixes

  - Error wrapping in executeFile - Non-Error rejections are now wrapped in
    `new Error(String(error))` so callers always receive a proper Error object.
  - Obsidian-idiomatic button creation - Replaced `document.createElement("button")`
    with Obsidian's `createEl("button")` so buttons respect the active window context.

  Improvements

  - Async lifecycle methods - `onload()` and `PathSelectModal.onOpen()` now return
    `void` and delegate async work to private methods, satisfying the Obsidian Plugin
    API signature and eliminating TypeScript warnings about async overrides.
  - CSS custom property for progress bar - Progress fill width now uses
    `--progress-fill-width` CSS variable instead of inline `style.width`, keeping
    style logic in CSS.
  - `activeWindow.setTimeout` - Replaced bare `setTimeout` with `activeWindow.setTimeout`
    in the UI yield helper, making it safe in multi-window Obsidian setups.
  - PathSelectModal onSelect supports async callbacks - The callback type now allows
    returning `Promise<void>` so callers can do async work on selection.
  - Renamed command - "Clean dead mpv links" renamed to "Clean dead links".

  Code Quality

  - Fixed unused catch variable warnings (`_error`) in hash.ts.
  - Replaced `querySelectorAll("button") as HTMLButtonElement[]` with the typed
    generic `querySelectorAll<HTMLButtonElement>("button")`.
  - Removed unused `vaultBasePath` local variable.
  - Simplified Obsidian internal typings: `EScope` replaced with the official
    `Scope` type; redundant literal-union types (e.g. `"" | string`) simplified
    to their base type.

---

  1.0.7

  Improvements 

  - Async I/O in hash.ts - Replaced all blocking synchronous filesystem calls
    (statSync, openSync, readSync, closeSync, readdirSync) with their
    fs.promises equivalents. Obsidian's UI thread no longer freezes during
    folder scans or hash computation on large video libraries. The existing
    yieldToUI() calls in relocalizeFiles now actually yield between real async
    operations.
    
  New Features                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                              
  - Relative vault paths - Video links now store paths relative to the vault root instead of absolute paths, making vaults portable across machines                                                                                                           
  - Remember last folder - New setting to remember the last folder used when adding mpv links                                                                                                                                                                 
  - Dead link cleanup - New command "Clean dead mpv links" removes code blocks containing links to non-existent video files                                                                                                                                   
  - Hash-based file relocalization - (Experimental) Store MD5 hash when creating links; use "Update/relocalize links" command to find moved files by content                                                                                                  
  - End-of-video buffer - New setting to cap saved timestamps to N seconds before the end, preventing links that open and close instantly when a video ended naturally                                                                                        
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       
                                                                                                                                                                                                                                                              
  Settings Added                                                                                                                                                                                                                                              
  ┌──────────────────────┬─────────────────────────────────────────┬─────────┐                                                                                                                                                                                
  │       Setting        │               Description               │ Default │                                                                                                                                                                                
  ├──────────────────────┼─────────────────────────────────────────┼─────────┤                                                                                                                                                                                
  │ Remember last folder │ Start file picker from last used folder │ Off     │                                                                                                                                                                                
  ├──────────────────────┼─────────────────────────────────────────┼─────────┤                                                                                                                                                                                
  │ Hash relocalization  │ Store MD5 hash for finding moved files  │ Off     │                                                                                                                                                                                
  ├──────────────────────┼─────────────────────────────────────────┼─────────┤                                                                                                                                                                                
  │ End-of-video buffer  │ Seconds before end to cap timestamps    │ 5       │                                                                                                                                                                                
  └──────────────────────┴─────────────────────────────────────────┴─────────┘          
