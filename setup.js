export async function checkApiKey() {
    const result = await chrome.storage.local.get(['geminiApiKey']);
    if (!result.geminiApiKey) {
        return showApiKeySetup();
    }
    return result.geminiApiKey;
}

function showApiKeySetup() {
    return new Promise((resolve) => {
        document.getElementById('content').innerHTML = `
            <div class="card setup-screen">
                <h2>Welcome to GenAI Learning Assistant</h2>
                <p>Please enter your Gemini API key to get started:</p>
                <input type="password" id="apiKeyInput" placeholder="Enter your Gemini API key" class="api-key-input">
                <p class="hint">Get your API key from <a href="https://makersuite.google.com/app/apikey" target="_blank">Google AI Studio</a></p>
                <div class="setup-instructions">
                    <p>Setup Instructions:</p>
                    <ol>
                        <li>Visit <a href="https://makersuite.google.com/app/apikey" target="_blank">Google AI Studio</a></li>
                        <li>Create or select a project</li>
                        <li>Create an API key</li>
                        <li>Copy and paste the key here</li>
                    </ol>
                </div>
                <div id="apiKeyError" class="api-key-error"></div>
                <button id="saveApiKey" class="option-btn">Save API Key</button>
            </div>
        `;

        document.getElementById('saveApiKey').addEventListener('click', async () => {
            const apiKey = document.getElementById('apiKeyInput').value.trim();
            const errorDiv = document.getElementById('apiKeyError');
            
            if (!apiKey) {
                errorDiv.textContent = 'Please enter an API key';
                return;
            }

            if (!apiKey.match(/^[A-Za-z0-9-_]+$/)) {
                errorDiv.textContent = 'Invalid API key format';
                return;
            }

            // Test the API key with a simple request
            try {
                const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-goog-api-key': apiKey
                    },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{
                                text: 'Test connection'
                            }]
                        }]
                    })
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error?.message || 'API request failed');
                }

                await chrome.storage.local.set({ geminiApiKey: apiKey });
                resolve(apiKey);
            } catch (error) {
                errorDiv.innerHTML = `
                    API Key Error:<br>
                    ${error.message.includes('invalid authentication credentials') ? 
                    '- Invalid or expired API key<br>- Ensure you\'ve enabled the Gemini API<br>- Check if you copied the complete key' : 
                    error.message}
                `;
            }
        });
    });
}