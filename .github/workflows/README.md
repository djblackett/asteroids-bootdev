# GitHub Actions Workflows

## deploy-gh-pages.yml

This workflow automatically builds and deploys the Asteroids game to GitHub Pages.

### How it works:

1. **Trigger:** Runs automatically on every push to the `main` branch, or can be manually triggered
2. **Build Job:**
   - Checks out the repository code
   - Sets up Python 3.11
   - Installs pygbag
   - Builds the game using `pygbag --build main.py`
   - Uploads the built files as an artifact
3. **Deploy Job:**
   - Takes the built artifact
   - Deploys it to GitHub Pages

### First-time setup:

Before the workflow can deploy, you need to enable GitHub Pages in your repository:

1. Go to repository Settings
2. Click "Pages" in the left sidebar
3. Under "Build and deployment", set **Source** to **GitHub Actions**
4. Save the settings

After this one-time setup, every push to `main` will automatically rebuild and deploy your game.

### Accessing your deployed game:

Once deployed, your game will be available at:
```
https://<your-username>.github.io/<repository-name>/
```

### Manual trigger:

You can also manually trigger a deployment:
1. Go to the "Actions" tab in your repository
2. Click "Deploy to GitHub Pages" workflow
3. Click "Run workflow"
4. Select the branch and click "Run workflow"

### Troubleshooting:

If the workflow fails:
- Check the Actions tab for error logs
- Ensure all Python files are syntactically correct
- Verify that all asset files (music, sound effects) are committed to the repository
- Make sure GitHub Pages is properly configured as described above
