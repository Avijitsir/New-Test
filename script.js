// --- Firebase Config ---
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

// --- Globals ---
let questions = [];
let currentIdx = 0;
let status, userAnswers;
let isSubmitted = false;
let timerInterval;
let timeLeft = 90 * 60; 
let isPaused = false;
let filteredIndices = [];
let quizSettings = { passMark: 30, posMark: 1, negMark: 0.33 };
let currentQuizId = null;
let sectionMode = false;   // section-wise mode on/off (off = single "All Sections")
let sections = [];         // [{name, start, end}] by question index
let endTime = 0;          // পরীক্ষা শেষের ঘড়ির সময় (ms)
let examStarted = false;
let wakeLock = null;

function escHtml(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function toBn(n) { return String(n).replace(/\d/g, d => '\u09E6\u09E7\u09E8\u09E9\u09EA\u09EB\u09EC\u09ED\u09EE\u09EF'[d]); }
function secOf(idx) { return sections.findIndex(s => idx >= s.start && idx <= s.end); }

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// --- Load Quiz ---
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    currentQuizId = urlParams.get('id');
    // পোর্টালের "Reattempt": সেভ মুছে নতুন করে শুরু (রিলোডে যেন আবার না মোছে, তাই ঠিকানা থেকে চিহ্নটা সরানো হয়)
    if (currentQuizId && urlParams.get('retake') === '1') {
        try { localStorage.removeItem(stateKey()); } catch (e) {}
        urlParams.delete('retake');
        try { history.replaceState(null, '', location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '')); } catch (e) {}
    }
    const wantView = urlParams.get('view');
    if (currentQuizId && tryRestoreAttempt()) {
        // আগের পরীক্ষা বা রেজাল্ট ফিরিয়ে আনা হয়েছে; পোর্টালের "Solution" বোতাম থেকে এলে সরাসরি সমাধান
        if (wantView === 'solution' && isSubmitted) switchTab('solution');
    } else if (currentQuizId) {
        document.getElementById('instContent').innerHTML = "<div style='text-align:center; padding:20px; color:#666;'>Loading Quiz Details... Please wait.</div>";
        loadQuizFromFirebase(currentQuizId);
    } else {
        alert("URL Error: No Quiz ID found.");
    }
    
    // Initialize Swipe Listeners
    setupSwipe('examSwipeArea', () => {
        if(!isPaused && currentIdx > 0) loadQuestion(currentIdx - 1);
    }, () => {
        if(!isPaused && currentIdx < questions.length - 1) loadQuestion(currentIdx + 1);
    });

    setupSwipe('resSwipeArea', () => {
        const nIdx = filteredIndices.indexOf(currentResRealIdx);
        if(nIdx > 0) loadResultQuestion(filteredIndices[nIdx - 1]);
    }, () => {
        const nIdx = filteredIndices.indexOf(currentResRealIdx);
        if(nIdx < filteredIndices.length - 1) loadResultQuestion(filteredIndices[nIdx + 1]);
    });

    // চেকবক্স তুলে দেওয়া হয়েছে: শুরুর বাটনে ক্লিক করলেই ফুলস্ক্রিন সহ পরীক্ষা শুরু হবে
});

let currentResRealIdx = -1; 

function setupSwipe(elementId, onSwipeRight, onSwipeLeft) {
    const el = document.getElementById(elementId);
    let touchStartX = 0;
    let touchEndX = 0;
    
    if(!el) return;

    el.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, {passive: true});

    el.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, {passive: true});

    function handleSwipe() {
        if (touchEndX < touchStartX - 50) {
            onSwipeLeft(); 
        }
        if (touchEndX > touchStartX + 50) {
            onSwipeRight(); 
        }
    }
}

