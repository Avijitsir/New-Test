// Firebase Config (আপনার দেওয়া কনফিগ)
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

// Firebase Init
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const database = firebase.database();
// const storage = firebase.storage(); // স্টোরেজ আর লাগবে না, তাই বন্ধ রাখা হলো

// --- ImgBB সেটআপ (অটোমেটিক ছবি আপলোডের জন্য) ---
const imgbbAPIKey = "428ce2fdbf8965490f82d9b0b2f09a97";

let currentQuestions = [];
let editingQuizId = null;
let editQIndex = -1;
let allQuizzes = [];
let viewingQuizId = null;
let viewingQuizTitle = "";
let unsavedChanges = false; // সেভ না করা পরিবর্তন আছে কিনা

// --- "সেভ হয়নি" চিহ্ন ও সতর্কতা ---
function markUnsaved() {
    unsavedChanges = true;
    const b = document.getElementById('unsaved-badge');
    if (b) b.style.display = 'inline-block';
}
function markSaved() {
    unsavedChanges = false;
    const b = document.getElementById('unsaved-badge');
    if (b) b.style.display = 'none';
}
window.addEventListener('beforeunload', (e) => {
    if (unsavedChanges) { e.preventDefault(); e.returnValue = ''; }
});

// কুইজের শেয়ার লিংক তৈরি
function buildQuizLink(id) {
    return window.location.href.replace('quiz-maker.html', 'exam.html').split('?')[0] + '?id=' + id;
}
function showQuizLink(id) {
    document.getElementById('generated-link').value = buildQuizLink(id);
    document.getElementById('share-link-box').style.display = 'block';
}

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
        if (data.success) {
            return data.data.url; // ছবির লিঙ্ক ফেরত দেবে
        } else {
            alert("ছবি আপলোড ব্যর্থ হয়েছে! ImgBB সার্ভারে সমস্যা।");
            return null;
        }
    } catch (error) {
        console.error("ImgBB Error:", error);
        alert("ইন্টারনেট সংযোগ চেক করুন।");
        return null;
    }
}

// Navigation & Init
function showDashboard() {
    if (unsavedChanges && !confirm("⚠️ আপনার পরিবর্তনগুলো এখনো সেভ হয়নি!\nসেভ না করেই ড্যাশবোর্ডে ফিরে যেতে চান?")) return;
    markSaved();
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
    document.getElementById('share-link-box').style.display = 'none';
    document.getElementById('view-dashboard').style.display = 'none';
    document.getElementById('view-editor').style.display = 'block';
    renderQuestions();
    markSaved();
    loadPortalOptions().then(() => prefillPublish(editingQuizId, true));
}

// Helper: Insert Math LaTeX Code
function insertMath(latex) {
    const editor = document.getElementById('rich-q-text');
    editor.focus();
    const mathCode = ` $${latex}$ `; 
    document.execCommand('insertText', false, mathCode);
}

function formatText(cmd) { document.execCommand(cmd, false, null); }

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
        const div = document.createElement('div'); div.className = 'quiz-item';
        div.innerHTML = `
            <div>
                <strong style="font-size:1.1rem; color:#2d3436;">${q.title || 'নামহীন কুইজ'}</strong>
                <br><small style="color:#636e72;">প্রশ্ন সংখ্যা: ${q.questions ? q.questions.length : 0} টি</small>
            </div>
            <div style="display:flex; gap:5px;">
                <button class="btn btn-success" style="padding:5px 10px; font-size:0.8rem;" onclick="viewResults('${q.id}', '${q.title}')">Results</button>
                <button class="btn btn-primary" style="padding:5px 10px; font-size:0.8rem;" onclick="editQuiz('${q.id}')">Edit</button>
                <button class="btn btn-danger" style="padding:5px 10px; font-size:0.8rem;" onclick="deleteQuiz('${q.id}')">Del</button>
            </div>`;
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
        editQIndex = -1;
        clearInputs();
        document.getElementById('add-question-btn').style.display = 'block';
        document.getElementById('update-question-btn').style.display = 'none';
        document.getElementById('view-dashboard').style.display = 'none';
        document.getElementById('view-editor').style.display = 'block';
        showQuizLink(id); // পুরনো কুইজের লিংকও সরাসরি কপি করা যাবে
        renderQuestions();
        markSaved();
        loadPortalOptions().then(() => prefillPublish(id, false));
    });
}

