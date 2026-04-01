document.addEventListener('DOMContentLoaded', function() {

function el(id) { return document.getElementById(id); }
function showErr(id, msg)  { const e = el(id); if(e){ e.textContent = msg; e.className = 'error'; } }
function showOk(id, msg)   { const e = el(id); if(e){ e.textContent = msg; e.className = 'success'; } }
function clearMsg(id)      { const e = el(id); if(e) e.textContent = ''; }

/* ═══════════════════════════════════════════════════════════════════
   PASSWORD GATE
══════════════════════════════════════════════════════════════════ */
let pwGateCallback = null;

function openPasswordGate(title, onConfirm) {
  pwGateCallback = onConfirm;
  if(el('pw-gate-title')) el('pw-gate-title').textContent = title || 'Confirm Identity';
  if(el('pw-gate-input')) el('pw-gate-input').value = '';
  clearMsg('pw-gate-error');
  if(el('modal-password-gate')) el('modal-password-gate').classList.remove('hidden');
  setTimeout(() => { if(el('pw-gate-input')) el('pw-gate-input').focus(); }, 100);
}

function closePasswordGate() {
  if(el('modal-password-gate')) el('modal-password-gate').classList.add('hidden');
  pwGateCallback = null;
}

if(el('pw-gate-confirm')) {
  el('pw-gate-confirm').addEventListener('click', async () => {
    const password = el('pw-gate-input') ? el('pw-gate-input').value : '';
    if (!password) { showErr('pw-gate-error', 'Please enter your password.'); return; }
    const body = new FormData();
    body.append('password', password);
    try {
      const res  = await fetch('/verify-learner-password', { method: 'POST', body });
      const data = await res.json();
      if (data.success) {
        closePasswordGate();
        if (pwGateCallback) pwGateCallback(password);
      } else {
        showErr('pw-gate-error', data.error || 'Incorrect password.');
      }
    } catch(e) { showErr('pw-gate-error', 'Network error.'); }
  });
}

if(el('pw-gate-cancel')) el('pw-gate-cancel').addEventListener('click', closePasswordGate);
if(el('pw-gate-input')) {
  el('pw-gate-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && el('pw-gate-confirm')) el('pw-gate-confirm').click();
  });
}
if(el('toggle-pw-gate') && el('pw-gate-input')) setupPasswordToggle('pw-gate-input','toggle-pw-gate');
if(el('modal-password-gate')) {
  el('modal-password-gate').addEventListener('click', function(e){ if(e.target===this) closePasswordGate(); });
}

/* ═══════════════════════════════════════════════════════════════════
   EDIT PROFILE — name, surname, email, cellphone
══════════════════════════════════════════════════════════════════ */
if(el('btn-edit-profile')) {
  el('btn-edit-profile').addEventListener('click', () => {
    openPasswordGate('Confirm to Edit Profile', () => {
      if(el('edit-first-name')) el('edit-first-name').value = learnerData.firstName;
      if(el('edit-last-name'))  el('edit-last-name').value  = learnerData.lastName;
      if(el('edit-email'))      el('edit-email').value      = learnerData.email;
      if(el('edit-cellphone'))  el('edit-cellphone').value  = learnerData.cellphone;
      clearMsg('edit-profile-error');
      if(el('modal-profile')) el('modal-profile').classList.remove('hidden');
    });
  });
}

if(el('cancel-profile')) {
  el('cancel-profile').addEventListener('click', () => {
    if(el('modal-profile')) el('modal-profile').classList.add('hidden');
  });
}

if(el('edit-cellphone')) el('edit-cellphone').addEventListener('input', function() { formatPhoneInput(this); });

if(el('save-profile')) {
  el('save-profile').addEventListener('click', async () => {
    clearMsg('edit-profile-error');
    const firstName = (el('edit-first-name') ? el('edit-first-name').value : '').trim();
    const lastName  = (el('edit-last-name')  ? el('edit-last-name').value  : '').trim();
    const email     = (el('edit-email')       ? el('edit-email').value      : '').trim();
    const cellphone = (el('edit-cellphone')   ? el('edit-cellphone').value  : '').trim();
    if (!firstName || !lastName || !email || !cellphone) {
      showErr('edit-profile-error', 'All fields are required.'); return;
    }
    const phV = validateSAPhone(cellphone);
    if (!phV.isValid) { showErr('edit-profile-error', phV.error); return; }
    const body = new FormData();
    body.append('first_name', firstName);
    body.append('last_name',  lastName);
    body.append('email',      email);
    body.append('cellphone',  phV.cleanPhone);
    try {
      const res  = await fetch('/edit-profile', { method: 'POST', body });
      const data = await res.json();
      if (data.success) {
        if(el('modal-profile')) el('modal-profile').classList.add('hidden');
        location.reload();
      } else {
        showErr('edit-profile-error', data.error);
      }
    } catch(e) { showErr('edit-profile-error', 'Network error.'); }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   EDIT PARENT
══════════════════════════════════════════════════════════════════ */
if(el('btn-edit-parent')) {
  el('btn-edit-parent').addEventListener('click', () => {
    openPasswordGate('Confirm to Edit Parent Details', () => {
      if(el('edit-p-rel'))   el('edit-p-rel').value   = parentData.relationship;
      if(el('edit-p-name'))  el('edit-p-name').value  = parentData.name;
      if(el('edit-p-id'))    el('edit-p-id').value    = parentData.idNumber;
      if(el('edit-p-phone')) el('edit-p-phone').value = parentData.phone;
      if(el('edit-p-email')) el('edit-p-email').value = parentData.email;
      if(el('modal-parent')) el('modal-parent').classList.remove('hidden');
    });
  });
}

if(el('cancel-parent')) {
  el('cancel-parent').addEventListener('click', () => {
    if(el('modal-parent')) el('modal-parent').classList.add('hidden');
  });
}

if(el('edit-p-id')) {
  el('edit-p-id').addEventListener('input', function() {
    formatIdInput(this);
    const v = validateSAID(this.value);
    if (this.value && !v.isValid) showErr('edit-p-id-error', v.error);
    else clearMsg('edit-p-id-error');
  });
}

if(el('edit-p-phone')) {
  el('edit-p-phone').addEventListener('input', function() {
    formatPhoneInput(this);
    const v = validateSAPhone(this.value);
    if (this.value && !v.isValid) showErr('edit-p-phone-error', v.error);
    else clearMsg('edit-p-phone-error');
  });
}

if(el('save-parent')) {
  el('save-parent').addEventListener('click', async () => {
    clearMsg('edit-parent-error');
    const idV = validateSAID(el('edit-p-id') ? el('edit-p-id').value : '');
    if (!idV.isValid) { showErr('edit-parent-error', idV.error); return; }
    const phV = validateSAPhone(el('edit-p-phone') ? el('edit-p-phone').value : '');
    if (!phV.isValid) { showErr('edit-parent-error', phV.error); return; }
    const body = new FormData();
    body.append('relationship', el('edit-p-rel')   ? el('edit-p-rel').value   : '');
    body.append('name',         el('edit-p-name')  ? el('edit-p-name').value  : '');
    body.append('idNumber',     idV.cleanID);
    body.append('phone',        phV.cleanPhone);
    body.append('email',        el('edit-p-email') ? el('edit-p-email').value : '');
    try {
      const res  = await fetch('/edit-parent', { method: 'POST', body });
      const data = await res.json();
      if (data.success) { if(el('modal-parent')) el('modal-parent').classList.add('hidden'); location.reload(); }
      else showErr('edit-parent-error', data.error);
    } catch(e) { showErr('edit-parent-error', 'Network error.'); }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   DELETE APPLICATION
══════════════════════════════════════════════════════════════════ */
const btnDeleteApp = el('btn-delete-app');
if (btnDeleteApp) {
  btnDeleteApp.addEventListener('click', () => {
    if(el('delete-app-pw')) el('delete-app-pw').value = '';
    clearMsg('delete-app-error');
    if(el('modal-delete-app')) el('modal-delete-app').classList.remove('hidden');
    setTimeout(() => { if(el('delete-app-pw')) el('delete-app-pw').focus(); }, 100);
  });
}

if (el('cancel-delete-app')) {
  el('cancel-delete-app').addEventListener('click', () => {
    if(el('modal-delete-app')) el('modal-delete-app').classList.add('hidden');
  });
}

if (el('confirm-delete-app')) {
  el('confirm-delete-app').addEventListener('click', async () => {
    const password = el('delete-app-pw') ? el('delete-app-pw').value : '';
    if (!password) { showErr('delete-app-error', 'Please enter your password.'); return; }
    const body = new FormData();
    body.append('password', password);
    try {
      const res  = await fetch('/delete-application', { method: 'POST', body });
      const data = await res.json();
      if (data.success) {
        // Full data purge — redirect to landing
        window.location.href = '/';
      } else {
        showErr('delete-app-error', data.error || 'Incorrect password.');
      }
    } catch(e) { showErr('delete-app-error', 'Network error.'); }
  });
}

if (el('modal-delete-app')) {
  el('modal-delete-app').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
}
if (el('toggle-delete-pw') && el('delete-app-pw')) setupPasswordToggle('delete-app-pw','toggle-delete-pw');

/* ═══════════════════════════════════════════════════════════════════
   APPLY NEXT YEAR
══════════════════════════════════════════════════════════════════ */
const btnApplyNext = el('btn-apply-next');
if (btnApplyNext) {
  btnApplyNext.addEventListener('click', async () => {
    if (!confirm('Apply for next academic year?')) return;
    try {
      const res  = await fetch('/apply-next-year', { method: 'POST' });
      const data = await res.json();
      if (data.success) { alert(data.message); location.reload(); }
      else alert(data.error);
    } catch(e) { alert('Network error.'); }
  });
}

/* ═══════════════════════════════════════════════════════════════════
   UPLOAD DOCUMENT
══════════════════════════════════════════════════════════════════ */
if(el('uploadDocument')) {
  el('uploadDocument').addEventListener('click', async () => {
    clearMsg('upload-msg'); clearMsg('upload-error');
    const fileInput = el('fileInput');
    const docType   = el('documentType') ? el('documentType').value : '';
    if (!fileInput || !fileInput.files.length) { showErr('upload-error', 'Please select a file.'); return; }
    if (!docType) { showErr('upload-error', 'Please select a document type.'); return; }
    const body = new FormData();
    body.append('file', fileInput.files[0]);
    body.append('documentType', docType);
    try {
      const res  = await fetch('/upload-document', { method: 'POST', body });
      const data = await res.json();
      if (data.success) { showOk('upload-msg', data.message); setTimeout(() => location.reload(), 1200); }
      else showErr('upload-error', data.error);
    } catch(e) { showErr('upload-error', 'Network error.'); }
  });
}

['modal-profile','modal-parent'].forEach(id => {
  const m = el(id);
  if(m) m.addEventListener('click', function(e){ if(e.target===this) this.classList.add('hidden'); });
});

/* ═══════════════════════════════════════════════════════════════════
   CLASS INFO
══════════════════════════════════════════════════════════════════ */
async function loadClassInfo() {
  try {
    const res  = await fetch('/my-class-info');
    const data = await res.json();
    if(el('class-loading')) el('class-loading').style.display = 'none';
    if (!data.success || !data.assigned) {
      if(el('class-not-assigned')) el('class-not-assigned').style.display = 'block';
      if (data.grade && el('class-grade')) el('class-grade').textContent = data.class_name || ('Grade ' + data.grade);
      return;
    }
    if(el('class-grade'))   el('class-grade').textContent   = data.class_name || ('Grade ' + data.grade);
    if(el('class-content')) el('class-content').style.display = 'block';
    if(el('teacher1-name')) el('teacher1-name').textContent = data.teacher || '—';
    if(el('rep1-name'))     el('rep1-name').textContent     = data.rep1    || 'Not assigned';
    if(el('rep2-name'))     el('rep2-name').textContent     = data.rep2    || 'Not assigned';
    function setPhoto(imgId, emojiId, url) {
      const img = el(imgId), emoji = el(emojiId);
      if (img && emoji && url) { img.src = url; img.style.display = 'block'; emoji.style.display = 'none'; }
    }
    setPhoto('teacher-photo','teacher-emoji', data.teacher_photo);
    setPhoto('rep1-photo',   'rep1-emoji',    data.rep1_photo);
    setPhoto('rep2-photo',   'rep2-emoji',    data.rep2_photo);
    if (data.updated && el('class-updated')) el('class-updated').textContent = 'Last updated: ' + data.updated;
  } catch(e) {
    if(el('class-loading')) el('class-loading').textContent = 'Could not load class info.';
  }
}
loadClassInfo();

/* ═══════════════════════════════════════════════════════════════════
   LIVE CHAT — SIYATOP
══════════════════════════════════════════════════════════════════ */
let chatOpen    = false;
let chatLoaded  = false;
let lastMsgId   = 0;
let chatPollTimer = null;
let chatSessionId = null;

const chatBubble  = el('chat-bubble');
const chatPanel   = el('chat-panel');
const chatClose   = el('chat-close');
const chatInput   = el('chat-input');
const chatSend    = el('chat-send');
const chatMsgs    = el('chat-messages');

function appendChatMsg(sender, text, animate) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;' + (sender==='learner'?'justify-content:flex-end':'justify-content:flex-start');
  const bubble = document.createElement('div');
  bubble.style.cssText = 'max-width:80%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.5;word-break:break-word;' +
    (sender==='learner'
      ? 'background:linear-gradient(135deg,#b91c1c,#dc2626);color:#fff;border-bottom-right-radius:4px'
      : sender==='admin'
        ? 'background:#1e293b;color:#f1f5f9;border-bottom-left-radius:4px'
        : 'background:#f1f5f9;color:#1e293b;border-bottom-left-radius:4px');
  bubble.textContent = text;
  wrap.appendChild(bubble);
  chatMsgs.appendChild(wrap);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

async function loadChat() {
  if (chatLoaded) return;
  chatLoaded = true;
  chatMsgs.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px">Loading…</div>';
  try {
    const res  = await fetch('/chat/start', { method: 'POST' });
    const data = await res.json();
    chatMsgs.innerHTML = '';
    chatSessionId = data.session_id;
    (data.messages || []).forEach(m => { appendChatMsg(m.sender, m.message); if(m.id>lastMsgId) lastMsgId=m.id; });
    updateChatStatus(data.status);
    startChatPoll();
  } catch(e) {
    chatMsgs.innerHTML = '<div style="color:#b91c1c;font-size:13px;padding:10px">Could not connect. Please try again.</div>';
  }
}

function updateChatStatus(status) {
  const lbl = el('chat-status-label');
  if (!lbl) return;
  if (status === 'bot')     lbl.textContent = 'Virtual Assistant';
  else if (status === 'waiting') lbl.textContent = '⏳ Waiting for admin…';
  else if (status === 'active')  lbl.textContent = '🟢 Admin connected';
  else lbl.textContent = 'Chat closed';
}

function startChatPoll() {
  if (chatPollTimer) clearInterval(chatPollTimer);
  chatPollTimer = setInterval(async () => {
    if (!chatOpen || !chatSessionId) return;
    try {
      const res  = await fetch('/chat/messages?after=' + lastMsgId);
      const data = await res.json();
      (data.messages || []).forEach(m => {
        if (m.id > lastMsgId) { lastMsgId = m.id; appendChatMsg(m.sender, m.message, true); }
      });
      updateChatStatus(data.status);
    } catch(e) {}
  }, 2500);
}

async function sendChatMessage() {
  const txt = chatInput ? chatInput.value.trim() : '';
  if (!txt) return;
  chatInput.value = '';
  appendChatMsg('learner', txt);
  const body = new FormData();
  body.append('message', txt);
  try {
    const res  = await fetch('/chat/send', { method: 'POST', body });
    const data = await res.json();
    if (data.bot_reply) appendChatMsg('bot', data.bot_reply);
    updateChatStatus(data.status);
  } catch(e) { appendChatMsg('bot', 'Sorry, there was a connection error. Please try again.'); }
}

if (chatBubble) {
  chatBubble.addEventListener('click', () => {
    chatOpen = !chatOpen;
    if (chatPanel) chatPanel.style.display = chatOpen ? 'flex' : 'none';
    if (chatOpen) { loadChat(); if(chatInput) chatInput.focus(); }
    else if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  });
}

if (chatClose) {
  chatClose.addEventListener('click', () => {
    chatOpen = false;
    if (chatPanel) chatPanel.style.display = 'none';
    if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
  });
}

if (chatSend) chatSend.addEventListener('click', sendChatMessage);
if (chatInput) {
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
}

// Poll for unread indicator on bubble
setInterval(async () => {
  if (chatOpen) return;
  try {
    const res  = await fetch('/chat/messages?after=' + lastMsgId);
    const data = await res.json();
    const hasNew = (data.messages||[]).some(m => m.sender !== 'learner');
    const dot = el('chat-unread-dot');
    if (dot) dot.style.display = hasNew ? 'block' : 'none';
  } catch(e) {}
}, 5000);

}); // end DOMContentLoaded
