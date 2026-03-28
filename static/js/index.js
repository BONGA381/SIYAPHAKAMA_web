const el    = id => document.getElementById(id);
const pages = ['page-register','page-email-verify','page-login','page-forgot-password','page-otp','page-reset'];

const RECAPTCHA_SITE_KEY = '6LdrQ5csAAAAAGdqhGvkAq4pMs2GSTElT11y2Q9X';
let recaptchaRegisterWidget = null;
let recaptchaLoginWidget    = null;

window.onRecaptchaLoad = function () {
  recaptchaRegisterWidget = grecaptcha.render('recaptcha-register', { sitekey: RECAPTCHA_SITE_KEY });
  recaptchaLoginWidget    = grecaptcha.render('recaptcha-login',    { sitekey: RECAPTCHA_SITE_KEY });
};

function showPage(id){
  pages.forEach(p => el(p).classList.add('hidden'));
  el(id).classList.remove('hidden');
}
function showErr(id, msg){ const e=el(id); if(e){e.textContent=msg; e.style.display='';} }
function clearErr(id)    { const e=el(id); if(e){e.textContent=''; e.style.display='none';} }
function showOk(id, msg) { const e=el(id); if(e){e.textContent=msg; e.className='success';} }
function clearMsg(id)    { const e=el(id); if(e) e.textContent=''; }

if (window.location.hash === '#login') {
  el('tab-register').style.display = '';
  el('tab-login').style.display    = '';
  showPage('page-login');
  history.replaceState(null, '', window.location.pathname);
}

let verifyEmail    = '';
let verifyTimerInt = null;
let verifyResendInt= null;
let pendingIdNumber= '';

const vCodeInputs = Array.from(document.querySelectorAll('#vstep-otp .code-input'));

function vshowStep(stepId){
  ['vstep-otp','vstep-done'].forEach(s => {
    const e = el(s); if(e) e.classList.remove('active');
  });
  const t = el(stepId); if(t) t.classList.add('active');
}

vCodeInputs.forEach((input, i) => {
  input.addEventListener('input', e => {
    const val = e.target.value.replace(/\D/g,'');
    input.value = val ? val[0] : '';
    input.classList.toggle('filled', !!input.value);
    input.classList.remove('error-box');
    el('votp-status').textContent = '';
    if (input.value && i < 5) vCodeInputs[i+1].focus();
    if (vCodeInputs.map(c=>c.value).join('').length === 6)
      handleVerifyEmailOtp(vCodeInputs.map(c=>c.value).join(''));
  });
  input.addEventListener('keydown', e => {
    if (e.key==='Backspace' && !input.value && i>0){
      vCodeInputs[i-1].value=''; vCodeInputs[i-1].classList.remove('filled'); vCodeInputs[i-1].focus();
    }
  });
  input.addEventListener('paste', e => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);
    if (paste.length===6){
      paste.split('').forEach((d,idx)=>{ vCodeInputs[idx].value=d; vCodeInputs[idx].classList.add('filled'); });
      handleVerifyEmailOtp(paste);
    }
  });
});

async function handleVerifyEmailOtp(code){
  vCodeInputs.forEach(c => c.disabled = true);
  setVStatus('Verifying…','info');
  await new Promise(r=>setTimeout(r,500));

  const body = new FormData();
  body.append('idNumber', pendingIdNumber);
  body.append('otp', code);
  const res  = await fetch('/verify-account-otp', {method:'POST', body});
  const data = await res.json();

  if (data.success){
    stopVTimer(); clearVResend();
    el('vemail-confirmed').textContent = verifyEmail;
    vshowStep('vstep-done');
    setTimeout(()=>{
      el('tab-register').style.display = '';
      el('tab-login').style.display    = '';
      showPage('page-login');
      showOk('login-msg','Account verified! Please log in.');
    }, 2000);
  } else {
    setVStatus(data.error, 'err');
    vCodeInputs.forEach(c => c.classList.add('error-box'));
    setTimeout(() => { vClearCodeInputs(); vCodeInputs.forEach(c=>c.disabled=false); vCodeInputs[0].focus(); }, 400);
  }
}

