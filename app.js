// Global variables for user interactions
const TEXT_MODEL = 'gemma:2b';
const CODE_MODEL = 'codegemma:2b';
const REASONING_MODEL = TEXT_MODEL;
const CODING_KEYWORD_REGEX = /\b(code|coding|program|programming|function|method|class|module|script|snippet|algorithm|debug|bugfix|sql|query|database|dataset|python|javascript|typescript|java|c\+\+|c#|c\s|rust|go|php|ruby|swift|kotlin|scala|haskell|api|library|sdk|cli|shell|bash|powershell|regex|json|yaml|toml|ini|html|css|markdown|unit test|test case|refactor|implement|compile|build|deploy|docker|kubernetes|makefile|gradle|package\.json)\b/i;
const CODING_FILE_REGEX = /\b\w+\.(py|js|ts|tsx|jsx|java|c|cpp|cxx|cs|rb|go|rs|php|swift|kt|scala|sql|sh|bash|ps1|json|yaml|yml|toml|ini|html|css|md)\b/i;
const CODE_FENCE_REGEX = /```|<\/?(script|style|code)[^>]*>/i;
const FORCE_CODE_MODEL_REGEX = /(use|switch to|prefer|run|pick)\s+(the\s+)?(code|coding)\s+(model|one)|use\s+codegemma/i;
const FORCE_TEXT_MODEL_REGEX = /(use|switch to|prefer|run|pick)\s+(the\s+)?(text|explanation)\s+(model|one)|use\s+gemma:2b/i;
const AGENT_LABELS = {
    tasktype: 'Task routing',
    model: 'Model selection',
    prompt: 'Prompt refinement',
    planning: 'Planning',
    search: 'Web search',
    writer: 'Writer draft',
    direction: 'Direction critique',
    fact: 'Fact check',
    checker: 'Completion check',
    comparison: 'Draft comparison',
};

let stopRequested = false; // Flag to stop the current loop

function gatherCodingSignals(text = '') {
    if (!text) {
        return {
            keywordMatch: false,
            hasCodeFence: false,
            mentionsFile: false,
        };
    }

    return {
        keywordMatch: CODING_KEYWORD_REGEX.test(text),
        hasCodeFence: CODE_FENCE_REGEX.test(text),
        mentionsFile: CODING_FILE_REGEX.test(text),
    };
}

function detectUserModelPreference(text = '') {
    if (FORCE_CODE_MODEL_REGEX.test(text)) {
        return CODE_MODEL;
    }

    if (FORCE_TEXT_MODEL_REGEX.test(text)) {
        return TEXT_MODEL;
    }

    return null;
}

function normalizeModelChoice(rawDecision = '') {
    const lower = rawDecision.toLowerCase();

    if (lower.includes('codegemma') || lower.includes('code gemma') || lower.includes('code-model') || lower.includes('code model')) {
        return CODE_MODEL;
    }

    if (lower.includes('gemma')) {
        return TEXT_MODEL;
    }

    return null;
}

function summarizeModelHeuristics({ userForcedCode, userForcedText, codingSignals }) {
    const items = [];

    items.push(`User override: ${userForcedCode ? 'codegemma:2b' : userForcedText ? 'gemma:2b' : 'none'}.`);
    items.push(`Coding keywords detected: ${codingSignals.keywordMatch ? 'yes' : 'no'}.`);
    items.push(`Code blocks or markup present: ${codingSignals.hasCodeFence ? 'yes' : 'no'}.`);
    items.push(`File extensions or language hints: ${codingSignals.mentionsFile ? 'yes' : 'no'}.`);

    return items.map((line) => `- ${line}`).join('\n');
}

function finalizeModelChoice({ agentProvidedModel, userForcedCode, userForcedText, codingSignals }) {
    const { keywordMatch, hasCodeFence, mentionsFile } = codingSignals;
    const codingSignalCount = [keywordMatch, hasCodeFence, mentionsFile].filter(Boolean).length;
    const strongCodingSignal = codingSignalCount >= 2;
    const anyCodingSignal = codingSignalCount >= 1;

    if (userForcedCode) {
        return {
            model: CODE_MODEL,
            explanation: 'User explicitly requested the coding model.',
        };
    }

    if (userForcedText) {
        return {
            model: TEXT_MODEL,
            explanation: 'User explicitly requested the text model.',
        };
    }

    if (agentProvidedModel === CODE_MODEL) {
        return {
            model: CODE_MODEL,
            explanation: 'Model agent selected codegemma:2b for this request.',
        };
    }

    if (agentProvidedModel === TEXT_MODEL) {
        if (strongCodingSignal) {
            return {
                model: CODE_MODEL,
                explanation: 'Model agent leaned toward gemma:2b, but multiple coding signals require codegemma:2b.',
            };
        }

        return {
            model: TEXT_MODEL,
            explanation: 'Model agent selected gemma:2b for explanatory quality.',
        };
    }

    if (strongCodingSignal) {
        return {
            model: CODE_MODEL,
            explanation: 'No clear decision from the agent, defaulting to codegemma:2b because the request looks like code.',
        };
    }

    if (anyCodingSignal) {
        return {
            model: CODE_MODEL,
            explanation: 'No clear decision from the agent, but coding cues suggest codegemma:2b will perform better.',
        };
    }

    return {
        model: TEXT_MODEL,
        explanation: 'No clear decision from the agent, defaulting to gemma:2b for general reasoning.',
    };
}

/**
 * Resolve the correct API endpoint depending on whether the proxy server is used.
 */
function resolveApiUrl() {
    if (typeof window !== 'undefined') {
        const { hostname, port } = window.location;
        if (hostname === 'localhost' && port === '3000') {
            return 'http://localhost:3000/api/generate';
        }
    }

    return 'http://localhost:11434/api/generate';
}

/**
 * Perform a single non-streaming Ollama completion request.
 */
async function requestCompletion({ model, prompt, history = [], signal }) {
    const response = await fetch(resolveApiUrl(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            context: history,
            stream: false,
        }),
        signal,
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

/**
 * Stream responses from the Ollama API with shared parsing logic.
 */
async function streamResponse({
    model,
    prompt,
    history = [],
    onChunk,
    shouldStop,
    controller,
}) {
    const response = await fetch(resolveApiUrl(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            context: history,
            stream: true,
        }),
        signal: controller?.signal,
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalChunk = null;
    let aborted = false;

    try {
        while (true) {
            if (shouldStop?.()) {
                await reader.cancel('Stopped by user');
                if (controller && !controller.signal.aborted) {
                    controller.abort();
                }
                break;
            }

            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                try {
                    const data = JSON.parse(trimmedLine);

                    if (data.response) {
                        onChunk?.(data.response);
                    }

                    if (data.done) {
                        finalChunk = data;
                    }
                } catch (parseError) {
                    console.warn('Failed to parse JSON chunk:', trimmedLine, parseError);
                }
            }
        }

        const remaining = buffer.trim();
        if (remaining) {
            try {
                const data = JSON.parse(remaining);
                if (data.response) {
                    onChunk?.(data.response);
                }
                if (data.done) {
                    finalChunk = data;
                }
            } catch (parseError) {
                console.warn('Failed to parse final JSON chunk:', buffer, parseError);
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            aborted = true;
        } else {
            throw error;
        }
    } finally {
        reader.releaseLock();
    }

    return aborted ? finalChunk ?? { done: true } : finalChunk;
}

class OllamaChatUI {
    constructor() {
        this.messagesContainer = document.getElementById('chat');
        this.messageInput = document.getElementById('prompt');
        this.sendButton = document.getElementById('send-btn');
        this.stopButton = document.getElementById('stop-btn');
        this.statusDiv = document.getElementById('status');
        this.stepCounter = 0;
        this.activeController = null;

        // Initially hide the stop button
        this.stopButton.style.display = 'none';

        this.initializeEventListeners();
        this.addDemoMessages();
        this.autoResizeInput();
    }

    initializeEventListeners() {
        // Send button: disables itself, calls runLoop, re-enables when finished
        this.sendButton.addEventListener('click', () => this.handleSendClick());
        
        // Stop button: sets stopRequested = true so runLoop breaks after current stream
        this.stopButton.addEventListener('click', () => this.handleStopClick());
        
        // Enter key handling
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendClick();
            }
        });

        this.messageInput.addEventListener('input', () => this.autoResizeInput());
        window.addEventListener('resize', () => this.autoResizeInput());
    }
    
    /**
     * Handle Send button click - disables button, calls runLoop, re-enables when finished
     */
    async handleSendClick() {
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        // Disable Send button
        this.sendButton.disabled = true;
        this.sendButton.textContent = 'Sending...';
        
        // Show Stop button
        this.stopButton.style.display = 'inline-block';
        
        // Reset stop flag
        stopRequested = false;
        
        try {
            // Add user message to chat
            this.addMessage(message, 'user');
            this.messageInput.value = '';
            this.autoResizeInput();

            // Call runLoop with current model and message
            await this.runLoop(message);
        } catch (error) {
            if (error.name === 'AbortError') {
                this.addMessage('Generation stopped.', 'assistant');
            } else {
                console.error('Error in handleSendClick:', error);
                this.addMessage('Sorry, there was an error processing your request. Please make sure Ollama is running.', 'assistant');
            }
        } finally {
            // Re-enable Send button when finished
            this.sendButton.disabled = false;
            this.sendButton.textContent = 'Send';

            // Hide Stop button
            this.stopButton.style.display = 'none';
            this.stopButton.disabled = false;
            this.stopButton.textContent = 'Stop';

            // Reset stop flag
            stopRequested = false;

            this.messageInput.focus();
        }
    }
    
    /**
     * Handle Stop button click - sets stopRequested = true
     */
    handleStopClick() {
        stopRequested = true;
        this.updateStatus('Stopping after current stream...');
        this.stopButton.disabled = true;
        this.stopButton.textContent = 'Stopping...';
        this.abortActiveStream();
    }
    
    autoResizeInput() {
        if (!this.messageInput) return;

        const styles = getComputedStyle(this.messageInput);
        const minHeight = parseFloat(styles.getPropertyValue('--composer-min-height')) || 52;
        const maxHeight = parseFloat(styles.getPropertyValue('--composer-max-height')) || 320;

        this.messageInput.style.height = 'auto';
        const desiredHeight = Math.min(Math.max(this.messageInput.scrollHeight, minHeight), maxHeight);
        this.messageInput.style.height = `${desiredHeight}px`;
        this.messageInput.style.overflowY = this.messageInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }

    /**
     * Streams responses from Ollama API with real-time updates
     * Checks global stopRequested flag during streaming
     * @param {string} model - The model to use for generation
     * @param {string} prompt - The prompt to send
     * @param {Array} history - Conversation history (optional)
     * @param {Function} onChunk - Callback function called for each chunk of text
     * @returns {Promise} - Resolves when streaming is complete or stopped
     */
    async streamOllama(model, prompt, history = [], onChunk) {
        const controller = new AbortController();
        this.activeController = controller;

        try {
            return await streamResponse({
                model,
                prompt,
                history,
                onChunk,
                shouldStop: () => stopRequested,
                controller,
            });
        } finally {
            if (this.activeController === controller) {
                this.activeController = null;
            }
        }
    }
    
    addMessage(content, sender, isLoading = false) {
        const messageDiv = document.createElement('div');
        
        // Map sender to appropriate CSS class
        if (sender === 'assistant') {
            messageDiv.className = 'message ai';
        } else if (sender === 'user') {
            messageDiv.className = 'message user';
        } else {
            messageDiv.className = `message ${sender}`;
        }
        
        if (isLoading) {
            messageDiv.classList.add('loading');
            messageDiv.textContent = content;
        } else {
            // Render markdown for non-loading messages
            if (typeof marked !== 'undefined' && (sender === 'assistant' || sender === 'ai')) {
                messageDiv.innerHTML = marked.parse(content);
            } else {
                messageDiv.textContent = content;
            }
        }
        
        // Add copy button for AI messages
        if (sender === 'assistant' && !isLoading) {
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.innerHTML = '📋';
            copyBtn.title = 'Copy message';
            copyBtn.addEventListener('click', () => this.copyToClipboard(content, copyBtn));
            messageDiv.appendChild(copyBtn);
        }
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }
    
    addStepMessage(content, options = {}) {
        const { label = null } = options;
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message step';

        const agentType = this.detectAgentType(content);
        if (agentType) {
            messageDiv.classList.add(`agent-${agentType}`);
        }

        this.stepCounter += 1;
        const autoLabel = agentType && AGENT_LABELS[agentType]
            ? `Step ${this.stepCounter} · ${AGENT_LABELS[agentType]}`
            : `Step ${this.stepCounter}`;
        messageDiv.setAttribute('data-step', label || autoLabel);

        const body = document.createElement('div');
        body.className = 'step-body';
        if (typeof marked !== 'undefined') {
            body.innerHTML = marked.parse(content);
        } else {
            body.textContent = content;
        }
        messageDiv.appendChild(body);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = 'Copy step';
        copyBtn.addEventListener('click', () => {
            const liveContent = body.innerText?.trim() || body.textContent?.trim() || content;
            this.copyToClipboard(liveContent, copyBtn);
        });
        messageDiv.appendChild(copyBtn);

        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();

        return messageDiv;
    }

    setStepMessageContent(stepElement, content, { markdown = false } = {}) {
        if (!stepElement) return;
        const body = stepElement.querySelector('.step-body');
        if (!body) return;

        if (markdown) {
            if (typeof marked !== 'undefined') {
                body.innerHTML = marked.parse(content);
            } else {
                body.textContent = content;
            }
        } else {
            body.textContent = content;
        }
    }
    
    /**
     * Detect which agent type is speaking based on content
     */
    detectAgentType(content) {
        const lowerContent = content.toLowerCase();
        
        if (lowerContent.includes('task type agent')) return 'tasktype';
        if (lowerContent.includes('prompt agent')) return 'prompt';
        if (lowerContent.includes('planning agent')) return 'planning';
        if (lowerContent.includes('search agent')) return 'search';
        if (lowerContent.includes('model agent')) return 'model';
        if (lowerContent.includes('writer agent')) return 'writer';
        if (lowerContent.includes('direction agent')) return 'direction';
        if (lowerContent.includes('fact agent')) return 'fact';
        if (lowerContent.includes('checker agent')) return 'checker';
        if (lowerContent.includes('comparison agent')) return 'comparison';
        
        return null;
    }
    
    async copyToClipboard(text, button) {
        try {
            await navigator.clipboard.writeText(text);
            const originalContent = button.innerHTML;
            const originalTitle = button.title;
            
            // Show "Copied!" feedback
            button.innerHTML = '✅';
            button.title = 'Copied!';
            button.style.background = 'rgba(34, 197, 94, 0.9)';
            button.style.color = 'white';
            
            setTimeout(() => {
                button.innerHTML = originalContent;
                button.title = originalTitle;
                button.style.background = '';
                button.style.color = '';
            }, 1500);
        } catch (err) {
            console.error('Failed to copy text: ', err);
            // Fallback for browsers that don't support clipboard API
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            const originalContent = button.innerHTML;
            const originalTitle = button.title;
            
            // Show "Copied!" feedback for fallback
            button.innerHTML = '✅';
            button.title = 'Copied!';
            button.style.background = 'rgba(34, 197, 94, 0.9)';
            button.style.color = 'white';
            
            setTimeout(() => {
                button.innerHTML = originalContent;
                button.title = originalTitle;
                button.style.background = '';
                button.style.color = '';
            }, 1500);
        }
    }
    
    updateStatus(message) {
        if (this.statusDiv) {
            this.statusDiv.textContent = message;
        }
    }
    
    setInputState(enabled) {
        this.messageInput.disabled = !enabled;
        this.sendButton.disabled = !enabled;

        if (enabled) {
            this.sendButton.textContent = 'Send';
            this.updateStatus('Ready');
        } else {
            this.sendButton.textContent = 'Sending...';
            this.updateStatus('Processing...');
        }
    }

    abortActiveStream() {
        if (this.activeController && !this.activeController.signal.aborted) {
            this.activeController.abort();
        }
    }
    
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    /**
     * NEW BASIL LOOP: Multi-Agent Architecture with 6 Specialized Agents
     * Each iteration creates a completely new message to ensure fresh AI instance
     * Continues until refinement checker says "No" to need for more refinement
     * @param {string} model - The model to use for generation
     * @param {string} userPrompt - The initial user prompt
     * @returns {Promise} - Resolves when loop is stopped
     */

    async runLoop(userPrompt) {
        this.stepCounter = 0;
        let iteration = 1;
        let currentText = '';
        let searchResults = [];
        let lastImprovementDirections = '';
        const userPreferredModel = detectUserModelPreference(userPrompt);
        const userForcedCode = userPreferredModel === CODE_MODEL;
        const userForcedText = userPreferredModel === TEXT_MODEL;
        const codingSignals = gatherCodingSignals(userPrompt);
        let selectedModel = TEXT_MODEL;
        let isCodingTask = false;

        try {
            const modelStepMessage = this.addStepMessage('MODEL AGENT: Evaluating best model...');
            this.updateStatus('Step 1: Selecting model...');

            let modelDecision = '';
            const heuristicsSummary = summarizeModelHeuristics({ userForcedCode, userForcedText, codingSignals });
            const modelSelectionPrompt = `You are a Model Selection Agent. Choose which small model should author the main draft.\n\nUser request: "${userPrompt}"\n\nSystem heuristics:\n${heuristicsSummary}\n\n- ${CODE_MODEL} excels at writing and revising source code but struggles with prose.\n- ${TEXT_MODEL} excels at reasoning, planning, and natural language but is weaker with code.\n\nRespond with ONLY "${CODE_MODEL}" or "${TEXT_MODEL}".`;

            await this.streamOllama(REASONING_MODEL, modelSelectionPrompt, [], (chunk) => {
                if (stopRequested) return;
                modelDecision += chunk;
                this.setStepMessageContent(modelStepMessage, `MODEL AGENT: ${modelDecision}`);
            });

            if (stopRequested) return;

            const agentProvidedModel = normalizeModelChoice(modelDecision.trim());
            const { model: resolvedModel, explanation: modelExplanation } = finalizeModelChoice({
                agentProvidedModel,
                userForcedCode,
                userForcedText,
                codingSignals,
            });
            selectedModel = resolvedModel;
            isCodingTask = selectedModel === CODE_MODEL;

            const decisionDisplay = modelDecision.trim() || 'No explicit answer returned.';
            this.setStepMessageContent(
                modelStepMessage,
                `MODEL AGENT: ${decisionDisplay}\n\n**Selected:** **${selectedModel}**. ${modelExplanation}`,
                { markdown: true }
            );

            const promptStepMessage = this.addStepMessage('PROMPT AGENT: Refining user request...');
            this.updateStatus('Step 2: Refining prompt...');

            let refinedPrompt = '';
            const promptRefinePrompt = `You are a Prompt Refining Agent. Your job is to take a user's request and make it more specific and detailed to get the best possible response from other AI agents.\n\nOriginal user request: "${userPrompt}"\n\nAnalyze this request and create a more detailed, specific version that will help other agents provide better technical, scientific, and factual responses. Focus on:\n- Making vague terms more specific\n- Adding context that would be helpful\n- Clarifying the level of detail needed\n- Identifying key aspects to address\n\nReturn ONLY the refined prompt, nothing else. No explanations, no "Here's the refined prompt:" - just the improved version.`;

            await this.streamOllama(REASONING_MODEL, promptRefinePrompt, [], (chunk) => {
                if (stopRequested) return;
                refinedPrompt += chunk;
                this.setStepMessageContent(promptStepMessage, `PROMPT AGENT: ${refinedPrompt}`);
            });

            if (stopRequested) return;
            const finalPrompt = refinedPrompt.trim() || userPrompt;

            const planStepMessage = this.addStepMessage('PLANNING AGENT: Creating response strategy...');
            this.updateStatus('Step 3: Planning response...');

            let responsePlan = '';
            const planningPrompt = isCodingTask
                ? `You are a Planning Agent for CODING tasks. Your job is to create a plan for implementing this code request:\n\n"${finalPrompt}"\n\nCreate a coding plan that outlines:\n1. What function/class/module needs to be created\n2. Input parameters and return values\n3. Key algorithms or logic to implement\n4. Error handling considerations\n5. Code structure and organization\n6. Example usage or test cases\n\nReturn ONLY the coding plan, nothing else. Be specific and code-focused.`
                : `You are a Planning Agent. Your job is to create a strategic plan for answering this refined request:\n\n"${finalPrompt}"\n\nCreate a detailed plan that outlines:\n1. What main topics need to be covered\n2. What level of technical detail is appropriate\n3. What structure the response should follow\n4. What key points must be addressed\n5. What tools or knowledge areas to focus on\n\nReturn ONLY the plan, nothing else. Be specific and actionable.`;

            await this.streamOllama(REASONING_MODEL, planningPrompt, [], (chunk) => {
                if (stopRequested) return;
                responsePlan += chunk;
                this.setStepMessageContent(planStepMessage, `PLANNING AGENT: ${responsePlan}`);
            });

            if (stopRequested) return;

            const shouldSearchNow = this.shouldSearch(finalPrompt);
            if (shouldSearchNow) {
                const searchStepMessage = this.addStepMessage('SEARCH AGENT: Gathering current information...');
                this.updateStatus('Step 4: Searching web...');

                try {
                    searchResults = await this.performSearch(finalPrompt);
                    if (searchResults.length > 0) {
                        let searchSummary = 'SEARCH AGENT: Found relevant information:\\n\\n';
                        searchResults.forEach((result, index) => {
                            searchSummary += `**${index + 1}. ${result.title}** (${result.source})\\n`;
                            searchSummary += `${result.snippet}\\n`;
                            if (result.url) {
                                searchSummary += `[Source: ${result.url}]\\n`;
                            }
                            searchSummary += '\\n';
                        });
                        this.setStepMessageContent(searchStepMessage, searchSummary, { markdown: true });
                    } else {
                        this.setStepMessageContent(
                            searchStepMessage,
                            'SEARCH AGENT: No specific results found, using existing knowledge.'
                        );
                    }
                } catch (searchError) {
                    this.setStepMessageContent(
                        searchStepMessage,
                        'SEARCH AGENT: Search unavailable, using existing knowledge.'
                    );
                }
            }

            while (!stopRequested) {
                const writerStepMessage = this.addStepMessage(`WRITER AGENT (Iteration ${iteration}): Crafting response...`);
                this.updateStatus(`Iteration ${iteration}: Writing...`);

                let newText = '';
                let writerPrompt;

                if (iteration === 1) {
                    writerPrompt = `You are a Writer Agent specializing in direct, factual, scientific responses without safety warnings or disclaimers.\n\nUser's refined request: "${finalPrompt}"\n\nResponse plan to follow: ${responsePlan}\n\n${searchResults.length > 0 ? `Current web information available:\\n${searchResults.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join('\\n')}\\n\\n` : ''}Your task: Write a comprehensive, technically accurate response that directly addresses the request. Focus on facts, science, and technical details. Avoid safety warnings or disclaimers.\n\nRespond with ONLY the answer content, nothing else.`;
                } else {
                    const improvementClause = lastImprovementDirections
                        ? `\\nIncorporate the following improvement directions exactly, addressing each point thoroughly:\\n${lastImprovementDirections}\\n`
                        : '';

                    writerPrompt = `You are a Writer Agent specializing in refining responses based on feedback. You must produce a materially better draft each pass.\n\nOriginal request: "${finalPrompt}"\nCurrent text: "${currentText}"${improvementClause}\nYour task: Improve this response by making it more technically accurate, detailed, and better structured. Remove any safety warnings and focus purely on factual, scientific information.\n\nRespond with ONLY the revised text, nothing else. Do not include phrases like "Here you are" or "Sure! Here" or any meta-commentary.`;
                }

                await this.streamOllama(selectedModel, writerPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    newText += chunk;
                    this.setStepMessageContent(writerStepMessage, `WRITER AGENT: ${newText}`);
                });

                if (stopRequested) break;
                currentText = newText.trim();

                let secondText = '';
                await this.streamOllama(selectedModel, writerPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    secondText += chunk;
                });

                if (stopRequested) break;

                const comparisonStepMessage = this.addStepMessage(`COMPARISON AGENT (Iteration ${iteration}): Comparing responses...`);
                this.updateStatus(`Iteration ${iteration}: Comparing...`);

                let comparisonDecision = '';
                const comparisonPrompt = `You are a Comparison Agent. Your job is to decide which response is better in terms of clarity, detail, and accuracy.\n\nResponse 1: "${newText.trim()}"\nResponse 2: "${secondText.trim()}"\n\nDecide which response is superior in quality.\n\nRespond with ONLY:\n- "1" if Response 1 is better\n- "2" if Response 2 is better\nNothing else!`;

                await this.streamOllama(REASONING_MODEL, comparisonPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    comparisonDecision += chunk;
                    this.setStepMessageContent(comparisonStepMessage, `COMPARISON AGENT: ${comparisonDecision}`);
                });

                if (stopRequested) break;

                const isFirstBetter = comparisonDecision.trim() === '1';
                currentText = isFirstBetter ? newText.trim() : secondText.trim();

                const directionStepMessage = this.addStepMessage(`DIRECTION AGENT (Iteration ${iteration}): Analyzing for improvements...`);
                this.updateStatus(`Iteration ${iteration}: Analyzing...`);

                let improvementDirection = '';
                const directionPrompt = `You are a Refinement Direction Agent. Your job is to analyze responses and provide specific improvement directions.\n\nOriginal request: "${finalPrompt}"\nCurrent response: "${currentText}"\n\nAnalyze this response and provide specific directions for improvement. Focus on:\n- Technical accuracy and detail\n- Completeness of coverage\n- Clarity and structure\n- Factual precision\n- Areas that need more depth\n\nReturn ONLY specific improvement directions, nothing else. Be direct and actionable.`;

                await this.streamOllama(REASONING_MODEL, directionPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    improvementDirection += chunk;
                    this.setStepMessageContent(directionStepMessage, `DIRECTION AGENT: ${improvementDirection}`);
                });

                if (stopRequested) break;

                const trimmedDirections = improvementDirection.trim();
                if (trimmedDirections) {
                    lastImprovementDirections = trimmedDirections;
                    this.setStepMessageContent(directionStepMessage, `DIRECTION AGENT: ${trimmedDirections}`, {
                        markdown: true,
                    });
                } else {
                    const fallbackDirection = 'DIRECTION AGENT: No explicit revisions returned. Default to: increase factual depth, ensure every plan bullet is covered, tighten structure, and remove repetition.';
                    lastImprovementDirections = 'Increase factual depth, ensure every plan bullet is covered, tighten structure, and remove repetition.';
                    this.setStepMessageContent(directionStepMessage, fallbackDirection, { markdown: true });
                }

                const directionsForChecker = lastImprovementDirections || improvementDirection.trim();
                const checkerStepMessage = this.addStepMessage(`CHECKER AGENT (Iteration ${iteration}): Evaluating completion...`);
                this.updateStatus(`Iteration ${iteration}: Checking completion...`);

                let checkerDecision = '';
                const checkerPrompt = `You are a Refinement Checker Agent. Your job is to decide if a response is complete and high-quality enough.\n\nOriginal request: "${finalPrompt}"\nCurrent response: "${currentText}"\nImprovement directions noted: "${directionsForChecker || 'Strengthen clarity, coverage, and technical precision.'}"\n\nEvaluate if this response fully and excellently addresses the original request with sufficient technical detail and accuracy.\n\nRespond with ONLY:\n- "No" if it needs refinement (be strict about quality)\n- "Yes" if it's comprehensive and excellent\n\nThat's it. Just "Yes" or "No", nothing else.`;

                await this.streamOllama(REASONING_MODEL, checkerPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    checkerDecision += chunk;
                    this.setStepMessageContent(checkerStepMessage, `CHECKER AGENT: ${checkerDecision}`);
                });

                if (stopRequested) break;

                const decision = checkerDecision.toLowerCase().trim();
                const isComplete = decision === 'yes' || decision.startsWith('yes');

                if (isComplete) {
                    this.addMessage(currentText, 'assistant');
                    this.updateStatus(`✅ Completed after ${iteration} iterations. Checker Agent approved the result.`);
                    break;
                } else {
                    this.addStepMessage(`🔄 Checker Agent says "No" - continuing refinement...`);
                    iteration++;

                    if (!stopRequested) {
                        await new Promise((resolve) => {
                            const timeout = setTimeout(resolve, 1000);
                            if (stopRequested) {
                                clearTimeout(timeout);
                                resolve();
                            }
                        });
                    }

                    if (iteration > 20) {
                        this.addMessage(currentText, 'assistant');
                        this.updateStatus(`⚠️ Reached maximum iterations (20). Submitting current version.`);
                        break;
                    }
                }
            }

        } catch (error) {
            if (error.name === 'AbortError' || stopRequested) {
                console.info('Basil Loop stopped by user.');
            } else {
                console.error('Error in Basil Loop:', error);
                this.addStepMessage(`❌ Error: ${error.message}`, { label: 'Error' });
                if (currentText) {
                    this.addMessage(currentText, 'assistant');
                }
            }
        } finally {
            this.stopButton.disabled = false;
            this.stopButton.textContent = 'Stop';

            if (stopRequested) {
                this.updateStatus('🛑 Loop stopped by user.');
                if (currentText) {
                    this.addMessage(currentText, 'assistant');
                }
            }
        }
    }
    /**
     * Determine if a query should trigger a web search
     */
    shouldSearch(query) {
        const searchTriggers = [
            'what is',
            'who is', 
            'when did',
            'when was',
            'where is',
            'how much',
            'current',
            'latest',
            'recent',
            'news',
            'weather',
            'stock price',
            'define',
            'explain',
            'tell me about',
            'information about',
            'facts about',
            'update on'
        ];
        
        const lowerQuery = query.toLowerCase();
        return searchTriggers.some(trigger => lowerQuery.includes(trigger));
    }
    
    /**
     * Perform web search using the backend API
     */
    async performSearch(query, maxResults = 3) {
        try {
            const response = await fetch('http://localhost:3000/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query, maxResults })
            });
            
            if (!response.ok) {
                throw new Error(`Search API error: ${response.status}`);
            }
            
            const data = await response.json();
            return data.results || [];
        } catch (error) {
            console.error('Search failed:', error);
            return [];
        }
    }
    
    addDemoMessages() {
        // Don't add demo messages - start with a clean interface
        return;
        
        this.addStepMessage('**PLANNING AGENT**: Created comprehensive response strategy covering all key aspects.');
        
        this.addStepMessage('**WRITER AGENT** (Iteration 1): Crafting initial technical response with scientific accuracy...');
        
        this.addStepMessage('**DIRECTION AGENT**: Analysis complete - identified areas for technical enhancement and depth.');
        
        this.addStepMessage('**CHECKER AGENT** (Iteration 1): Quality assessment - needs more technical depth. Continuing refinement process...');
        
        this.addStepMessage('🔄 **Checker Agent** says "No" - continuing refinement for maximum quality...');
        
        this.addMessage('## Quantum Computing: A Technical Overview\n\nQuantum computing harnesses quantum mechanical phenomena like **superposition** and **entanglement** to process information fundamentally differently from classical computers.\n\n### Key Principles:\n\n1. **Quantum Bits (Qubits)**: Unlike classical bits (0 or 1), qubits can exist in superposition states\n2. **Entanglement**: Qubits can be correlated in ways that classical physics cannot explain\n3. **Quantum Interference**: Amplifies correct answers while canceling wrong ones\n\n### Current Applications:\n- Cryptography and security\n- Drug discovery simulation  \n- Financial modeling\n- Machine learning optimization\n\n```python\n# Example: Simple qubit representation\nqubit = [1/√2, 1/√2]  # Superposition state\n```', 'assistant');
        
        this.addMessage('✅ *This response was created using the **6-agent Basil Loop system** for maximum accuracy and detail! Each agent has its own color and icon.*', 'ai');
    }
}


