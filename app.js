import { firebaseConfig, ADMIN_EMAIL } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js';
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, onSnapshot, doc, query, orderBy, serverTimestamp } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const fabAdd = document.getElementById('fabAdd');
const searchInput = document.getElementById('searchInputHero');
const sortSelect = document.getElementById('sortSelect');
const genreFilter = document.getElementById('genreFilter');
const listEl = document.getElementById('list');
const seriesSummary = document.getElementById('seriesSummary');
const editor = document.getElementById('editor');
const editForm = document.getElementById('editForm');
const formTitle = document.getElementById('formTitle');
const cancelEdit = document.getElementById('cancelEdit');
const tabs = document.querySelectorAll('.tab');

let currentUser = null;
let isAdmin = false;
let editingId = null;
let currentFilter = 'all';
let searchTerm = '';
let sortMode = 'created-desc';
let latestItems = [];
let currentGenreFilter = 'all';
let seriesMap = new Map();
let currentSeriesFilter = '';

loginBtn.addEventListener('click', async ()=>{
  try{
    await signInWithPopup(auth, provider);
  }catch(err){
    console.error('signInWithPopup error', err);
    if (err.code === 'auth/unauthorized-domain') {
       alert('Firebase 설정 오류: 현재 주소(localhost)가 승인된 도메인에 등록되지 않았습니다. Firebase 콘솔에서 추가해 주세요.');
    } else {
       alert('로그인 중 오류가 발생했습니다: ' + err.message);
    }
  }
});
logoutBtn.addEventListener('click', async ()=>{
  try{ await signOut(auth); }catch(err){ console.error('signOut error', err); alert('로그아웃 실패'); }
});
fabAdd?.addEventListener('click', ()=> openEditor());
cancelEdit.addEventListener('click', closeEditor);

searchInput?.addEventListener('input', (e)=>{
  searchTerm = e.target.value.trim().toLowerCase();
  renderList(latestItems);
});
sortSelect?.addEventListener('change', (e)=>{
  sortMode = e.target.value;
  renderList(latestItems);
});
genreFilter?.addEventListener('change', (e)=>{
  currentGenreFilter = e.target.value;
  renderList(latestItems);
});

tabs.forEach(t=>t.addEventListener('click', ()=>{
  tabs.forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  currentFilter = t.dataset.type;
  renderList(latestItems);
}));

onAuthStateChanged(auth, user=>{
  currentUser = user;
  isAdmin = user?.email === ADMIN_EMAIL;
  console.log('Auth state changed:', user?.email ?? null, 'isAdmin=', isAdmin);
  updateAuthUI();
  // Re-render list to show/hide admin buttons immediately
  if(latestItems.length > 0) renderList(latestItems);
});

// 전역 에러 포착(간단한 디버깅 도움용)
window.addEventListener('error', (e)=>{
  console.error('Uncaught error', e.error ?? e.message);
  // 사용자에게 알림
  // alert는 자주 쓰면 귀찮으니 필요 시 주석 해제하세요
  // alert('오류 발생: ' + (e.error?.message || e.message));
});

// Redirect 결과 확인 로직 제거 (Popup 방식으로 변경됨)

function updateAuthUI(){
  if(currentUser){
    loginBtn.style.display='none';
    logoutBtn.style.display='inline-block';
  }else{
    loginBtn.style.display='inline-block';
    logoutBtn.style.display='none';
  }
  const show = (currentUser && isAdmin) ? 'inline-block' : 'none';
  fabAdd && (fabAdd.style.display = show);
}

