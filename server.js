const express = require('express');
const cors = require('cors');
const path = require('path');
const { JSDOM } = require('jsdom');

const app = express();
const PORT = 3000;
const OLLAMA_URL = 'http://localhost:11434';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Proxy endpoint for Ollama API
app.post('/api/generate', async (req, res) => {
    try {
        console.log(`🔄 Ollama API request - Model: ${req.body.model}, Stream: ${req.body.stream}, Prompt length: ${req.body.prompt?.length || 0}`);
        
        // Check if Ollama is running by trying to connect
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Ollama API error ${response.status}: ${errorText}`);
            throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
        }

        console.log(`✅ Ollama API responded successfully`);

        // Check if this is a streaming request
        if (req.body.stream) {
            // Stream the response back to the client
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Transfer-Encoding', 'chunked');
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    res.write(chunk);
                }
                res.end();
                console.log(`📡 Stream completed successfully`);
            } catch (streamError) {
                console.error('❌ Streaming error:', streamError);
                res.end();
            }
        } else {
            // Non-streaming response
            const data = await response.json();
            res.json(data);
        }
    } catch (error) {
        console.error('🚨 Proxy error:', error.message);
        
        // More specific error messages
        let errorMessage = error.message;
        if (error.code === 'ECONNREFUSED') {
            errorMessage = 'Ollama is not running. Please start it with: ollama serve';
        } else if (error.message.includes('404')) {
            errorMessage = `Model '${req.body.model}' not found. Please pull it with: ollama pull ${req.body.model}`;
        }
        
        res.status(500).json({ 
            error: 'Failed to communicate with Ollama',
            message: errorMessage,
            details: error.message
        });
    }
});

// Web search endpoint
app.post('/api/search', async (req, res) => {
    try {
        const { query, maxResults = 5 } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        
        console.log(`🔍 Searching for: "${query}"`);
        
        // Try DuckDuckGo instant answer first
        // Handle if no results obtained
        const searchResults = await performWebSearch(query, maxResults);
        
        res.json({
            query,
            results: searchResults,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            error: 'Search failed',
            message: error.message 
        });
    }
});

// Enhanced web search function with better offline handling
async function performWebSearch(query, maxResults = 5) {
    const results = [];
    
    try {
        console.log(`🔍 Performing search for: "${query}"`);
        
        // Method 1: Try DuckDuckGo instant answer API with timeout
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
            
            const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            const ddgResponse = await fetch(ddgUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (ddgResponse.ok) {
                const ddgData = await ddgResponse.json();
                
                if (ddgData.Abstract && ddgData.Abstract.trim() && ddgData.Abstract.length > 10) {
                    results.push({
                        title: ddgData.Heading || 'DuckDuckGo Answer',
                        snippet: ddgData.Abstract.substring(0, 300) + (ddgData.Abstract.length > 300 ? '...' : ''),
                        url: ddgData.AbstractURL || '',
                        source: 'DuckDuckGo'
                    });
                    console.log('✅ DuckDuckGo result found');
                }
            }
        } catch (ddgError) {
            console.log('❌ DuckDuckGo search failed:', ddgError.message);
        }
        
        // Method 2: Try Wikipedia if query looks like a definition request
        if (query.toLowerCase().includes('what is') || query.toLowerCase().includes('who is') || 
            query.toLowerCase().includes('define') || query.toLowerCase().includes('explain')) {
            
            try {
                const wikiTerm = query.replace(/^(what is|who is|define|explain)\s+/i, '').trim();
                const cleanTerm = wikiTerm.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
                
                if (cleanTerm.length > 1) {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    
                    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTerm)}`;
                    const wikiResponse = await fetch(wikiUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (wikiResponse.ok) {
                        const wikiData = await wikiResponse.json();
                        if (wikiData.extract && !wikiData.extract.includes('may refer to') && wikiData.extract.length > 50) {
                            results.push({
                                title: wikiData.title || 'Wikipedia Article',
                                snippet: wikiData.extract.substring(0, 300) + (wikiData.extract.length > 300 ? '...' : ''),
                                url: wikiData.content_urls?.desktop?.page || '',
                                source: 'Wikipedia'
                            });
                            console.log('✅ Wikipedia result found');
                        }
                    }
                }
            } catch (wikiError) {
                console.log('❌ Wikipedia search failed:', wikiError.message);
            }
        }
        
        // Method 3: Add contextual guidance based on query type
        if (results.length === 0) {
            let contextualHint = '';
            
            if (query.toLowerCase().includes('how to')) {
                contextualHint = 'This appears to be a how-to question. I\'ll provide step-by-step guidance based on my knowledge.';
            } else if (query.toLowerCase().includes('current') || query.toLowerCase().includes('latest') || query.toLowerCase().includes('recent')) {
                contextualHint = 'You\'re asking about current information. I\'ll provide the most recent information I have, though it may not reflect very recent developments.';
            } else if (query.toLowerCase().includes('compare') || query.toLowerCase().includes('vs') || query.toLowerCase().includes('difference')) {
                contextualHint = 'I\'ll provide a detailed comparison based on my knowledge of these topics.';
            } else {
                contextualHint = 'I\'ll provide comprehensive information about this topic using my existing knowledge.';
            }
            
            results.push({
                title: 'Knowledge Base Search',
                snippet: contextualHint,
                url: '',
                source: 'AI Knowledge'
            });
        }
        
        console.log(`📊 Search completed: ${results.length} results found`);
    // If no results found from DDG or Wikipedia
    if (results.length === 0) {
        results.push({
            title: 'No Results',
            snippet: 'No specific information was found online. Try refining your search.',
            url: '',
            source: 'Search'
        });
    }
    
    return results.slice(0, maxResults);
        
    } catch (error) {
        console.error('🚨 Search system error:', error);
        return [{
            title: 'Search Unavailable',
            snippet: `Search is currently unavailable (${error.message}). I'll provide answers using my built-in knowledge.`,
            url: '',
            source: 'Offline Mode'
        }];
    }
}

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Ollama Chat UI server running at http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${__dirname}`);
    console.log(`🔗 Proxying Ollama API from: ${OLLAMA_URL}`);
    console.log('');
    console.log('Make sure Ollama is running on port 11434');
    console.log('You can start Ollama with: ollama serve');
});
