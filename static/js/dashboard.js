document.addEventListener('DOMContentLoaded', function() {

function el(id) { return document.getElementById(id); }
function showErr(id, msg)  { const e = el(id); if(e){ e.textContent = msg; e.className = 'error'; } }
function showOk(id, msg)   { const e = el(id); if(e){ e.textContent = msg; e.className = 'success'; } }
function clearMsg(id)      { const e = el(id); if(e) e.textContent = ''; }

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
    } catch(e) {
      showErr('pw-gate-error', 'Network error. Please try again.');
    }
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

if(el('btn-edit-profile')) {
  el('btn-edit-profile').addEventListener('click', () => {
    openPasswordGate('Confirm to Edit Profile', () => {
      if(el('modal-profile')) el('modal-profile').classList.remove('hidden');
    });
  });
}

if(el('cancel-profile')) {
  el('cancel-profile').addEventListener('click', () => {
    if(el('modal-profile')) el('modal-profile').classList.add('hidden');
  });
}

if(el('save-profile')) {
  el('save-profile').addEventListener('click', async () => {
    const cellphone = el('edit-cellphone') ? el('edit-cellphone').value : '';
    const v = validateSAPhone(cellphone);
    if (!v.isValid) { showErr('edit-cellphone-error', v.error); return; }
    const body = new FormData();
    body.append('cellphone', v.cleanPhone);
    try {
      const res  = await fetch('/edit-profile', { method: 'POST', body });
      const data = await res.json();
      if (data.success) {
        if(el('modal-profile')) el('modal-profile').classList.add('hidden');
        location.reload();
      } else {
        showErr('edit-cellphone-error', data.error);
      }
    } catch(e) { showErr('edit-cellphone-error', 'Network error.'); }
  });
}

if(el('edit-cellphone')) el('edit-cellphone').addEventListener('input', function() { formatPhoneInput(this); });

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
    body.append('relationship', el('edit-p-rel') ? el('edit-p-rel').value : '');
    body.append('name',         el('edit-p-name') ? el('edit-p-name').value : '');
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
        if(el('modal-delete-app')) el('modal-delete-app').classList.add('hidden');
        location.reload();
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

if (el('toggle-delete-pw') && el('delete-app-pw')) setupPasswordToggle('delete-app-pw', 'toggle-delete-pw');

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

['modal-profile', 'modal-parent'].forEach(id => {
  const m = el(id);
  if(m) m.addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
});

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
    if (data.updated && el('class-updated')) {
      el('class-updated').textContent = 'Last updated: ' + data.updated;
    }
  } catch(e) {
    if(el('class-loading')) el('class-loading').textContent = 'Could not load class info.';
  }
}

loadClassInfo();

}); // end DOMContentLoaded