function openEditor(item){
  editor.style.display='flex';
  if(item){
    formTitle.textContent = '정보 수정';
    editForm.title.value = item.title;
    editForm.engTitle.value = item.engTitle || '';
    editForm.type.value = item.type;
    editForm.genre.value = item.genre || '';
    editForm.poster.value = item.poster || '';
    editForm.seriesId.value = item.seriesId || '';
    // Pre-fill search box with series name
    const sName = item.seriesId ? (seriesMap.get(item.seriesId)?.title || '') : '';
    const seriesSearch = document.getElementById('seriesSearch');
    if(seriesSearch) seriesSearch.value = sName;
    
    editForm.creator.value = item.creator || '';
    editForm.year.value = item.year || '';
    editForm.score.value = item.score || '';
    editForm.review.value = item.review || '';
    editForm.detailReview.value = item.detailReview || '';
    editingId = item.id;
  } else {
    formTitle.textContent = '새 항목 추가';
    editForm.reset();
    const seriesSearch = document.getElementById('seriesSearch');
    if(seriesSearch) seriesSearch.value = '';
    editingId = null;
  }
  // Reset series select options
  populateSeriesSelect(document.getElementById('seriesSearch')?.value || '');
}
function closeEditor(){ editor.style.display='none'; editingId = null; }

// Close on overlay click
editor.addEventListener('click', (e) => {
  if (e.target === editor) closeEditor();
});


editForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!currentUser || !isAdmin){ alert('편집 권한이 없습니다.'); return; }
  const data = {
    title: editForm.title.value,
    engTitle: editForm.engTitle.value || '',
    type: editForm.type.value,
    creator: editForm.creator.value || '',
    genre: editForm.genre.value || '',
    poster: editForm.poster.value || '',
    year: parseInt(editForm.year.value) || null,
    // store score rounded to 1 decimal place
    // store score rounded to 1 decimal place
    score: (function(v){ const n = parseFloat(v); return isNaN(n) ? null : Math.round(n*10)/10; })(editForm.score.value),
    review: editForm.review.value,
    detailReview: editForm.detailReview.value,
    updatedAt: serverTimestamp()
  };
  // Determine seriesId FIRST (applies to both create and update)
  let finalSeriesId = editForm.seriesId.value || null;
  const seriesName = editForm.seriesName.value && editForm.seriesName.value.trim();
  
  // If user entered a new series name, create it first
  if(seriesName){
    try {
      const sdoc = await addDoc(collection(db,'series'), { title: seriesName, type: data.type, createdAt: serverTimestamp() });
      finalSeriesId = sdoc.id;
    } catch(err) {
      console.error("Error creating series:", err);
      alert('시리즈 생성 실패');
      return;
    }
  }

  const payload = {
    ...data,
    seriesId: finalSeriesId,
    updatedAt: serverTimestamp()
  };

  try{
    if(editingId){
      const dref = doc(db, 'ratings', editingId);
      await updateDoc(dref, payload);
    } else {
      const col = collection(db, 'ratings');
      await addDoc(col, {...payload, createdAt: serverTimestamp()});
    }
    closeEditor();
  }catch(err){
    console.error(err);
    // Friendly handling for permission-denied to guide user
    const code = err && (err.code || '');
    if(code === 'permission-denied' || (err && err.message && err.message.includes('permission-denied'))){
      const rulesHint = `Firebase security rules가 쓰기를 차단하고 있습니다. Firebase 콘솔 → Firestore → Rules에 아래 예시를 적용하거나 콘솔에서 직접 수정하세요.\n\nrules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /ratings/{docId} {\n      allow read: if true;\n      allow write: if request.auth != null && request.auth.token.email == '${ADMIN_EMAIL}';\n    }\n    match /series/{docId} {\n      allow read: if true;\n      allow write: if request.auth != null && request.auth.token.email == '${ADMIN_EMAIL}';\n    }\n  }\n}\n\n또는 Authentication에서 Google Sign-in을 활성화하고 Authorized domains에 localhost를 추가하세요.`;
      alert('저장 권한이 없습니다 (permission-denied). 콘솔 규칙을 확인하세요.\n\n' + rulesHint);
    } else {
      alert('저장 중 오류');
    }
  }
});


// 실시간 구독: 최신순
const q = query(collection(db,'ratings'), orderBy('createdAt','desc'));
onSnapshot(q, snapshot=>{
  latestItems = snapshot.docs.map(d=>({id:d.id, ...d.data()}));
  populateGenreFilter(latestItems);
  renderList(latestItems);
});

