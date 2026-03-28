// ── Shared validators ─────────────────────────────────────────────────────────

function validateSAID(idNumber, validateAge = false) {
  const clean = idNumber.replace(/\D/g, '');
  if (!/^\d{13}$/.test(clean))
    return { isValid: false, error: 'ID number must be exactly 13 digits (numbers only)' };

  const year_2d    = parseInt(clean.substring(0, 2));
  const month      = parseInt(clean.substring(2, 4));
  const day        = parseInt(clean.substring(4, 6));
  const genderDig  = parseInt(clean.substring(6, 10));
  const citizenship = parseInt(clean.substring(10, 11));
  const checkDigit = parseInt(clean.substring(12, 13));

  if (month < 1 || month > 12)
    return { isValid: false, error: 'ID number contains an invalid month.' };

  const fullYear = year_2d <= (new Date().getFullYear() - 2000) ? 2000 + year_2d : 1900 + year_2d;
  const daysInMonth = new Date(fullYear, month, 0).getDate();
  if (day < 1 || day > daysInMonth)
    return { isValid: false, error: 'ID number contains an invalid day for that month.' };

  if (citizenship !== 0 && citizenship !== 1)
    return { isValid: false, error: 'ID number has an invalid citizenship digit.' };

  let total = 0;
  for (let i = 0; i < 12; i++) {
    let d = parseInt(clean[i]);
    if (i % 2 === 0) {
      total += d;
    } else {
      let doubled = d * 2;
      total += doubled < 10 ? doubled : doubled - 9;
    }
  }
  const expected = (10 - (total % 10)) % 10;
  if (checkDigit !== expected)
    return { isValid: false, error: 'ID number failed the checksum verification. This ID appears to be invalid or fabricated.' };

  const gender = genderDig < 5000 ? 'Female' : 'Male';

  if (validateAge) {
    const birth = new Date(fullYear, month - 1, day);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    if (age < 9) return { isValid: false, error: `Learner is too young (min 9). Age from ID: ${age}.` };
    if (age > 40) return { isValid: false, error: `Learner is too old (max 40). Age from ID: ${age}.` };
  }

  return { isValid: true, cleanID: clean, gender, birthYear: fullYear };
}

function validateSAPhone(phoneNumber) {
  const clean = phoneNumber.replace(/\D/g, '');
  if (!/^0\d{9}$/.test(clean))
    return { isValid: false, error: 'Cellphone must be 10 digits starting with 0' };
  const prefixes = ['60','61','62','63','64','65','66','67','68','69','71','72','73','74','75','76','77','78','79','81','82','83','84','85','86','87','88','89'];
  if (!prefixes.includes(clean.substring(1, 3)))
    return { isValid: false, error: 'Invalid South African cellphone number' };
  return { isValid: true, cleanPhone: clean };
}

function checkPasswordStrength(password) {
  if (!password) return { strength: 0, text: '' };
  let s = 0;
  if (password.length >= 8)  s++;
  if (password.length >= 12) s++;
  if (/[a-z]/.test(password)) s++;
  if (/[A-Z]/.test(password)) s++;
  if (/[0-9]/.test(password)) s++;
  if (/[^a-zA-Z0-9]/.test(password)) s++;
  if (s <= 2) return { strength: 1, text: 'Weak',   className: 'password-weak' };
  if (s <= 4) return { strength: 2, text: 'Medium', className: 'password-medium' };
  return      { strength: 3, text: 'Strong', className: 'password-strong' };
}

function setupPasswordToggle(fieldId, btnId) {
  const field = document.getElementById(fieldId);
  const btn   = document.getElementById(btnId);
  if (!field || !btn) return;
  btn.addEventListener('click', () => {
    const t = field.type === 'password' ? 'text' : 'password';
    field.type = t;
    btn.textContent = t === 'password' ? '👁️' : '🙈';
  });
}

function formatPhoneInput(input) {
  input.value = input.value.replace(/\D/g, '').substring(0, 10);
}

function formatIdInput(input) {
  input.value = input.value.replace(/\D/g, '').substring(0, 13);
}
