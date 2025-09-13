// Store for Gemini API key - Replace with your actual API key
const GEMINI_API_KEY = 'YOUR_API_KEY_HERE';

// Initialize proficiency level
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['proficiency'], (result) => {
        if (result.proficiency) {
            document.getElementById('proficiency').value = result.proficiency;
        } else {
            chrome.storage.local.set({ proficiency: 'beginner' });
        }
    });

    // Proficiency level change listener
    document.getElementById('proficiency').addEventListener('change', (e) => {
        chrome.storage.local.set({ proficiency: e.target.value });
    });

    // Button click listeners
    document.getElementById('coursePlan').addEventListener('click', generateCoursePlan);
    document.getElementById('buzzwords').addEventListener('click', showBuzzwords);
    document.getElementById('quiz').addEventListener('click', startQuiz);
});

// Helper function to call Gemini API
async function callGeminiAPI(prompt) {
    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GEMINI_API_KEY}`
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            })
        });

        if (!response.ok) {
            throw new Error('API request failed');
        }

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        return 'Error: Could not get response from AI';
    }
}

// Course Plan Generation
async function generateCoursePlan() {
    const contentArea = document.getElementById('content');
    contentArea.innerHTML = '<div class="card">Loading course plan...</div>';

    const proficiency = document.getElementById('proficiency').value;
    const prompt = `Generate a detailed step-by-step learning roadmap for ${proficiency} level in Generative AI. Include what to study, practice exercises, and estimated timeline.`;

    const response = await callGeminiAPI(prompt);
    contentArea.innerHTML = `<div class="card">${response.replace(/\n/g, '<br>')}</div>`;
}

// Buzzwords Feature
let currentBuzzwordIndex = 0;
let buzzwords = [];

async function showBuzzwords() {
    const contentArea = document.getElementById('content');
    contentArea.innerHTML = '<div class="card">Loading buzzwords...</div>';

    const prompt = 'Generate 10 AI buzzwords with their simple definitions in JSON format.';
    const response = await callGeminiAPI(prompt);
    
    try {
        buzzwords = JSON.parse(response);
        showCurrentBuzzword();
    } catch (error) {
        contentArea.innerHTML = '<div class="card">Error loading buzzwords</div>';
    }
}

function showCurrentBuzzword() {
    const contentArea = document.getElementById('content');
    const buzzword = buzzwords[currentBuzzwordIndex];

    contentArea.innerHTML = `
        <div class="card">
            <h3>${buzzword.term}</h3>
            <p>${buzzword.definition}</p>
            <div class="nav-buttons">
                <button onclick="previousBuzzword()" class="nav-btn" ${currentBuzzwordIndex === 0 ? 'disabled' : ''}>Previous</button>
                <span>${currentBuzzwordIndex + 1}/10</span>
                <button onclick="nextBuzzword()" class="nav-btn" ${currentBuzzwordIndex === 9 ? 'disabled' : ''}>Next</button>
            </div>
        </div>
    `;
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
    contentArea.innerHTML = '<div class="card">Loading quiz...</div>';

    const proficiency = document.getElementById('proficiency').value;
    const prompt = `Generate 10 multiple-choice questions about Generative AI for ${proficiency} level. Format as JSON array with questions, options (A-D), and correct answer.`;

    const response = await callGeminiAPI(prompt);
    try {
        quizQuestions = JSON.parse(response);
        currentQuestionIndex = 0;
        startTimer();
        showCurrentQuestion();
    } catch (error) {
        contentArea.innerHTML = '<div class="card">Error loading quiz</div>';
    }
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
}

function showCurrentQuestion() {
    const question = quizQuestions[currentQuestionIndex];
    const contentArea = document.getElementById('content');

    contentArea.innerHTML = `
        <div class="quiz-container">
            <div class="quiz-timer">10:00</div>
            <div class="card">
                <h3>Question ${currentQuestionIndex + 1}/10</h3>
                <p>${question.question}</p>
                <div class="quiz-options">
                    ${Object.entries(question.options).map(([key, value]) => `
                        <div class="quiz-option" data-option="${key}">
                            ${key}. ${value}
                        </div>
                    `).join('')}
                </div>
                <div class="nav-buttons">
                    ${currentQuestionIndex > 0 ? '<button onclick="previousQuestion()" class="nav-btn">Previous</button>' : ''}
                    ${currentQuestionIndex < 9 ? '<button onclick="nextQuestion()" class="nav-btn">Next</button>' : ''}
                    ${currentQuestionIndex === 9 ? '<button onclick="submitQuiz()" class="nav-btn">Submit</button>' : ''}
                </div>
            </div>
        </div>
    `;

    // Add click handlers for options
    document.querySelectorAll('.quiz-option').forEach(option => {
        option.addEventListener('click', () => selectOption(option));
    });
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
    
    // Save score in storage
    chrome.storage.local.get(['quizScores'], (result) => {
        const scores = result.quizScores || [];
        scores.push({
            date: new Date().toISOString(),
            score: score,
            proficiency: document.getElementById('proficiency').value
        });
        chrome.storage.local.set({ quizScores: scores });
    });

    // Show results with animation
    contentArea.innerHTML = `
        <div class="card">
            <h2>Quiz Complete!</h2>
            <p class="score">Your Score: ${score}/10</p>
            <button onclick="showProgress()" class="option-btn">View Progress</button>
        </div>
    `;

    // Show confetti for high scores
    if (score >= 8) {
        showConfetti();
    }
}

function showConfetti() {
    // Add confetti animation
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    document.body.appendChild(confetti);
    setTimeout(() => confetti.remove(), 3000);
}

function showProgress() {
    chrome.storage.local.get(['quizScores'], (result) => {
        const scores = result.quizScores || [];
        const contentArea = document.getElementById('content');
        
        // Create progress chart (you'll need to add Chart.js library)
        contentArea.innerHTML = `
            <div class="card">
                <h3>Your Progress</h3>
                <canvas id="progressChart"></canvas>
            </div>
        `;
        
        // Add chart visualization here
    });
}