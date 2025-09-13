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
                <p class="hint">You can get your API key from Google AI Studio</p>
                <button id="saveApiKey" class="option-btn">Save API Key</button>
            </div>
        `;

        document.getElementById('saveApiKey').addEventListener('click', async () => {
            const apiKey = document.getElementById('apiKeyInput').value.trim();
            if (apiKey) {
                await chrome.storage.local.set({ geminiApiKey: apiKey });
                resolve(apiKey);
            }
        });
    });
}