# 🚀 Basil Loop AI Chat - BETA v1.0

## What's New in Beta

This version introduces the **Revolutionary Multi-Agent Basil Loop System** - a 6-agent architecture designed to make small language models perform like large ones through iterative self-improvement.

### 🤖 The 6 Specialized Agents:

1. **🔍 Prompt Refining Agent** - Enhances user queries for maximum clarity
2. **📋 Planning Agent** - Creates comprehensive response strategies  
3. **🔎 Search Agent** - Gathers current web information when needed
4. **✍️ Writer Agent** - Crafts and refines technical responses
5. **📊 Direction Agent** - Analyzes content and suggests improvements
6. **✅ Checker Agent** - Decides when responses are complete and excellent

### ✨ Key Features:

- **Iterative Refinement**: Each agent creates a fresh message instance
- **Quality Control**: Continues until Checker Agent says "Yes"
- **Web Search Integration**: Automatic search for current information
- **No Safety Warnings**: Direct, scientific, technical responses
- **Real-time Streaming**: Watch agents work in real-time
- **Markdown Support**: Beautiful formatting for technical content
- **Copy Functionality**: Easy copying of responses and agent steps

## 🚂 Perfect for Train Usage!

This system works great offline once you have:
1. Ollama running locally
2. Your preferred model downloaded
3. The web server started

## Quick Start

1. **Start Ollama:**
   ```bash
   ollama serve
   ```

2. **Download a model (if you haven't):**
   ```bash
   ollama pull gemma:2b
   ```

3. **Start the server:**
   ```bash
   node server.js
   ```

4. **Open browser:** http://localhost:3000

## 🧪 Test Queries

Try these to see the multi-agent system in action:

- "Explain quantum computing"
- "How does machine learning work?"
- "What is the physics behind superconductors?"
- "Define neural networks and their applications"

## Models Supported

- `gemma:2b` (default, fast)
- `codegemma:2b` (coding focus)
- `llama3.2:1b` (very fast)
- `llama3.2:3b` (balanced)

## 🔧 Offline Considerations

- Web search will fallback gracefully when offline
- All core functionality works without internet
- Models and processing happen entirely locally
- Perfect for travel/remote work

## Beta Notes

This is experimental software! The multi-agent loop:
- May take longer than single responses
- Uses more computational resources
- Can be stopped mid-process with the Stop button
- Has a safety limit of 20 iterations

## Have Fun!

The Basil Loop represents a new approach to AI reasoning - making small, local models think more like large, cloud-based ones through structured self-reflection and improvement.

Enjoy testing this revolutionary approach to AI chat! 🎉