function loadQuizFromFirebase(quizId) {
    database.ref('quizzes/' + quizId).once('value').then((snapshot) => {
        const data = snapshot.val();
        if (data && data.questions) {
            // 1. Load Settings
            if(data.title) document.getElementById('instTitle').innerText = data.title;
            if(data.duration) timeLeft = parseInt(data.duration) * 60;
            if(data.passMark) quizSettings.passMark = parseFloat(data.passMark);
            if(data.posMark) quizSettings.posMark = parseFloat(data.posMark);
            if(data.negMark) quizSettings.negMark = parseFloat(data.negMark);

            document.getElementById('dispPosMark').innerText = "+" + quizSettings.posMark;
            document.getElementById('dispNegMark').innerText = "-" + quizSettings.negMark;

            questions = data.questions;

            // PRE-PROCESS
            questions.forEach(q => {
                q.correctIndex = parseInt(q.correctIndex);
                if (isNaN(q.correctIndex)) q.correctIndex = 0; 
            });

            // 2. Randomization Logic
            sectionMode = false; sections = [];
            if (data.sectionMode) {
                // group by Subject; section order = order of first appearance
                const names = [];
                questions.forEach(q => { q.subject = (q.subject || 'Others').trim(); if (!names.includes(q.subject)) names.push(q.subject); });
                if (names.length > 1) {
                    const groups = names.map(n => questions.filter(q => q.subject === n));
                    if (data.randomizeQuestions) groups.forEach(g => shuffleArray(g));   // shuffle only inside each section
                    questions = [].concat(...groups);
                    let pos = 0;
                    sections = groups.map((g, i) => { const sec = { name: names[i], start: pos, end: pos + g.length - 1 }; pos += g.length; return sec; });
                    sectionMode = true;
                } else if (data.randomizeQuestions) {
                    shuffleArray(questions);
                }
            } else if (data.randomizeQuestions) {
                shuffleArray(questions);
            }
            if(data.randomizeOptions) {
                questions.forEach(q => {
                    let cIdx = q.correctIndex;
                    if (cIdx < 0 || cIdx >= q.options.length) cIdx = 0;
                    
                    const correctText = q.options[cIdx];
                    
                    let combinedOpts = q.options.map((opt, i) => {
                        return { text: opt, img: (q.optImgs && q.optImgs[i]) ? q.optImgs[i] : null };
                    });
                    
                    shuffleArray(combinedOpts);
                    
                    q.options = combinedOpts.map(o => o.text);
                    q.optImgs = combinedOpts.map(o => o.img);
                    
                    const newIndex = q.options.indexOf(correctText);
                    q.correctIndex = newIndex !== -1 ? newIndex : 0;
                });
            }

            status = new Array(questions.length).fill(0); 
            userAnswers = new Array(questions.length).fill(null); 
            
            // --- 3. Previous Score Logic ---
            let prevScoreMsg = "";
            const savedScore = localStorage.getItem('last_score_' + quizId);
            if(savedScore) {
                prevScoreMsg = `<div style="background:#e8f5e9; color:#2e7d32; padding:10px; border-radius:5px; margin-bottom:15px; border:1px solid #c8e6c9;">
                    <strong>আপনার পূর্ববর্তী ফলাফল:</strong> ${savedScore}
                </div>`;
            }

            // --- 4. INSTRUCTION PAGE ---
            const fullMarks = Number((questions.length * quizSettings.posMark).toFixed(2));
            // রঙিন কার্ড-স্টাইল নির্দেশাবলী (লেখা আগের মতোই, শুধু সাজানো বদলেছে)
            const COL = { blue: ['#1565c0', '#e3f2fd'], green: ['#2e7d32', '#e8f5e9'], purple: ['#6a1b9a', '#f3e5f5'], red: ['#c62828', '#ffebee'], orange: ['#e65100', '#fff3e0'] };
            const stat = (icon, label, val, k) => `<div style="background:${COL[k][1]}; border-radius:12px; padding:10px 8px; text-align:center;">
                    <div style="font-size:20px; line-height:1.2;">${icon}</div>
                    <div style="font-size:12px; color:#555; margin-top:2px;">${label}</div>
                    <div style="font-size:16px; font-weight:700; color:${COL[k][0]};">${val}</div></div>`;
            const infoBox = `<div style="display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:12px;">
                    ${stat('⏱️', 'মোট সময়', toBn(data.duration) + ' মিনিট', 'blue')}
                    ${stat('📝', 'মোট প্রশ্ন', toBn(questions.length), 'purple')}
                    ${stat('🎯', 'পূর্ণমান', toBn(fullMarks), 'green')}
                    ${stat('✅', 'পাস মার্ক', toBn(quizSettings.passMark), 'orange')}
                </div>
                ${sectionMode ? `<div style="background:#e8eaf6; color:#283593; padding:8px 12px; border-radius:10px; font-size:13px; margin-bottom:12px;">📚 <b>সেকশন:</b> ${sections.map(x => escHtml(x.name) + ' (' + toBn(x.end - x.start + 1) + ')').join(' • ')}</div>` : ''}`;

            const row = (n, t, k) => `<div style="display:flex; gap:10px; align-items:flex-start; background:${COL[k][1]}; border-left:4px solid ${COL[k][0]}; border-radius:8px; padding:9px 10px; margin-bottom:8px;">
                    <span style="flex:none; min-width:24px; height:24px; border-radius:12px; background:${COL[k][0]}; color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; padding:0 3px;">${n === 'x' ? '%%N%%' : toBn(n)}</span>
                    <span style="flex:1; min-width:0;">${t}</span></div>`;
            const hd = (t, k) => `<div style="font-weight:700; color:${COL[k][0]}; margin:14px 0 8px; font-size:14px;">${t}</div>`;

            const rule = (t, k) => row('x', t, k || 'blue');   // নম্বর পরে, দেখানোর ক্রম ধরে বসে

            const core = row(1, `<strong>মোট সময় (Duration):</strong> <b style="color:#1565c0;">${data.duration} মিনিট</b>`, 'blue')
                + row(2, `<strong>পাস মার্ক (Pass Mark):</strong> <b style="color:#e65100;">${quizSettings.passMark}</b>`, 'orange')
                + row(3, `<strong>মার্কিং:</strong> প্রতিটি সঠিক উত্তরের জন্য <b style="color:#2e7d32;">+${quizSettings.posMark}</b> এবং ভুল উত্তরের জন্য <b style="color:#c62828;">-${quizSettings.negMark}</b> নম্বর কাটা যাবে`, 'green')
                + row(4, 'ডানদিকের প্যালেট ব্যবহার করে যে কোনো প্রশ্নে যাওয়া যাবে', 'blue')
                + row(5, '<strong>নতুন:</strong> স্ক্রিনে বামে/ডানে সোয়াইপ করে প্রশ্ন পরিবর্তন করা যাবে।', 'blue');

            let btnRules = '', warnRules = '', tipRules = '';
            if (sectionMode) btnRules += rule('<strong>সেকশন:</strong> পরীক্ষাটি বিষয় অনুযায়ী সেকশনে ভাগ করা। ওপরের সেকশনের নামে ক্লিক করলে সেই সেকশনের প্রথম প্রশ্নে যাবেন। যেকোনো সময় যেকোনো সেকশনে যেতে পারবেন। <b>সময় সব সেকশনের জন্য মিলিয়ে একটাই।</b>', 'purple');
            warnRules += rule('<strong>সময় শেষ হওয়ামাত্র</strong> আপনার পরীক্ষা নিজে থেকেই জমা হয়ে যাবে।', 'red');
            warnRules += rule('নিচের <b>"I am ready to begin"</b> বোতামে ক্লিক করামাত্র <b>টাইমার চালু</b> হবে। তাই আগে থেকে তৈরি হয়ে নিন।', 'red');
            btnRules += rule('উত্তর বেছে <b>"Save & Next"</b> চাপতে হবে। না চেপে অন্য প্রশ্নে চলে গেলে সেই উত্তর <b>ধরা হবে না</b>।', 'purple');
            btnRules += rule('<b>"Mark Review"</b> শুধু আপনার মনে রাখার জন্য। উত্তর বেছে Mark Review করলে সেই উত্তরও গণনায় ধরা হবে।', 'purple');
            btnRules += rule('বাছা উত্তরটির ওপর <b>আবার চাপ দিলে</b> উত্তর মুছে যাবে। এতে কোনো নম্বর কাটা হবে না। আগের প্রশ্নে ফিরতে <b>"Previous"</b> বোতাম আছে।', 'purple');
            warnRules += rule('পরীক্ষা চলাকালীন <b>পেজ রিফ্রেশ করবেন না, ব্যাক বোতাম চাপবেন না বা ব্রাউজার বন্ধ করবেন না।</b> করলে পরীক্ষা নষ্ট হতে পারে।', 'red');
            warnRules += rule('<b>ফুলস্ক্রিন থেকে বেরোবেন না।</b> বেরোলে সতর্কবার্তা আসবে, "Return to Fullscreen" চেপে ফিরে আসুন।', 'red');
            if (data.randomizeQuestions || data.randomizeOptions) tipRules += rule('প্রশ্ন বা অপশনের ক্রম <b>এলোমেলো</b> থাকতে পারে, তাই পাশের জনের সঙ্গে ক্রম মিলবে না।', 'orange');
            tipRules += rule('ফোনে কল এলে, স্ক্রিন লক হলে বা পেজ হঠাৎ বন্ধ হয়ে গেলে <b>একই লিংকে আবার ঢুকুন।</b> আপনার উত্তর ও পরীক্ষা যেখানে ছিল সেখান থেকেই চলবে, তবে <b>সময় চলতে থাকবে।</b>', 'green');
            tipRules += rule('পরীক্ষা চলাকালীন <b>ইন্টারনেট চালু রাখুন</b> এবং ফোনে চার্জ আছে কিনা দেখে নিন।', 'green');
            tipRules += rule('সাবমিটের পর আপনি <b>স্কোর, সঠিক-ভুলের হিসাব এবং প্রতিটি প্রশ্নের সমাধান ও ব্যাখ্যা</b> দেখতে পাবেন।', 'green');

            const dot = (cls, t) => `<span style="display:inline-flex; align-items:center; gap:6px; background:#fff; border:1px solid #e0e0e0; border-radius:14px; padding:4px 10px; font-size:12px;"><span class="dot-icon ${cls}"></span>${t}</span>`;

            const instHTML = `
                ${prevScoreMsg}
                <div style="font-family: 'Roboto', sans-serif; font-size: 15px; line-height: 1.6; color:#333;">
                    <div style="background:linear-gradient(135deg,#1565c0,#6a1b9a); color:#fff; border-radius:14px; padding:14px 16px; margin-bottom:12px;">
                        <div style="font-size:17px; font-weight:700;">📋 সাধারণ নির্দেশাবলী</div>
                        <div style="font-size:12px; opacity:.9;">General Instructions &mdash; শুরুর আগে মন দিয়ে পড়ুন</div>
                    </div>
                    ${infoBox}
                    ${hd('📌 মূল তথ্য', 'blue')}
                    ${core}
                    ${hd('🔘 বোতাম ব্যবহার', 'purple')}
                    ${btnRules}
                    ${hd('⚠️ খুব গুরুত্বপূর্ণ সতর্কতা', 'red')}
                    ${warnRules}
                    ${hd('💡 জেনে রাখুন', 'green')}
                    ${tipRules}
                    <div style="background:#f5f5f5; padding:10px 12px; border-radius:10px; margin-top:12px; font-size:13px;">
                        <strong>কালার কোড (Legend):</strong>
                        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
                            ${dot('not-visited', 'দেখেনি (Not Visited)')}
                            ${dot('not-answered', 'উত্তর দেয়নি (Not Answered)')}
                            ${dot('answered', 'উত্তর দিয়েছে (Answered)')}
                            ${dot('marked', 'মার্ক করা (Marked for Review)')}
                        </div>
                    </div>
                    <p style="margin:16px 0 4px; padding:12px 14px; background:linear-gradient(135deg,#fff8e1,#ffe0b2); border-left:5px solid #ff9800; border-radius:8px;">
                        আপনি প্রস্তুত থাকলে নিচের বোতামে ক্লিক করুন। <b>ক্লিক করামাত্র পরীক্ষা শুরু হবে।</b> শুভকামনা! 🍀
                    </p>
                </div>`;
            let seq = 5;
            const instHTMLNumbered = instHTML.replace(/%%N%%/g, () => toBn(++seq));
            
            document.getElementById('instContent').innerHTML = instHTMLNumbered;
            
            // --- FIX: Button disabled logic logic fixed ---
            // বাটন ডিজেবল থাকবে যতক্ষণ না চেকবক্সে ক্লিক করা হয়
            document.getElementById('startTestBtn').disabled = false;
        } else {
            document.getElementById('instContent').innerHTML = "Quiz not found or invalid.";
        }
    });
}

