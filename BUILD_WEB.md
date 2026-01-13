# Building Asteroids for Web Browser with Pygbag

This document explains how to build and run the Asteroids game in a web browser using pygbag.

## Prerequisites

Make sure you have Python 3.11 or higher installed.

## Installation

1. Install pygbag:
```bash
pip install pygbag
```

Or install all dependencies:
```bash
pip install -r requirements.txt
```

## Building for Web

To build and test the game in your browser, run:

```bash
pygbag main.py
```

This will:
1. Package your game with all assets
2. Start a local web server
3. Open your browser to play the game

The game will be accessible at `http://localhost:8000`

## Deploying to GitHub Pages

This repository includes a GitHub Actions workflow that automatically builds and deploys the game to GitHub Pages whenever you push to the `main` branch.

### Setup Steps:

1. **Enable GitHub Pages in your repository:**
   - Go to your repository Settings
   - Navigate to "Pages" in the left sidebar
   - Under "Build and deployment", set Source to "GitHub Actions"

2. **Push your changes:**
   ```bash
   git add .
   git commit -m "Add pygbag web support and GitHub Pages deployment"
   git push
   ```

3. **Access your game:**
   - After the workflow completes, your game will be available at:
   - `https://<your-username>.github.io/<repository-name>/`

The workflow will automatically rebuild and redeploy your game whenever you push changes to the main branch.

## Publishing to itch.io

To create a build for itch.io or other hosting:

```bash
pygbag --build main.py
```

This creates a `build/web` directory containing all the files you need to upload.

## Audio Processing

The game includes pre-processed audio files in `sound-effects/processed/` for optimal web performance:
- **Shooting sounds**: 3 pitch variations with reverb
- **Explosion sounds**: 3 size-specific variations

These files are automatically used in web mode, providing the same audio experience as desktop.

### Regenerating Audio Files

If you modify the source audio files, regenerate the processed versions:
```bash
python preprocess_audio.py
```

## Notes

- The game has been modified to run asynchronously (required for web browsers)
- All assets (music and sound effects) are automatically included
- The game should work in any modern web browser with WebAssembly support
- Mobile browsers are supported, though controls may need adjustment
- Web version uses pre-processed audio files for full audio quality without runtime processing

## Troubleshooting

If the game doesn't load:
- Make sure you're using a modern browser (Chrome, Firefox, Edge, Safari)
- Check the browser console for error messages
- Ensure all asset files are present in the `music/` and `sound-effects/` directories