async function handleResendEmailOtp(){
  if (el('vresend-btn').disabled) return;
  vClearCodeInputs();
  vCodeInputs.forEach(c=>c.disabled=false);
  setVStatus('Sending new code…','info');
  el('vresend-btn').disabled = true;

  const body = new FormData();
  body.append('idNumber', pendingIdNumber);
  const res  = await fetch('/resend-account-otp',{method:'POST',body});
  const data = await res.json();
  if (data.success){
    try {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
        { to_email: verifyEmail, code: data.otp, app_name: SCHOOL_NAME });
    } catch(e){ console.warn('EmailJS resend failed:', e); }
    setVStatus('New code sent!','ok');
    setTimeout(()=>setVStatus('',''), 2500);
    startVTimer(120); startVResend(30);
    vCodeInputs[0].focus();
  } else {
    setVStatus(data.error,'err');
    el('vresend-btn').disabled = false;
  }
}

function startVTimer(seconds){
  stopVTimer();
  let t = seconds;
  const bar = el('vtimer-bar');
  bar.style.background = '#b91c1c'; bar.style.width = '100%';
  verifyTimerInt = setInterval(() => {
    t--;
    bar.style.width = (t/seconds*100)+'%';
    if (t<=20) bar.style.background = '#f87171';
    if (t<=0){ stopVTimer(); setVStatus('Code expired. Click Resend.','err'); vCodeInputs.forEach(c=>c.disabled=true); }
  }, 1000);
}
function stopVTimer(){ if(verifyTimerInt){ clearInterval(verifyTimerInt); verifyTimerInt=null; } }
function startVResend(s){
  clearVResend();
  let t=s; const btn=el('vresend-btn');
  btn.disabled=true; btn.textContent=`Resend in ${t}s`;
  verifyResendInt = setInterval(()=>{
    t--;
    if(t<=0){ clearVResend(); btn.disabled=false; btn.textContent='Resend code'; }
    else btn.textContent=`Resend in ${t}s`;
  },1000);
}
function clearVResend(){ if(verifyResendInt){ clearInterval(verifyResendInt); verifyResendInt=null; } el('vresend-btn').textContent='Resend code'; }
function setVStatus(msg,type){ const e=el('votp-status'); e.textContent=msg; e.className='status-msg'+(type?` ${type}`:''); }
function vClearCodeInputs(){ vCodeInputs.forEach(c=>{ c.value=''; c.classList.remove('filled','error-box'); }); setVStatus('',''); }

el('tab-register').addEventListener('click', ()=>showPage('page-register'));
el('tab-login').addEventListener('click', ()=>showPage('page-login'));
el('back-to-register').addEventListener('click', ()=>showPage('page-register'));
el('back-to-login').addEventListener('click', ()=>showPage('page-login'));
el('back-to-forgot').addEventListener('click', ()=>showPage('page-forgot-password'));
el('back-to-otp').addEventListener('click', ()=>showPage('page-otp'));
el('open-forgot').addEventListener('click', ()=>showPage('page-forgot-password'));

el('idNumber').addEventListener('input', function(){
  formatIdInput(this);
  const v = validateSAID(this.value, true);
  if (this.value && !v.isValid){ this.classList.add('validation-error'); showErr('idNumber-error', v.error); }
  else if(v.isValid){
    this.classList.remove('validation-error'); clearErr('idNumber-error');
    if(v.gender){ const gs=el('gender'); if([...gs.options].map(o=>o.value).includes(v.gender)) gs.value=v.gender; }
  } else { this.classList.remove('validation-error'); clearErr('idNumber-error'); }
});

el('gender').addEventListener('change', function(){
  const id=el('idNumber').value;
  if(!id||!this.value){ el('gender-error').textContent=''; return; }
  const v=validateSAID(id);
  el('gender-error').textContent = (v.isValid && v.gender!==this.value)
    ? `Gender in ID (${v.gender}) doesn't match selected gender (${this.value}).` : '';
});

