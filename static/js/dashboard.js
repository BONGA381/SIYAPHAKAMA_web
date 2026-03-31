document.addEventListener('DOMContentLoaded', function () {

/* ── Helpers ────────────────────────────────────────────────────── */
function el(id) { return document.getElementById(id); }
function showErr(id, msg)  { const e=el(id); if(e){e.textContent=msg; e.className='error';} }
function showOk(id, msg)   { const e=el(id); if(e){e.textContent=msg; e.className='success';} }
function clearMsg(id)      { const e=el(id); if(e) e.textContent=''; }

/* ═══════════════════════════════════════════════════════════════════
   PASSWORD GATE
══════════════════════════════════════════════════════════════════ */
let pwGateCallback = null;

function openPasswordGate(title, onConfirm) {
  pwGateCallback = onConfirm;
  if(el('pw-gate-title'))  el('pw-gate-title').textContent = title || 'Confirm Identity';
  if(el('pw-gate-input'))  el('pw-gate-input').value = '';
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
    } catch(e) { showErr('pw-gate-error', 'Network error. Please try again.'); }
  });
}

if(el('pw-gate-cancel')) el('pw-gate-cancel').addEventListener('click', closePasswordGate);
if(el('pw-gate-input')) {
  el('pw-gate-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && el('pw-gate-confirm')) el('pw-gate-confirm').click();
  });
}
if(el('toggle-pw-gate') && el('pw-gate-input')) setupPasswordToggle('pw-gate-input', 'toggle-pw-gate');
if(el('modal-password-gate')) {
  el('modal-password-gate').addEventListener('click', function(e) {
    if (e.target === this) closePasswordGate();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   EDIT PROFILE — name, surname, email, cellphone
══════════════════════════════════════════════════════════════════ */
if(el('btn-edit-profile')) {
  el('btn-edit-profile').addEventListener('click', () => {
    openPasswordGate('Confirm to Edit Profile', () => {
      // Pre-fill with current data
      if(el('edit-first-name')) el('edit-first-name').value = learnerData.firstName;
      if(el('edit-last-name'))  el('edit-last-name').value  = learnerData.lastName;
      if(el('edit-email'))      el('edit-email').value      = learnerData.email;
      if(el('edit-cellphone'))  el('edit-cellphone').value  = learnerData.cellphone;
      clearMsg('edit-profile-error');
      if(el('modal-profile')) el('modal-profile').classList.remove('hidden');
      setTimeout(() => { if(el('edit-first-name')) el('edit-first-name').focus(); }, 100);
    });
  });
}

if(el('cancel-profile')) {
  el('cancel-profile').addEventListener('click', () => {
    if(el('modal-profile')) el('modal-profile').classList.add('hidden');
  });
}

if(el('edit-cellphone')) {
  el('edit-cellphone').addEventListener('input', function () { formatPhoneInput(this); });
}

if(el('save-profile')) {
  el('save-profile').addEventListener('click', async () => {
    clearMsg('edit-profile-error');
    const firstName = el('edit-first-name') ? el('edit-first-name').value.trim() : '';
    const lastName  = el('edit-last-name')  ? el('edit-last-name').value.trim()  : '';
    const email     = el('edit-email')      ? el('edit-email').value.trim()      : '';
    const cellphone = el('edit-cellphone')  ? el('edit-cellphone').value.trim()  : '';

    if (!firstName || !lastName) { showErr('edit-profile-error', 'First name and last name are required.'); return; }
    if (!email || !email.includes('@')) { showErr('edit-profile-error', 'A valid email address is required.'); return; }
    const phV = validateSAPhone(cellphone);
    if (!phV.isValid) { showErr('edit-profile-error', phV.error); return; }

    const body = new FormData();
    body.append('firstName', firstName);
    body.append('lastName',  lastName);
    body.append('email',     email);
    body.append('cellphone', phV.cleanPhone);

    try {
      const res  = await fetch('/edit-profile', { method: 'POST', body });
      const data = await res.json();
      if (data.success) {
        if(el('modal-profile')) el('modal-profile').classList.add('hidden');
        // Update on-screen values without full reload
        learnerData.firstName = firstName;
        learnerData.lastName  = lastName;
        learnerData.email     = email;
        learnerData.cellphone = phV.cleanPhone;
        if(el('ps-name'))  el('ps-name').textContent  = firstName + ' ' + lastName;
        if(el('ps-email')) el('ps-email').textContent = email;
        if(el('ps-cell'))  el('ps-cell').textContent  = phV.cleanPhone;
        showOk('profile-msg', '✅ Profile updated successfully!');
        setTimeout(() => clearMsg('profile-msg'), 3000);
      } else {
        showErr('edit-profile-error', data.error || 'Could not save changes.');
      }
    } catch(e) { showErr('edit-profile-error', 'Network error.'); }
  });
}

if(el('modal-profile')) {
  el('modal-profile').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
}

/* ═══════════════════════════════════════════════════════════════════
   EDIT PARENT — all fields
══════════════════════════════════════════════════════════════════ */
if(el('btn-edit-parent')) {
  el('btn-edit-parent').addEventListener('click', () => {
    openPasswordGate('Confirm to Edit Parent Details', () => {
      if(el('edit-p-rel'))   el('edit-p-rel').value   = parentData.relationship;
      if(el('edit-p-name'))  el('edit-p-name').value  = parentData.name;
      if(el('edit-p-id'))    el('edit-p-id').value    = parentData.idNumber;
      if(el('edit-p-phone')) el('edit-p-phone').value = parentData.phone;
      if(el('edit-p-email')) el('edit-p-email').value = parentData.email;
      clearMsg('edit-parent-error');
      clearMsg('edit-p-id-error');
      clearMsg('edit-p-phone-error');
      if(el('modal-parent')) el('modal-parent').classList.remove('hidden');
      setTimeout(() => { if(el('edit-p-rel')) el('edit-p-rel').focus(); }, 100);
    });
  });
}

if(el('cancel-parent')) {
  el('cancel-parent').addEventListener('click', () => {
    if(el('modal-parent')) el('modal-parent').classList.add('hidden');
  });
}

if(el('edit-p-id')) {
  el('edit-p-id').addEventListener('input', function () {
    formatIdInput(this);
    const v = validateSAID(this.value);
    if (this.value && !v.isValid) showErr('edit-p-id-error', v.error);
    else clearMsg('edit-p-id-error');
  });
}

if(el('edit-p-phone')) {
  el('edit-p-phone').addEventListener('input', function () {
    formatPhoneInput(this);
    const v = validateSAPhone(this.value);
    if (this.value && !v.isValid) showErr('edit-p-phone-error', v.error);
    else clearMsg('edit-p-phone-error');
  });
}

if(el('save-parent')) {
  el('save-parent').addEventListener('click', async () => {
    clearMsg('edit-parent-error');
    const rel   = el('edit-p-rel')   ? el('edit-p-rel').value   : '';
    const name  = el('edit-p-name')  ? el('edit-p-name').value.trim()  : '';
    const idVal = el('edit-p-id')    ? el('edit-p-id').value    : '';
    const phone = el('edit-p-phone') ? el('edit-p-phone').value : '';
    const email = el('edit-p-email') ? el('edit-p-email').value.trim() : '';

    if (!rel || !name) { showErr('edit-parent-error', 'Relationship and name are required.'); return; }
    const idV = validateSAID(idVal);
    if (!idV.isValid) { showErr('edit-parent-error', 'Parent ID: ' + idV.error); return; }
    const phV = validateSAPhone(phone);
    if (!phV.isValid) { showErr('edit-parent-error', 'Phone: ' + phV.error); return; }

    const body = new FormData();
    body.append('relationship', rel);
    body.append('name',        name);
    body.append('idNumber',    idV.cleanID);
    body.append('phone',       phV.cleanPhone);
    body.append('email',       email);

    try {
      const res  = await fetch('/edit-parent', { method: 'POST', body });
      const data = await res.json();
      if (data.success) {
        if(el('modal-parent')) el('modal-parent').classList.add('hidden');
        // Update displayed values
        parentData.relationship = rel;
        parentData.name         = name;
        parentData.idNumber     = idV.cleanID;
        parentData.phone        = phV.cleanPhone;
        parentData.email        = email;
        if(el('pd-rel'))   el('pd-rel').textContent   = rel;
        if(el('pd-name'))  el('pd-name').textContent  = name;
        if(el('pd-id'))    el('pd-id').textContent    = idV.cleanID;
        if(el('pd-phone')) el('pd-phone').textContent = phV.cleanPhone;
        if(el('pd-email')) el('pd-email').textContent = email || '—';
        showOk('profile-msg', '✅ Parent details updated successfully!');
        setTimeout(() => clearMsg('profile-msg'), 3000);
      } else {
        showErr('edit-parent-error', data.error || 'Could not save changes.');
      }
    } catch(e) { showErr('edit-parent-error', 'Network error.'); }
  });
}

if(el('modal-parent')) {
  el('modal-parent').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
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

if(el('cancel-delete-app')) {
  el('cancel-delete-app').addEventListener('click', () => {
    if(el('modal-delete-app')) el('modal-delete-app').classList.add('hidden');
  });
}

if(el('confirm-delete-app')) {
  el('confirm-delete-app').addEventListener('click', async () => {
    const password = el('delete-app-pw') ? el('delete-app-pw').value : '';
    if (!password) { showErr('delete-app-error', 'Please enter your password.'); return; }
    const body = new FormData();
    body.append('password', password);
    try {
      const res  = await fetch('/delete-application', { method: 'POST', body });
      const data = await res.json();
      if (data.success) {
        if(el('modal-delete-app')) el('modal-delete-app').classList.add('hidden');
        alert('Your application and all data have been deleted. You will be redirected to re-register.');
        window.location.href = '/';
      } else {
        showErr('delete-app-error', data.error || 'Incorrect password.');
      }
    } catch(e) { showErr('delete-app-error', 'Network error.'); }
  });
}

if(el('modal-delete-app')) {
  el('modal-delete-app').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
}

if(el('toggle-delete-pw') && el('delete-app-pw')) setupPasswordToggle('delete-app-pw', 'toggle-delete-pw');

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
   DOCUMENT UPLOAD
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
      if (data.success) {
        showOk('upload-msg', data.message);
        setTimeout(() => location.reload(), 1200);
      } else {
        showErr('upload-error', data.error);
      }
    } catch(e) { showErr('upload-error', 'Network error.'); }
  });
}

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
    // Show ID photos where available
    function setPhoto(imgId, emojiId, url) {
      const img   = el(imgId);
      const emoji = el(emojiId);
      if (img && emoji && url) {
        img.src             = url;
        img.style.display   = 'block';
        emoji.style.display = 'none';
      }
    }
    setPhoto('teacher-photo-img', 'teacher-photo-emoji', data.teacher_photo);
    setPhoto('rep1-photo-img',    'rep1-photo-emoji',    data.rep1_photo);
    setPhoto('rep2-photo-img',    'rep2-photo-emoji',    data.rep2_photo);
    if (data.updated && el('class-updated')) {
      el('class-updated').textContent = 'Last updated: ' + data.updated;
    }
  } catch(e) {
    if(el('class-loading')) el('class-loading').textContent = 'Could not load class info.';
  }
}
loadClassInfo();

