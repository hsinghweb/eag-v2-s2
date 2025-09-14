# GenAI Learning Assistant Chrome Extension

A Chrome Extension to help beginners learn about Generative AI through interactive features, course plans, and quizzes.

## Features

- Proficiency level selection (Beginner, Intermediate, Master)
- Interactive course plan generation using Gemini AI
- AI Buzzwords flashcards with definitions
- Timed quizzes with progress tracking
- Modern UI with animations and sound effects

## Setup Instructions

1. Clone this repository:
    ```bash
    git clone <repository-url>
    cd eag-v2-s2
    ```

2. Install the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the project directory

3. First Time Setup:
   - Click the extension icon in Chrome
   - You'll be prompted to enter your Gemini API key
   - Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Enter the key in the setup screen

## Development

### Project Structure
    ```
    ├── manifest.json      # Extension configuration
    ├── popup.html        # Main extension UI
    ├── popup.js         # Main functionality
    ├── setup.js        # API key setup
    └── styles.css     # Styling
    ```

### Local Development
1. Make changes to the files
2. Refresh the extension in `chrome://extensions/`
3. Click the extension icon to see updates

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/YourFeature`
3. Commit your changes: `git commit -m 'Add YourFeature'`
4. Push to the branch: `git push origin feature/YourFeature`
5. Open a Pull Request

## Notes

- The extension uses Chrome Storage to securely store your API key
- Quiz progress is saved locally
- API calls are rate-limited based on Gemini's free tier limits
- Convert any generated course plan into an actionable TODO list (one active list stored, progress tracked with checkboxes)