['cellphone','parentPhone'].forEach(fid=>{
  el(fid).addEventListener('input', function(){
    formatPhoneInput(this);
    const v=validateSAPhone(this.value);
    const errId=fid==='cellphone'?'cellphone-error':'parentPhone-error';
    if(this.value&&!v.isValid){ this.classList.add('validation-error'); showErr(errId,v.error); }
    else { this.classList.remove('validation-error'); clearErr(errId); }
  });
});

el('parentId').addEventListener('input', function(){
  formatIdInput(this);
  const v=validateSAID(this.value);
  if(this.value&&!v.isValid){ this.classList.add('validation-error'); showErr('parentId-error',v.error); }
  else { this.classList.remove('validation-error'); clearErr('parentId-error'); }
});

el('loginId').addEventListener('input', function(){
  formatIdInput(this);
  const v=validateSAID(this.value);
  if(this.value&&!v.isValid){ this.classList.add('validation-error'); showErr('loginId-error',v.error); }
  else { this.classList.remove('validation-error'); clearErr('loginId-error'); }
});

el('forgot-id').addEventListener('input', function(){ formatIdInput(this); });

setupPasswordToggle('password','togglePassword');
setupPasswordToggle('confirmPassword','toggleConfirmPassword');
setupPasswordToggle('loginPassword','toggleLoginPassword');
setupPasswordToggle('new-password','toggleNewPassword');
setupPasswordToggle('confirm-new-password','toggleConfirmNewPassword');

el('password').addEventListener('input', function(){
  const se=el('password-strength');
  if(!this.value){se.textContent='';return;}
  if(this.value.length<8){se.textContent='Min 8 characters';se.className='password-strength password-weak';return;}
  const s=checkPasswordStrength(this.value);
  se.textContent=`Strength: ${s.text}`; se.className=`password-strength ${s.className}`;
  validatePasswordMatch();
});
el('confirmPassword').addEventListener('input', validatePasswordMatch);

function validatePasswordMatch(){
  const pw=el('password').value, cp=el('confirmPassword').value, me=el('password-match');
  if(!cp){me.textContent='Please confirm your password';me.className='muted small';return false;}
  if(pw===cp){me.textContent='✓ Passwords match';me.className='password-match';return true;}
  me.textContent='✗ Passwords do not match';me.className='password-mismatch';return false;
}

el('new-password').addEventListener('input', function(){
  const se=el('new-password-strength');
  if(!this.value){se.textContent='';return;}
  if(this.value.length<8){se.textContent='Min 8 characters';se.className='password-strength password-weak';return;}
  const s=checkPasswordStrength(this.value); se.textContent=`Strength: ${s.text}`; se.className=`password-strength ${s.className}`;
});
el('confirm-new-password').addEventListener('input', function(){
  const me=el('new-password-match');
  if(!this.value){me.textContent='';return;}
  if(el('new-password').value===this.value){me.textContent='✓ Passwords match';me.className='password-match';}
  else {me.textContent='✗ Passwords do not match';me.className='password-mismatch';}
});

setupSubjectSelection();

// Disability show/hide
el('hasDisability').addEventListener('change', function() {
  const details = el('disability-details');
  const typeSelect = el('disabilityType');
  if (this.value === 'yes') {
    details.style.display = '';
    typeSelect.required = true;
  } else {
    details.style.display = 'none';
    typeSelect.required = false;
    typeSelect.value = '';
    clearErr('disabilityType-error');
  }
});