/* ═══════════════════════════════════════════════════════════════════
   LIVE CHAT — SIYATOP
══════════════════════════════════════════════════════════════════ */
let chatOpen       = false;
let chatLoaded     = false;
let lastMsgTime    = '';
let chatPollTimer  = null;

const chatBubble   = el('chat-bubble');
const chatPanel    = el('chat-panel');
const chatClose    = el('chat-close');
const chatInput    = el('chat-input');
const chatSend     = el('chat-send');
const chatMessages = el('chat-messages');
const chatBadge    = el('chat-badge');
const chatStatus   = el('chat-status-label');

function renderMessage(msg) {
  const wrap = document.createElement('div');
  const isBot    = msg.sender === 'bot';
  const isAdmin  = msg.sender === 'admin';
  const isLearner= msg.sender === 'learner';

  wrap.style.cssText = `display:flex;flex-direction:column;align-items:${isLearner ? 'flex-end' : 'flex-start'};`;
  const bubble = document.createElement('div');
  bubble.style.cssText = `
    max-width:82%;padding:9px 13px;border-radius:${isLearner ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};
    font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;
    background:${isLearner ? '#b91c1c' : isAdmin ? '#1e293b' : '#e2e8f0'};
    color:${isLearner ? '#fff' : isAdmin ? '#f1f5f9' : '#1e293b'};
    ${isAdmin ? 'border:1px solid #334155;' : ''}
  `;

  if (isBot) {
    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:#64748b;margin-bottom:2px;font-weight:700';
    label.textContent = '🤖 SIYATOP';
    wrap.appendChild(label);
  } else if (isAdmin) {
    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;color:#475569;margin-bottom:2px;font-weight:700';
    label.textContent = '🏫 Admin';
    wrap.appendChild(label);
  }

  bubble.textContent = msg.message;
  wrap.appendChild(bubble);

  const time = document.createElement('div');
  time.style.cssText = 'font-size:10px;color:#94a3b8;margin-top:3px';
  time.textContent = (msg.sent_at || '').slice(11, 16);
  wrap.appendChild(time);

  chatMessages.appendChild(wrap);
}

