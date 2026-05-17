// ===================== CONFIGURATION =====================
const VARIANT_SIZE = 40;

const SUBJECT_CONFIG = {
    psycho: {
        title: 'Психология',
        file: 'psycho-questions.json',
        totalQuestions: 160,
        accent: '#ff6b9d'
    },
    spk: {
        title: 'СПК',
        file: 'spk-questions.json',
        totalQuestions: 480,
        accent: '#4facfe'
    }
};

// ===================== STATE =====================
let questions = [];
let currentQuestion = 0;
let userAnswers = [];
let currentTest = '';
let currentVariant = 0;
let totalVariants = 0;
let allRawQuestions = [];
// Cache for search page so we don't re-fetch every time
let searchQuestionsCache = null;

// ===================== UTILITY FUNCTIONS =====================
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function shuffleQuestions(rawQuestions) {
    return rawQuestions.map(q => {
        const indexedOptions = q.options.map((opt, idx) => ({
            text: opt,
            isCorrect: idx === q.correct_index
        }));
        const shuffled = shuffleArray(indexedOptions);
        const newCorrectIndex = shuffled.findIndex(opt => opt.isCorrect);
        return {
            id: q.id,
            question: q.question,
            options: shuffled.map(opt => opt.text),
            correct_index: newCorrectIndex
        };
    });
}

