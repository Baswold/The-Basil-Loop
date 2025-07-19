// Global variables for user interactions
let currentModel = 'gemma:2b'; // Default model
let stopRequested = false; // Flag to stop the current loop

class OllamaChatUI {
    constructor() {
        this.messagesContainer = document.getElementById('chat');
        this.messageInput = document.getElementById('prompt');
        this.sendButton = document.getElementById('send-btn');
        this.stopButton = document.getElementById('stop-btn');
        this.modelSelect = document.getElementById('model-select');
        this.statusDiv = document.getElementById('status');
        this.stepCounter = 0;
        
        // Use localhost:3000 if using the Express proxy, otherwise direct to Ollama
        this.apiUrl = window.location.hostname === 'localhost' && window.location.port === '3000' 
            ? 'http://localhost:3000/api/generate' 
            : 'http://localhost:11434/api/generate';
        
        // Initially hide the stop button
        this.stopButton.style.display = 'none';
        
        // Initialize global currentModel with the selected value
        currentModel = this.modelSelect.value;
        
        this.initializeEventListeners();
        this.addDemoMessages();
    }
    
    initializeEventListeners() {
        // Send button: disables itself, calls runLoop, re-enables when finished
        this.sendButton.addEventListener('click', () => this.handleSendClick());
        
        // Stop button: sets stopRequested = true so runLoop breaks after current stream
        this.stopButton.addEventListener('click', () => this.handleStopClick());
        
        // Model select: updates global currentModel
        this.modelSelect.addEventListener('change', () => this.handleModelChange());
        
        // Enter key handling
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendClick();
            }
        });
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
            
            // Call runLoop with current model and message
            await this.runLoop(currentModel, message);
        } catch (error) {
            console.error('Error in handleSendClick:', error);
            this.addMessage('Sorry, there was an error processing your request. Please make sure Ollama is running.', 'assistant');
        } finally {
            // Re-enable Send button when finished
            this.sendButton.disabled = false;
            this.sendButton.textContent = 'Send';
            
            // Hide Stop button
            this.stopButton.style.display = 'none';
            
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
    }
    
    /**
     * Handle Model select change - updates global currentModel
     */
    handleModelChange() {
        currentModel = this.modelSelect.value;
        this.updateStatus(`Model changed to ${currentModel}`);
        
        // Reset status to Ready after a short delay
        setTimeout(() => {
            this.updateStatus('Ready');
        }, 2000);
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        // Add user message to chat
        this.addMessage(message, 'user');
        this.messageInput.value = '';
        
        // Check if this is a loop request (contains keywords like 'loop', 'iterate', 'continue until')
        const isLoopRequest = message.toLowerCase().includes('loop') || 
                             message.toLowerCase().includes('iterate') || 
                             message.toLowerCase().includes('continue until') ||
                             message.toLowerCase().includes('keep going') ||
                             message.toLowerCase().includes('step by step');
        
        // Disable input while processing
        this.setInputState(false);
        
        try {
            if (isLoopRequest) {
                // Use the loop functionality for iterative responses
                const selectedModel = this.modelSelect.value;
                await this.runLoop(selectedModel, message);
            } else {
                // Regular single response
                const loadingMessage = this.addMessage('Thinking...', 'assistant', true);
                
                const response = await this.callOllama(message);
                // Remove loading message
                loadingMessage.remove();
                // Add assistant response
                this.addMessage(response, 'assistant');
            }
        } catch (error) {
            console.error('Error:', error);
            this.addMessage('Sorry, there was an error processing your request. Please make sure Ollama is running.', 'assistant');
        } finally {
            this.setInputState(true);
            this.messageInput.focus();
        }
    }
    
    async callOllama(message) {
        const selectedModel = this.modelSelect.value;
        this.updateStatus(`Connecting to ${selectedModel}...`);
        
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: selectedModel,
                prompt: message,
                stream: false
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        this.updateStatus('Ready');
        return data.response || 'No response received';
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
        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                context: history,
                stream: true
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        try {
            while (true) {
                // Check if stop was requested
                if (stopRequested) {
                    break;
                }
                
                const { done, value } = await reader.read();
                
                if (done) break;
                
                // Decode the chunk and add it to our buffer
                buffer += decoder.decode(value, { stream: true });
                
                // Process complete lines in the buffer
                let lines = buffer.split('\n');
                
                // Keep the last incomplete line in the buffer
                buffer = lines.pop() || '';
                
                // Process each complete line
                for (const line of lines) {
                    // Check if stop was requested before processing each line
                    if (stopRequested) {
                        break;
                    }
                    
                    const trimmedLine = line.trim();
                    if (trimmedLine === '') continue;
                    
                    try {
                        const data = JSON.parse(trimmedLine);
                        
                        // Extract the response text and call onChunk
                        if (data.response) {
                            onChunk(data.response);
                        }
                        
                        // Check if we're done
                        if (data.done) {
                            return data;
                        }
                    } catch (parseError) {
                        console.warn('Failed to parse JSON chunk:', trimmedLine, parseError);
                    }
                }
                
                // Break outer loop if stop was requested during line processing
                if (stopRequested) {
                    break;
                }
            }
            
            // Process any remaining data in the buffer if not stopped
            if (!stopRequested && buffer.trim()) {
                try {
                    const data = JSON.parse(buffer.trim());
                    if (data.response) {
                        onChunk(data.response);
                    }
                    return data;
                } catch (parseError) {
                    console.warn('Failed to parse final JSON chunk:', buffer, parseError);
                }
            }
        } finally {
            reader.releaseLock();
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
    
    addStepMessage(content, stepNumber = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message step';
        
        // Detect agent type and add specific styling
        const agentType = this.detectAgentType(content);
        if (agentType) {
            messageDiv.classList.add(`agent-${agentType}`);
        }
        
        if (stepNumber === null) {
            this.stepCounter++;
            stepNumber = this.stepCounter;
        }
        
        messageDiv.setAttribute('data-step', `Step ${stepNumber}`);
        
        // Render markdown for step messages
        if (typeof marked !== 'undefined') {
            messageDiv.innerHTML = marked.parse(content);
        } else {
            messageDiv.textContent = content;
        }
        
        // Add copy button for step messages (AI reasoning steps)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '📋';
        copyBtn.title = 'Copy step';
        copyBtn.addEventListener('click', () => this.copyToClipboard(content, copyBtn));
        messageDiv.appendChild(copyBtn);
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
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
    async runLoop(model, userPrompt) {
        let iteration = 1;
        let currentText = '';
        let searchResults = [];
        let isCodingTask = false; // Track if this is a coding task
        
        try {
            // AGENT 0: Task Type Agent (determines if this is coding or text)
            const taskTypeMessage = this.addStepMessage('TASK TYPE AGENT: Analyzing request type...', `${iteration}-tasktype`);
            this.updateStatus('Step 0: Determining task type...');
            
            let taskType = '';
            const taskTypePrompt = `You are a Task Type Agent. Analyze if this user request is about coding/programming.

User request: "${userPrompt}"

Look for keywords like: function, code, program, script, algorithm, implement, debug, syntax, class, method, variable, loop, etc.

Respond with ONLY:
"code" if this is a coding/programming request
"text" if this is a general text/explanation request

Nothing else!`;
            
            await this.streamOllama(model, taskTypePrompt, [], (chunk) => {
                if (stopRequested) return;
                taskType += chunk;
                taskTypeMessage.textContent = `TASK TYPE AGENT: ${taskType}`;
            });
            
            if (stopRequested) return;
            
            isCodingTask = taskType.toLowerCase().trim() === 'code';
            if (isCodingTask) {
                taskTypeMessage.innerHTML = marked.parse(`TASK TYPE AGENT: **Detected as CODING task** - Will use codegemma:2b`);
            } else {
                taskTypeMessage.innerHTML = marked.parse(`TASK TYPE AGENT: **Detected as TEXT/EXPLANATION task** - Will use gemma:2b`);
            }
            
            // AGENT 1: Prompt Refining Agent (enhances user prompt for better results)
            const promptStepMessage = this.addStepMessage('PROMPT AGENT: Analyzing and refining user request...', `${iteration}-prompt`);
            this.updateStatus('Step 1: Refining prompt...');
            
            let refinedPrompt = '';
            const promptRefinePrompt = `You are a Prompt Refining Agent. Your job is to take a user's request and make it more specific and detailed to get the best possible response from other AI agents.

Original user request: "${userPrompt}"

Analyze this request and create a more detailed, specific version that will help other agents provide better technical, scientific, and factual responses. Focus on:
- Making vague terms more specific
- Adding context that would be helpful
- Clarifying the level of detail needed
- Identifying key aspects to address

Return ONLY the refined prompt, nothing else. No explanations, no "Here's the refined prompt:" - just the improved version.`;
            
            await this.streamOllama(model, promptRefinePrompt, [], (chunk) => {
                if (stopRequested) return;
                refinedPrompt += chunk;
                promptStepMessage.textContent = `PROMPT AGENT: ${refinedPrompt}`;
            });
            
            if (stopRequested) return;
            const finalPrompt = refinedPrompt.trim() || userPrompt; // fallback to original
            
            // AGENT 2: Planning Agent (creates execution plan)
            const planStepMessage = this.addStepMessage('PLANNING AGENT: Creating response strategy...', `${iteration}-plan`);
            this.updateStatus('Step 2: Planning response...');
            
            let responsePlan = '';
            const planningPrompt = isCodingTask ? 
                `You are a Planning Agent for CODING tasks. Your job is to create a plan for implementing this code request:

"${finalPrompt}"

Create a coding plan that outlines:
1. What function/class/module needs to be created
2. Input parameters and return values
3. Key algorithms or logic to implement
4. Error handling considerations
5. Code structure and organization
6. Example usage or test cases

Return ONLY the coding plan, nothing else. Be specific and code-focused.` :
                `You are a Planning Agent. Your job is to create a strategic plan for answering this refined request:

"${finalPrompt}"

Create a detailed plan that outlines:
1. What main topics need to be covered
2. What level of technical detail is appropriate
3. What structure the response should follow
4. What key points must be addressed
5. What tools or knowledge areas to focus on

Return ONLY the plan, nothing else. Be specific and actionable.`;
            
            await this.streamOllama(model, planningPrompt, [], (chunk) => {
                if (stopRequested) return;
                responsePlan += chunk;
                planStepMessage.textContent = `PLANNING AGENT: ${responsePlan}`;
            });
            
            if (stopRequested) return;
            
            // AGENT 3: Model Selection Agent (picks best model for the task)
            const modelStepMessage = this.addStepMessage('MODEL AGENT: Selecting optimal model for this task...', `${iteration}-model`);
            this.updateStatus('Step 3: Selecting model...');
            
            let selectedModel = model; // default fallback
            
            // Skip model selection agent if task type already determined
            if (isCodingTask) {
                selectedModel = 'codegemma:2b';
                modelStepMessage.innerHTML = marked.parse(`MODEL AGENT: **Automatically selected codegemma:2b** based on Task Type Agent's coding detection`);
            } else {
                let modelDecision = '';
                const modelSelectionPrompt = `You are a Model Selection Agent. Your job is to determine whether to use gemma:2b (good for text/explanations) or codegemma:2b (specialized for code) based on the request.

Request to analyze: "${finalPrompt}"
Planning context: ${responsePlan}

Analyze if this request is primarily about:
- CODE/PROGRAMMING (functions, algorithms, debugging, syntax, code examples, programming concepts) → use codegemma:2b
- TEXT/EXPLANATIONS (concepts, theories, general knowledge, essays, explanations) → use gemma:2b

IMPORTANT: codegemma:2b is TERRIBLE at writing explanatory text but excellent at code. gemma:2b is good at explanations but weaker at code.

Respond with ONLY:
"codegemma:2b" if this is primarily a coding/programming task
"gemma:2b" if this is primarily a text/explanation task

Nothing else!`;
            
            await this.streamOllama(model, modelSelectionPrompt, [], (chunk) => {
                if (stopRequested) return;
                modelDecision += chunk;
                modelStepMessage.textContent = `MODEL AGENT: ${modelDecision}`;
            });
            
            if (stopRequested) return;
            
                // Parse model decision
                const cleanDecision = modelDecision.toLowerCase().trim();
                if (cleanDecision.includes('codegemma:2b')) {
                    selectedModel = 'codegemma:2b';
                    modelStepMessage.innerHTML = marked.parse(`MODEL AGENT: Selected **codegemma:2b** - This is a coding/programming task`);
                } else {
                    selectedModel = 'gemma:2b';
                    modelStepMessage.innerHTML = marked.parse(`MODEL AGENT: Selected **gemma:2b** - This is a text/explanation task`);
                }
            }
            
            // AGENT 4: Web Search (if needed)
            const shouldSearchNow = this.shouldSearch(finalPrompt);
            if (shouldSearchNow) {
                const searchStepMessage = this.addStepMessage('SEARCH AGENT: Gathering current information...', `${iteration}-search`);
                this.updateStatus('Step 4: Searching web...');
                
                try {
                    searchResults = await this.performSearch(finalPrompt);
                    if (searchResults.length > 0) {
                        let searchSummary = 'SEARCH AGENT: Found relevant information:\n\n';
                        searchResults.forEach((result, index) => {
                            searchSummary += `**${index + 1}. ${result.title}** (${result.source})\n`;
                            searchSummary += `${result.snippet}\n`;
                            if (result.url) {
                                searchSummary += `[Source: ${result.url}]\n`;
                            }
                            searchSummary += '\n';
                        });
                        searchStepMessage.innerHTML = marked.parse(searchSummary);
                    } else {
                        searchStepMessage.textContent = 'SEARCH AGENT: No specific results found, using existing knowledge.';
                    }
                } catch (searchError) {
                    searchStepMessage.textContent = 'SEARCH AGENT: Search unavailable, using existing knowledge.';
                }
            }
            
            // NOW START THE ITERATIVE REFINEMENT LOOP
            while (!stopRequested) {
                // AGENT 4: Draft Writer Agent (writes/rewrites content)
                const writerStepMessage = this.addStepMessage(`WRITER AGENT (Iteration ${iteration}): Crafting response...`, `${iteration}-writer`);
                
                // Execute twice with high temperature for diversity
                const temp = 1.0;
                this.updateStatus(`Iteration ${iteration}: Writing...`);
                
                let newText = '';
                let writerPrompt;
                
                if (iteration === 1) {
                    // First draft
                    writerPrompt = `You are a Writer Agent specializing in direct, factual, scientific responses without safety warnings or disclaimers.

User's refined request: "${finalPrompt}"

Response plan to follow: ${responsePlan}

${searchResults.length > 0 ? `Current web information available:\n${searchResults.map((r, i) => `${i+1}. ${r.title}: ${r.snippet}`).join('\n')}\n\n` : ''}Your task: Write a comprehensive, technically accurate response that directly addresses the request. Focus on facts, science, and technical details. Avoid safety warnings or disclaimers.

Respond with ONLY the answer content, nothing else:`;
                } else {
                    // Refinement iteration
                    writerPrompt = `You are a Writer Agent specializing in refining responses based on feedback.

Original request: "${finalPrompt}"
Current text: "${currentText}"

Your task: Improve this response by making it more technically accurate, detailed, and better structured. Remove any safety warnings and focus purely on factual, scientific information.

Respond with ONLY the revised text, nothing else. Do not include phrases like "Here you are" or "Sure! Here" or any meta-commentary:`;
                }
                
                await this.streamOllama(selectedModel, writerPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    newText += chunk;
                    writerStepMessage.textContent = `WRITER AGENT: ${newText}`;
                });
                
                if (stopRequested) break;
                currentText = newText.trim();
                
                
                // Perform a second iteration
                let secondText = '';
                await this.streamOllama(selectedModel, writerPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    secondText += chunk;
                });
                
                if (stopRequested) break;
                
                // AGENT: Comparison Agent (compares two responses)
                const comparisonStepMessage = this.addStepMessage(`COMPARISON AGENT (Iteration ${iteration}): Comparing responses...`, `${iteration}-comparison`);
                this.updateStatus(`Iteration ${iteration}: Comparing...`);
                
                let comparisonDecision = '';
                const comparisonPrompt = `You are a Comparison Agent. Your job is to decide which response is better in terms of clarity, detail, and accuracy.
                
                Response 1: "${newText.trim()}"
                Response 2: "${secondText.trim()}"
                
                Decide which response is superior in quality.
                
                Respond with ONLY:
                - "1" if Response 1 is better
                - "2" if Response 2 is better
                Nothing else!`;

                await this.streamOllama(model, comparisonPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    comparisonDecision += chunk;
                    comparisonStepMessage.textContent = `COMPARISON AGENT: ${comparisonDecision}`;
                });

                if (stopRequested) break;

                const isFirstBetter = comparisonDecision.trim() === '1';
                currentText = isFirstBetter ? newText.trim() : secondText.trim();
                const directionStepMessage = this.addStepMessage(`DIRECTION AGENT (Iteration ${iteration}): Analyzing for improvements...`, `${iteration}-direction`);
                this.updateStatus(`Iteration ${iteration}: Analyzing...`);
                
                let improvementDirection = '';
                const directionPrompt = `You are a Refinement Direction Agent. Your job is to analyze responses and provide specific improvement directions.

Original request: "${finalPrompt}"
Current response: "${currentText}"

Analyze this response and provide specific directions for improvement. Focus on:
- Technical accuracy and detail
- Completeness of coverage
- Clarity and structure
- Factual precision
- Areas that need more depth

Return ONLY specific improvement directions, nothing else. Be direct and actionable.`;
                
                await this.streamOllama(model, directionPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    improvementDirection += chunk;
                    directionStepMessage.textContent = `DIRECTION AGENT: ${improvementDirection}`;
                });
                
                if (stopRequested) break;
                
                // AGENT 6: Refinement Checker Agent (decides if we're done)
                const checkerStepMessage = this.addStepMessage(`CHECKER AGENT (Iteration ${iteration}): Evaluating completion...`, `${iteration}-checker`);
                this.updateStatus(`Iteration ${iteration}: Checking completion...`);
                
                let checkerDecision = '';
                const checkerPrompt = `You are a Refinement Checker Agent. Your job is to decide if a response is complete and high-quality enough.

Original request: "${finalPrompt}"
Current response: "${currentText}"
Improvement directions noted: "${improvementDirection}"

Evaluate if this response fully and excellently addresses the original request with sufficient technical detail and accuracy.

Respond with ONLY:
- "No" if it needs refinement (be strict about quality)
- "Yes" if it's comprehensive and excellent

That's it. Just "Yes" or "No", nothing else.`;
                
                await this.streamOllama(model, checkerPrompt, [], (chunk) => {
                    if (stopRequested) return;
                    checkerDecision += chunk;
                    checkerStepMessage.textContent = `CHECKER AGENT: ${checkerDecision}`;
                });
                
                if (stopRequested) break;
                
                // Check the decision
                const decision = checkerDecision.toLowerCase().trim();
                const isComplete = decision === 'yes' || decision.startsWith('yes');
                
                if (isComplete) {
                    // Submit final answer
                    this.addMessage(currentText, 'assistant');
                    this.updateStatus(`✅ Completed after ${iteration} iterations. Checker Agent approved the result.`);
                    break;
                } else {
                    // Continue refining
                    const continueMessage = this.addStepMessage(`🔄 Checker Agent says "No" - continuing refinement...`, `${iteration}-continue`);
                    iteration++;
                    
                    // Small delay between iterations
                    if (!stopRequested) {
                        await new Promise(resolve => {
                            const timeout = setTimeout(resolve, 1000);
                            if (stopRequested) {
                                clearTimeout(timeout);
                                resolve();
                            }
                        });
                    }
                    
                    // Safety check - prevent infinite loops
                    if (iteration > 20) {
                        this.addMessage(currentText, 'assistant');
                        this.updateStatus(`⚠️ Reached maximum iterations (20). Submitting current version.`);
                        break;
                    }
                }
            }
            
        } catch (error) {
            console.error('Error in Basil Loop:', error);
            this.addStepMessage(`❌ Error: ${error.message}`, 'error');
            if (currentText) {
                this.addMessage(currentText, 'assistant');
            }
        } finally {
            // Clean up UI state
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
 * @param {string} model - The model to use for generation
 * @param {string} userPrompt - The initial user prompt
 * @returns {Promise} - Resolves when loop is stopped
 */
async function runLoop(model, userPrompt) {
    const history = [];
    let loop = 1;
    
    while (true) {
        // a. Display "Step #loop" placeholder
        console.log(`Step ${loop}`);
        
        // Create a placeholder element in the DOM if chat UI is available
        if (typeof window !== 'undefined' && document.getElementById('chat')) {
            const chatArea = document.getElementById('chat');
            const stepDiv = document.createElement('div');
            stepDiv.className = 'message step';
            stepDiv.setAttribute('data-step', `Step ${loop}`);
            stepDiv.textContent = 'Starting...';
            chatArea.appendChild(stepDiv);
            
            let stepContent = '';
            
            try {
                // b. Await streamOllama(...), appending tokens to that step
                // Use proxy URL if running on localhost:3000, otherwise direct to Ollama
                const apiUrl = window.location.hostname === 'localhost' && window.location.port === '3000' 
                    ? 'http://localhost:3000/api/generate' 
                    : 'http://localhost:11434/api/generate';
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: model,
                        prompt: loop === 1 ? userPrompt : 'continue',
                        context: history,
                        stream: true
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                
                while (true) {
                    const { done, value } = await reader.read();
                    
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    let lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine === '') continue;
                        
                        try {
                            const data = JSON.parse(trimmedLine);
                            
                            if (data.response) {
                                stepContent += data.response;
                                stepDiv.textContent = stepContent; // Update step with streaming content
                            }
                            
                            if (data.done) {
                                break;
                            }
                        } catch (parseError) {
                            console.warn('Failed to parse JSON chunk:', trimmedLine);
                        }
                    }
                }
                
                // Process remaining buffer
                if (buffer.trim()) {
                    try {
                        const data = JSON.parse(buffer.trim());
                        if (data.response) {
                            stepContent += data.response;
                            stepDiv.textContent = stepContent;
                        }
                    } catch (parseError) {
                        console.warn('Failed to parse final JSON chunk:', buffer);
                    }
                }
                
                // c. Decide continue or stop
                const lowerContent = stepContent.toLowerCase();
                if (lowerContent.includes('done') || 
                    lowerContent.includes('finished') || 
                    lowerContent.includes('complete')) {
                    console.log('AI indicated completion. Stopping loop.');
                    break;
                }
                
                // Push AI text into history
                if (stepContent.trim()) {
                    history.push(stepContent);
                }
                
            } catch (error) {
                console.error(`Error in step ${loop}:`, error);
                stepDiv.textContent = `Error in step ${loop}: ${error.message}`;
                stepDiv.classList.add('error');
            }
            
            // Small delay between iterations
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } else {
            // Fallback for non-DOM environments
            console.warn('DOM not available, running in console mode');
            
            try {
                // Use proxy URL if running on localhost:3000, otherwise direct to Ollama
                const apiUrl = window.location.hostname === 'localhost' && window.location.port === '3000' 
                    ? 'http://localhost:3000/api/generate' 
                    : 'http://localhost:11434/api/generate';
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: model,
                        prompt: loop === 1 ? userPrompt : 'continue',
                        context: history,
                        stream: false
                    })
                });
                
                const data = await response.json();
                const content = data.response || '';
                console.log(`Step ${loop} response:`, content);
                
                if (content.toLowerCase().includes('done')) {
                    break;
                }
                
                history.push(content);
                
            } catch (error) {
                console.error(`Error in step ${loop}:`, error);
            }
        }
        
        loop++;
        
        // Safety check to prevent infinite loops
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
    window.currentModel = currentModel;
    window.stopRequested = stopRequested;
});