function renderMessages(messages) {
  chatMessages.innerHTML = '';
  messages.forEach(renderMessage);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (messages.length > 0) {
    lastMsgTime = messages[messages.length - 1].sent_at || '';
  }
}

function updateChatStatus(sess) {
  if (!chatStatus) return;
  if (sess.status === 'waiting') {
    chatStatus.textContent = '⏳ Waiting for admin…';
  } else if (sess.status === 'active') {
    chatStatus.textContent = '✅ Connected to Admin';
  } else {
    chatStatus.textContent = 'Virtual Assistant • Online';
  }
}

async function loadChatSession() {
  try {
    const res  = await fetch('/chat/session');
    const data = await res.json();
    if (data.success) {
      renderMessages(data.messages);
      updateChatStatus(data.session);
      chatLoaded = true;
    }
  } catch(e) { console.error('Chat load error:', e); }
}

async function pollChat() {
  if (!chatOpen || !chatLoaded) return;
  try {
    const url  = '/chat/poll' + (lastMsgTime ? '?since=' + encodeURIComponent(lastMsgTime) : '');
    const res  = await fetch(url);
    const data = await res.json();
    if (data.success && data.messages.length > 0) {
      data.messages.forEach(msg => {
        if (msg.sent_at > lastMsgTime) renderMessage(msg);
      });
      lastMsgTime = data.messages[data.messages.length - 1].sent_at || lastMsgTime;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      updateChatStatus(data.session);
    }
  } catch(e) {}
}