el('register-form').addEventListener('submit', async function(e){
  e.preventDefault();
  clearMsg('register-error'); clearMsg('register-msg');
  const grade=el('grade').value;
  if(grade==='10'||grade==='11'){
    const sv=validateSeniorSubjects();
    if(!sv.isValid){showErr('subject-error',sv.error);return;}
  }
  if(el('hasDisability').value === 'yes' && !el('disabilityType').value){
    showErr('disabilityType-error','Please select the type of disability.');
    el('disabilityType').focus();
    return;
  }
  if (!grecaptcha.getResponse(recaptchaRegisterWidget)) {
    showErr('register-error', 'Please complete the reCAPTCHA.');
    return;
  }
  const body=new FormData(this);
  body.append('recaptcha_token', grecaptcha.getResponse(recaptchaRegisterWidget));
  const res =await fetch('/register',{method:'POST',body});
  const data=await res.json();
  if(data.success){
    verifyEmail     = data.email;
    pendingIdNumber = data.idNumber;
    el('vemail-display').textContent = verifyEmail;
    try {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
        { to_email: verifyEmail, code: data.otp, app_name: SCHOOL_NAME });
    } catch(ex){ console.warn('EmailJS send failed:', ex); }
    showOk('register-msg','Account created! Check your email for a verification code.');
    setTimeout(()=>{
      vshowStep('vstep-otp');
      vClearCodeInputs();
      vCodeInputs.forEach(c=>c.disabled=false);
      showPage('page-email-verify');
      startVTimer(120);
      startVResend(30);
      setTimeout(()=>vCodeInputs[0]&&vCodeInputs[0].focus(), 150);
      this.reset(); el('subject-selection').classList.add('hidden');
      grecaptcha.reset(recaptchaRegisterWidget);
    }, 1500);
  } else {
    showErr('register-error', data.error);
    grecaptcha.reset();
  }
});

el('login-form').addEventListener('submit', async function(e){
  e.preventDefault();
  clearMsg('login-error'); clearMsg('login-msg');
  
  if (typeof grecaptcha === 'undefined') {
    showErr('login-error', 'reCAPTCHA is not loaded. Please refresh the page.');
    return;
  }
  
  // Try to get reCAPTCHA response with retries
  let captchaToken = grecaptcha.getResponse(recaptchaLoginWidget);
  let attempts = 0;
  while (!captchaToken && attempts < 5) {
    await new Promise(r => setTimeout(r, 200));
    captchaToken = grecaptcha.getResponse(recaptchaLoginWidget);
    attempts++;
  }
  
  if (!captchaToken) {
    showErr('login-error', 'Please complete the reCAPTCHA checkbox.');
    return;
  }
  
  const body=new FormData(this);
  body.append('recaptcha_token', captchaToken);
  const res =await fetch('/login',{method:'POST',body});
  const data=await res.json();
  if(data.success){ showOk('login-msg','Login successful! Redirecting…'); setTimeout(()=>window.location.href='/dashboard',1000); }
  else { showErr('login-error',data.error); grecaptcha.reset(recaptchaLoginWidget); }
});

let pwOtpCode='', pwIdNumber='', pwOtpTimer=null;
const pwCodeInputs = Array.from(document.querySelectorAll('#pw-code-row .code-input'));

el('forgot-form').addEventListener('submit', async function(e){
  e.preventDefault();
  clearMsg('forgot-error'); clearMsg('forgot-msg');
  const id=el('forgot-id').value;
  const idV=validateSAID(id);
  if(!idV.isValid){showErr('forgot-error',idV.error);return;}

  const body=new FormData(); body.append('idNumber',id);
  const res =await fetch('/forgot-password',{method:'POST',body});
  const data=await res.json();
  if(!data.success){showErr('forgot-error',data.error);return;}

  pwOtpCode  = data.otp;
  pwIdNumber = id;
  el('otp-email-display').textContent = data.email;

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
      { to_email: data.email, code: pwOtpCode, app_name: SCHOOL_NAME });
  } catch(ex){ console.warn('EmailJS pw OTP failed:', ex); }

  showOk('forgot-msg','OTP sent to your registered email.');
  pwClearCode(); pwCodeInputs.forEach(c=>c.disabled=false);
  showPage('page-otp');
  startPwTimer(300);
  setTimeout(()=>pwCodeInputs[0]&&pwCodeInputs[0].focus(),150);
  el('resend-otp').disabled=true;
  setTimeout(()=>el('resend-otp').disabled=false, 30000);
});

