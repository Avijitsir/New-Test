// Firebase Config (আপনার কনফিগ)
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
const imgbbAPIKey = "428ce2fdbf8965490f82d9b0b2f09a97"; // ImgBB Key

let currentQuestions = [];
let editingQuizId = null;
let editQIndex = -1;
let allQuizzes = [];
let viewingQuizId = null; 
let viewingQuizTitle = "";

// --- ImgBB আপলোড ফাংশন ---
async function uploadToImgBB(file) {
    if (!file) return null;
    const formData = new FormData();
    formData.append("image", file);
    try {
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbAPIKey}`, {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        return data.success ? data.data.url : null;
    } catch (error) {
        console.error("ImgBB Error:", error);
        return null;
    }
}

// Navigation
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
    // নতুন: ইনস্ট্রাকশন বক্স ক্লিয়ার করা
    if(document.getElementById('quiz-instructions')) {
        document.getElementById('quiz-instructions').value = ''; 
    }
    document.getElementById('rand-question-check').checked = false;
    document.getElementById('rand-option-check').checked = false;
    clearInputs();
    document.getElementById('quiz-id-input').value = editingQuizId;
    document.getElementById('view-dashboard').style.display = 'none';
    document.getElementById('view-editor').style.display = 'block';
    renderQuestions();
}

// --- কুইজ লোড ও এডিট ---
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
        const div = document.createElement('div'); div.className = 'quiz-item';
        div.innerHTML = `
            <div>
                <strong>${q.title || 'নামহীন কুইজ'}</strong><br>
                <small>প্রশ্ন: ${q.questions ? q.questions.length : 0} টি</small>
            </div>
            <div style="display:flex; gap:5px;">
                <button class="btn btn-success" onclick="viewResults('${q.id}', '${q.title}')">Results</button>
                <button class="btn btn-primary" onclick="editQuiz('${q.id}')">Edit</button>
                <button class="btn btn-danger" onclick="deleteQuiz('${q.id}')">Del</button>
            </div>`;
        listCon.appendChild(div);
    });
}

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
        
        // নতুন: ইনস্ট্রাকশন লোড করা
        if(document.getElementById('quiz-instructions')) {
            document.getElementById('quiz-instructions').value = d.instructions || ""; 
        }

        document.getElementById('rand-question-check').checked = d.randomizeQuestions || false;
        document.getElementById('rand-option-check').checked = d.randomizeOptions || false;
        currentQuestions = d.questions || [];
        document.getElementById('view-dashboard').style.display = 'none';
        document.getElementById('view-editor').style.display = 'block';
        renderQuestions();
    });
}

// --- প্রশ্ন সেভ (ImgBB সহ) ---
document.getElementById('add-question-btn').addEventListener('click', () => saveQuestionData(-1));
document.getElementById('update-question-btn').addEventListener('click', () => saveQuestionData(editQIndex));

async function saveQuestionData(idx) {
    const qText = document.getElementById('rich-q-text').innerHTML;
    const passage = document.getElementById('passage-input').value;
    const btn = idx === -1 ? document.getElementById('add-question-btn') : document.getElementById('update-question-btn');
    
    if(!qText || document.getElementById('o1').value === "") { alert("প্রশ্ন ও অপশন পূরণ করুন!"); return; }

    btn.disabled = true; btn.innerText = "ছবি আপলোড হচ্ছে...";

    try {
        const qFile = document.getElementById('q-img-input').files[0];
        const eFile = document.getElementById('expl-img').files[0];
        const qImgUrl = qFile ? await uploadToImgBB(qFile) : (idx >= 0 ? currentQuestions[idx].qImg : null);
        const expImgUrl = eFile ? await uploadToImgBB(eFile) : (idx >= 0 ? currentQuestions[idx].expImg : null);

        const newQ = {
            subject: document.getElementById('question-subject-select').value,
            passage: passage, question: qText, qImg: qImgUrl,
            options: [
                document.getElementById('o1').value, document.getElementById('o2').value, 
                document.getElementById('o3').value, document.getElementById('o4').value
            ],
            optImgs: [null,null,null,null],
            correctIndex: parseInt(document.getElementById('c-opt').value),
            explanation: document.getElementById('expl-input').value,
            expImg: expImgUrl
        };

        if (idx === -1) currentQuestions.push(newQ); else { currentQuestions[idx] = newQ; editQIndex = -1; document.getElementById('add-question-btn').style.display='block'; document.getElementById('update-question-btn').style.display='none'; }
        renderQuestions(); clearInputs();
    } catch(e) { alert("Error: " + e.message); } finally { btn.disabled = false; btn.innerText = idx === -1 ? "➕ লিস্টে যোগ করুন" : "🔄 আপডেট করুন"; }
}

// --- কুইজ সেভ (ইনস্ট্রাকশন সহ) ---
function saveQuizData() {
    if(!currentQuestions.length) return alert("কোনো প্রশ্ন নেই!");
    const id = document.getElementById('quiz-id-input').value;
    
    // নতুন: ইনস্ট্রাকশন ভ্যালু নেওয়া
    const instr = document.getElementById('quiz-instructions') ? document.getElementById('quiz-instructions').value : "";

    database.ref('quizzes/'+id).set({
        title: document.getElementById('quiz-title-input').value, 
        duration: document.getElementById('quiz-duration').value,
        passMark: document.getElementById('quiz-pass-mark').value, 
        posMark: document.getElementById('quiz-pos-mark').value, 
        negMark: document.getElementById('quiz-neg-mark').value,
        instructions: instr, // ডাটাবেসে ইনস্ট্রাকশন সেভ হবে
        randomizeQuestions: document.getElementById('rand-question-check').checked,
        randomizeOptions: document.getElementById('rand-option-check').checked,
        questions: currentQuestions
    }).then(() => { 
        alert("কুইজ ও ইনস্ট্রাকশন সেভ হয়েছে!"); 
        const link = window.location.href.replace('quiz-maker.html', 'exam.html').split('?')[0] + '?id=' + id; 
        document.getElementById('generated-link').value = link; 
        document.getElementById('share-link-box').style.display = 'block'; 
    });
}

// বাকি ফাংশনগুলো (renderQuestions, clearInputs, deleteQuiz, etc.) আগের মতোই থাকবে...
function renderQuestions() {
    const con = document.getElementById('questions-container'); con.innerHTML = '';
    currentQuestions.forEach((q, i) => {
        const div = document.createElement('div'); div.className = 'q-preview-card';
        div.innerHTML = `<strong>Q${i+1}: ${q.question}</strong><div style="font-size:0.8rem; color:blue;">${q.qImg ? '🖼️ ছবি আছে' : ''}</div>
        <button onclick="loadQForEdit(${i})">✏️</button> <button onclick="delQ(${i})">🗑️</button>`;
        con.appendChild(div);
    });
}
function clearInputs() { 
    document.getElementById('rich-q-text').innerHTML = ''; document.getElementById('o1').value = ''; 
    document.getElementById('o2').value = ''; document.getElementById('o3').value = ''; document.getElementById('o4').value = ''; 
    document.getElementById('expl-input').value = ''; document.getElementById('q-img-input').value = ''; document.getElementById('expl-img').value = '';
}
function delQ(i) { if(confirm("ডিলিট করবেন?")) { currentQuestions.splice(i, 1); renderQuestions(); } }
function deleteQuiz(id) { if(confirm("নিশ্চিত?")) database.ref('quizzes/' + id).remove().then(loadQuizList); }
function copyLink() { document.getElementById('generated-link').select(); document.execCommand('copy'); alert("কপি হয়েছে!"); }
function loadQForEdit(i) {
    const q = currentQuestions[i]; editQIndex = i;
    document.getElementById('rich-q-text').innerHTML = q.question; 
    document.getElementById('passage-input').value = q.passage || '';
    document.getElementById('o1').value = q.options[0]; 
    document.getElementById('o2').value = q.options[1]; 
    document.getElementById('o3').value = q.options[2]; 
    document.getElementById('o4').value = q.options[3];
    document.getElementById('c-opt').value = q.correctIndex; 
    document.getElementById('expl-input').value = q.explanation || '';
    document.getElementById('add-question-btn').style.display='none'; 
    document.getElementById('update-question-btn').style.display='block';
}
// Results & Export
function viewResults(id, title) {
    viewingQuizId = id; viewingQuizTitle = title;
    document.getElementById('view-dashboard').style.display = 'none'; document.getElementById('view-results').style.display = 'block';
    document.getElementById('res-quiz-title').innerText = title;
    const tb = document.getElementById('results-body'); tb.innerHTML = '<tr><td>লোডিং...</td></tr>';
    database.ref('results/'+id).once('value', s => { 
        tb.innerHTML = ''; if(!s.exists()) return tb.innerHTML = '<tr><td>ডেটা নেই</td></tr>'; 
        s.forEach(c => { const r = c.val(); tb.innerHTML += `<tr><td>${r.name}</td><td>${r.score}</td><td>${r.date}</td></tr>`; }); 
    });
}
function exportToCSV() {
    if (!viewingQuizId) { alert("রেজাল্ট ওপেন করুন!"); return; }
    database.ref('results/' + viewingQuizId).once('value', (snapshot) => {
        if (!snapshot.exists()) return alert("ডেটা নেই");
        let csv = "\uFEFFName,Score,Date\r\n";
        snapshot.forEach(c => { const v = c.val(); csv += `"${v.name}",${v.score},"${v.date}"\r\n`; });
        const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
        link.download = `${viewingQuizTitle}_Results.csv`; link.click();
    });
}
