 Changelog (since 1.0.7)

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