// subscribe to series collection
const seriesCol = collection(db,'series');
onSnapshot(seriesCol, snapshot=>{
  seriesMap.clear();
  snapshot.docs.forEach(d=> seriesMap.set(d.id, {id:d.id, ...d.data()}));
  populateSeriesSelect();
  // if currently viewing a series, update summary
  if(currentSeriesFilter) showSeriesSummary(currentSeriesFilter);
  // Re-render list to ensure badges have correct titles
  if(latestItems.length > 0) renderList(latestItems);
});

function populateSeriesSelect(filterText = ''){
  const sel = editForm.querySelector('select[name="seriesId"]');
  if(!sel) return;
  const cur = sel.value || '';
  sel.innerHTML = '<option value="">(없음)</option>';
  
  Array.from(seriesMap.values())
    .sort((a,b)=>a.title.localeCompare(b.title))
    .filter(s => s.title.toLowerCase().includes(filterText.toLowerCase()))
    .forEach(s=>{
      const opt = document.createElement('option'); 
      opt.value = s.id; 
      opt.textContent = s.title; 
      sel.appendChild(opt);
    });
  
  if(cur && Array.from(sel.options).some(o=>o.value===cur)) {
    sel.value = cur;
  } else if (filterText && sel.options.length > 1) {
    // If searching and no current selection is valid, auto-select the first match
    sel.selectedIndex = 1;
  }
}

// 시리즈 검색 리스너
document.getElementById('seriesSearch')?.addEventListener('input', (e) => {
  populateSeriesSelect(e.target.value);
});

// 시리즈 드롭다운 변경 리스너 (선택 시 검색창에도 이름 표시)
editForm.querySelector('select[name="seriesId"]')?.addEventListener('change', (e) => {
  const sel = e.target;
  const text = sel.options[sel.selectedIndex]?.text || '';
  const searchInput = document.getElementById('seriesSearch');
  if(searchInput) {
    searchInput.value = (sel.value === '') ? '' : text;
  }
});

function showSeriesSummary(seriesId){
  const s = seriesMap.get(seriesId);
  if(!s){ seriesSummary.style.display='none'; return; }
  const children = latestItems.filter(i=>i.seriesId===seriesId);
  const scores = children.map(c=>Number(c.score)||0).filter(v=>v>0);
  const avg = scores.length? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '-';
  
  seriesSummary.style.display='flex';
  seriesSummary.innerHTML = `
    <button id="clearSeries" class="btn ghost back-btn" title="전체 목록으로 돌아가기">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
      목록으로
    </button>
    <div class="series-info">
      <span class="label">시리즈</span>
      <span class="title">${escapeHtml(s.title)}</span>
    </div>
    <div class="series-stats">
      <span>항목 <strong>${children.length}</strong></span>
      <span>평균 <strong>${avg}</strong></span>
    </div>
  `;
  document.getElementById('clearSeries')?.addEventListener('click', ()=>{ 
    currentSeriesFilter=''; 
    seriesSummary.style.display='none'; 
    renderList(latestItems); 
  });
}

function populateGenreFilter(items){
  const set = new Set();
  items.forEach(i=>{
    const g = (i.genre||'').toString();
    if(!g) return;
    g.split(',').map(s=>s.trim()).filter(Boolean).forEach(s=>set.add(s));
  });
  const options = ['all', ...Array.from(set).sort((a,b)=>a.localeCompare(b))];
  if(!genreFilter) return;
  const cur = genreFilter.value || 'all';
  genreFilter.innerHTML = '';
  options.forEach(o=>{
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = (o==='all')? '전체 장르' : o;
    genreFilter.appendChild(opt);
  });
  if(Array.from(genreFilter.options).some(x=>x.value===cur)) genreFilter.value = cur; else genreFilter.value = 'all';
}

