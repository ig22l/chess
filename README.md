# Chess Studio

An offline chess analysis board with genuine full Stockfish 19 NNUE. You control both sides; the engine recommends moves without playing automatically.

## Open locally

Download the entire repository, extract it, and double-click `index.html` in modern Chrome or Firefox. Keep `index.html`, `styles.css`, `app.js`, and the complete `assets` directory together. No server, installation, or internet connection is required.

## Upload to GitHub

Upload every file and preserve the directory structure. The largest files are approximately 22.4 MB each; no file is over 100 MB. Git LFS is not required. The folder is also ready for static hosting, including GitHub Pages.

## Files

- `index.html`: interface, original SVG pieces, licenses, and downloadable engine source archive.
- `styles.css`: responsive dark theme.
- `app.js`: board interactions, game history, analysis, and inline worker creation.
- `assets/chess.js`: bundled chess.js 1.4.0 rules and notation.
- `assets/stockfish-loader.js`: bundled Stockfish.js 19 loader source.
- `assets/stockfish-part-1.js` through `stockfish-part-6.js`: the complete original WebAssembly engine and neural network, encoded in local JavaScript chunks so browsers can load them directly under `file://`.

The six parts reconstruct the original engine exactly; this split does not reduce engine strength. Do not remove or edit individual parts. The app checks part presence and total byte count before compilation.

## Controls

Click or drag pieces. Choose promotions explicitly. Use Left/Right to undo/redo, Home/End to navigate history, and F to flip. Click a candidate to preview its continuation without changing the game. Analysis supports thinking-time budgets, depth limits, and infinite thinking.

Games live in the current tab and are cleared on reload. Copy FEN or PGN before closing if you want to retain a position or game.

## Licenses

Stockfish.js and this app are GPL-3.0. chess.js is BSD-2-Clause. Open **Engine & open-source credits** in the app for the full licenses and the embedded corresponding Stockfish.js v19.0.1 source archive. The original Stockfish loader is stored as unmodified source text and initialized locally by the app.