function deleteQuiz(id) { 
    if(confirm("আপনি কি নিশ্চিত যে এই কুইজটি মুছে ফেলতে চান?")) { 
        database.ref('quizzes/' + id).remove().then(() => loadQuizList()); 
    } 
}

document.getElementById('add-question-btn').addEventListener('click', () => saveQuestionData(-1));
document.getElementById('update-question-btn').addEventListener('click', () => saveQuestionData(editQIndex));

// --- প্রশ্ন সেভ করার লজিক (ImgBB ইন্টিগ্রেশন সহ) ---
async function saveQuestionData(idx) {
    const qText = document.getElementById('rich-q-text').innerHTML;
    const passage = document.getElementById('passage-input').value;
    const btn = idx === -1 ? document.getElementById('add-question-btn') : document.getElementById('update-question-btn');
    
    // Validation
    if(!qText || document.getElementById('o1').value === "") {
        alert("প্রশ্ন এবং অন্তত প্রথম অপশনটি পূরণ করতে হবে!");
        return;
    }

    btn.disabled = true; 
    btn.innerText = "ছবি আপলোড হচ্ছে..."; // ব্যবহারকারীকে জানানো

    try {
        // ফাইল ইনপুট থেকে ফাইল নেওয়া
        const qFile = document.getElementById('q-img-input').files[0];
        const eFile = document.getElementById('expl-img').files[0];

        // ImgBB-তে আপলোড করা (যদি নতুন ফাইল থাকে)
        // যদি ফাইল না থাকে, আগের লিঙ্কটিই থেকে যাবে
        const qImgUrl = qFile ? await uploadToImgBB(qFile) : (idx >= 0 ? currentQuestions[idx].qImg : null);
        const expImgUrl = eFile ? await uploadToImgBB(eFile) : (idx >= 0 ? currentQuestions[idx].expImg : null);

        const newQ = {
            subject: document.getElementById('question-subject-select').value,
            passage: passage, 
            question: qText, 
            qImg: qImgUrl, // লিঙ্ক সেভ হবে
            options: [
                document.getElementById('o1').value, 
                document.getElementById('o2').value, 
                document.getElementById('o3').value, 
                document.getElementById('o4').value
            ],
            optImgs: [null,null,null,null],
            correctIndex: parseInt(document.getElementById('c-opt').value),
            explanation: document.getElementById('expl-input').value,
            expImg: expImgUrl // লিঙ্ক সেভ হবে
        };

        if (idx === -1) {
            currentQuestions.push(newQ); 
        } else { 
            currentQuestions[idx] = newQ; 
            editQIndex = -1; 
            document.getElementById('add-question-btn').style.display='block'; 
            document.getElementById('update-question-btn').style.display='none'; 
        }
        renderQuestions(); 
        clearInputs();
        markUnsaved(); // প্রশ্ন যোগ/আপডেট হলো, কিন্তু কুইজ এখনো সেভ হয়নি
    } catch(e) { 
        alert("Error: " + e.message); 
    } finally { 
        btn.disabled = false; 
        btn.innerText = idx === -1 ? "➕ লিস্টে যোগ করুন" : "🔄 আপডেট করুন"; 
    }
}

