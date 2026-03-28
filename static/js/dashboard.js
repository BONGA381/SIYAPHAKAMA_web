function el(id) { return document.getElementById(id); }
function showErr(id, msg)  { const e = el(id); if(e){ e.textContent = msg; e.className = 'error'; } }
function showOk(id, msg)   { const e = el(id); if(e){ e.textContent = msg; e.className = 'success'; } }
function clearMsg(id)      { const e = el(id); if(e) e.textContent = ''; }

let pwGateCallback = null;

function openPasswordGate(title, onConfirm) {
  pwGateCallback = onConfirm;
  el('pw-gate-title').textContent = title || 'Confirm Identity';
  el('pw-gate-input').value = '';
  clearMsg('pw-gate-error');
  el('modal-password-gate').classList.remove('hidden');
  setTimeout(() => el('pw-gate-input').focus(), 100);
}

function closePasswordGate() {
  el('modal-password-gate').classList.add('hidden');
  pwGateCallback = null;
}

el('pw-gate-confirm').addEventListener('click', async () => {
  const password = el('pw-gate-input').value;
  if (!password) { showErr('pw-gate-error', 'Please enter your password.'); return; }
  const body = new FormData();
  body.append('password', password);
  const res  = await fetch('/verify-learner-password', { method: 'POST', body });
  const data = await res.json();
  if (data.success) {
    closePasswordGate();
    if (pwGateCallback) pwGateCallback(password);
  } else {
    showErr('pw-gate-error', data.error || 'Incorrect password.');
  }
});

el('pw-gate-cancel').addEventListener('click', closePasswordGate);

el('pw-gate-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') el('pw-gate-confirm').click();
});

setupPasswordToggle('pw-gate-input', 'toggle-pw-gate');

el('modal-password-gate').addEventListener('click', function(e) {
  if (e.target === this) closePasswordGate();
});

el('btn-edit-profile').addEventListener('click', () => {
  openPasswordGate('Confirm to Edit Profile', () => {
    el('modal-profile').classList.remove('hidden');
  });
});

el('cancel-profile').addEventListener('click', () => {
  el('modal-profile').classList.add('hidden');
});

el('save-profile').addEventListener('click', async () => {
  const cellphone = el('edit-cellphone').value;
  const v = validateSAPhone(cellphone);
  if (!v.isValid) { showErr('edit-cellphone-error', v.error); return; }
  const body = new FormData();
  body.append('cellphone', v.cleanPhone);
  const res  = await fetch('/edit-profile', { method: 'POST', body });
  const data = await res.json();
  if (data.success) {
    el('modal-profile').classList.add('hidden');
    location.reload();
  } else {
    showErr('edit-cellphone-error', data.error);
  }
});

el('edit-cellphone').addEventListener('input', function() { formatPhoneInput(this); });

el('btn-edit-parent').addEventListener('click', () => {
  openPasswordGate('Confirm to Edit Parent Details', () => {
    el('edit-p-rel').value   = parentData.relationship;
    el('edit-p-name').value  = parentData.name;
    el('edit-p-id').value    = parentData.idNumber;
    el('edit-p-phone').value = parentData.phone;
    el('edit-p-email').value = parentData.email;
    el('modal-parent').classList.remove('hidden');
  });
});

el('cancel-parent').addEventListener('click', () => {
  el('modal-parent').classList.add('hidden');
});

el('edit-p-id').addEventListener('input', function() {
  formatIdInput(this);
  const v = validateSAID(this.value);
  if (this.value && !v.isValid) showErr('edit-p-id-error', v.error);
  else clearMsg('edit-p-id-error');
});

el('edit-p-phone').addEventListener('input', function() {
  formatPhoneInput(this);
  const v = validateSAPhone(this.value);
  if (this.value && !v.isValid) showErr('edit-p-phone-error', v.error);
  else clearMsg('edit-p-phone-error');
});