function renderList(items){
  if(!items) items = [];
  // 필터: 타입, 검색어
  const filtered = items.filter(i=>{
    if(currentFilter!=='all' && i.type !== currentFilter) return false;
    if(currentGenreFilter && currentGenreFilter !== 'all'){
      const genres = (i.genre||'').toString().toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if(!genres.includes(currentGenreFilter.toLowerCase())) return false;
    }
    if(currentSeriesFilter){
      if(i.seriesId !== currentSeriesFilter) return false;
    }
    if(searchTerm){
      const cleanSearch = searchTerm.replace(/\s+/g, '');
      const getVal = (v) => (v||'').toString().toLowerCase().replace(/\s+/g, '');
      
      const title = getVal(i.title);
      const eng = getVal(i.engTitle);
      const creator = getVal(i.creator);
      const genre = getVal(i.genre);
      
      // Search in Title, English Title, Creator, and Genre (space-insensitive)
      return title.includes(cleanSearch) || eng.includes(cleanSearch) || creator.includes(cleanSearch) || genre.includes(cleanSearch);
    }
    return true;
  });
  // 정렬
  const sorted = filtered.slice().sort((a,b)=>{
    switch(sortMode){
      case 'score-desc': return (b.score||0) - (a.score||0);
      case 'score-asc': return (a.score||0) - (b.score||0);
      case 'title-asc': return (''+a.title).localeCompare(b.title);
      default:
        const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : (a.createdAt? new Date(a.createdAt).getTime():0);
        const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : (b.createdAt? new Date(b.createdAt).getTime():0);
        return tb - ta;
    }
  });

  listEl.innerHTML = sorted.map(item=>{
    const metaParts = [item.type];
    if (item.creator) metaParts.push(item.creator);
    if (item.year) metaParts.push(item.year);
    
    const meta = metaParts.join(' • ');
    const actions = (currentUser && isAdmin) ? `
      <div class="actions">
        <button data-id="${item.id}" class="edit btn small">수정</button>
        <button data-id="${item.id}" class="delete btn small">삭제</button>
      </div>
    ` : '';
    const score = (item.score !== undefined && item.score !== null) ? item.score : '-';
    // Series badge next to title
    const seriesTitle = item.seriesId ? (seriesMap.get(item.seriesId)?.title || 'Series') : '';
    const seriesBadge = item.seriesId ? `<span class="series-link-badge" data-series="${item.seriesId}">${escapeHtml(seriesTitle)}</span>` : '';

    const posterNum = item.poster ? escapeHtml(String(item.poster)) : '';
    // Use .png as the default extension as found in images folder
    const imgTag = posterNum ? `<img class="thumb-img" src="images/${posterNum}.png" alt="poster" onerror="this.onerror=null;this.src='images/${posterNum}.jpg';this.onerror=function(){this.style.display='none'}"/>` : '';
    const thumbContent = imgTag || '<div class="thumb-placeholder">No Image</div>';
    
    return `
      <div class="item" data-id="${item.id}">
        <div class="thumb">${thumbContent}</div>
        <div class="content">
          <div class="header-row">
            <h3 class="item-title" data-id="${item.id}">${escapeHtml(item.title)} ${seriesBadge}</h3>
          </div>
          <div class="meta">${escapeHtml(meta)}</div>
          <div class="review clickable-review" data-id="${item.id}">${escapeHtml(item.review||'')}</div>
          <div class="rating-visual">${renderStars(score)}</div>
          ${actions}
        </div>
        <div class="score-badge">${escapeHtml(String(score))}</div>
      </div>
    `;
  }).join('');
  
  // attach handlers
  document.querySelectorAll('.edit').forEach(b=>b.addEventListener('click', async e=>{
    e.stopPropagation(); // prevent detail view
    const id = e.currentTarget.dataset.id;
    const docRef = items.find(x=>x.id===id);
    openEditor(docRef);
  }));
  document.querySelectorAll('.delete').forEach(b=>b.addEventListener('click', async e=>{
    e.stopPropagation();
    if(!confirm('삭제하시겠습니까?')) return;
    const id = e.currentTarget.dataset.id;
    try{ await deleteDoc(doc(db,'ratings',id)); }catch(err){console.error(err);alert('삭제 실패');}
  }));
  // series link handlers
  document.querySelectorAll('.series-link-badge').forEach(a=>a.addEventListener('click', e=>{
    e.stopPropagation();
    const sid = e.currentTarget.dataset.series;
    if(!sid) return;
    currentSeriesFilter = sid;
    const s = seriesMap.get(sid);
    if(s) showSeriesSummary(sid);
    renderList(latestItems);
  }));
  // Detail View Handlers (Title & Review click)
  document.querySelectorAll('.item-title, .clickable-review').forEach(el => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    const item = items.find(x => x.id === id);
    if(item) openDetail(item);
  }));
}