// --- BULK IMPORT (As provided) ---
document.getElementById('process-bulk-btn').addEventListener('click', () => {
    const txt = document.getElementById('bulk-input-textarea').value.trim();
    if(!txt) return;
    
    const blocks = txt.split(/\n\s*\n/);
    let count = 0;
    
    blocks.forEach(b => {
        const lines = b.trim().split('\n').filter(l => l.trim());
        if(lines.length >= 6) {
            const qt = lines[0].trim();
            const ops = [lines[1].trim(), lines[2].trim(), lines[3].trim(), lines[4].trim()];
            
            const ansLine = lines.find(l => l.toLowerCase().startsWith("answer:"));
            const cIdx = ansLine ? ops.indexOf(ansLine.split(":")[1].trim()) : -1;
            
            // Explanation finding
            const expLine = lines.find(l => l.toLowerCase().startsWith("explanation:"));
            const explanationText = expLine ? expLine.split(/:(.+)/)[1].trim() : ""; 

            if(cIdx !== -1) {
                currentQuestions.push({ 
                    subject: document.getElementById('question-subject-select').value, 
                    passage: "", 
                    question: qt, 
                    qImg: null, 
                    options: ops, 
                    optImgs: [null,null,null,null], 
                    correctIndex: cIdx, 
                    explanation: explanationText, 
                    expImg: null 
                });
                count++;
            }
        }
    });
    
    if(count) {
        renderQuestions();
        markUnsaved();
        document.getElementById('bulk-input-textarea').value = ''; 
        alert(count + " টি প্রশ্ন ব্যাখ্যাসহ যুক্ত হয়েছে!"); 
    } else {
        alert("ফরম্যাট সঠিক নয়! প্রশ্ন যোগ করা যায়নি।");
    }
});

