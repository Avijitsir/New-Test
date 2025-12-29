// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyDwGzTPmFg-gjoYtNWNJM47p22NfBugYFA",
    authDomain: "mock-test-1eea6.firebaseapp.com",
    databaseURL: "https://mock-test-1eea6-default-rtdb.firebaseio.com",
    projectId: "mock-test-1eea6",
    storageBucket: "mock-test-1eea6.firebaseapp.com",
    messagingSenderId: "111849173136",
    appId: "1:111849173136:web:8b211f58d854119e88a815",
    measurementId: "G-5RLWPTP8YD"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const storage = firebase.storage();

let currentQuestions = [];
let editingQuizId = null;
let editQIndex = -1;
let allQuizzes = [];
let viewingQuizId = null; // For CSV Export
let viewingQuizTitle = "";

// Navigation & Init
function showDashboard() {
    document.getElementById('view-dashboard').style.display = 'block';
    document.getElementById('view-editor').style.display = 'none';
    document.getElementById('view-results').style.display = 'none';
    loadQuizList();
}

function createNewQuiz() {
    editingQuizId = 'quiz_' + Date.now();
    currentQuestions = [];
    document.getElementById('quiz-title-input').value = '';
    document.getElementById('quiz-duration').value = '';
    document.getElementById('quiz-pass-mark').value = '';
    document.getElementById('quiz-pos-mark').value = '';
    document.getElementById('quiz-neg-mark').value = '';
    document.getElementById('rand-question-check').checked = false;
    document.getElementById('rand-option-check').checked = false;
    clearInputs();
    document.getElementById('quiz-id-input').value = editingQuizId;
    document.getElementById('view-dashboard').style.display = 'none';
    document.getElementById('view-editor').style.display = 'block';
    renderQuestions();
}

// Helper: Insert Math LaTeX Code
function insertMath(latex) {
    const editor = document.getElementById('rich-q-text');
    editor.focus();
    const mathCode = ` $${latex}$ `; 
    document.execCommand('insertText', false, mathCode);
}

function formatText(cmd) { document.execCommand(cmd, false, null); }

async function uploadFile(file) {
    if (!file) return null;
    const ref = storage.ref(`imgs/${Date.now()}_${file.name}`);
    await ref.put(file); return await ref.getDownloadURL();
}

// Load List
function loadQuizList() {
    const listCon = document.getElementById('quiz-list-container');
    listCon.innerHTML = '<p>লোডিং হচ্ছে...</p>';
    database.ref('quizzes').once('value', snapshot => {
        listCon.innerHTML = ''; allQuizzes = [];
        if (!snapshot.exists()) { listCon.innerHTML = '<p>কোনো কুইজ পাওয়া যায়নি।</p>'; return; }
        snapshot.forEach(child => { allQuizzes.push({ id: child.key, ...child.val() }); });
        allQuizzes.reverse(); renderQuizList(allQuizzes);
    });
}

function renderQuizList(list) {
    const listCon = document.getElementById('quiz-list-container'); listCon.innerHTML = '';
    list.forEach(q => {
        const div = document.createElement('div'); div.className = 'quiz-list-item';
        div.innerHTML = `<div><strong>${q.title || 'নামহীন কুইজ'}</strong><br><small>প্রশ্ন: ${q.questions ? q.questions.length : 0} টি</small></div>
            <div class="list-actions"><button class="action-btn" style="background:#388e3c" onclick="viewResults('${q.id}', '${q.title}')">Results</button>
            <button class="action-btn" style="background:#1976d2" onclick="editQuiz('${q.id}')">Edit</button>
            <button class="action-btn" style="background:#d32f2f" onclick="deleteQuiz('${q.id}')">Del</button></div>`;
        listCon.appendChild(div);
    });
}
function filterQuizzes() {
    const text = document.getElementById('search-quiz').value.toLowerCase();
    renderQuizList(allQuizzes.filter(q => (q.title || '').toLowerCase().includes(text)));
}

// Edit & Save Logic
function editQuiz(id) {
    editingQuizId = id;
    database.ref('quizzes/' + id).once('value', s => {
        const d = s.val();
        document.getElementById('quiz-id-input').value = id;
        document.getElementById('quiz-title-input').value = d.title;
        document.getElementById('quiz-duration').value = d.duration;
        document.getElementById('quiz-pass-mark').value = d.passMark;
        document.getElementById('quiz-pos-mark').value = d.posMark;
        document.getElementById('quiz-neg-mark').value = d.negMark;
        document.getElementById('rand-question-check').checked = d.randomizeQuestions || false;
        document.getElementById('rand-option-check').checked = d.randomizeOptions || false;
        currentQuestions = d.questions || [];
        document.getElementById('view-dashboard').style.display = 'none';
        document.getElementById('view-editor').style.display = 'block';
        renderQuestions();
    });
}
function deleteQuiz(id) { if(confirm("মুছে ফেলতে চান?")) { database.ref('quizzes/' + id).remove().then(() => loadQuizList()); } }