function openDetail(item) {
  const detailModal = document.getElementById('detailModal');
  const content = document.getElementById('detailContent');
  if(!detailModal || !content) return;
  
  const seriesTitle = item.seriesId ? (seriesMap.get(item.seriesId)?.title || '') : '';
  const seriesHtml = seriesTitle ? 
    `<div class="detail-series">Series : <span class="modal-series-link" data-series="${item.seriesId}">${escapeHtml(seriesTitle)}</span></div>` 
    : '';

  const engTitleHtml = item.engTitle ? `<div class="detail-eng-title">${escapeHtml(item.engTitle)}</div>` : '';
    
  const creator = item.creator ? `<div class="detail-creator">Created by ${escapeHtml(item.creator)}</div>` : '';
  
  // Choose which review to show: prioritize detailReview, but show short review if detail is missing, or both.
  // Requirement: "inside separate". Let's show short review as intro, then detail.
  const shortReviewHtml = item.review ? `<div class="detail-short-review">"${escapeHtml(item.review)}"<br><br></div>` : '';
  const detailReviewHtml = item.detailReview ? `<div class="detail-long-review">${escapeHtml(item.detailReview).replace(/\n/g, '<br>')}</div>` : '';
  
  // If no detail review, just show the short one as main
  const reviewContent = (shortReviewHtml + detailReviewHtml) || '<span style="color:#64748b">(리뷰 없음)</span>';

  content.innerHTML = `
    <h2 class="detail-title">${escapeHtml(item.title)}</h2>
    ${engTitleHtml}
    ${seriesHtml}
    <div class="detail-meta">${item.type} • ${item.year || ''} • ${item.genre || ''}</div>
    ${imgTagForDetail(item)}
    ${creator}
    <div class="detail-score-area">
       <span class="detail-score">${item.score}</span>
       <div class="detail-stars">${renderStars(item.score)}</div>
    </div>
    <div class="detail-review-section">
      ${reviewContent}
    </div>
  `;
  
  // Add listener for modal series link
  content.querySelector('.modal-series-link')?.addEventListener('click', (e) => {
    const sid = e.target.dataset.series;
    if(sid){
      currentSeriesFilter = sid;
      const s = seriesMap.get(sid);
      if(s) showSeriesSummary(sid);
      renderList(latestItems);
      detailModal.style.display = 'none'; // Close modal
    }
  });

  detailModal.style.display = 'flex';
}

function imgTagForDetail(item){
  if(!item.poster) return '';
  return `<div class="detail-poster"><img src="images/${item.poster}.png" onerror="this.onerror=null;this.src='images/${item.poster}.jpg'"/></div>`;
}

document.getElementById('closeDetail')?.addEventListener('click', () => {
    document.getElementById('detailModal').style.display = 'none';
});
// Close detail on outside click
document.getElementById('detailModal')?.addEventListener('click', (e) => {
    if(e.target === e.currentTarget) e.currentTarget.style.display = 'none';
});

function renderStars(score){
  const n = parseFloat(score);
  if(isNaN(n) || n<=0) return `<div class="stars" style="--w:0%"></div>`;
  // Score is 0-10, stars are 5. Each star is 2 points.
  // Percentage = (score / 10) * 100
  const pct = Math.max(0, Math.min(100, (n / 10) * 100));
  return `<div class="stars" style="--w:${pct}%"></div><span class="star-label">${n.toFixed(1)}</span>`;
}

function escapeHtml(s){ if(!s) return ''; return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

// 로컬에서 간단 테스트용: 데이터가 없으면 기본 예시 추가 (관리자일 때만)
async function seedIfEmpty(){
  // noop here — user can add via UI
}
seedIfEmpty();

// 기본 UI 업데이트(초기)
updateAuthUI();