pwCodeInputs.forEach((input,i)=>{
  input.addEventListener('input',e=>{
    const val=e.target.value.replace(/\D/g,'');
    input.value=val?val[0]:'';
    input.classList.toggle('filled',!!input.value);
    input.classList.remove('error-box');
    clearMsg('otp-error');
    if(input.value&&i<5) pwCodeInputs[i+1].focus();
    if(pwCodeInputs.map(c=>c.value).join('').length===6)
      handlePwOtp(pwCodeInputs.map(c=>c.value).join(''));
  });
  input.addEventListener('keydown',e=>{
    if(e.key==='Backspace'&&!input.value&&i>0){
      pwCodeInputs[i-1].value=''; pwCodeInputs[i-1].classList.remove('filled'); pwCodeInputs[i-1].focus();
    }
  });
  input.addEventListener('paste',e=>{
    e.preventDefault();
    const paste=e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6);
    if(paste.length===6){ paste.split('').forEach((d,idx)=>{pwCodeInputs[idx].value=d;pwCodeInputs[idx].classList.add('filled');}); handlePwOtp(paste); }
  });
});

el('otp-form').addEventListener('submit', async function(e){
  e.preventDefault();
  const code=pwCodeInputs.map(c=>c.value).join('');
  if(code.length===6) await handlePwOtp(code);
});

async function handlePwOtp(code){
  pwCodeInputs.forEach(c=>c.disabled=true);
  clearMsg('otp-error');
  const body=new FormData();
  body.append('idNumber',pwIdNumber); body.append('otp',code);
  const res =await fetch('/verify-otp',{method:'POST',body});
  const data=await res.json();
  if(data.success){ showOk('otp-msg','OTP verified!'); stopPwTimer(); setTimeout(()=>showPage('page-reset'),800); }
  else {
    showErr('otp-error',data.error);
    pwCodeInputs.forEach(c=>c.classList.add('error-box'));
    setTimeout(()=>{ pwClearCode(); pwCodeInputs.forEach(c=>c.disabled=false); pwCodeInputs[0].focus(); },400);
  }
}

el('resend-otp').addEventListener('click', async()=>{
  const body=new FormData(); body.append('idNumber',pwIdNumber);
  const res =await fetch('/forgot-password',{method:'POST',body});
  const data=await res.json();
  if(data.success){
    pwOtpCode=data.otp;
    try{ await emailjs.send(EMAILJS_SERVICE_ID,EMAILJS_TEMPLATE_ID,
      {to_email:data.email,code:pwOtpCode,app_name:SCHOOL_NAME}); }
    catch(ex){ console.warn('EmailJS resend failed:',ex); }
    showOk('otp-msg','New OTP sent to your email.');
    pwClearCode(); pwCodeInputs.forEach(c=>c.disabled=false);
    startPwTimer(300);
    el('resend-otp').disabled=true;
    setTimeout(()=>el('resend-otp').disabled=false,30000);
  }
});

function startPwTimer(seconds){
  stopPwTimer(); let t=seconds;
  const tick=()=>{
    const m=Math.floor(t/60),s=t%60;
    el('timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if(t<=0){ stopPwTimer(); showErr('otp-error','OTP expired. Request a new one.'); pwCodeInputs.forEach(c=>c.disabled=true); el('resend-otp').disabled=false; }
    t--;
  };
  tick(); pwOtpTimer=setInterval(tick,1000);
}
function stopPwTimer(){ if(pwOtpTimer){clearInterval(pwOtpTimer);pwOtpTimer=null;} }
function pwClearCode(){ pwCodeInputs.forEach(c=>{c.value='';c.classList.remove('filled','error-box');}); clearMsg('otp-error'); clearMsg('otp-msg'); }

el('reset-form').addEventListener('submit', async function(e){
  e.preventDefault();
  clearMsg('reset-error'); clearMsg('reset-msg');
  const np=el('new-password').value, cp=el('confirm-new-password').value;
  if(np.length<8){showErr('reset-error','Password must be at least 8 characters.');return;}
  if(np!==cp){showErr('reset-error','Passwords do not match.');return;}
  const body=new FormData();
  body.append('newPassword',np); body.append('confirmPassword',cp);
  const res =await fetch('/reset-password',{method:'POST',body});
  const data=await res.json();
  if(data.success){
    showOk('reset-msg','Password reset! Redirecting to login…');
    setTimeout(()=>{ showPage('page-login'); showOk('login-msg','Password reset! Please login.'); this.reset(); },1500);
  } else showErr('reset-error',data.error);
});