async function sendChatMessage() {
  const msg = chatInput ? chatInput.value.trim() : '';
  if (!msg) return;
  chatInput.value = '';
  const body = new FormData();
  body.append('message', msg);
  try {
    const res  = await fetch('/chat/send', { method: 'POST', body });
    const data = await res.json();
    if (data.success) {
      renderMessages(data.messages);
      updateChatStatus(data.session);
    }
  } catch(e) { console.error('Chat send error:', e); }
}

if (chatBubble) {
  chatBubble.addEventListener('click', async () => {
    chatOpen = !chatOpen;
    if (chatPanel) chatPanel.style.display = chatOpen ? 'flex' : 'none';
    if (chatOpen) {
      if (!chatLoaded) await loadChatSession();
      chatMessages.scrollTop = chatMessages.scrollHeight;
      if (chatInput) chatInput.focus();
      if (chatBadge) chatBadge.style.display = 'none';
      clearInterval(chatPollTimer);
      chatPollTimer = setInterval(pollChat, 4000);
    } else {
      clearInterval(chatPollTimer);
    }
  });
}

if (chatClose) {
  chatClose.addEventListener('click', () => {
    chatOpen = false;
    if (chatPanel) chatPanel.style.display = 'none';
    clearInterval(chatPollTimer);
  });
}

if (chatSend) {
  chatSend.addEventListener('click', sendChatMessage);
}

if (chatInput) {
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChatMessage();
  });
}

}); // end DOMContentLoaded