// ===================== LOADING / ERROR UI =====================
function showLoading(message = 'Загрузка...') {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        overlay.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-text">${message}</div>
        `;
        document.body.appendChild(overlay);
    } else {
        overlay.querySelector('.loading-text').textContent = message;
    }
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

function showError(container, message) {
    container.innerHTML = `
        <div class="error-message">
            <span class="error-icon">⚠️</span>
            <span>${message}</span>
        </div>
    `;
}

// ===================== DATA LOADING =====================
/**
 * Unified question loader. Returns parsed JSON or throws with a user-friendly message.
 */
async function fetchQuestions(filename) {
    const response = await fetch(filename);
    if (!response.ok) {
        throw new Error(`Файл «${filename}» не найден (${response.status})`);
    }
    return response.json();
}

// ===================== LOCAL STORAGE =====================
const STORAGE_KEY = 'testAppState';

function saveState() {
    const state = {
        page: getCurrentPage(),
        test: currentTest,
        variant: currentVariant,
        totalVariants,
        currentQuestion,
        userAnswers,
        questions,
        allRawQuestions,
        searchQuery: document.getElementById('searchInput')?.value || '',
        scrollY: window.scrollY
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
        // Quota exceeded or private mode — silently ignore
        console.warn('Не удалось сохранить состояние:', e);
    }
}

function getCurrentPage() {
    const pages = ['testPage', 'variantPage', 'resultsPage', 'searchPage'];
    for (const id of pages) {
        if (document.getElementById(id).style.display === 'block') {
            return id.replace('Page', '');
        }
    }
    return 'start';
}

async function restoreState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return false;

        const state = JSON.parse(saved);

        if (state.page === 'variant' && state.test && state.allRawQuestions?.length > 0) {
            currentTest = state.test;
            allRawQuestions = state.allRawQuestions;
            totalVariants = state.totalVariants || 0;
            showVariantSelection(currentTest, false);
            if (state.scrollY) window.scrollTo(0, state.scrollY);
            return true;

        } else if (state.page === 'test' && state.test && state.questions?.length > 0) {
            currentTest = state.test;
            currentVariant = state.variant ?? 0;
            totalVariants = state.totalVariants || 0;
            currentQuestion = state.currentQuestion || 0;
            userAnswers = state.userAnswers || [];
            questions = state.questions;
            allRawQuestions = state.allRawQuestions || [];

            hideAllPages();
            document.getElementById('testPage').style.display = 'block';
            updateTestTitle();
            showQuestion();
            if (state.scrollY) window.scrollTo(0, state.scrollY);
            return true;

        } else if (state.page === 'search') {
            // Restore search page without re-saving state in the middle of restoration
            hideAllPages();
            document.getElementById('searchPage').style.display = 'block';
            await loadSearchQuestions(); // populate cache
            if (state.searchQuery) {
                document.getElementById('searchInput').value = state.searchQuery;
                doSearch();
            }
            updateSearchStats();
            if (state.scrollY) window.scrollTo(0, state.scrollY);
            return true;

        } else if (state.page === 'results' && state.test && state.questions?.length > 0) {
            currentTest = state.test;
            currentVariant = state.variant ?? 0;
            totalVariants = state.totalVariants || 0;
            userAnswers = state.userAnswers || [];
            questions = state.questions;
            allRawQuestions = state.allRawQuestions || [];

            hideAllPages();
            document.getElementById('resultsPage').style.display = 'block';
            showResults();
            if (state.scrollY) window.scrollTo(0, state.scrollY);
            return true;
        }

        return false;
    } catch (e) {
        console.error('Ошибка восстановления состояния:', e);
        return false;
    }
}

function hideAllPages() {
    ['startPage', 'variantPage', 'testPage', 'resultsPage', 'searchPage'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
}

// Save on navigation events, not just beforeunload
window.addEventListener('beforeunload', saveState);

document.addEventListener('DOMContentLoaded', async () => {
    const restored = await restoreState();
    if (!restored) {
        localStorage.removeItem(STORAGE_KEY);
    }
});

// ===================== VARIANT SELECTION =====================
async function selectSubject(type) {
    currentTest = type;
    const config = SUBJECT_CONFIG[type];

    showLoading(`Загружаем вопросы по «${config.title}»…`);
    try {
        allRawQuestions = await fetchQuestions(config.file);
        totalVariants = Math.ceil(allRawQuestions.length / VARIANT_SIZE);
        hideLoading();
        showVariantSelection(type, true);
    } catch (error) {
        hideLoading();
        const variantPage = document.getElementById('variantPage');
        hideAllPages();
        variantPage.style.display = 'block';
        document.getElementById('variantTitle').textContent = config.title;
        document.getElementById('variantSubtitle').textContent = '';
        showError(document.getElementById('variantGrid'), error.message + ' — убедитесь, что файл находится рядом с index.html');
    }
}

function getVariantStatusInfo(result) {
    if (!result) return { classes: [], html: '' };

    let cls, html;
    if (result.percentage === 100) {
        cls = 'perfect';
        html = '<span class="variant-status check">✓</span>';
    } else if (result.percentage >= 90) {
        cls = 'great';
        html = `<span class="variant-status percent great">${result.percentage}%</span>`;
    } else if (result.percentage >= 70) {
        cls = 'good';
        html = `<span class="variant-status percent good">${result.percentage}%</span>`;
    } else {
        cls = 'low';
        html = `<span class="variant-status percent">${result.percentage}%</span>`;
    }
    return { classes: ['completed', cls], html };
}

function buildVariantButton(options) {
    const { className, result, icon, label, sublabel, onClick } = options;
    const { classes, html: statusHtml } = getVariantStatusInfo(result);

    const btn = document.createElement('button');
    btn.className = ['variant-btn', className, ...classes].filter(Boolean).join(' ');
    btn.innerHTML = `
        ${statusHtml}
        <span class="variant-number">${icon}</span>
        <span>${label}</span>
        <span class="variant-range">${sublabel}</span>
    `;
    btn.onclick = onClick;
    return btn;
}

function showVariantSelection(type, animate) {
    const config = SUBJECT_CONFIG[type];
    hideAllPages();

    const variantPage = document.getElementById('variantPage');
    variantPage.style.display = 'block';
    if (animate) {
        variantPage.style.animation = 'none';
        variantPage.offsetHeight; // trigger reflow
        variantPage.style.animation = 'slideUp 0.5s ease';
    }

    document.getElementById('variantTitle').textContent = config.title;
    document.getElementById('variantSubtitle').textContent =
        `Всего ${allRawQuestions.length} вопросов, разделено на ${totalVariants} вариантов по ${VARIANT_SIZE} вопросов`;

    const grid = document.getElementById('variantGrid');
    grid.innerHTML = '';

    const savedResults = getSavedResults(type);

    // Special buttons wrapper
    const specialWrapper = document.createElement('div');
    specialWrapper.className = 'variant-special-wrapper';
    grid.appendChild(specialWrapper);

    specialWrapper.appendChild(buildVariantButton({
        className: 'variant-all',
        result: savedResults['all'],
        icon: '🎯',
        label: 'Все вопросы',
        sublabel: `${allRawQuestions.length} вопросов`,
        onClick: startAllQuestionsVariant
    }));

    specialWrapper.appendChild(buildVariantButton({
        className: 'variant-random',
        result: null,
        icon: '🎲',
        label: 'Случайные 40',
        sublabel: '40 случайных вопросов',
        onClick: startRandomVariant
    }));

    for (let i = 0; i < totalVariants; i++) {
        const startIdx = i * VARIANT_SIZE;
        const endIdx = Math.min(startIdx + VARIANT_SIZE, allRawQuestions.length);

        grid.appendChild(buildVariantButton({
            className: '',
            result: savedResults[i],
            icon: String(i + 1),
            label: 'Вариант',
            sublabel: `Вопросы ${startIdx + 1}—${endIdx}`,
            onClick: () => startVariant(i)
        }));
    }

    saveState();
}

function getSavedResults(subject) {
    try {
        const data = localStorage.getItem('testResults_' + subject);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        return {};
    }
}

function saveResult(subject, variantIndex, correct, total) {
    const key = 'testResults_' + subject;
    const results = getSavedResults(subject);
    results[variantIndex] = {
        correct,
        total,
        percentage: Math.round((correct / total) * 100),
        date: new Date().toISOString()
    };
    try {
        localStorage.setItem(key, JSON.stringify(results));
    } catch (e) {
        console.warn('Не удалось сохранить результат:', e);
    }
}

function startAllQuestionsVariant() {
    currentVariant = 'all';
    questions = shuffleQuestions([...allRawQuestions]);
    userAnswers = new Array(questions.length).fill(null);
    currentQuestion = 0;
    launchTest();
}

function startRandomVariant() {
    currentVariant = 'random';
    const random40 = shuffleArray([...allRawQuestions]).slice(0, Math.min(40, allRawQuestions.length));
    questions = shuffleQuestions(random40);
    userAnswers = new Array(questions.length).fill(null);
    currentQuestion = 0;
    launchTest();
}

function startVariant(variantIndex) {
    currentVariant = variantIndex;
    const startIdx = variantIndex * VARIANT_SIZE;
    const variantQuestions = allRawQuestions.slice(startIdx, startIdx + VARIANT_SIZE);
    questions = shuffleQuestions(variantQuestions);
    userAnswers = new Array(questions.length).fill(null);
    currentQuestion = 0;
    launchTest();
}

function launchTest() {
    hideAllPages();
    document.getElementById('testPage').style.display = 'block';
    updateTestTitle();
    showQuestion();
    saveState();
}

function updateTestTitle() {
    const base = SUBJECT_CONFIG[currentTest]?.title || '';
    let suffix = '';
    if (currentVariant === 'all') suffix = '— Все вопросы';
    else if (currentVariant === 'random') suffix = '— Случайные 40';
    else suffix = `— Вариант ${currentVariant + 1}`;
    document.getElementById('testTitle').textContent = `${base} ${suffix}`;
}

function goHomeFromVariants() {
    currentTest = '';
    currentVariant = 0;
    totalVariants = 0;
    allRawQuestions = [];
    localStorage.removeItem(STORAGE_KEY);
    hideAllPages();
    document.getElementById('startPage').style.display = 'flex';
}

function backToVariants() {
    if (currentTest && allRawQuestions.length > 0) {
        showVariantSelection(currentTest, true);
    } else {
        goHomeFromVariants();
    }
}

// ===================== TEST LOGIC =====================
function showQuestion() {
    const q = questions[currentQuestion];
    document.getElementById('progress').textContent = `${currentQuestion + 1} / ${questions.length}`;
    document.getElementById('questionText').textContent = q.question;

    const backBtn = document.getElementById('backBtn');
    if (backBtn) backBtn.style.visibility = currentQuestion === 0 ? 'hidden' : 'visible';

    const optionsDiv = document.getElementById('options');
    optionsDiv.innerHTML = '';

    const answered = userAnswers[currentQuestion] !== null;

    q.options.forEach((opt, idx) => {
        const div = document.createElement('div');
        div.className = 'option';
        div.textContent = opt;

        if (answered) {
            div.style.pointerEvents = 'none';
            if (idx === userAnswers[currentQuestion]) div.classList.add('selected');
            if (idx === q.correct_index) div.classList.add('correct');
            else if (idx === userAnswers[currentQuestion]) div.classList.add('wrong');
        } else {
            div.onclick = () => selectOption(idx);
        }

        optionsDiv.appendChild(div);
    });

    const nextBtn = document.getElementById('nextBtn');
    nextBtn.disabled = !answered;
    const isLast = currentQuestion === questions.length - 1;
    nextBtn.textContent = isLast ? 'Завершить' : 'Следующий →';
    nextBtn.className = `nav-btn ${isLast ? 'btn-finish' : 'btn-next'}`;
}

function selectOption(index) {
    if (userAnswers[currentQuestion] !== null) return;

    userAnswers[currentQuestion] = index;

    const options = document.querySelectorAll('.option');
    const q = questions[currentQuestion];

    options.forEach((opt, idx) => {
        opt.style.pointerEvents = 'none';
        if (idx === index) opt.classList.add('selected');
        if (idx === q.correct_index) opt.classList.add('correct');
        else if (idx === index) opt.classList.add('wrong');
    });

    document.getElementById('nextBtn').disabled = false;
    saveState();
}

function nextQuestion() {
    if (currentQuestion < questions.length - 1) {
        currentQuestion++;
        showQuestion();
        saveState();
    } else {
        showResults();
    }
}

function goBack() {
    if (currentQuestion > 0) {
        currentQuestion--;
        showQuestion();
        saveState();
    }
}

function goHome() {
    questions = [];
    userAnswers = [];
    currentQuestion = 0;
    currentVariant = 0;
    currentTest = '';
    allRawQuestions = [];
    localStorage.removeItem(STORAGE_KEY);
    hideAllPages();
    document.getElementById('startPage').style.display = 'flex';
}

// ===================== RESULTS =====================
function showResults() {
    let correct = 0;
    userAnswers.forEach((ans, idx) => {
        if (ans === questions[idx].correct_index) correct++;
    });

    saveResult(currentTest, currentVariant, correct, questions.length);

    hideAllPages();
    document.getElementById('resultsPage').style.display = 'block';

    const config = SUBJECT_CONFIG[currentTest];
    let variantLabel;
    if (currentVariant === 'all') {
        variantLabel = `${config.title} — Все вопросы (${allRawQuestions.length} вопросов)`;
    } else if (currentVariant === 'random') {
        variantLabel = `${config.title} — Случайные 40 вопросов`;
    } else {
        const startIdx = currentVariant * VARIANT_SIZE;
        const endIdx = Math.min(startIdx + VARIANT_SIZE, allRawQuestions.length);
        variantLabel = `${config.title} — Вариант ${currentVariant + 1} (вопросы ${startIdx + 1}—${endIdx})`;
    }

    document.getElementById('variantInfo').textContent = variantLabel;
    document.getElementById('score').textContent = `${correct}/${questions.length}`;

    const nextVariantBtn = document.querySelector('.btn-next-variant');
    if (nextVariantBtn) {
        const isSpecial = currentVariant === 'all' || currentVariant === 'random';
        nextVariantBtn.style.display = (!isSpecial && currentVariant + 1 < totalVariants) ? 'inline-block' : 'none';
    }

    const percentage = Math.round((correct / questions.length) * 100);
    let emoji, text;
    if (percentage >= 90) { emoji = '🎉'; text = 'Отличный результат!'; }
    else if (percentage >= 70) { emoji = '👍'; text = 'Хороший результат!'; }
    else if (percentage >= 50) { emoji = '📝'; text = 'Удовлетворительно. Можно лучше.'; }
    else { emoji = '📖'; text = 'Стоит повторить материал.'; }

    document.getElementById('scoreText').textContent = `${percentage}% — ${text} ${emoji}`;
    saveState();
}

function nextVariant() {
    if (currentVariant === 'all' || currentVariant === 'random') return;
    const next = currentVariant + 1;
    if (next >= totalVariants) return;
    questions = [];
    userAnswers = [];
    currentQuestion = 0;
    startVariant(next);
}

function restart() {
    hideAllPages();
    document.getElementById('startPage').style.display = 'flex';
    questions = [];
    userAnswers = [];
    currentQuestion = 0;
    currentVariant = 0;
    currentTest = '';
    allRawQuestions = [];
    localStorage.removeItem(STORAGE_KEY);
}

// ===================== SEARCH =====================
async function loadSearchQuestions() {
    if (searchQuestionsCache) return searchQuestionsCache;

    const results = [];
    for (const [key, config] of Object.entries(SUBJECT_CONFIG)) {
        try {
            const data = await fetchQuestions(config.file);
            // In search mode we show original (unshuffled) options so the correct answer is clear
            data.forEach(q => {
                results.push({
                    id: q.id,
                    question: q.question,
                    options: q.options,
                    correct_index: q.correct_index,
                    source: config.title
                });
            });
        } catch (e) {
            console.warn(`Не удалось загрузить ${config.file}:`, e.message);
        }
    }

    searchQuestionsCache = results;
    return results;
}

async function openSearch() {
    hideAllPages();
    const searchPage = document.getElementById('searchPage');
    searchPage.style.display = 'block';

    const statsDiv = document.getElementById('searchStats');
    const resultsDiv = document.getElementById('searchResults');

    if (!searchQuestionsCache) {
        statsDiv.textContent = 'Загружаем вопросы…';
        resultsDiv.innerHTML = '';
        showLoading('Загружаем базу вопросов…');
        try {
            await loadSearchQuestions();
            hideLoading();
        } catch (e) {
            hideLoading();
            showError(resultsDiv, 'Не удалось загрузить вопросы: ' + e.message);
            return;
        }
    }

    updateSearchStats();
    document.getElementById('searchInput').focus();
    saveState();
}

function updateSearchStats() {
    const count = searchQuestionsCache?.length ?? 0;
    document.getElementById('searchStats').textContent =
        count > 0
            ? `Загружено ${count} вопросов. Введите слово для поиска.`
            : 'Вопросы не загружены.';
}

function goHomeFromSearch() {
    hideAllPages();
    document.getElementById('startPage').style.display = 'flex';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';
    localStorage.removeItem(STORAGE_KEY);
}

let searchTimeout;

function doSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(_runSearch, 200);
}

function _runSearch() {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    const resultsDiv = document.getElementById('searchResults');
    const statsDiv = document.getElementById('searchStats');
    const allQuestions = searchQuestionsCache || [];

    if (!query) {
        updateSearchStats();
        resultsDiv.innerHTML = '';
        return;
    }

    if (query.length < 2) {
        statsDiv.textContent = 'Введите минимум 2 символа…';
        resultsDiv.innerHTML = '';
        return;
    }

    let results = allQuestions.filter(q => q.question.toLowerCase().includes(query));

    results.sort((a, b) => {
        const aText = a.question.toLowerCase();
        const bText = b.question.toLowerCase();
        const aStarts = aText.startsWith(query);
        const bStarts = bText.startsWith(query);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return aText.localeCompare(bText);
    });

    statsDiv.textContent = `Найдено: ${results.length} результатов по запросу «${query}»`;

    if (results.length === 0) {
        resultsDiv.innerHTML = '<div class="no-results">😕 Ничего не найдено. Попробуйте другие слова.</div>';
        return;
    }

    saveState();

    resultsDiv.innerHTML = results.map(q => {
        const correctAnswer = q.options[q.correct_index];
        const isExact = q.question.toLowerCase().startsWith(query);
        return `
            <div class="search-result-item ${isExact ? 'exact-match' : ''}">
                <div class="result-question">${escapeHtml(q.question)}</div>
                <div class="result-answer">✅ ${escapeHtml(correctAnswer)}</div>
                <div class="result-source">📁 ${q.source} | ID: ${q.id}</div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}