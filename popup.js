// Import setup functionality
import { checkApiKey } from './setup.js';

let GEMINI_API_KEY;

// Promise-based chrome.storage helpers
const storage = {
    get(keys) {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage.local.get(keys, (result) => {
                    const err = chrome.runtime.lastError;
                    if (err) return reject(err);
                    resolve(result);
                });
            } catch (e) { reject(e); }
        });
    },
    set(items) {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage.local.set(items, () => {
                    const err = chrome.runtime.lastError;
                    if (err) return reject(err);
                    resolve();
                });
            } catch (e) { reject(e); }
        });
    },
    remove(keys) {
        return new Promise((resolve, reject) => {
            try {
                chrome.storage.local.remove(keys, () => {
                    const err = chrome.runtime.lastError;
                    if (err) return reject(err);
                    resolve();
                });
            } catch (e) { reject(e); }
        });
    }
};

// Ensure options are exactly A-D and correct is a single letter among them
function normalizeQuestion(raw) {
    const labels = ['A','B','C','D'];
    const question = String(raw.question || raw.prompt || '').trim();

    // Build options map with exactly A-D
    let optionsObj = {};
    if (raw.options && typeof raw.options === 'object' && !Array.isArray(raw.options)) {
        const entries = Object.entries(raw.options).map(([k, v]) => [String(k).trim().toUpperCase(), String(v).trim()]);
        // If keys are A-D already, preserve order A-D
        if (labels.every(L => entries.some(([k]) => k === L))) {
            labels.forEach(L => { optionsObj[L] = entries.find(([k]) => k === L)?.[1] || ''; });
        } else {
            // Otherwise, take values in encountered order and assign to A-D
            const values = entries.map(([, v]) => v).filter(Boolean).slice(0, 4);
            labels.forEach((L, i) => { optionsObj[L] = values[i] || ''; });
        }
    } else if (Array.isArray(raw.options)) {
        const values = raw.options.map(v => String(v).trim()).filter(Boolean).slice(0, 4);
        labels.forEach((L, i) => { optionsObj[L] = values[i] || ''; });
    } else {
        // Try properties A, B, C, D on the object
        labels.forEach(L => { if (raw[L]) optionsObj[L] = String(raw[L]).trim(); });
        if (Object.keys(optionsObj).length !== 4) {
            // Not enough info; best-effort fallback to empty strings
            labels.forEach(L => { if (!optionsObj[L]) optionsObj[L] = ''; });
        }
    }

    // Determine correct letter
    let correct = String(raw.correct || raw.correct_answer || raw.answer || '').trim();
    if (/^[A-D]$/i.test(correct)) {
        correct = correct.toUpperCase();
    } else {
        // If 'correct' matches an option text, map it to its label
        const found = Object.entries(optionsObj).find(([, v]) => v && v.toLowerCase() === correct.toLowerCase());
        correct = found ? found[0] : 'A';
    }

    // Return normalized question
    return { question, options: optionsObj, correct };
}

// Fisher–Yates shuffle (top-level)
function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Reusable loading renderer
function renderLoading(message = 'Loading...') {
    const contentArea = document.getElementById('content');
    if (!contentArea) return;
    contentArea.innerHTML = `
        <div class="card loading">
            <div class="spinner"></div>
            <div>${message}</div>
        </div>
    `;
}