document.getElementById('add-question-btn').addEventListener('click', () => saveQuestionData(-1));
document.getElementById('update-question-btn').addEventListener('click', () => saveQuestionData(editQIndex));

async function saveQuestionData(idx) {
    const qText = document.getElementById('rich-q-text').innerHTML;
    const passage = document.getElementById('passage-input').value;
    const btn = idx === -1 ? document.getElementById('add-question-btn') : document.getElementById('update-question-btn');
    btn.disabled = true; btn.innerText = "অপেক্ষা করুন...";
    try {
        const qImg = document.getElementById('q-img-input').files[0] ? await uploadFile(document.getElementById('q-img-input').files[0]) : (idx>=0?currentQuestions[idx].qImg:null);
        const newQ = {
            subject: document.getElementById('question-subject-select').value,
            passage: passage, question: qText, qImg: qImg,
            options: [document.getElementById('o1').value, document.getElementById('o2').value, document.getElementById('o3').value, document.getElementById('o4').value],
            optImgs: [null,null,null,null],
            correctIndex: parseInt(document.getElementById('c-opt').value),
            explanation: document.getElementById('expl-input').value,
            expImg: document.getElementById('expl-img').files[0] ? await uploadFile(document.getElementById('expl-img').files[0]) : (idx>=0?currentQuestions[idx].expImg:null)
        };
        if (idx === -1) currentQuestions.push(newQ); else { currentQuestions[idx] = newQ; editQIndex = -1; document.getElementById('add-question-btn').style.display='block'; document.getElementById('update-question-btn').style.display='none'; }
        renderQuestions(); clearInputs();
    } catch(e) { alert(e.message); } finally { btn.disabled = false; btn.innerText = idx === -1 ? "➕ যোগ করুন" : "আপডেট করুন"; }
}

document.getElementById('process-bulk-btn').addEventListener('click', () => {
    const txt = document.getElementById('bulk-input-textarea').value.trim();
    if(!txt) return;
    const blocks = txt.split(/\n\s*\n/);
    let count = 0;
    blocks.forEach(b => {
        const lines = b.trim().split('\n').filter(l=>l);
        if(lines.length >= 6) {
            const qt = lines[0];
            const ops = [lines[1], lines[2], lines[3], lines[4]];
            const ansLine = lines.find(l => l.toLowerCase().startsWith("answer:"));
            const cIdx = ansLine ? ops.indexOf(ansLine.split(":")[1].trim()) : 0;
            if(cIdx !== -1) {
                currentQuestions.push({ subject: document.getElementById('question-subject-select').value, passage: "", question: qt, qImg: null, options: ops, optImgs: [null,null,null,null], correctIndex: cIdx, explanation: "", expImg: null });
                count++;
            }
        }
    });
    if(count) { renderQuestions(); document.getElementById('bulk-input-textarea').value = ''; alert(count + " added"); }
});

function renderQuestions() {
    const con = document.getElementById('questions-container'); con.innerHTML = '';
    currentQuestions.forEach((q, i) => {
        const div = document.createElement('div'); div.className = 'q-card'; div.setAttribute('draggable', true); div.dataset.index = i;
        div.innerHTML = `<div class="q-header"><span class="drag-handle">☰ Q${i+1} (${q.subject})</span><div><button class="action-btn" onclick="loadQForEdit(${i})" style="background:#1976d2;">Edit</button><button class="action-btn" onclick="delQ(${i})" style="background:#d32f2f;">X</button></div></div><div>${q.question}</div>`;
        div.addEventListener('dragstart', handleDragStart); div.addEventListener('dragover', handleDragOver); div.addEventListener('drop', handleDrop);
        con.appendChild(div);
    });
    if(window.MathJax) { MathJax.typesetPromise(); }
}

