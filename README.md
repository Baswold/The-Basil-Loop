# Ollama Chat UI

A simple, lightweight web interface for chatting with Ollama models.

## 🎥 Demo Video

[![Watch the demo on Vimeo](https://img.shields.io/badge/Demo-Play%20on%20Vimeo-blue?logo=vimeo)](https://vimeo.com/1102758969)


## Project Structure

```
ollama-chat-ui/
├── index.html      # Main HTML interface
├── styles.css      # CSS styling
├── app.js          # Frontend JavaScript
├── server.js       # Express proxy server (optional)
├── package.json    # Node.js dependencies
└── README.md       # This file
```

## Setup

1. **Make sure Ollama is running:**
   ```bash
   ollama serve
   ```

2. **Install a model (if you haven't already):**
   ```bash
   ollama pull llama2
   # or another model of your choice
   ```

## Usage Options

### Option 1: Using the Express Proxy Server (Recommended)
This option includes CORS handling and serves files from `http://localhost:3000`:

```bash
npm start
```

Then open your browser to `http://localhost:3000`

### Option 2: Direct File Opening
You can also open `index.html` directly in your browser, but you may encounter CORS issues when trying to connect to Ollama.

## Configuration

- **Model Selection:** Edit the `model` field in `app.js` (line 52) to use a different Ollama model
- **Ollama URL:** If your Ollama instance runs on a different port, update the `OLLAMA_URL` in `server.js`

## Features

- Clean, modern chat interface
- Real-time messaging with Ollama
- Loading states and error handling
- Responsive design
- Keyboard shortcuts (Enter to send)

## Requirements

- Node.js (for the Express server)
- Ollama running locally
- A modern web browser

## Troubleshooting

- **"Error processing request":** Make sure Ollama is running (`ollama serve`)
- **CORS issues:** Use the Express server instead of opening the HTML file directly
- **Model not found:** Pull the model with `ollama pull <model-name>`