// Minimal Markdown -> HTML renderer for readability of LLM responses
function renderMarkdown(mdText) {
    if (!mdText) return '';
    // Normalize line endings
    let text = String(mdText).replace(/\r\n/g, '\n');

    // Extract fenced code blocks first
    const codeBlocks = [];
    text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
        const idx = codeBlocks.push(code) - 1;
        return `[[CODE_BLOCK_${idx}]]`;
    });

    // Escape HTML
    text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Headings
    text = text.replace(/^###\s+(.+)$/gm, '<h3>$1<\/h3>')
               .replace(/^##\s+(.+)$/gm, '<h2>$1<\/h2>')
               .replace(/^#\s+(.+)$/gm, '<h1>$1<\/h1>');

    // Bold and italics (basic)
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1<\/strong>');
    text = text.replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<em>$2<\/em>');
    text = text.replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1<em>$2<\/em>');

    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code>$1<\/code>');

    // Lists: build <ul> and <ol>
    const lines = text.split('\n');
    const out = [];
    let inUL = false, inOL = false;
    const flush = () => {
        if (inUL) { out.push('</ul>'); inUL = false; }
        if (inOL) { out.push('</ol>'); inOL = false; }
    };
    for (let line of lines) {
        const ulMatch = /^\s*[-*]\s+(.+)$/.exec(line);
        const olMatch = /^\s*\d+\.\s+(.+)$/.exec(line);
        if (ulMatch) {
            if (inOL) { out.push('</ol>'); inOL = false; }
            if (!inUL) { out.push('<ul>'); inUL = true; }
            out.push(`<li>${ulMatch[1]}</li>`);
            continue;
        }
        if (olMatch) {
            if (inUL) { out.push('</ul>'); inUL = false; }
            if (!inOL) { out.push('<ol>'); inOL = true; }
            out.push(`<li>${olMatch[1]}</li>`);
            continue;
        }
        // Not a list line
        if (line.trim() === '') {
            flush();
            out.push('');
        } else {
            flush();
            out.push(`<p>${line}</p>`);
        }
    }
    flush();
    let html = out.join('\n');

    // Restore fenced code blocks
    html = html.replace(/\[\[CODE_BLOCK_(\d+)\]\]/g, (_, idx) => {
        const code = String(codeBlocks[Number(idx)] || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<pre><code>${code}<\/code><\/pre>`;
    });
    return html;
}

// Initialize extension
document.addEventListener('DOMContentLoaded', async () => {
    // Check for API key first
    GEMINI_API_KEY = await checkApiKey();
    if (!GEMINI_API_KEY) return; // Setup screen is showing

    try {
        const result = await storage.get(['proficiency']);
        if (result.proficiency) {
            document.getElementById('proficiency').value = result.proficiency;
        } else {
            await storage.set({ proficiency: 'beginner' });
        }
    } catch (e) {
        console.warn('Storage get/set error for proficiency', e);
    }

    // Proficiency level change listener
    document.getElementById('proficiency').addEventListener('change', async (e) => {
        try { await storage.set({ proficiency: e.target.value }); } catch {}
    });

    // Button click listeners
    document.getElementById('coursePlan').addEventListener('click', generateCoursePlan);
    document.getElementById('buzzwords').addEventListener('click', showBuzzwords);
    document.getElementById('quiz').addEventListener('click', startQuiz);
});

// Helper function to call Gemini API
async function callGeminiAPI(prompt) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';
    const maxAttempts = 3;
    const baseDelayMs = 800;
    try {
        if (!GEMINI_API_KEY) {
            throw new Error('API key not found. Please set up your API key first.');
        }

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-goog-api-key': GEMINI_API_KEY
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }]
                    })
                });

                const status = response.status;
                let data;
                try { data = await response.json(); } catch { data = null; }

                if (!response.ok) {
                    // Retry on transient errors
                    if (status === 503 || status === 504) {
                        if (attempt < maxAttempts) {
                            await new Promise(r => setTimeout(r, baseDelayMs * attempt));
                            continue;
                        }
                        const msg = (data && data.error?.message) || 'Service unavailable. Please try again later.';
                        throw new Error(`Service Unavailable (HTTP ${status}): ${msg}`);
                    }
                    throw new Error((data && data.error?.message) || `API request failed (HTTP ${status})`);
                }

                if (!data || !data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
                    throw new Error('Invalid response format from API');
                }
                return data.candidates[0].content.parts[0].text;
            } catch (err) {
                if (attempt === maxAttempts) throw err;
                // If network-related error, backoff and retry
                if (String(err?.message || '').includes('Failed to fetch')) {
                    await new Promise(r => setTimeout(r, baseDelayMs * attempt));
                    continue;
                }
                // For other errors, do not retry unless 503/504 handled above
                throw err;
            }
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        
        let errorMessage;
        const msg = String(error.message || '');
        if (msg.includes('invalid authentication credentials')) {
            errorMessage = 'Authentication Error: Your API key might be invalid or expired. Please ensure you:\n' +
                         '1. Have copied the complete API key\n' +
                         '2. Have enabled the Gemini API in your Google Cloud Console\n' +
                         '3. Are using a valid API key from Google AI Studio';
        } else if (msg.includes('Service Unavailable') || msg.includes('HTTP 503') || msg.includes('HTTP 504')) {
            errorMessage = 'The model is currently unreachable (service unavailable or timeout). Please try again in a minute.';
        } else if (msg.includes('API key')) {
            errorMessage = 'Invalid or missing API key. Please check your API key in the extension settings.';
        } else if (msg.includes('Invalid response format')) {
            errorMessage = 'Unexpected response from API. Please try again.';
        } else if (!navigator.onLine) {
            errorMessage = 'No internet connection. Please check your network and try again.';
        } else {
            errorMessage = `Error: ${msg || 'Something went wrong. Please try again.'}`;
        }

        const contentArea = document.getElementById('content');
        if (contentArea) {
            contentArea.innerHTML = `
                <div class="card error-card">
                    <h3>⚠️ Error</h3>
                    <p>${errorMessage}</p>
                    <div class="error-actions">
                        <button onclick="location.reload()" class="option-btn">Try Again</button>
                        ${msg.includes('API key') ? '<button onclick="resetApiKey()" class="option-btn">Reset API Key</button>' : ''}
                    </div>
                </div>
            `;
        }
        return null;
    }
}

// Course Plan Generation
async function generateCoursePlan() {
    const contentArea = document.getElementById('content');
    renderLoading('Generating course plan...');

    const proficiency = document.getElementById('proficiency').value;
    const prompt = `Generate a detailed step-by-step learning roadmap for ${proficiency} level in Generative AI.
Include what to study, practice exercises, and an estimated timeline.
MANDATORY: Cover the following areas with practical examples and projects at the chosen level:
- AI Agents (agent architectures, tools, planning/execution loops)
- Retrieval-Augmented Generation (RAG) (indexing, chunking, retrieval, reranking, grounding)
- Large Language Models (LLMs) (prompting, fine-tuning, evaluation, safety)`;

    const response = await callGeminiAPI(prompt);
    const html = renderMarkdown(response);
    contentArea.innerHTML = `
        <div class="card">
            <div class="course-content">${html}</div>
            <button id="convertToTodo" class="option-btn">Convert to TODO List</button>
        </div>
    `;
    // Attach handler for Convert to TODO List
    const convertBtn = document.getElementById('convertToTodo');
    if (convertBtn) convertBtn.addEventListener('click', () => convertCoursePlanToTodo(response, proficiency));
}

// Convert Course Plan to TODO List using Gemini API
async function convertCoursePlanToTodo(coursePlanText, proficiency) {
    renderLoading('Converting Course Plan to TODO List...');
    const prompt = `Convert the following Generative AI course plan into a concise TODO list for a learner. Each TODO should be a clear actionable step. Return the TODO list as a JSON array of objects, each with 'task' (string) and 'completed' (boolean, default false).\n\nCourse Plan:\n${coursePlanText}`;
    const response = await callGeminiAPI(prompt);
    let todoList;
    try {
        todoList = JSON.parse(response);
        if (!Array.isArray(todoList)) throw new Error('Not an array');
    } catch (e) {
        // Fallback: try to extract JSON from markdown/code block
        const match = response.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
        if (match && match[1]) {
            try { todoList = JSON.parse(match[1]); } catch {}
        }
        if (!todoList || !Array.isArray(todoList)) {
            renderLoading('Failed to parse TODO list. Try again.');
            return;
        }
    }
    // Store TODO list in Chrome storage, replacing any existing list
    await storage.set({ activeTodoList: { proficiency, list: todoList } });
    showTodoList();
}

// Show TODO List UI
async function showTodoList() {
    renderLoading('Loading TODO List...');
    const contentArea = document.getElementById('content');
    const result = await storage.get(['activeTodoList']);
    const todoObj = result.activeTodoList;
    if (!todoObj || !Array.isArray(todoObj.list) || todoObj.list.length === 0) {
        contentArea.innerHTML = '<div class="card">No TODO list found. Generate a Course Plan and convert it to a TODO list.</div>';
        return;
    }
    contentArea.innerHTML = `
        <div class="card">
            <h2>TODO List (${todoObj.proficiency})</h2>
            <ul class="todo-list">
                ${todoObj.list.map((item, idx) => `
                    <li>
                        <label>
                            <input type="checkbox" data-idx="${idx}" ${item.completed ? 'checked' : ''}>
                            <span class="${item.completed ? 'completed' : ''}">${item.task}</span>
                        </label>
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
    // Add checkbox listeners
    document.querySelectorAll('.todo-list input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', async (e) => {
            const idx = Number(e.target.dataset.idx);
            todoObj.list[idx].completed = e.target.checked;
            await storage.set({ activeTodoList: todoObj });
            showTodoList();
        });
    });
}

// Wire up TODO List button on Home page
if (document.getElementById('todoList')) {
    document.getElementById('todoList').addEventListener('click', showTodoList);
}
// Buzzwords Feature
let currentBuzzwordIndex = 0;
let buzzwords = [];

async function showBuzzwords() {
    const contentArea = document.getElementById('content');
    renderLoading('Loading buzzwords...');

    const randomnessToken = Math.random().toString(36).slice(2);
    const prompt = `Generate 10 AI buzzwords with simple definitions in JSON format. Ensure the 10 buzzwords are balanced across these areas: AI Agents (e.g., Agentic Workflow, Tool Use, ReAct, AutoGPT), RAG (e.g., Vector Store, Embeddings, Reranker, Grounding), and LLM (e.g., Prompt Engineering, Fine-tuning, Context Window). Use keys buzzword and definition. Randomness token: ${randomnessToken}`;
    const response = await callGeminiAPI(prompt);
    let parsedBuzzwords;
    try {
        parsedBuzzwords = JSON.parse(response);
    } catch (error) {
        // Robust fallback: group lines that look like key-labeled pairs
        const lines = response.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const items = [];
        let current = { buzzword: '', definition: '' };

        // Match formats like:
        // buzzword: Generative AI
        // "buzzword": "Generative AI",
        // definition - text
        const keyPairRegex = /^(?:"\s*)?(buzzword|term|definition|meaning)(?:\s*")?\s*[:\-]\s*(?:"\s*)?(.+?)(?:\s*")?[,]?$/i;

        for (const raw of lines) {
            // Remove trailing commas for safety
            const line = raw.replace(/,+\s*$/, '').trim();
            const m = line.match(keyPairRegex);
            if (m) {
                const key = m[1].toLowerCase();
                let val = m[2].trim();
                // Strip surrounding quotes if any
                val = val.replace(/^"|"$/g, '');
                if (key === 'buzzword' || key === 'term') {
                    // If we already had a pair, push it before starting a new buzzword
                    if (current.buzzword && current.definition) {
                        items.push({ ...current });
                        current = { buzzword: '', definition: '' };
                    }
                    current.buzzword = val;
                } else if (key === 'definition' || key === 'meaning') {
                    current.definition = val;
                    // If we have both, push and reset
                    if (current.buzzword) {
                        items.push({ ...current });
                        current = { buzzword: '', definition: '' };
                    }
                }
                continue;
            }

            // Fallback: single-line "term: definition" (without explicit key names)
            const parts = line.split(':');
            if (parts.length >= 2) {
                let bw = parts.shift()?.trim() || '';
                let def = parts.join(':').trim();
                // Strip quotes
                bw = bw.replace(/^"|"$/g, '');
                def = def.replace(/^"|"$/g, '');

                // Ignore if the left side is literally buzzword/definition labels (handled above)
                if (bw && def && !/^buzzword$|^definition$|^term$|^meaning$/i.test(bw)) {
                    // If an in-progress pair exists, push it first
                    if (current.buzzword && current.definition) {
                        items.push({ ...current });
                        current = { buzzword: '', definition: '' };
                    }
                    items.push({ buzzword: bw, definition: def });
                    continue;
                }
            }
        }

        // Edge: if a complete pair is left over
        if (current.buzzword && current.definition) {
            items.push({ ...current });
        }

        // Only keep complete pairs
        parsedBuzzwords = items.filter(it => it.buzzword && it.definition);
    }
    if (!parsedBuzzwords || parsedBuzzwords.length === 0) {
        contentArea.innerHTML = '<div class="card">Error loading buzzwords</div>';
        return;
    }

    // Normalize buzzword objects to always have buzzword and definition keys and limit to 10
    const normalized = parsedBuzzwords.map(item => {
        if (item.term && item.definition) {
            return { buzzword: item.term, definition: item.definition };
        }
        return item;
    });
    // Shuffle for randomness, then take first 10
    buzzwords = shuffleArray(normalized).slice(0, 10);
    currentBuzzwordIndex = 0;
    showCurrentBuzzword();
}

function showCurrentBuzzword() {
    const contentArea = document.getElementById('content');
    const bw = buzzwords[currentBuzzwordIndex];

    // Simple HTML escape to prevent HTML injection
    const esc = (str) => String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    contentArea.innerHTML = `
        <div class="card buzzword-card">
            <div><strong>${esc(bw.buzzword)}</strong></div>
            <div>"${esc(bw.definition)}"</div>
            <div class="nav-buttons">
                <button id="prevBuzzword" class="nav-btn" ${currentBuzzwordIndex === 0 ? 'disabled' : ''}>Previous</button>
                <span>${currentBuzzwordIndex + 1}/${buzzwords.length}</span>
                <button id="nextBuzzword" class="nav-btn" ${currentBuzzwordIndex === buzzwords.length - 1 ? 'disabled' : ''}>Next</button>
            </div>
        </div>
    `;

    const prev = document.getElementById('prevBuzzword');
    const next = document.getElementById('nextBuzzword');
    if (prev) prev.addEventListener('click', previousBuzzword);
    if (next) next.addEventListener('click', nextBuzzword);
}

function previousBuzzword() {
    if (currentBuzzwordIndex > 0) {
        currentBuzzwordIndex--;
        showCurrentBuzzword();
    }
}

function nextBuzzword() {
    if (currentBuzzwordIndex < buzzwords.length - 1) {
        currentBuzzwordIndex++;
        showCurrentBuzzword();
    }
}

// Quiz Feature
let quizQuestions = [];
let currentQuestionIndex = 0;
let timeLeft = 600; // 10 minutes in seconds
let timerInterval;

async function startQuiz() {
    const contentArea = document.getElementById('content');
    renderLoading('Loading quiz...');

    const proficiency = document.getElementById('proficiency').value;
    const randomnessToken = Math.random().toString(36).slice(2);
    const prompt = `Generate 10 multiple-choice questions about Generative AI for ${proficiency} level.
Include questions spanning AI Agents, RAG, and LLM topics (at least 3 from each across the set).
Return a JSON array where each item has:
- question: string
- options: exactly four options labeled A, B, C, and D (letters only)
- correct: a single letter among A, B, C, D (only one correct option)
Randomness token: ${randomnessToken}`;

    const response = await callGeminiAPI(prompt);

    // Exit if the API call failed and has already displayed an error message
    if (!response) {
        return;
    }

    let parsedQuestions;
    try {
        // More robust parsing: find the start and end of the JSON array/object
        // Strip Markdown code fences if present
        let cleaned = response;
        const fence = cleaned.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
        if (fence && fence[1]) cleaned = fence[1];
        const startIndex = cleaned.indexOf('[');
        const endIndex = cleaned.lastIndexOf(']');

        if (startIndex === -1 || endIndex === -1) {
            throw new Error('Could not find JSON array in the response.');
        }

        const jsonString = cleaned.substring(startIndex, endIndex + 1);
        const questions = JSON.parse(jsonString);

        // Normalize structure and enforce A-D with single correct
        parsedQuestions = questions.map(q => normalizeQuestion(q));
    } catch (error) {
        // Robust fallback: handle various line endings and flexible 'Correct Answer' formats
        parsedQuestions = response.split(/\n\n|\r\n\r\n/).map(block => {
            const lines = block.split(/\n|\r\n/).map(l => l.trim()).filter(Boolean);
            if (lines.length >= 3) {
                const questionLine = lines[0];
                const options = {};
                let correct = '';
                lines.slice(1).forEach(line => {
                    const optMatch = line.match(/^([A-D])\.\s*(.*)$/);
                    if (optMatch) {
                        options[optMatch[1]] = optMatch[2];
                    } else if (line.toLowerCase().includes('correct answer')) {
                        // Accept both 'Correct Answer: A' and 'Correct answer is A' formats
                        const ansMatch = line.match(/correct answer[:\s]*([A-D])/i);
                        if (ansMatch) correct = ansMatch[1];
                    }
                });
                if (Object.keys(options).length >= 2 && correct) {
                    return normalizeQuestion({ question: questionLine, options, correct });
                }
            }
            return null;
        }).filter(Boolean);
    }
    // Final validation: keep only well-formed questions with A-D and one correct
    parsedQuestions = (parsedQuestions || []).filter(q => q && q.question && q.options && ['A','B','C','D'].every(k => typeof q.options[k] === 'string' && q.options[k].trim()) && /^[A-D]$/.test(q.correct));

    // Shuffle questions for randomness
    parsedQuestions = shuffleArray(parsedQuestions);

    // Shuffle options within each question while preserving A-D keys and correct mapping
    parsedQuestions = parsedQuestions.map(q => {
        const labels = ['A','B','C','D'];
        const originalOptions = q.options;
        const originalCorrectText = originalOptions[q.correct];
        const values = labels.map(k => originalOptions[k]);
        const shuffledValues = shuffleArray(values);
        const newOptions = {};
        labels.forEach((L, i) => { newOptions[L] = shuffledValues[i]; });
        const newCorrectIndex = shuffledValues.findIndex(v => v === originalCorrectText);
        const newCorrect = labels[newCorrectIndex] || 'A';
        return { ...q, options: newOptions, correct: newCorrect };
    });
    if (!parsedQuestions || parsedQuestions.length === 0) {
        contentArea.innerHTML = `
            <div class="card">
                <p>Error loading quiz. The API response could not be parsed.</p>
                <strong>Raw API Response:</strong>
                <pre style="white-space: pre-wrap; word-wrap: break-word; max-height: 200px; overflow-y: auto; background: #eee; padding: 10px; border-radius: 5px; color: #333;">${response ? response.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'No response received from API.'}</pre>
            </div>`;
        return;
    }
    console.log('Successfully parsed questions:', parsedQuestions);
    quizQuestions = parsedQuestions;
    currentQuestionIndex = 0;
    startTimer();
    showCurrentQuestion();
}

function startTimer() {
    timeLeft = 600;
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimer();
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            submitQuiz();
        }
    }, 1000);
}

function updateTimer() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const timerElement = document.querySelector('.quiz-timer');
    if (timerElement) {
        timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    const total = 600; // seconds
    const pct = Math.max(0, Math.min(100, (timeLeft / total) * 100));
    const fill = document.querySelector('.timer-fill');
    if (fill) {
        fill.style.width = pct + '%';
    }
}

function showCurrentQuestion() {
    console.log('Showing question', currentQuestionIndex, quizQuestions[currentQuestionIndex]);
    const question = quizQuestions[currentQuestionIndex];
    const contentArea = document.getElementById('content');

    // Defensive check to prevent rendering errors from malformed data
    if (!question || typeof question.options !== 'object' || question.options === null) {
        console.error('Invalid question data:', question);
        contentArea.innerHTML = `<div class="card">Error: Invalid question format.</div>`;
        return;
    }

    const totalQuestions = quizQuestions.length || 10;
    contentArea.innerHTML = `
        <div class="quiz-container">
            <div class="quiz-timer">10:00</div>
            <div class="timer-bar"><div class="timer-fill" style="width:100%"></div></div>
            <div class="card">
                <h3>Question ${currentQuestionIndex + 1}/${totalQuestions}</h3>
                <p>${question.question}</p>
                <div class="quiz-options">
                    ${Object.entries(question.options).map(([key, value]) => `
                        <div class="quiz-option" data-option="${key}">
                            ${key}. ${value}
                        </div>
                    `).join('')}
                </div>
                <div class="nav-buttons">
                    ${currentQuestionIndex > 0 ? '<button id="prevQuestionBtn" class="nav-btn">Previous</button>' : ''}
                    ${currentQuestionIndex < totalQuestions - 1 ? '<button id="nextQuestionBtn" class="nav-btn">Next</button>' : ''}
                    ${currentQuestionIndex === totalQuestions - 1 ? '<button id="submitQuizBtn" class="nav-btn">Submit</button>' : ''}
                </div>
            </div>
        </div>
    `;

    // Add click handlers for options
    const optionEls = document.querySelectorAll('.quiz-option');
    optionEls.forEach(option => {
        option.addEventListener('click', () => selectOption(option));
    });
    // Re-apply selected state if user had previously selected an answer
    const selected = quizQuestions[currentQuestionIndex].selectedAnswer;
    if (selected) {
        const selectedEl = Array.from(optionEls).find(el => el.dataset.option === selected);
        if (selectedEl) selectedEl.classList.add('selected');
    }

    // Wire up navigation buttons without inline handlers (CSP-safe)
    const prevBtn = document.getElementById('prevQuestionBtn');
    if (prevBtn) prevBtn.addEventListener('click', previousQuestion);
    const nextBtn = document.getElementById('nextQuestionBtn');
    if (nextBtn) nextBtn.addEventListener('click', nextQuestion);
    const submitBtn = document.getElementById('submitQuizBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitQuiz);

    // Ensure timer text and bar reflect current time on each render
    updateTimer();
}

function selectOption(optionElement) {
    document.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected'));
    optionElement.classList.add('selected');
    quizQuestions[currentQuestionIndex].selectedAnswer = optionElement.dataset.option;
}

function previousQuestion() {
    if (currentQuestionIndex > 0) {
        currentQuestionIndex--;
        showCurrentQuestion();
    }
}

function nextQuestion() {
    if (currentQuestionIndex < quizQuestions.length - 1) {
        currentQuestionIndex++;
        showCurrentQuestion();
    }
}

function submitQuiz() {
    clearInterval(timerInterval);
    
    const score = quizQuestions.filter(q => q.selectedAnswer === q.correct).length;
    const contentArea = document.getElementById('content');
    
    // Save score in storage (promise-based)
    (async () => {
        try {
            const result = await storage.get(['quizScores']);
            const scores = result.quizScores || [];
            scores.push({
                date: new Date().toISOString(),
                score: score,
                proficiency: document.getElementById('proficiency').value
            });
            await storage.set({ quizScores: scores });
        } catch (e) {
            console.warn('Failed to persist quiz score', e);
        }
    })();

    // Show results with animation
    contentArea.innerHTML = `
        <div class="card">
            <h2>Quiz Complete!</h2>
            <p class="score">Your Score: ${score}/10</p>
            <button id="viewProgressBtn" class="option-btn">View Progress</button>
        </div>
    `;

    // Attach handler for View Progress (CSP-safe)
    const viewBtn = contentArea.querySelector('#viewProgressBtn');
    if (viewBtn) viewBtn.addEventListener('click', showProgress);

    // Show confetti for high scores
    if (score >= 8) {
        showConfetti();
    }
}

function showConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti';
    document.body.appendChild(container);

    const colors = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#3742fa', '#e84393'];
    const pieces = 100;
    const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);

    for (let i = 0; i < pieces; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * vw + 'px';
        piece.style.top = (-Math.random() * 100) + 'px';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        piece.style.animationDelay = (Math.random() * 0.8) + 's';
        container.appendChild(piece);
    }

    setTimeout(() => container.remove(), 3200);
}

// Expose functions used by inline onclick in module context
// This ensures buttons like Previous/Next/Submit work when using type="module"
// without refactoring markup.
// eslint-disable-next-line no-undef
window.previousQuestion = previousQuestion;
// eslint-disable-next-line no-undef
window.nextQuestion = nextQuestion;
// eslint-disable-next-line no-undef
window.submitQuiz = submitQuiz;
// eslint-disable-next-line no-undef
window.showProgress = showProgress;
// eslint-disable-next-line no-undef
window.resetApiKey = resetApiKey;

function showProgress() {
    (async () => {
        const result = await storage.get(['quizScores']);
        const scores = result.quizScores || [];
        const contentArea = document.getElementById('content');
        
        contentArea.innerHTML = `
            <div class="card">
                <h3>Your Progress</h3>
                <canvas id="progressChart"></canvas>
                <div class="chart-legend">
                    <p>Total Quizzes: ${scores.length}</p>
                    <p>Average Score: ${(scores.reduce((acc, s) => acc + s.score, 0) / scores.length || 0).toFixed(1)}/10</p>
                </div>
            </div>
        `;
        
        const ctx = document.getElementById('progressChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: scores.map((_, i) => `Quiz ${i + 1}`),
                datasets: [{
                    label: 'Quiz Scores',
                    data: scores.map(s => s.score),
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    tension: 0.1,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        ticks: {
                            stepSize: 1
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    })();
}

async function resetApiKey() {
    try { await storage.remove('geminiApiKey'); } catch {}
    GEMINI_API_KEY = null;
    location.reload();
}