function renderQuestions() {
    const con = document.getElementById('questions-container'); con.innerHTML = '';
    currentQuestions.forEach((q, i) => {
        const div = document.createElement('div'); div.className = 'q-preview-card'; div.setAttribute('draggable', true); div.dataset.index = i;
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <span class="q-badge">Q${i+1} - ${q.subject}</span>
                <div>
                    <button class="action-btn" onclick="loadQForEdit(${i})" style="background:#fbc531; border:none; border-radius:3px; cursor:pointer;">✏️</button>
                    <button class="action-btn" onclick="delQ(${i})" style="background:#ff7675; border:none; border-radius:3px; cursor:pointer;">🗑️</button>
                </div>
            </div>
            <div style="font-weight:600;">${q.question}</div>
            <div style="font-size:0.85rem; color:#636e72; margin-top:5px;">Correct: ${q.options[q.correctIndex]}</div>
            <div style="font-size:0.8rem; color:#0984e3; margin-top:3px;">
                ${q.qImg ? '🖼️ প্রশ্নের ছবি আছে' : ''} ${q.expImg ? '| 🖼️ ব্যাখ্যার ছবি আছে' : ''}
            </div>
        `;
        div.addEventListener('dragstart', handleDragStart); 
        div.addEventListener('dragover', handleDragOver); 
        div.addEventListener('drop', handleDrop);
        con.appendChild(div);
    });
    if(window.MathJax) { MathJax.typesetPromise(); }
}

// Drag Handlers
let dragSrcEl = null;
function handleDragStart(e) { dragSrcEl = this; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', this.innerHTML); this.classList.add('dragging'); }
function handleDragOver(e) { if (e.preventDefault) e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDrop(e) { if (e.stopPropagation) e.stopPropagation(); if (dragSrcEl !== this) { let fromIndex = parseInt(dragSrcEl.dataset.index); let toIndex = parseInt(this.dataset.index); let itemToMove = currentQuestions[fromIndex]; currentQuestions.splice(fromIndex, 1); currentQuestions.splice(toIndex, 0, itemToMove); renderQuestions(); markUnsaved(); } return false; }

function loadQForEdit(i) {
    const q = currentQuestions[i]; editQIndex = i;
    document.getElementById('rich-q-text').innerHTML = q.question; 
    document.getElementById('passage-input').value = q.passage || '';
    document.getElementById('o1').value = q.options[0]; 
    document.getElementById('o2').value = q.options[1]; 
    document.getElementById('o3').value = q.options[2]; 
    document.getElementById('o4').value = q.options[3];
    document.getElementById('c-opt').value = q.correctIndex;
    // সাবজেক্টও ফিরিয়ে আনা হচ্ছে, না হলে আপডেটের সময় সাবজেক্ট নিজে থেকে বদলে যেত
    const subjSel = document.getElementById('question-subject-select');
    if (q.subject && Array.from(subjSel.options).some(o => o.value === q.subject)) subjSel.value = q.subject;
    document.getElementById('expl-input').value = q.explanation || '';
    document.getElementById('add-question-btn').style.display='none'; 
    document.getElementById('update-question-btn').style.display='block';
    
    // Scroll to top
    document.querySelector('.editor-left').scrollTop = 0;
}

function clearInputs() { 
    document.getElementById('rich-q-text').innerHTML = ''; 
    document.getElementById('passage-input').value = ''; 
    document.getElementById('o1').value = ''; 
    document.getElementById('o2').value = ''; 
    document.getElementById('o3').value = ''; 
    document.getElementById('o4').value = ''; 
    document.getElementById('expl-input').value = ''; 
    document.getElementById('q-img-input').value = '';
    document.getElementById('expl-img').value = '';
}

function delQ(i) { 
    if(confirm("এই প্রশ্নটি ডিলিট করবেন?")) {
        currentQuestions.splice(i, 1);
        renderQuestions();
        markUnsaved();
    }
}

function saveQuizData() {
    if(!currentQuestions.length) return alert("কোনো প্রশ্ন নেই! আগে প্রশ্ন যোগ করুন।");
    const id = document.getElementById('quiz-id-input').value;
    
    database.ref('quizzes/'+id).set({
        title: document.getElementById('quiz-title-input').value, 
        duration: document.getElementById('quiz-duration').value,
        passMark: document.getElementById('quiz-pass-mark').value, 
        posMark: document.getElementById('quiz-pos-mark').value, 
        negMark: document.getElementById('quiz-neg-mark').value,
        randomizeQuestions: document.getElementById('rand-question-check').checked,
        randomizeOptions: document.getElementById('rand-option-check').checked,
        questions: currentQuestions
    }).then(() => { 
        markSaved();
        showQuizLink(id);
        return publishToPortal(id, document.getElementById('quiz-title-input').value.trim());
    }).then(portalMsg => {
        alert("কুইজ সেভ হয়েছে!" + (portalMsg || ""));
    }).catch(err => {
        alert("সেভ করা যায়নি! ইন্টারনেট চেক করে আবার চেষ্টা করুন।\n" + err.message);
    });
}
function copyLink() { 
    document.getElementById('generated-link').select(); 
    document.execCommand('copy'); 
    alert("লিংক কপি হয়েছে!");
}

// --- RESULTS & EXCEL EXPORT ---
function viewResults(id, title) {
    viewingQuizId = id;
    viewingQuizTitle = title;
    
    document.getElementById('view-dashboard').style.display = 'none'; 
    document.getElementById('view-results').style.display = 'block'; 
    document.getElementById('res-quiz-title').innerText = title;
    
    const tb = document.getElementById('results-body'); 
    tb.innerHTML = '<tr><td colspan="3">লোডিং...</td></tr>';
    
    database.ref('results/'+id).once('value', s => { 
        tb.innerHTML = ''; 
        if(!s.exists()) return tb.innerHTML = '<tr><td colspan="3">কোনো ডেটা নেই</td></tr>'; 
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


// কুইজ সেটিংসের কোনো ঘর বদলালে "সেভ হয়নি" চিহ্ন দেখাবে
['quiz-title-input','quiz-duration','quiz-pass-mark','quiz-pos-mark','quiz-neg-mark','rand-question-check','rand-option-check','pub-cat','pub-tab','pub-menu','pub-sub'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', markUnsaved);
});


// =====================================================
// পোর্টালে স্বয়ংক্রিয় প্রকাশ (অ্যাডমিন প্যানেলের Single Entry-র শর্টকাট)
// কুইজ সেভ করলেই 'exams' নোডে এন্ট্রি তৈরি/আপডেট হয়
// =====================================================
let portalExams = []; // [[key, value], ...]
const PUB_LAST_KEY = 'qm_last_publish';

function pubVal(id) { return (document.getElementById(id).value || '').trim(); }
function pubSet(id, v) { document.getElementById(id).value = v || ''; }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

// পোর্টালের বর্তমান এন্ট্রিগুলো এনে ড্রপডাউনের তালিকা বানায়
function loadPortalOptions() {
    return database.ref('exams').once('value').then(snap => {
        portalExams = [];
        snap.forEach(c => { portalExams.push([c.key, c.val() || {}]); });
        const uniq = arr => [...new Set(arr.filter(Boolean))];
        const fill = (id, arr) => {
            document.getElementById(id).innerHTML = arr.map(v => '<option value="' + escAttr(v) + '">').join('');
        };
        fill('pub-catList', uniq(portalExams.map(([k, v]) => v.category)));
        fill('pub-tabList', uniq(['Mock Tests'].concat(portalExams.map(([k, v]) => v.topTab))));
        refreshMenuList();
        renderPortalChips();
    }).catch(err => { console.log('Portal options load failed:', err); });
}

// নির্বাচিত পরীক্ষার মেনুগুলোই সাজেস্ট করে (না থাকলে সব মেনু)
function refreshMenuList() {
    const cat = pubVal('pub-cat');
    let src = portalExams.filter(([k, v]) => v.category === cat);
    if (!src.length) src = portalExams;
    const menus = [...new Set(src.map(([k, v]) => v.subject).filter(Boolean))];
    document.getElementById('pub-menuList').innerHTML = menus.map(m => '<option value="' + escAttr(m) + '">').join('');
}
document.getElementById('pub-cat').addEventListener('input', refreshMenuList);

// এডিটর খোলার সময় ঘরগুলো ভরে দেয়
//  - আগে থেকে পোর্টালে থাকা কুইজ হলে: ওই এন্ট্রির তথ্য
//  - একদম নতুন কুইজ হলে: শেষবার যা ব্যবহার করেছেন সেটাই
function prefillPublish(quizId, isNew) {
    const link = buildQuizLink(quizId);
    const found = portalExams.find(([k, v]) => v.link === link);
    pubSet('pub-key', found ? found[0] : '');
    if (found) {
        pubSet('pub-cat', found[1].category);
        pubSet('pub-tab', found[1].topTab || 'Mock Tests');
        pubSet('pub-menu', found[1].subject);
        pubSet('pub-sub', found[1].subFilter);
    } else if (isNew) {
        let last = {};
        try { last = JSON.parse(localStorage.getItem(PUB_LAST_KEY) || '{}'); } catch (e) {}
        pubSet('pub-cat', last.cat);
        pubSet('pub-tab', last.tab || 'Mock Tests');
        pubSet('pub-menu', last.menu);
        pubSet('pub-sub', last.sub);
    } else {
        pubSet('pub-cat', ''); pubSet('pub-tab', 'Mock Tests'); pubSet('pub-menu', ''); pubSet('pub-sub', '');
    }
    refreshMenuList();
    markSaved(); // ঘর ভরাটকে "পরিবর্তন" হিসেবে ধরা হবে না
}

// কুইজ সেভ হওয়ার পর পোর্টালে এন্ট্রি করে। ফেরত দেয় একটি বার্তা (বা ফাঁকা লেখা)
function publishToPortal(quizId, title) {
    const cat = pubVal('pub-cat'), menu = pubVal('pub-menu');
    if (!cat && !menu) return Promise.resolve('');
    if (!cat || !menu) return Promise.resolve('\n\n⚠️ পোর্টালে যোগ হয়নি: "Exam" ও "Menu" দুটোই দিতে হবে।');
    if (!title) return Promise.resolve('\n\n⚠️ পোর্টালে যোগ হয়নি: কুইজের নাম (Exam Title) দিন।');

    const link = buildQuizLink(quizId);
    // সবসময় সর্বশেষ তালিকা এনে মিলিয়ে নেয়, যাতে ডুপ্লিকেট এন্ট্রি না হয়
    return loadPortalOptions().then(() => {
        let key = pubVal('pub-key');
        if (!key) { const f = portalExams.find(([k, v]) => v.link === link); if (f) key = f[0]; }
        const existing = key ? portalExams.find(([k]) => k === key) : null;

        // আইকন: একই পরীক্ষার আগের আইকন নিজে থেকে নেয়
        let icon = '';
        if (existing && existing[1].category === cat && existing[1].icon) icon = existing[1].icon;
        if (!icon) { const f = portalExams.find(([k, v]) => v.category === cat && v.icon); if (f) icon = f[1].icon; }

        const payload = {
            category: cat,
            icon: icon,
            topTab: pubVal('pub-tab') || 'Mock Tests',
            subject: menu,
            subFilter: pubVal('pub-sub'),
            chapter: title,
            link: link,
            locked: existing ? (existing[1].locked || false) : false
        };

        let op, newKey = key;
        if (key) { op = database.ref('exams/' + key).update(payload); }
        else { const ref = database.ref('exams').push(); newKey = ref.key; op = ref.set(payload); }

        return op.then(() => {
            pubSet('pub-key', newKey);
            try { localStorage.setItem(PUB_LAST_KEY, JSON.stringify({ cat: cat, tab: payload.topTab, menu: menu, sub: payload.subFilter })); } catch (e) {}
            loadPortalOptions();
            return '\n\n🌐 পোর্টালেও ' + (key ? 'আপডেট' : 'যোগ') + ' হয়েছে।' + (icon ? '' : '\n(এই পরীক্ষার আইকন এখনো নেই, চাইলে অ্যাডমিন প্যানেল থেকে একবার দিন।)');
        });
    }).catch(err => '\n\n⚠️ কুইজ সেভ হয়েছে, কিন্তু পোর্টালে যোগ করা যায়নি: ' + err.message);
}


// ---- "পোর্টালে এখন যা আছে" তালিকা: ক্লিক করলে Exam/Tab/Menu/Sub ঘর ভরে যায় ----
let pubCombos = [];
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderPortalChips() {
    const box = document.getElementById('pub-existing');
    if (!box) return;
    const map = new Map();
    portalExams.forEach(([k, v]) => {
        if (!v.category) return;
        const tab = v.topTab || 'Mock Tests', menu = v.subject || '', sub = v.subFilter || '';
        const key = [v.category, tab, menu, sub].join('||');
        if (!map.has(key)) map.set(key, { cat: v.category, tab: tab, menu: menu, sub: sub, n: 0 });
        map.get(key).n++;
    });
    pubCombos = [...map.values()].sort((a, b) =>
        (a.cat + '|' + a.tab + '|' + a.menu + '|' + a.sub).localeCompare(b.cat + '|' + b.tab + '|' + b.menu + '|' + b.sub));
    if (!pubCombos.length) {
        box.innerHTML = '<span style="color:#636e72;">পোর্টালে এখনো কিছু নেই। ওপরের ঘরগুলোতে নিজে লিখুন।</span>';
        return;
    }
    const groups = {};
    pubCombos.forEach((c, i) => { (groups[c.cat] = groups[c.cat] || []).push([c, i]); });
    box.innerHTML = Object.keys(groups).map(cat => {
        const chips = groups[cat].map(([c, i]) => {
            const label = [c.tab, c.menu, c.sub].filter(Boolean).join(' › ') + ' (' + c.n + 'টি)';
            return '<button type="button" onclick="pickPortalCombo(' + i + ')" style="margin:3px 4px 3px 0; padding:5px 10px; border:1px solid #b2bec3; border-radius:16px; background:#f5f6fa; cursor:pointer; font-size:0.8rem;">' + escHtml(label) + '</button>';
        }).join('');
        return '<div style="margin-bottom:6px;"><strong style="color:#2d3436;">🏫 ' + escHtml(cat) + '</strong><br>' + chips + '</div>';
    }).join('');
}

function pickPortalCombo(i) {
    const c = pubCombos[i];
    if (!c) return;
    pubSet('pub-cat', c.cat); pubSet('pub-tab', c.tab); pubSet('pub-menu', c.menu); pubSet('pub-sub', c.sub);
    refreshMenuList();
    markUnsaved();
}