document.getElementById('startTestBtn').addEventListener('click', () => {
    document.getElementById('instructionScreen').style.display = 'none';
    document.getElementById('quizMainArea').style.display = 'flex'; 
    if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    examStarted = true;
    loadQuestion(0);
    startTimer();
    keepAwake();
    saveState();
});

// Fullscreen Logic
document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !isSubmitted) document.getElementById('fullscreenOverlay').style.display = 'flex';
    else document.getElementById('fullscreenOverlay').style.display = 'none';
    // ব্রাউজারের "exit full screen" বার্তা কয়েক সেকেন্ড নিচের বোতাম ঢাকে, তাই তখন বোতাম একটু ওপরে তোলা থাকে
    const ft = document.querySelector('.app-footer');
    if (document.fullscreenElement && examStarted && ft) {
        ft.style.bottom = '70px';
        setTimeout(() => { ft.style.bottom = '0'; }, 6000);
    }
});
document.getElementById('returnFsBtn').addEventListener('click', () => {
    if(document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
});

// --- Render Question ---
function loadQuestion(index) {
    if(status[index] === 0) status[index] = 1; 
    currentIdx = index;
    document.getElementById('currentQNum').innerText = index + 1;
    updateSectionBar();
    saveState();
    const q = questions[index];
    
    let qHTML = "";
    if(q.passage) qHTML += `<div class="passage-box"><strong>Passage:</strong><br>${q.passage.replace(/\n/g, '<br>')}</div>`;
    if(q.qImg) qHTML += `<img src="${q.qImg}" class="q-img-display">`;
    qHTML += q.question;
    
    document.getElementById('questionTextBox').innerHTML = qHTML;

    const container = document.getElementById('optionsContainer');
    container.innerHTML = '';
    
    const nextBtn = document.getElementById('saveNextBtn');
    if (index === questions.length - 1) { nextBtn.innerText = "Final Submit"; nextBtn.style.backgroundColor = "#ff5722"; } 
    else { nextBtn.innerText = "Save & Next"; nextBtn.style.backgroundColor = "#00c696"; }

    q.options.forEach((opt, i) => {
        const row = document.createElement('div');
        row.className = 'option-row';
        if(userAnswers[index] === i) row.classList.add('selected');
        
        let optContent = `<div class="radio-circle"></div><div style="flex:1;">`;
        if(q.optImgs && q.optImgs[i]) optContent += `<img src="${q.optImgs[i]}" style="max-width:100px; display:block; margin-bottom:5px;">`;
        optContent += `<div class="opt-text">${opt}</div></div>`;
        
        row.innerHTML = optContent;
        row.onclick = () => { if(isPaused) return; const was = row.classList.contains('selected'); document.querySelectorAll('.option-row').forEach(r => r.classList.remove('selected')); if(!was) row.classList.add('selected'); };
        container.appendChild(row);
    });

    if(window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise();
}

// সেকশন বার: চালু থাকলে প্রতিটা সেকশন, বন্ধ থাকলে স্থির "All Sections"
function updateSectionBar() {
    if (!sectionMode) return;
    const bar = document.querySelector('.section-bar');
    bar.innerHTML = '';
    const cur = secOf(currentIdx);
    sections.forEach((sec, i) => {
        const d = document.createElement('div');
        d.className = 'chip' + (i === cur ? ' active' : '');
        d.textContent = sec.name;
        d.onclick = () => { if (!isPaused) loadQuestion(sec.start); };
        bar.appendChild(d);
    });
    const active = bar.querySelector('.chip.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

// রেজাল্টে সেকশন-ওয়ারি নম্বরের ছোট টেবিল
function renderSectionScores() {
    const old = document.getElementById('secScoreBox'); if (old) old.remove();
    if (!sectionMode) return;
    const grid = document.querySelector('#tab-score-view .score-grid'); if (!grid) return;
    const td = 'padding:6px; border-top:1px solid #eee;';
    const rows = sections.map(sec => {
        let c = 0, w = 0, sk = 0;
        for (let i = sec.start; i <= sec.end; i++) {
            const u = userAnswers[i];
            if (u === null) sk++; else if (u == Number(questions[i].correctIndex)) c++; else w++;
        }
        const sc = (c * quizSettings.posMark - w * quizSettings.negMark).toFixed(2);
        return '<tr><td style="' + td + ' text-align:left; font-weight:bold;">' + escHtml(sec.name) + '</td><td style="' + td + ' color:#26a745;">' + c + '</td><td style="' + td + ' color:#dc3545;">' + w + '</td><td style="' + td + ' color:#888;">' + sk + '</td><td style="' + td + ' font-weight:bold;">' + sc + '</td></tr>';
    }).join('');
    const box = document.createElement('div');
    box.id = 'secScoreBox'; box.style.cssText = 'margin-top:12px; overflow-x:auto;';
    box.innerHTML = '<div style="font-weight:bold; color:#555; margin-bottom:4px;">সেকশন অনুযায়ী ফলাফল</div>' +
        '<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:center;"><thead><tr style="background:#f0f4ff;">' +
        '<th style="padding:6px; text-align:left;">সেকশন</th><th>সঠিক</th><th>ভুল</th><th>বাদ</th><th>নম্বর</th></tr></thead><tbody>' + rows + '</tbody></table>';
    grid.insertAdjacentElement('afterend', box);
}

function getSelIdx() { const s = document.querySelector('.option-row.selected'); return s ? Array.from(s.parentNode.children).indexOf(s) : null; }

document.getElementById('markReviewBtn').addEventListener('click', () => { 
    if(isPaused) return; 
    const i = getSelIdx(); 
    if(i!==null){ userAnswers[currentIdx]=i; status[currentIdx]=4; } else { userAnswers[currentIdx]=null; status[currentIdx]=3; } saveState(); 
    if(currentIdx < questions.length - 1) loadQuestion(currentIdx + 1); else openDrawer();
});

document.getElementById('saveNextBtn').addEventListener('click', () => { 
    if(isPaused) return; 
    const i = getSelIdx(); 
    if(i!==null){ userAnswers[currentIdx]=i; status[currentIdx]=2; } else { userAnswers[currentIdx]=null; status[currentIdx]=1; } saveState(); 
    
    if (currentIdx === questions.length - 1) { 
        if (confirm("আপনি কি নিশ্চিত যে আপনি পরীক্ষা শেষ করতে চান?")) submitTest(); 
    } else { 
        loadQuestion(currentIdx + 1); 
    }
});

document.getElementById('prevBtn').addEventListener('click', () => {
    if(isPaused || currentIdx === 0) return;
    const i = getSelIdx();
    if(i!==null){ userAnswers[currentIdx]=i; status[currentIdx] = (status[currentIdx]===4) ? 4 : 2; }
    else { userAnswers[currentIdx]=null; if(status[currentIdx]!==3) status[currentIdx]=1; }
    saveState();
    loadQuestion(currentIdx - 1);
});

// Drawer & Timer
const drawer = document.getElementById('paletteSheet');
document.querySelector('.menu-icon').addEventListener('click', () => { renderPalette(); drawer.classList.add('open'); document.getElementById('sheetOverlay').style.display='block'; });
function closeDrawer() { drawer.classList.remove('open'); setTimeout(()=>document.getElementById('sheetOverlay').style.display='none', 300); }
document.getElementById('closeSheetBtn').addEventListener('click', closeDrawer);
document.getElementById('sheetOverlay').addEventListener('click', closeDrawer);

function renderPalette() {
    const grid = document.getElementById('paletteGrid'); grid.innerHTML = '';
    status.forEach((s, i) => {
        if (sectionMode) {
            const si = secOf(i);
            if (si >= 0 && sections[si].start === i) {
                const h = document.createElement('div');
                h.textContent = sections[si].name;
                h.style.cssText = 'grid-column:1/-1; font-size:12px; font-weight:bold; color:#145c94; border-bottom:1px solid #e0e0e0; padding:4px 0 2px; margin-top:' + (i === 0 ? '0' : '8px') + ';';
                grid.appendChild(h);
            }
        }
        const btn = document.createElement('div'); btn.className = 'p-btn'; btn.innerText = i + 1;
        if(s===2) btn.classList.add('answered'); else if(s===1) btn.classList.add('not-answered');
        else if(s===3) btn.classList.add('marked'); else if(s===4) btn.classList.add('marked-ans');
        if(i===currentIdx) btn.classList.add('current');
        btn.onclick = () => { if(!isPaused) { loadQuestion(i); closeDrawer(); }};
        grid.appendChild(btn);
    });
}

function tick() {
    // ঘড়ির সময় ধরে হিসাব: স্ক্রিন লক বা কলের সময়ও সঠিকভাবে কমে
    timeLeft = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    const m = parseInt(timeLeft / 60), s = parseInt(timeLeft % 60);
    document.getElementById('timerDisplay').innerText = `${m}:${s<10?'0'+s:s}`;
    if (timeLeft <= 0) { clearInterval(timerInterval); submitTest(); }
}

function startTimer() {
    clearInterval(timerInterval);
    endTime = Date.now() + timeLeft * 1000;
    tick();
    if (timeLeft > 0) timerInterval = setInterval(tick, 1000);
}

document.getElementById('pauseBtn').addEventListener('click', () => {
    const ca = document.querySelector('.content-area'); const b = document.getElementById('pauseBtn');
    if(!isPaused) { clearInterval(timerInterval); isPaused=true; b.innerText="Resume"; b.style.background="#ff9800"; b.style.color="white"; ca.style.opacity='0'; showPauseMsg(true); saveState(); } 
    else { startTimer(); isPaused=false; b.innerText="Pause"; b.style.background="white"; b.style.color="#007bff"; ca.style.opacity='1'; showPauseMsg(false); saveState(); }
});

// --- SUBMIT & RESULT ANALYSIS ---
function submitTest(fromRestore) {
    if(isSubmitted && !fromRestore) return;
    isSubmitted = true;
    clearInterval(timerInterval);
    
    let s=0, c=0, w=0, sk=0;
    
    questions.forEach((q, i) => { 
        const correctIdx = Number(q.correctIndex);
        const userAns = userAnswers[i];
        
        if(userAns !== null) { 
            if(userAns == correctIdx) { 
                s += quizSettings.posMark; 
                c++; 
            } else { 
                s -= quizSettings.negMark; 
                w++; 
            } 
        } else {
            sk++; 
        }
    });
    
    const score = s.toFixed(2);
    
    const stdName = 'Anonymous'; // নাম নেওয়া হয় না
    if(currentQuizId && !fromRestore) {
        database.ref('results/' + currentQuizId).push({
            name: stdName, score: score, correct: c, wrong: w, date: new Date().toLocaleString()
        });
    }
    if(!fromRestore) localStorage.setItem('last_score_' + currentQuizId, score);

    document.getElementById('resScore').innerText = score; 
    document.getElementById('resCorrect').innerText = c; 
    document.getElementById('resWrong').innerText = w; 
    document.getElementById('resSkip').innerText = sk;
    
    const passBox = document.getElementById('passFailBox');
    
    if(s >= quizSettings.passMark) {
        passBox.innerHTML = `🎉 অভিনন্দন! আপনি পাস করেছেন।`; 
        passBox.style.background = "#d4edda"; 
        passBox.style.color = "#155724"; 
        passBox.style.border = "1px solid #c3e6cb";
    } else {
        const needed = (quizSettings.passMark - s).toFixed(2);
        passBox.innerHTML = `😞 দুঃখিত! আপনি ফেল করেছেন।<br>
        <span style="font-size:14px; font-weight:normal; display:block; margin-top:5px;">
            পাস করার জন্য আরও <strong>${needed}</strong> নম্বর প্রয়োজন ছিল।
        </span>`; 
        passBox.style.background = "#f8d7da"; 
        passBox.style.color = "#721c24"; 
        passBox.style.border = "1px solid #f5c6cb";
    }

    renderSectionScores();
    document.getElementById('resultModal').style.display = 'flex';
    switchTab('score');
    applyFilter('all');
    saveState();
    releaseWake();
}

function applyFilter(t) {
    document.querySelectorAll('.f-btn').forEach(b => { 
        b.classList.remove('active'); 
        if(b.innerText.toLowerCase() === t) b.classList.add('active'); 
    });
    
    filteredIndices = [];
    questions.forEach((q, i) => {
        const u = userAnswers[i];
        const correctIdx = Number(q.correctIndex);
        let st = 'skipped';
        
        if(u !== null) {
            st = (u == correctIdx) ? 'correct' : 'wrong';
        }
        
        if(t === 'all' || t === st) filteredIndices.push(i);
    });
    
    renderResultPalette();
    
    if(filteredIndices.length > 0) { 
        document.getElementById('resEmptyMsg').style.display = 'none';
        document.getElementById('tab-solution-view').querySelector('.content-area').style.display = 'block';
        loadResultQuestion(filteredIndices[0]); 
    } else {
        document.getElementById('resEmptyMsg').style.display = 'flex';
        document.getElementById('tab-solution-view').querySelector('.content-area').style.display = 'none';
    }
}

function renderResultPalette() {
    const c = document.getElementById('resPaletteContainer'); c.innerHTML = '';
    filteredIndices.forEach(idx => {
        const btn = document.createElement('div'); btn.className = 'rp-btn'; btn.innerText = idx + 1;
        const u = userAnswers[idx];
        const q = questions[idx];
        const correctIdx = Number(q.correctIndex);

        if(u === null) btn.classList.add('skipped'); 
        else if(u == correctIdx) btn.classList.add('correct'); 
        else btn.classList.add('wrong');
        
        btn.onclick = () => {
            loadResultQuestion(idx);
            switchTab('solution');
        };
        c.appendChild(btn);
    });
}

function loadResultQuestion(realIdx) {
    const nIdx = filteredIndices.indexOf(realIdx);
    if(nIdx === -1) return;
    
    currentResRealIdx = realIdx; 

    document.querySelectorAll('.rp-btn').forEach(b => b.classList.remove('active'));
    if(document.querySelectorAll('.rp-btn')[nIdx]) document.querySelectorAll('.rp-btn')[nIdx].classList.add('active');
    
    document.getElementById('resCurrentQNum').innerText = realIdx + 1;
    
    const u = userAnswers[realIdx];
    const q = questions[realIdx];
    const c = Number(q.correctIndex); 

    const b = document.getElementById('resQStatusBadge');
    if(u === null) { 
        b.innerText = "Skipped"; b.style.background = "#ffc107"; b.style.color = "#333"; 
    } else if(u == c) { 
        b.innerText = "Correct"; b.style.background = "#26a745"; b.style.color = "white"; 
    } else { 
        b.innerText = "Wrong"; b.style.background = "#dc3545"; b.style.color = "white"; 
    }
    
    let qHTML = "";
    if(q.qImg) qHTML += `<img src="${q.qImg}" style="max-height:200px; max-width:100%; display:block; margin:0 auto 10px; border-radius:4px;">`;
    qHTML += q.question;
    document.getElementById('resQuestionText').innerHTML = qHTML;

    const con = document.getElementById('resOptionsContainer'); 
    con.innerHTML = '';

    q.options.forEach((o, i) => {
        let cls = 'res-opt-row';
        if(i == c) cls += ' correct-ans';
        if(u == i && u != c) cls += ' user-wrong';

        let optContent = '';
        if(q.optImgs && q.optImgs[i]) {
            optContent += `<img src="${q.optImgs[i]}" style="height:50px; display:block; margin-bottom:5px; border:1px solid #ddd; border-radius:3px;">`;
        }
        optContent += `<span style="font-size:15px;">${o}</span>`;

        con.innerHTML += `
            <div class="${cls}">
                <div class="res-circle"></div>
                <div class="res-opt-text" style="flex:1;">${optContent}</div>
            </div>`;
    });
    
    const explBox = document.getElementById('resExplanation');
    if(q.explanation && q.explanation.trim() !== "") { 
        explBox.style.display = "block"; 
        let expContent = "";
        if(q.expImg) expContent += `<img src="${q.expImg}" style="max-height:150px; display:block; margin-bottom:10px;">`;
        expContent += q.explanation;
        document.getElementById('resExplText').innerHTML = expContent; 
    } else { 
        explBox.style.display = "none"; 
    }

    if(window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise();
    
    document.getElementById('resPrevBtn').onclick = () => { if(nIdx > 0) loadResultQuestion(filteredIndices[nIdx - 1]); };
    document.getElementById('resNextBtn').onclick = () => { if(nIdx < filteredIndices.length - 1) loadResultQuestion(filteredIndices[nIdx + 1]); };
}

function switchTab(tabName) {
    document.getElementById('btn-score').classList.remove('active');
    document.getElementById('btn-solution').classList.remove('active');
    document.getElementById('btn-' + tabName).classList.add('active');

    if(tabName === 'score') {
        document.getElementById('tab-score-view').style.display = 'block';
        document.getElementById('tab-solution-view').style.display = 'none';
    } else {
        document.getElementById('tab-score-view').style.display = 'none';
        document.getElementById('tab-solution-view').style.display = 'flex'; 
        document.getElementById('tab-solution-view').style.flexDirection = 'column';
    }
}

document.getElementById('submitTestBtn').addEventListener('click', () => submitTest());
window.addEventListener('beforeunload', (e) => { if(!isSubmitted && !leavingPage) { e.preventDefault(); e.returnValue = ''; } });

// =====================================================================
//  কল / স্ক্রিন লক / পেজ রিলোড: পরীক্ষা ও রেজাল্ট ফোনে সেভ থাকে, ফিরলে আবার চালু হয়
// =====================================================================
function stateKey() { return 'exam_state_' + currentQuizId; }

function saveState() {
    if (!currentQuizId || !examStarted) return;
    try {
        localStorage.setItem(stateKey(), JSON.stringify({
            v: 1, savedAt: Date.now(),
            questions: questions, sections: sections, sectionMode: sectionMode, quizSettings: quizSettings,
            status: status, userAnswers: userAnswers, currentIdx: currentIdx,
            endTime: endTime, timeLeft: timeLeft, isPaused: isPaused, submitted: isSubmitted
        }));
    } catch (e) { /* স্টোরেজ ভরা বা বন্ধ থাকলে চুপচাপ বাদ */ }
}

// স্ক্রিন যেন নিজে থেকে বন্ধ না হয় (৩০ সেকেন্ডের অটো-লক আটকায়)
async function keepAwake() {
    try {
        if (!('wakeLock' in navigator) || isSubmitted || document.visibilityState !== 'visible' || wakeLock) return;
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
}
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }

// ফোন আনলক বা কল শেষে ট্যাবে ফিরলে: সময় ধরতা ঠিক করা ও স্ক্রিন আবার জাগিয়ে রাখা
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !examStarted || isSubmitted) return;
    keepAwake();
    if (!isPaused) tick();
});
document.getElementById('returnFsBtn').addEventListener('click', () => keepAwake());

// আগের অসমাপ্ত পরীক্ষা বা সাবমিট করা রেজাল্ট থাকলে ফিরিয়ে আনে। ফিরিয়ে আনলে true
function tryRestoreAttempt() {
    let st = null;
    try { st = JSON.parse(localStorage.getItem(stateKey()) || 'null'); } catch (e) { st = null; }
    if (!st || st.v !== 1 || !st.questions || !st.questions.length || !st.status || !st.userAnswers) return false;
    if (Date.now() - (st.savedAt || 0) > 24 * 3600 * 1000) { try { localStorage.removeItem(stateKey()); } catch (e) {} return false; }

    questions = st.questions; sections = st.sections || []; sectionMode = !!st.sectionMode;
    quizSettings = st.quizSettings || quizSettings; status = st.status; userAnswers = st.userAnswers;
    currentIdx = Math.min(Math.max(st.currentIdx || 0, 0), questions.length - 1);
    document.getElementById('dispPosMark').innerText = '+' + quizSettings.posMark;
    document.getElementById('dispNegMark').innerText = '-' + quizSettings.negMark;
    examStarted = true;
    document.getElementById('instructionScreen').style.display = 'none';
    document.getElementById('quizMainArea').style.display = 'flex';

    if (st.submitted) { submitTest(true); return true; }   // সাবমিট করা রেজাল্ট আবার দেখানো (আবার জমা পড়ে না)

    // Pause করা অবস্থায় বেরিয়ে গেলেও ফিরে এলে পরীক্ষা নিজে চালু হয় (প্রশ্ন ঢাকা বা সময় আটকে থাকে না); Pause-এ বাকি সময়টুকুই ধরা হয়
    const wasPaused = !!st.isPaused;
    isPaused = false;
    timeLeft = wasPaused ? (st.timeLeft || 0) : Math.max(0, Math.round((st.endTime - Date.now()) / 1000));
    loadQuestion(currentIdx);
    if (timeLeft <= 0) { submitTest(); return true; }        // দূরে থাকতে সময় শেষ: নিজে জমা হবে
    startTimer();
    // রিলোডে ফুলস্ক্রিন চলে যায়: যেসব ফোনে ফুলস্ক্রিন চলে, সেখানে ফেরার বোতাম দেখানো
    if (document.fullscreenEnabled && !document.fullscreenElement) document.getElementById('fullscreenOverlay').style.display = 'flex';
    keepAwake();
    return true;
}

// "Close & Re-attempt": সেভ করা অবস্থা মুছে নতুন করে শুরু
function retakeTest() {
    try { localStorage.removeItem(stateKey()); } catch (e) {}
    location.reload();
}


// =====================================================================
//  ফোনের Back বোতাম: সমাধান → স্কোর কার্ড → (নিশ্চিত করে) পোর্টাল; পরীক্ষা চলার সময় ভুল করে বেরোনো আটকায়
// =====================================================================
let leavingPage = false;
history.pushState({ guard: 1 }, '');
window.addEventListener('popstate', () => {
    const shown = id => { const e = document.getElementById(id); return e && getComputedStyle(e).display !== 'none'; };
    const stay = () => history.pushState({ guard: 1 }, '');
    const leave = () => { leavingPage = true; history.back(); };
    if (shown('resultModal')) {
        if (shown('tab-solution-view')) { switchTab('score'); stay(); return; }
        if (confirm('পোর্টালে ফিরে যেতে চান?')) leave(); else stay();
    } else if (examStarted && !isSubmitted) {
        if (drawer.classList.contains('open')) { closeDrawer(); stay(); return; }
        if (confirm('পরীক্ষা চলছে। সত্যিই বেরিয়ে যেতে চান? (ফিরে এলে একই লিংকে উত্তর ও সময় ঠিক থাকবে)')) leave(); else stay();
    } else {
        leave();
    }
});

// "← টেস্ট সিরিজে ফিরুন": রেজাল্ট থেকে সরাসরি পোর্টালের আগের মেনুতে (নিশ্চিতকরণ ছাড়া, কারণ বোতামটা ইচ্ছা করেই চাপা)
function goPortal() {
    leavingPage = true;
    // পোর্টাল লিংকের সঙ্গে ফেরার ঠিকানা (back) পাঠিয়েছে; একই সাইটের হলেই সেটা ব্যবহার
    try {
        const back = new URLSearchParams(location.search).get('back');
        if (back && new URL(back, location.href).origin === location.origin) { location.replace(back); return; }
    } catch (e) {}
    history.go(-2);
    setTimeout(() => { if (document.referrer) location.href = document.referrer; else leavingPage = false; }, 500);
}

// Pause করা থাকলে ঢাকা পর্দায় কী করতে হবে তা লিখে দেখানো
function showPauseMsg(on) {
    let m = document.getElementById('pauseMsg');
    if (!m) {
        m = document.createElement('div'); m.id = 'pauseMsg';
        m.style.cssText = 'position:fixed;left:0;right:0;top:42%;text-align:center;font-size:16px;font-weight:bold;color:#ff9800;z-index:5;padding:0 24px;display:none;';
        m.textContent = '⏸ পরীক্ষা Pause করা আছে। চালু করতে ওপরের "Resume" বোতাম চাপুন।';
        document.body.appendChild(m);
    }
    m.style.display = on ? 'block' : 'none';
}