el('save-parent').addEventListener('click', async () => {
  clearMsg('edit-parent-error');
  const idV = validateSAID(el('edit-p-id').value);
  if (!idV.isValid) { showErr('edit-parent-error', idV.error); return; }
  const phV = validateSAPhone(el('edit-p-phone').value);
  if (!phV.isValid) { showErr('edit-parent-error', phV.error); return; }
  const body = new FormData();
  body.append('relationship', el('edit-p-rel').value);
  body.append('name',         el('edit-p-name').value);
  body.append('idNumber',     idV.cleanID);
  body.append('phone',        phV.cleanPhone);
  body.append('email',        el('edit-p-email').value);
  const res  = await fetch('/edit-parent', { method: 'POST', body });
  const data = await res.json();
  if (data.success) { el('modal-parent').classList.add('hidden'); location.reload(); }
  else showErr('edit-parent-error', data.error);
});

const btnDeleteApp = el('btn-delete-app');
if (btnDeleteApp) {
  btnDeleteApp.addEventListener('click', () => {
    el('delete-app-pw').value = '';
    clearMsg('delete-app-error');
    el('modal-delete-app').classList.remove('hidden');
    setTimeout(() => el('delete-app-pw').focus(), 100);
  });
}

if (el('cancel-delete-app')) {
  el('cancel-delete-app').addEventListener('click', () => {
    el('modal-delete-app').classList.add('hidden');
  });
}

if (el('confirm-delete-app')) {
  el('confirm-delete-app').addEventListener('click', async () => {
    const password = el('delete-app-pw').value;
    if (!password) { showErr('delete-app-error', 'Please enter your password.'); return; }
    const body = new FormData();
    body.append('password', password);
    const res  = await fetch('/delete-application', { method: 'POST', body });
    const data = await res.json();
    if (data.success) {
      el('modal-delete-app').classList.add('hidden');
      location.reload();
    } else {
      showErr('delete-app-error', data.error || 'Incorrect password.');
    }
  });
}

if (el('modal-delete-app')) {
  el('modal-delete-app').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
}

if (el('toggle-delete-pw')) setupPasswordToggle('delete-app-pw', 'toggle-delete-pw');

const btnApplyNext = el('btn-apply-next');
if (btnApplyNext) {
  btnApplyNext.addEventListener('click', async () => {
    if (!confirm('Apply for next academic year?')) return;
    const res  = await fetch('/apply-next-year', { method: 'POST' });
    const data = await res.json();
    if (data.success) { alert(data.message); location.reload(); }
    else alert(data.error);
  });
}

el('uploadDocument').addEventListener('click', async () => {
  clearMsg('upload-msg'); clearMsg('upload-error');
  const fileInput = el('fileInput');
  const docType   = el('documentType').value;
  if (!fileInput.files.length) { showErr('upload-error', 'Please select a file.'); return; }
  if (!docType)                 { showErr('upload-error', 'Please select a document type.'); return; }
  const body = new FormData();
  body.append('file', fileInput.files[0]);
  body.append('documentType', docType);
  const res  = await fetch('/upload-document', { method: 'POST', body });
  const data = await res.json();
  if (data.success) {
    showOk('upload-msg', data.message);
    setTimeout(() => location.reload(), 1200);
  } else {
    showErr('upload-error', data.error);
  }
});

['modal-profile', 'modal-parent'].forEach(id => {
  el(id).addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });
});

async function loadClassInfo() {
  try {
    const res  = await fetch('/my-class-info');
    const data = await res.json();
    el('class-loading').style.display = 'none';
    if (!data.success || !data.assigned) {
      el('class-not-assigned').style.display = 'block';
      if (data.grade) el('class-grade').textContent = data.class_name || ('Grade ' + data.grade);
      return;
    }
    el('class-grade').textContent = data.class_name || ('Grade ' + data.grade);
    el('class-content').style.display = 'block';
    el('teacher1-name').textContent = data.teacher || '—';
    el('rep1-name').textContent     = data.rep1    || 'Not assigned';
    el('rep2-name').textContent     = data.rep2    || 'Not assigned';
    if (data.updated) {
      el('class-updated').textContent = `Last updated: ${data.updated}`;
    }
  } catch(e) {
    el('class-loading').textContent = 'Could not load class info.';
  }
}

loadClassInfo();