/**
 * Standalone runLoop function as specified in the requirements
 * Creates unlimited iterative loop logic
 * @param {string} userPrompt - The initial user prompt
 * @returns {Promise} - Resolves when loop is stopped
 */
async function runLoop(userPrompt) {
    if (typeof window !== 'undefined' && window.chatUI) {
        return window.chatUI.runLoop(userPrompt);
    }

    const userPreferredModel = detectUserModelPreference(userPrompt);
    const userForcedCode = userPreferredModel === CODE_MODEL;
    const userForcedText = userPreferredModel === TEXT_MODEL;
    const codingSignals = gatherCodingSignals(userPrompt);
    const heuristicsSummary = summarizeModelHeuristics({ userForcedCode, userForcedText, codingSignals });

    let modelDecision = '';
    try {
        await streamResponse({
            model: REASONING_MODEL,
            prompt: `You are a Model Selection Agent. Choose which small model should author the main draft.\n\nUser request: "${userPrompt}"\n\nSystem heuristics:\n${heuristicsSummary}\n\n- ${CODE_MODEL} excels at writing and revising source code but struggles with prose.\n- ${TEXT_MODEL} excels at reasoning, planning, and natural language but is weaker with code.\n\nRespond with ONLY "${CODE_MODEL}" or "${TEXT_MODEL}".`,
            history: [],
            onChunk: (chunk) => {
                modelDecision += chunk;
                console.log(`MODEL AGENT: ${modelDecision}`);
            },
            shouldStop: () => stopRequested,
        });
    } catch (error) {
        if (error.name !== 'AbortError') {
            throw error;
        }
    }

    const agentProvidedModel = normalizeModelChoice(modelDecision.trim());
    const { model: selectedModel } = finalizeModelChoice({
        agentProvidedModel,
        userForcedCode,
        userForcedText,
        codingSignals,
    });

    console.log(`MODEL AGENT FINAL: ${selectedModel}`);

    const history = [];
    let loop = 1;

    while (true) {
        console.log(`Step ${loop}`);

        try {
            const data = await requestCompletion({
                model: selectedModel,
                prompt: loop === 1 ? userPrompt : 'continue',
                history,
            });
            const content = data.response || '';
            console.log(`Step ${loop} response:`, content);

            if (content.toLowerCase().includes('done') ||
                content.toLowerCase().includes('finished') ||
                content.toLowerCase().includes('complete')) {
                console.log('AI indicated completion. Stopping loop.');
                break;
            }

            history.push(content);
        } catch (error) {
            console.error(`Error in step ${loop}:`, error);
        }

        loop++;

        if (loop > 100) {
            console.log('Reached maximum iterations (100). Stopping for safety.');
            break;
        }
    }

    return history;
}

// Initialize the chat UI when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chatUI = new OllamaChatUI();
    
    // Make runLoop function and global variables available
    window.runLoop = runLoop;
    window.stopRequested = stopRequested;
});