// Drag Handlers
let dragSrcEl = null;
function handleDragStart(e) { dragSrcEl = this; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', this.innerHTML); this.classList.add('dragging'); }
function handleDragOver(e) { if (e.preventDefault) e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDrop(e) { if (e.stopPropagation) e.stopPropagation(); if (dragSrcEl !== this) { let fromIndex = parseInt(dragSrcEl.dataset.index); let toIndex = parseInt(this.dataset.index); let itemToMove = currentQuestions[fromIndex]; currentQuestions.splice(fromIndex, 1); currentQuestions.splice(toIndex, 0, itemToMove); renderQuestions(); } return false; }

function loadQForEdit(i) {
    const q = currentQuestions[i]; editQIndex = i;
    document.getElementById('rich-q-text').innerHTML = q.question; document.getElementById('passage-input').value = q.passage || '';
    document.getElementById('o1').value = q.options[0]; document.getElementById('o2').value = q.options[1]; document.getElementById('o3').value = q.options[2]; document.getElementById('o4').value = q.options[3];
    document.getElementById('c-opt').value = q.correctIndex; document.getElementById('expl-input').value = q.explanation;
    document.getElementById('add-question-btn').style.display='none'; document.getElementById('update-question-btn').style.display='block';
}
function clearInputs() { document.getElementById('rich-q-text').innerHTML = ''; document.getElementById('passage-input').value = ''; document.getElementById('o1').value = ''; document.getElementById('o2').value = ''; document.getElementById('o3').value = ''; document.getElementById('o4').value = ''; document.getElementById('expl-input').value = ''; document.getElementById('q-img-input').value = ''; }
function delQ(i) { currentQuestions.splice(i, 1); renderQuestions(); }

function saveQuizData() {
    if(!currentQuestions.length) return alert("No questions!");
    const id = document.getElementById('quiz-id-input').value;
    database.ref('quizzes/'+id).set({
        title: document.getElementById('quiz-title-input').value, duration: document.getElementById('quiz-duration').value,
        passMark: document.getElementById('quiz-pass-mark').value, posMark: document.getElementById('quiz-pos-mark').value, negMark: document.getElementById('quiz-neg-mark').value,
        randomizeQuestions: document.getElementById('rand-question-check').checked,
        randomizeOptions: document.getElementById('rand-option-check').checked,
        questions: currentQuestions
    }).then(() => { 
        alert("Saved!"); 
        // --- LINK CHANGE: Points to exam.html now ---
        const link = window.location.href.replace('quiz-maker.html', 'exam.html').split('?')[0] + '?id=' + id; 
        document.getElementById('generated-link').value = link; 
        document.getElementById('share-link-box').style.display = 'block'; 
    });
}
function copyLink() { document.getElementById('generated-link').select(); document.execCommand('copy'); }

// --- UPDATED RESULTS & EXCEL EXPORT ---
function viewResults(id, title) {
    viewingQuizId = id;
    viewingQuizTitle = title;
    
    document.getElementById('view-dashboard').style.display = 'none'; 
    document.getElementById('view-results').style.display = 'block'; 
    document.getElementById('res-quiz-title').innerText = title;
    
    const tb = document.getElementById('results-body'); 
    tb.innerHTML = 'Loading...';
    
    database.ref('results/'+id).once('value', s => { 
        tb.innerHTML = ''; 
        if(!s.exists()) return tb.innerHTML = '<tr><td colspan="3">No data</td></tr>'; 
        s.forEach(c => { 
            const r = c.val(); 
            tb.innerHTML += `<tr><td>${r.name}</td><td>${r.score}</td><td>${r.date}</td></tr>`; 
        }); 
    });
}

function exportToCSV() {
    if (!viewingQuizId) { alert("প্রথমে কোনো কুইজের রেজাল্ট ওপেন করুন!"); return; }
    const btn = document.querySelector('button[onclick="exportToCSV()"]');
    const oldText = btn ? btn.innerText : "Export";
    if(btn) btn.innerText = "ডাউনলোড হচ্ছে...";

    database.ref('results/' + viewingQuizId).once('value', (snapshot) => {
        if (!snapshot.exists()) {
            alert("ডাউনলোড করার মতো কোনো ডেটা নেই।");
            if(btn) btn.innerText = oldText; return;
        }
        let csvContent = "\uFEFFStudent Name,Score,Correct,Wrong,Date\r\n";
        snapshot.forEach(child => {
            const val = child.val();
            const safeName = val.name ? `"${val.name.replace(/"/g, '""')}"` : "Anonymous";
            const row = `${safeName},${val.score},${val.correct || 0},${val.wrong || 0},"${val.date}"`;
            csvContent += row + "\r\n";
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `${viewingQuizTitle}_Results.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if(btn) btn.innerText = oldText;
    });
}