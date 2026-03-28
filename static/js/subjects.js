// ── Subject data ──────────────────────────────────────────────────────────────

const juniorSubjects = [
  { code:'ZULU',  name:'ISIZULU HML',                  fullName:'ISIZULU Home Language',               compulsory:true  },
  { code:'ENG',   name:'ENGLISH FAL',                  fullName:'ENGLISH First Additional Language',   compulsory:true  },
  { code:'LO',    name:'LIFE ORIENTATION',              fullName:'LIFE ORIENTATION',                    compulsory:true  },
  { code:'TECH',  name:'TECHNOLOGY',                   fullName:'TECHNOLOGY',                          compulsory:false },
  { code:'CA',    name:'CREATIVE ARTS',                fullName:'CREATIVE ARTS',                       compulsory:false },
  { code:'MATHS', name:'MATHEMATICS',                  fullName:'MATHEMATICS',                         compulsory:false },
  { code:'NS',    name:'NATURAL SCIENCES',             fullName:'NATURAL SCIENCES',                    compulsory:false },
  { code:'HSS',   name:'HUMAN SOCIAL SCIENCES',        fullName:'HUMAN SOCIAL SCIENCES',               compulsory:false },
  { code:'EMS',   name:'ECONOMIC AND MANAGEMENT SCIENCES', fullName:'ECONOMIC AND MANAGEMENT SCIENCES',compulsory:false },
];

const seniorSubjects = [
  { code:'ZULU',   name:'ISIZULU HML',          fullName:'ISIZULU Home Language',             compulsory:true  },
  { code:'ENG',    name:'ENGLISH FAL',           fullName:'ENGLISH First Additional Language', compulsory:true  },
  { code:'LO',     name:'LIFE ORIENTATION',      fullName:'LIFE ORIENTATION',                  compulsory:true  },
  { code:'DRAMA',  name:'DRAMATIC ARTS',         fullName:'DRAMATIC ARTS',                     compulsory:true  },
  { code:'PHYSICS',name:'PHYSICAL SCIENCES',     fullName:'PHYSICAL SCIENCES',  compulsory:false, group:'SCIENCE'    },
  { code:'LIFE',   name:'LIFE SCIENCES',         fullName:'LIFE SCIENCES',      compulsory:false, group:'SCIENCE'    },
  { code:'AGRIC',  name:'AGRICULTURAL SCIENCES', fullName:'AGRICULTURAL SCIENCES',compulsory:false,group:'SCIENCE'   },
  { code:'MATHS',  name:'MATHEMATICS',           fullName:'MATHEMATICS',        compulsory:false, group:'SCIENCE'    },
  { code:'GEOG',   name:'GEOGRAPHY',             fullName:'GEOGRAPHY',          compulsory:false, group:'HUMANITIES' },
  { code:'TOUR',   name:'TOURISM',               fullName:'TOURISM',            compulsory:false, group:'HUMANITIES' },
  { code:'HIST',   name:'HISTORY',               fullName:'HISTORY',            compulsory:false, group:'HUMANITIES' },
  { code:'MLIT',   name:'MATHEMATICAL LITERACY', fullName:'MATHEMATICAL LITERACY',compulsory:false,group:'HUMANITIES'},
];

const subjectConflicts = {
  PHYSICS:['GEOG','TOUR','HIST','MLIT'],
  MATHS:  ['GEOG','TOUR','HIST','MLIT'],
  LIFE:   ['GEOG','TOUR','HIST','MLIT'],
  AGRIC:  ['GEOG','TOUR','HIST','MLIT'],
  GEOG:   ['PHYSICS','AGRIC','LIFE','MATHS'],
  TOUR:   ['PHYSICS','AGRIC','LIFE','MATHS'],
  HIST:   ['PHYSICS','AGRIC','LIFE','MATHS'],
  MLIT:   ['PHYSICS','AGRIC','LIFE','MATHS'],
};

function setupSubjectSelection() {
  const gradeSelect = document.getElementById('grade');
  if (!gradeSelect) return;
  gradeSelect.addEventListener('change', function() {
    const section = document.getElementById('subject-selection');
    if (this.value === '10' || this.value === '11') {
      section.classList.remove('hidden');
      renderSeniorSubjects();
    } else {
      section.classList.add('hidden');
    }
  });
}

function renderSeniorSubjects() {
  const grid = document.getElementById('subject-grid');
  grid.innerHTML = '';
  seniorSubjects.forEach(s => {
    const lbl = document.createElement('label');
    lbl.className = `subject-option${s.compulsory ? ' compulsory' : ''}`;
    lbl.innerHTML = `
      <input type="checkbox" name="subjects" value="${s.code}" ${s.compulsory ? 'checked disabled' : ''}>
      <div>
        <strong>${s.name}</strong><br>
        <small>${s.fullName}</small>
        ${s.compulsory ? '<br><small style="color:#15803d">Compulsory</small>' : ''}
        ${s.group ? `<br><small style="color:#9333ea">${s.group}</small>` : ''}
      </div>
    `;
    grid.appendChild(lbl);
  });
  grid.querySelectorAll('.subject-option').forEach(opt => {
    opt.addEventListener('click', function(e) {
      if (this.classList.contains('disabled')) return;
      const cb = this.querySelector('input');
      if (cb.disabled) return;
      cb.checked = !cb.checked;
      this.classList.toggle('selected', cb.checked);
      updateSubjectConflicts();
    });
  });
  updateSubjectConflicts();
}

function updateSubjectConflicts() {
  const selected = Array.from(document.querySelectorAll('input[name="subjects"]:checked')).map(c => c.value);
  const allOpts  = document.querySelectorAll('.subject-option');
  allOpts.forEach(o => o.classList.remove('disabled'));

  const blocked = new Set();
  selected.forEach(code => {
    (subjectConflicts[code] || []).forEach(c => blocked.add(c));
  });

  allOpts.forEach(opt => {
    const cb = opt.querySelector('input');
    if (blocked.has(cb.value) && !cb.disabled) {
      opt.classList.add('disabled');
      cb.checked = false;
      opt.classList.remove('selected');
    }
  });

  const current = Array.from(document.querySelectorAll('input[name="subjects"]:checked')).length;
  const comp = seniorSubjects.filter(s => s.compulsory).length;
  const counter = document.getElementById('subject-counter');
  if (counter) counter.textContent = `Selected: ${current}/8 subjects (${comp} compulsory + ${current - comp} electives)`;
}

function validateSeniorSubjects() {
  const selected = Array.from(document.querySelectorAll('input[name="subjects"]:checked')).map(c => c.value);
  const compulsory = seniorSubjects.filter(s => s.compulsory).map(s => s.code);
  const missing = compulsory.filter(c => !selected.includes(c));
  if (missing.length) return { isValid: false, error: `Missing compulsory: ${missing.join(', ')}` };
  if (selected.length !== 8) return { isValid: false, error: `Select exactly 8 subjects. Currently: ${selected.length}` };
  return { isValid: true, subjects: selected };
}
