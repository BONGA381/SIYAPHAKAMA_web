from flask import (Flask, render_template, request, redirect,
                   url_for, session, jsonify, flash, abort, send_from_directory)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler
import os, random, string, datetime, calendar, json, urllib.request, urllib.parse, atexit, smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from functools import wraps

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'fallback_secret_key')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

EMAILJS_PUBLIC_KEY   = os.environ.get('EMAILJS_PUBLIC_KEY', '')
EMAILJS_SERVICE_ID   = os.environ.get('EMAILJS_SERVICE_ID', '')
EMAILJS_TEMPLATE_ID  = os.environ.get('EMAILJS_TEMPLATE_ID', '')
RECAPTCHA_SECRET_KEY = os.environ.get('RECAPTCHA_SECRET_KEY', '')
RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
GEMINI_API_KEY       = os.environ.get('GEMINI_API_KEY', '')
SCHOOL_NAME          = "Siyaphakama High School"
SMTP_SENDER_EMAIL    = os.environ.get('SMTP_SENDER_EMAIL', '')
SMTP_SENDER_PASSWORD = os.environ.get('SMTP_SENDER_PASSWORD', '')
SMTP_SENDER_NAME     = "Siyaphakama HS Admissions"
ALLOWED_EXTENSIONS   = {'pdf', 'png', 'jpg', 'jpeg', 'gif'}

DOCUMENT_TYPES = {
    'learnerId':          {'name': 'Learner ID Copy',                     'required': True},
    'parentId':           {'name': 'Parent ID Copy',                      'required': True},
    'schoolReport':       {'name': 'Previous Year School Report',         'required': True},
    'leavingCertificate': {'name': 'Previous School Leaving Certificate', 'required': False},
    'proofOfResidence':   {'name': 'Proof of Residence',                  'required': True},
    'disabilityDoc':      {'name': 'Doctor\'s Letter (Disability)',       'required': False, 'disability_only': True},
}

DATABASE_URL = os.environ.get('DATABASE_URL')

def get_db():
    if DATABASE_URL:
        import psycopg2, psycopg2.extras
        db = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
        db.autocommit = False
        return db
    else:
        import sqlite3
        db = sqlite3.connect('siyaphakama.db')
        db.row_factory = sqlite3.Row
        return _SQLiteCompat(db)


class _SQLiteCompat:
    def __init__(self, conn):
        self._conn = conn
    def cursor(self):
        return _SQLiteCursor(self._conn.cursor())
    def commit(self):
        self._conn.commit()
    def rollback(self):
        self._conn.rollback()
    def close(self):
        self._conn.close()

class _SQLiteCursor:
    def __init__(self, cur):
        self._cur = cur
        self._returning_id = None
    def execute(self, sql, params=()):
        sql = sql.replace('%s', '?')
        if 'RETURNING id' in sql:
            sql = sql.replace(' RETURNING id', '')
            self._cur.execute(sql, params)
            self._returning_id = self._cur.lastrowid
        else:
            self._returning_id = None
            self._cur.execute(sql, params)
        return self
    def fetchone(self):
        if self._returning_id is not None:
            result = self._returning_id
            self._returning_id = None
            return {'id': result}
        row = self._cur.fetchone()
        return dict(row) if row else None
    def fetchall(self):
        return [dict(r) for r in self._cur.fetchall()]
    def close(self):
        self._cur.close()


def init_db():
    db  = get_db()
    cur = db.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS learners (
            id              SERIAL PRIMARY KEY,
            title           TEXT NOT NULL,
            gender          TEXT NOT NULL,
            first_name      TEXT NOT NULL,
            last_name       TEXT NOT NULL,
            id_number       TEXT NOT NULL UNIQUE,
            cellphone       TEXT NOT NULL,
            email           TEXT NOT NULL,
            email_verified  INTEGER NOT NULL DEFAULT 0,
            password_hash   TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            learner_class   TEXT,
            is_deleted      INTEGER NOT NULL DEFAULT 0,
            deleted_at      TEXT,
            has_disability  INTEGER NOT NULL DEFAULT 0,
            disability_type TEXT
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS applications (
            id             SERIAL PRIMARY KEY,
            learner_id     INTEGER NOT NULL REFERENCES learners(id),
            grade          TEXT NOT NULL,
            year           INTEGER NOT NULL,
            status         TEXT NOT NULL DEFAULT 'Pending',
            decline_reason TEXT,
            applied_at     TEXT NOT NULL,
            reviewed_at    TEXT
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS subjects (
            id         SERIAL PRIMARY KEY,
            learner_id INTEGER NOT NULL REFERENCES learners(id),
            code       TEXT NOT NULL
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS parents (
            id           SERIAL PRIMARY KEY,
            learner_id   INTEGER NOT NULL UNIQUE REFERENCES learners(id),
            relationship TEXT NOT NULL,
            name         TEXT NOT NULL,
            id_number    TEXT NOT NULL,
            phone        TEXT NOT NULL,
            email        TEXT
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id          SERIAL PRIMARY KEY,
            learner_id  INTEGER NOT NULL REFERENCES learners(id),
            doc_type    TEXT NOT NULL,
            file_name   TEXT,
            uploaded    INTEGER NOT NULL DEFAULT 0,
            upload_date TEXT,
            UNIQUE(learner_id, doc_type)
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS otp_tokens (
            id         SERIAL PRIMARY KEY,
            identifier TEXT NOT NULL,
            purpose    TEXT NOT NULL DEFAULT 'email',
            otp        TEXT NOT NULL,
            expires_at TEXT NOT NULL
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS admins (
            id            SERIAL PRIMARY KEY,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS email_log (
            id         SERIAL PRIMARY KEY,
            learner_id INTEGER,
            email_type TEXT NOT NULL,
            sent_at    TEXT NOT NULL,
            recipient  TEXT NOT NULL
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS class_assignments (
            id              SERIAL PRIMARY KEY,
            class_key       TEXT NOT NULL UNIQUE,
            teacher         TEXT,
            rep1_learner_id INTEGER REFERENCES learners(id),
            rep2_learner_id INTEGER REFERENCES learners(id),
            updated_at      TEXT
        )
    ''')
    # Add photo columns if they don't exist yet (safe migration with savepoints)
    for col in ('teacher_photo', 'rep1_photo', 'rep2_photo'):
        cur.execute(
            "SELECT 1 FROM information_schema.columns"
            " WHERE table_name='class_assignments' AND column_name=%s",
            (col,)
        )
        if not cur.fetchone():
            try:
                cur.execute('SAVEPOINT add_col_' + col)
                cur.execute('ALTER TABLE class_assignments ADD COLUMN ' + col + ' TEXT')
                cur.execute('RELEASE SAVEPOINT add_col_' + col)
            except Exception:
                cur.execute('ROLLBACK TO SAVEPOINT add_col_' + col)
    cur.execute('''
        CREATE TABLE IF NOT EXISTS doc_reminders (
            id         SERIAL PRIMARY KEY,
            learner_id INTEGER NOT NULL UNIQUE REFERENCES learners(id),
            last_sent  TEXT
        )
    ''')
    # Live chat tables
    cur.execute('''
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id          SERIAL PRIMARY KEY,
            learner_id  INTEGER NOT NULL REFERENCES learners(id),
            status      TEXT NOT NULL DEFAULT 'bot',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS chat_messages (
            id          SERIAL PRIMARY KEY,
            session_id  INTEGER NOT NULL,
            sender      TEXT NOT NULL,
            message     TEXT NOT NULL,
            sent_at     TEXT NOT NULL,
            is_read     INTEGER NOT NULL DEFAULT 0
        )
    ''')
    cur.execute('SELECT id FROM admins LIMIT 1')
    if not cur.fetchone():
        cur.execute('INSERT INTO admins(username,password_hash) VALUES(%s,%s)',
                    ('admin', generate_password_hash('Admin@123')))
    db.commit()
    cur.close()
    db.close()


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin_id'):
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated


def learner_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('learner_id'):
            return jsonify(success=False, error='Not logged in.')
        return f(*args, **kwargs)
    return decorated


SCIENCE_SUBJECTS = {'PHYSICS', 'LIFE', 'AGRIC', 'MATHS'}


def detect_stream(subjects):
    return 'Science' if any(s in SCIENCE_SUBJECTS for s in subjects) else 'Humanities'


def validate_sa_id(id_number, min_age=None, max_age=None):
    clean = ''.join(filter(str.isdigit, id_number))
    if len(clean) != 13:
        return False, 'ID number must be exactly 13 digits.'
    try:
        year_2d  = int(clean[0:2])
        month    = int(clean[2:4])
        day      = int(clean[4:6])
        gender   = int(clean[6:10])
        citizen  = int(clean[10])
        checksum = int(clean[12])
    except ValueError:
        return False, 'ID number contains invalid characters.'
    if month < 1 or month > 12:
        return False, 'ID number contains an invalid month.'
    max_day = calendar.monthrange(2000, month)[1]
    if day < 1 or day > max_day:
        return False, 'ID number contains an invalid day for that month.'
    if citizen not in (0, 1):
        return False, 'ID number has an invalid citizenship digit.'
    total = 0
    for i, digit in enumerate(clean[:12]):
        d = int(digit)
        if i % 2 == 0:
            total += d
        else:
            doubled = d * 2
            total += doubled if doubled < 10 else doubled - 9
    if checksum != (10 - (total % 10)) % 10:
        return False, 'ID number failed checksum verification.'
    full_year = (2000 + year_2d) if year_2d <= (datetime.datetime.utcnow().year - 2000) else (1900 + year_2d)
    if min_age is not None or max_age is not None:
        try:
            birth = datetime.date(full_year, month, day)
            today = datetime.date.today()
            age   = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
            if min_age is not None and age < min_age:
                return False, f'Learner is too young (minimum age {min_age}). Age from ID: {age}.'
            if max_age is not None and age > max_age:
                return False, f'Learner is too old (maximum age {max_age}). Age from ID: {age}.'
        except ValueError:
            return False, 'ID number contains an invalid date of birth.'
    gender_str = 'Female' if gender < 5000 else 'Male'
    return True, gender_str


def verify_recaptcha(token):
    if not token or not RECAPTCHA_SECRET_KEY:
        return True
    try:
        data = urllib.parse.urlencode({'secret': RECAPTCHA_SECRET_KEY, 'response': token}).encode()
        req  = urllib.request.Request(RECAPTCHA_VERIFY_URL, data=data, method='POST')
        with urllib.request.urlopen(req, timeout=5) as r:
            result = json.loads(r.read())
        return result.get('success', False)
    except Exception:
        return True


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def is_application_window_open():
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=2)
    return now.month >= 3


def get_application_year():
    now = datetime.datetime.utcnow() + datetime.timedelta(hours=2)
    return now.year + 1 if now.month >= 3 else now.year


def application_window_dates():
    now       = datetime.datetime.utcnow() + datetime.timedelta(hours=2)
    next_year = now.year + 1 if now.month >= 3 else now.year
    open_year = next_year - 1
    last_feb  = 29 if calendar.isleap(now.year + (1 if now.month >= 3 else 0)) else 28
    return open_year, next_year, last_feb


def generate_otp():
    return ''.join(random.choices(string.digits, k=6))


def get_learner(id_number):
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id_number=%s', (id_number,))
    learner = cur.fetchone()
    if not learner:
        cur.close(); db.close()
        return None
    lid = learner['id']
    cur.execute('SELECT * FROM applications WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (lid,))
    application = cur.fetchone()
    cur.execute('SELECT * FROM parents WHERE learner_id=%s', (lid,))
    parent = cur.fetchone()
    cur.execute('SELECT code FROM subjects WHERE learner_id=%s', (lid,))
    subjects = [r['code'] for r in cur.fetchall()]
    cur.execute('SELECT * FROM documents WHERE learner_id=%s', (lid,))
    documents = cur.fetchall()
    cur.close(); db.close()
    return dict(learner=learner, application=application, parent=parent,
                subjects=subjects, documents=documents)


def gemini_message(prompt):
    if not GEMINI_API_KEY:
        return None
    payload = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}",
        data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        app.logger.error(f"Gemini API error: {e}")
        return None


def ai_registration_msg(name, grade, year):
    tones = ["warm and professional", "encouraging and friendly", "formal and reassuring"]
    msg = gemini_message(
        f"You are the admissions office of {SCHOOL_NAME}. Write a short, {random.choice(tones)} "
        f"email body (3-4 sentences) to {name} confirming their application for Grade {grade} in {year} "
        f"was received and is under review. Mention uploading all required documents. No asterisks or quotes."
    )
    return msg or (
        f"Dear {name}, your application to {SCHOOL_NAME} for Grade {grade} in {year} has been received "
        f"and is currently under review. Please ensure all required documents are uploaded to your portal. "
        f"You will be notified of the outcome via email."
    )


def ai_accepted_msg(name, grade, year):
    msg = gemini_message(
        f"You are the admissions office of {SCHOOL_NAME}. Write a short celebratory email body "
        f"(3-4 sentences) to {name} informing them their application for Grade {grade} in {year} "
        f"was ACCEPTED. Congratulate them and mention preparing for the academic year. No asterisks or quotes."
    )
    return msg or (
        f"Dear {name}, we are thrilled to inform you that your application to {SCHOOL_NAME} for Grade {grade} "
        f"in {year} has been ACCEPTED! Congratulations — we look forward to welcoming you. "
        f"Please check your learner portal for further enrolment instructions."
    )


def ai_declined_msg(name, grade, year, reason):
    msg = gemini_message(
        f"You are the admissions office of {SCHOOL_NAME}. Write a compassionate email body (3-4 sentences) "
        f"to {name} informing them their application for Grade {grade} in {year} was DECLINED. "
        f"Reason: {reason}. Encourage them to contact the school for assistance. No asterisks or quotes."
    )
    return msg or (
        f"Dear {name}, we regret to inform you that your application to {SCHOOL_NAME} for Grade {grade} "
        f"in {year} has not been successful. Reason: {reason}. "
        f"Please contact our admissions office if you have any questions or wish to discuss next steps."
    )


def ai_doc_reminder_msg(name, missing_docs):
    docs_str = ", ".join(missing_docs)
    msg = gemini_message(
        f"You are the admissions office of {SCHOOL_NAME}. Write a polite reminder email body (2-3 sentences) "
        f"to {name} asking them to upload missing documents: {docs_str}. "
        f"Mention their application cannot be fully processed without them. No asterisks or quotes."
    )
    return msg or (
        f"Dear {name}, this is a reminder that the following documents are still outstanding on your "
        f"{SCHOOL_NAME} application: {docs_str}. "
        f"Please log in to your learner portal and upload them as soon as possible."
    )


def build_email_html(body, school_name, logo_url=None):
    logo_tag = f'<img src="{logo_url}" alt="Logo" style="width:48px;height:48px;border-radius:10px;object-fit:cover;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;" />' if logo_url else ''
    return f"""
    <html><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:0;margin:0;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:30px 0;">
        <tr><td align="center">
          <table width="580" cellpadding="0" cellspacing="0"
                 style="background:#ffffff;border-radius:12px;overflow:hidden;
                        border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,.06);">
            <tr>
              <td style="background:linear-gradient(135deg,#b91c1c,#dc2626);
                          padding:28px 32px;text-align:center;">
                {logo_tag}
                <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">🏫 {school_name}</h1>
                <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px;">Admissions Office</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="color:#1e293b;font-size:15px;line-height:1.7;white-space:pre-line;margin:0;">{body}</p>
              </td>
            </tr>
            <tr>
              <td style="background:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="color:#94a3b8;font-size:12px;margin:0;">
                  {school_name} &nbsp;|&nbsp; Admissions Portal<br/>
                  This is an automated message — please do not reply to this email.
                </p>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """


def send_notification_email(to_email, subject, body, to_name=""):
    if not SMTP_SENDER_EMAIL or not SMTP_SENDER_PASSWORD:
        app.logger.warning(f"SMTP not configured — skipping email to {to_email}: {subject}")
        return False
    try:
        msg            = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"{SMTP_SENDER_NAME} <{SMTP_SENDER_EMAIL}>"
        msg["To"]      = f"{to_name} <{to_email}>" if to_name else to_email
        html = build_email_html(body, SCHOOL_NAME)
        msg.attach(MIMEText(body, "plain"))
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(SMTP_SENDER_EMAIL, SMTP_SENDER_PASSWORD.replace(" ", ""))
            server.sendmail(SMTP_SENDER_EMAIL, to_email, msg.as_string())
        app.logger.info(f"Email sent to {to_email}: {subject}")
        return True
    except Exception as e:
        app.logger.error(f"SMTP email failed to {to_email}: {e}")
        return False


send_emailjs = send_notification_email


def log_email(db, learner_id, email_type, recipient):
    cur = db.cursor()
    cur.execute('INSERT INTO email_log(learner_id,email_type,sent_at,recipient) VALUES(%s,%s,%s,%s)',
               (learner_id, email_type, datetime.datetime.utcnow().isoformat(), recipient))
    cur.close()


def send_missing_doc_reminders():
    with app.app_context():
        db  = get_db()
        cur = db.cursor()
        now    = datetime.datetime.utcnow()
        cutoff = (now - datetime.timedelta(days=2)).isoformat()
        cur.execute('''
            SELECT l.id, l.first_name, l.last_name, l.email, a.grade, a.year
            FROM learners l
            JOIN applications a ON a.learner_id = l.id
            WHERE a.status = 'Pending' AND l.email_verified = 1
        ''')
        rows = cur.fetchall()
        for row in rows:
            lid = row['id']
            cur.execute('SELECT last_sent FROM doc_reminders WHERE learner_id=%s', (lid,))
            r = cur.fetchone()
            if r and r['last_sent'] and r['last_sent'] > cutoff:
                continue
            cur.execute('SELECT * FROM documents WHERE learner_id=%s', (lid,))
            docs = cur.fetchall()
            cur.execute('SELECT has_disability FROM learners WHERE id=%s', (lid,))
            is_disabled = bool(cur.fetchone()['has_disability'])
            missing = [DOCUMENT_TYPES[d['doc_type']]['name']
                       for d in docs if not d['uploaded'] and (
                           DOCUMENT_TYPES.get(d['doc_type'], {}).get('required') or
                           (DOCUMENT_TYPES.get(d['doc_type'], {}).get('disability_only') and is_disabled)
                       )]
            if not missing:
                continue
            name = f"{row['first_name']} {row['last_name']}"
            body = ai_doc_reminder_msg(name, missing)
            if send_emailjs(row['email'], f"[{SCHOOL_NAME}] Action Required: Missing Documents", body, name):
                if r:
                    cur.execute('UPDATE doc_reminders SET last_sent=%s WHERE learner_id=%s', (now.isoformat(), lid))
                else:
                    cur.execute('INSERT INTO doc_reminders(learner_id,last_sent) VALUES(%s,%s)', (lid, now.isoformat()))
                log_email(db, lid, 'doc_reminder_auto', row['email'])
                db.commit()
        cur.close()
        db.close()


scheduler = BackgroundScheduler()
scheduler.add_job(send_missing_doc_reminders, 'interval', hours=48, id='doc_reminder')
scheduler.start()
atexit.register(lambda: scheduler.shutdown())


@app.route('/')
def landing():
    if session.get('admin_id'):   return redirect(url_for('admin_dashboard'))
    if session.get('learner_id'): return redirect(url_for('dashboard'))
    return render_template('landing.html')


@app.route('/apply')
def index():
    if session.get('admin_id'):   return redirect(url_for('admin_dashboard'))
    if session.get('learner_id'): return redirect(url_for('dashboard'))
    if not is_application_window_open():
        open_year, next_year, last_feb = application_window_dates()
        return render_template('index.html', window_closed=True,
                               opens=f"1 March {open_year}",
                               closes=f"{last_feb} February {open_year + 1}",
                               apply_year=next_year)
    return render_template('index.html', window_closed=False)


@app.route('/register', methods=['POST'])
def register():
    if not is_application_window_open():
        return jsonify(success=False, error='Applications are currently closed. They open on 1 March each year.')
    f               = request.form
    recaptcha_token = f.get('recaptcha_token', '').strip()
    email           = f.get('email', '').strip().lower()
    id_number       = f.get('idNumber', '').strip()
    first_name      = f.get('firstName', '').strip()
    last_name       = f.get('lastName', '').strip()
    title           = f.get('title', '').strip()
    gender          = f.get('gender', '').strip()
    cellphone       = f.get('cellphone', '').strip()
    password        = f.get('password', '').strip()
    confirm_pw      = f.get('confirmPassword', '').strip()
    grade           = f.get('grade', '').strip()
    p_rel           = f.get('parentRelationship', '').strip()
    p_name          = f.get('parentName', '').strip()
    p_id            = f.get('parentId', '').strip()
    p_phone         = f.get('parentPhone', '').strip()
    p_email         = f.get('parentEmail', '').strip()
    subjects        = request.form.getlist('subjects')
    has_disability  = f.get('hasDisability', 'no').strip().lower() == 'yes'
    disability_type = f.get('disabilityType', '').strip() if has_disability else None

    if not verify_recaptcha(recaptcha_token):
        return jsonify(success=False, error='Security check failed. Please try again.')
    if not all([email, title, gender, first_name, last_name, id_number, cellphone, password, grade]):
        return jsonify(success=False, error='All required fields must be filled.')
    if has_disability and not disability_type:
        return jsonify(success=False, error='Please select your disability type.')
    if password != confirm_pw:
        return jsonify(success=False, error='Passwords do not match.')
    if len(password) < 8:
        return jsonify(success=False, error='Password must be at least 8 characters.')
    if not all([p_rel, p_name, p_id, p_phone]):
        return jsonify(success=False, error='All parent/guardian fields are required.')

    id_valid, id_result = validate_sa_id(id_number, min_age=9, max_age=40)
    if not id_valid:
        return jsonify(success=False, error=f'Learner ID: {id_result}')
    if gender and id_result != gender:
        return jsonify(success=False, error=f'Gender mismatch: ID indicates {id_result} but {gender} was selected.')

    p_id_valid, p_id_result = validate_sa_id(p_id)
    if not p_id_valid:
        return jsonify(success=False, error=f'Parent ID: {p_id_result}')
    if id_number.strip() == p_id.strip():
        return jsonify(success=False, error='Learner and parent ID numbers cannot be the same.')

    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT id, is_deleted FROM learners WHERE id_number=%s', (id_number,))
    existing = cur.fetchone()
    if existing and not existing['is_deleted']:
        cur.close(); db.close()
        return jsonify(success=False, error='An account with this ID number already exists.')
    cur.execute('SELECT id FROM learners WHERE email=%s AND is_deleted=0', (email,))
    if cur.fetchone():
        cur.close(); db.close()
        return jsonify(success=False, error='An account with this email already exists.')

    pw_hash = generate_password_hash(password)
    now_iso = datetime.datetime.utcnow().isoformat()
    year    = get_application_year()

    try:
        # If re-registering after deletion, delete old record fully first
        if existing and existing['is_deleted']:
            old_lid = existing['id']
            cur.execute('DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE learner_id=%s)', (old_lid,))
            cur.execute('DELETE FROM chat_sessions WHERE learner_id=%s', (old_lid,))
            cur.execute('DELETE FROM doc_reminders WHERE learner_id=%s', (old_lid,))
            cur.execute('DELETE FROM email_log WHERE learner_id=%s', (old_lid,))
            cur.execute('DELETE FROM documents WHERE learner_id=%s', (old_lid,))
            cur.execute('DELETE FROM subjects WHERE learner_id=%s', (old_lid,))
            cur.execute('DELETE FROM parents WHERE learner_id=%s', (old_lid,))
            cur.execute('DELETE FROM applications WHERE learner_id=%s', (old_lid,))
            cur.execute('DELETE FROM learners WHERE id=%s', (old_lid,))

        cur.execute(
            'INSERT INTO learners(title,gender,first_name,last_name,id_number,cellphone,email,email_verified,password_hash,created_at,has_disability,disability_type) VALUES(%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s) RETURNING id',
            (title, gender, first_name, last_name, id_number, cellphone, email, pw_hash, now_iso, 1 if has_disability else 0, disability_type)
        )
        lid = cur.fetchone()['id']
        cur.execute('INSERT INTO applications(learner_id,grade,year,status,applied_at) VALUES(%s,%s,%s,%s,%s)',
                   (lid, grade, year, 'Pending', now_iso))
        cur.execute('INSERT INTO parents(learner_id,relationship,name,id_number,phone,email) VALUES(%s,%s,%s,%s,%s,%s)',
                   (lid, p_rel, p_name, p_id, p_phone, p_email))
        if grade in ('8', '9'):
            for code in ['ZULU', 'ENG', 'TECH', 'CA', 'LO', 'MATHS', 'NS', 'HSS', 'EMS']:
                cur.execute('INSERT INTO subjects(learner_id,code) VALUES(%s,%s)', (lid, code))
        else:
            for code in subjects:
                cur.execute('INSERT INTO subjects(learner_id,code) VALUES(%s,%s)', (lid, code))
            cur.execute('UPDATE learners SET learner_class=%s WHERE id=%s', (detect_stream(subjects), lid))
        for doc_type in DOCUMENT_TYPES:
            if DOCUMENT_TYPES[doc_type].get('disability_only') and not has_disability:
                continue
            cur.execute('INSERT INTO documents(learner_id,doc_type,uploaded) VALUES(%s,%s,0)', (lid, doc_type))
        otp     = generate_otp()
        expires = (datetime.datetime.utcnow() + datetime.timedelta(minutes=10)).isoformat()
        cur.execute('DELETE FROM otp_tokens WHERE identifier=%s AND purpose=%s', (id_number, 'account_verify'))
        cur.execute('INSERT INTO otp_tokens(identifier,purpose,otp,expires_at) VALUES(%s,%s,%s,%s)',
                   (id_number, 'account_verify', otp, expires))
        db.commit()
        cur.close(); db.close()
        return jsonify(success=True, otp=otp, email=email, idNumber=id_number)
    except Exception as e:
        db.rollback()
        cur.close(); db.close()
        return jsonify(success=False, error=str(e))


@app.route('/verify-account-otp', methods=['POST'])
def verify_account_otp():
    id_number = request.form.get('idNumber', '').strip()
    entered   = request.form.get('otp', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM otp_tokens WHERE identifier=%s AND purpose=%s ORDER BY id DESC LIMIT 1',
        (id_number, 'account_verify'))
    row = cur.fetchone()
    if not row:
        cur.close(); db.close()
        return jsonify(success=False, error='No OTP found. Please request a new code.')
    if datetime.datetime.utcnow() > datetime.datetime.fromisoformat(row['expires_at']):
        cur.close(); db.close()
        return jsonify(success=False, error='OTP expired. Please request a new code.')
    if entered != row['otp']:
        cur.close(); db.close()
        return jsonify(success=False, error='Incorrect code. Please try again.')
    cur.execute('UPDATE learners SET email_verified=1 WHERE id_number=%s', (id_number,))
    cur.execute('DELETE FROM otp_tokens WHERE identifier=%s AND purpose=%s', (id_number, 'account_verify'))
    db.commit()
    cur.execute('SELECT * FROM learners WHERE id_number=%s', (id_number,))
    learner = cur.fetchone()
    cur.execute('SELECT * FROM applications WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (learner['id'],))
    app_row = cur.fetchone()
    full_name = f"{learner['first_name']} {learner['last_name']}"
    try:
        body    = ai_registration_msg(full_name, app_row['grade'], app_row['year'])
        subject = f"[{SCHOOL_NAME}] Application Received — Under Review"
        sent    = send_emailjs(learner['email'], subject, body, full_name)
        if sent:
            log_email(db, learner['id'], 'registration_received', learner['email'])
            db.commit()
    except Exception as e:
        app.logger.error(f"Post-verification email failed: {e}")
    cur.close(); db.close()
    return jsonify(success=True)


@app.route('/resend-account-otp', methods=['POST'])
def resend_account_otp():
    id_number = request.form.get('idNumber', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT id FROM learners WHERE id_number=%s', (id_number,))
    if not cur.fetchone():
        cur.close(); db.close()
        return jsonify(success=False, error='Account not found.')
    otp     = generate_otp()
    expires = (datetime.datetime.utcnow() + datetime.timedelta(minutes=10)).isoformat()
    cur.execute('DELETE FROM otp_tokens WHERE identifier=%s AND purpose=%s', (id_number, 'account_verify'))
    cur.execute('INSERT INTO otp_tokens(identifier,purpose,otp,expires_at) VALUES(%s,%s,%s,%s)',
               (id_number, 'account_verify', otp, expires))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True, otp=otp)


@app.route('/login', methods=['POST'])
def login():
    recaptcha_token = request.form.get('recaptcha_token', '').strip()
    if not verify_recaptcha(recaptcha_token):
        return jsonify(success=False, error='Security check failed. Please try again.')
    id_number = request.form.get('loginId', '').strip()
    password  = request.form.get('loginPassword', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id_number=%s', (id_number,))
    learner = cur.fetchone()
    cur.close(); db.close()
    if not learner or not check_password_hash(learner['password_hash'], password):
        return jsonify(success=False, error='Invalid ID number or password.')
    if learner['is_deleted']:
        return jsonify(success=False, error='This account has been removed. Please contact the school or re-register.')
    if not learner['email_verified']:
        return jsonify(success=False, error='Please verify your email before logging in.')
    session['learner_id'] = learner['id']
    session['id_number']  = learner['id_number']
    return jsonify(success=True)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('landing'))


@app.route('/dashboard')
def dashboard():
    if 'learner_id' not in session:
        return redirect(url_for('landing'))
    data = get_learner(session['id_number'])
    if not data:
        session.clear()
        return redirect(url_for('landing'))
    return render_template('dashboard.html', data=data, doc_types=DOCUMENT_TYPES)


@app.route('/verify-learner-password', methods=['POST'])
@learner_required
def verify_learner_password():
    password = request.form.get('password', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id=%s', (session['learner_id'],))
    learner = cur.fetchone()
    cur.close(); db.close()
    if check_password_hash(learner['password_hash'], password):
        return jsonify(success=True)
    return jsonify(success=False, error='Incorrect password.')


@app.route('/delete-application', methods=['POST'])
@learner_required
def delete_application():
    """Fully purge the learner's application and all linked data so they can re-apply."""
    password = request.form.get('password', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id=%s', (session['learner_id'],))
    learner = cur.fetchone()
    if not check_password_hash(learner['password_hash'], password):
        cur.close(); db.close()
        return jsonify(success=False, error='Incorrect password.')
    cur.execute('SELECT * FROM applications WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (session['learner_id'],))
    app_row = cur.fetchone()
    if not app_row:
        cur.close(); db.close()
        return jsonify(success=False, error='No application found.')
    if app_row['status'] != 'Pending':
        cur.close(); db.close()
        return jsonify(success=False, error='Only pending applications can be deleted.')

    lid = session['learner_id']
    # Full data purge — delete everything linked to this learner
    cur.execute('DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE learner_id=%s)', (lid,))
    cur.execute('DELETE FROM chat_sessions WHERE learner_id=%s', (lid,))
    cur.execute('DELETE FROM doc_reminders WHERE learner_id=%s', (lid,))
    cur.execute('DELETE FROM email_log WHERE learner_id=%s', (lid,))
    cur.execute('DELETE FROM documents WHERE learner_id=%s', (lid,))
    cur.execute('DELETE FROM subjects WHERE learner_id=%s', (lid,))
    cur.execute('DELETE FROM parents WHERE learner_id=%s', (lid,))
    cur.execute('DELETE FROM applications WHERE learner_id=%s', (lid,))
    cur.execute('DELETE FROM learners WHERE id=%s', (lid,))
    db.commit()
    cur.close(); db.close()
    session.clear()
    return jsonify(success=True, message='Application and all data deleted. You may re-register.')


# ── EDIT PROFILE (new: name, surname, email, cellphone) ──────────────────────
@app.route('/edit-profile', methods=['POST'])
@learner_required
def edit_profile():
    first_name = request.form.get('firstName', '').strip()
    last_name  = request.form.get('lastName', '').strip()
    email      = request.form.get('email', '').strip().lower()
    cellphone  = request.form.get('cellphone', '').strip()

    if not first_name or not last_name:
        return jsonify(success=False, error='First name and last name are required.')
    if not email:
        return jsonify(success=False, error='Email is required.')
    if not cellphone:
        return jsonify(success=False, error='Cellphone is required.')

    db  = get_db()
    cur = db.cursor()
    # Check email uniqueness (excluding current learner)
    cur.execute('SELECT id FROM learners WHERE email=%s AND id!=%s AND is_deleted=0', (email, session['learner_id']))
    if cur.fetchone():
        cur.close(); db.close()
        return jsonify(success=False, error='This email is already used by another account.')
    cur.execute(
        'UPDATE learners SET first_name=%s, last_name=%s, email=%s, cellphone=%s WHERE id=%s',
        (first_name, last_name, email, cellphone, session['learner_id'])
    )
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True)


# ── EDIT PARENT (all fields) ──────────────────────────────────────────────────
@app.route('/edit-parent', methods=['POST'])
@learner_required
def edit_parent():
    f          = request.form
    rel        = f.get('relationship', '').strip()
    name       = f.get('name', '').strip()
    id_number  = f.get('idNumber', '').strip()
    phone      = f.get('phone', '').strip()
    email      = f.get('email', '').strip()

    if not all([rel, name, id_number, phone]):
        return jsonify(success=False, error='All parent fields (except email) are required.')

    p_id_valid, p_id_result = validate_sa_id(id_number)
    if not p_id_valid:
        return jsonify(success=False, error=f'Parent ID: {p_id_result}')

    db  = get_db()
    cur = db.cursor()
    cur.execute('UPDATE parents SET relationship=%s, name=%s, id_number=%s, phone=%s, email=%s WHERE learner_id=%s',
               (rel, name, id_number, phone, email, session['learner_id']))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True)


@app.route('/upload-document', methods=['POST'])
@learner_required
def upload_document():
    doc_type = request.form.get('documentType', '').strip()
    if doc_type not in DOCUMENT_TYPES:
        return jsonify(success=False, error='Invalid document type.')
    if 'file' not in request.files or request.files['file'].filename == '':
        return jsonify(success=False, error='No file selected.')
    file = request.files['file']
    if not allowed_file(file.filename):
        return jsonify(success=False, error='Allowed: PDF, PNG, JPG, JPEG, GIF.')
    lid      = session['learner_id']
    folder   = os.path.join(app.config['UPLOAD_FOLDER'], str(lid))
    os.makedirs(folder, exist_ok=True)
    filename = secure_filename(f"{doc_type}_{file.filename}")
    file.save(os.path.join(folder, filename))
    db  = get_db()
    cur = db.cursor()
    now = datetime.datetime.utcnow().isoformat()
    cur.execute('UPDATE documents SET uploaded=1,file_name=%s,upload_date=%s WHERE learner_id=%s AND doc_type=%s',
               (filename, now, lid, doc_type))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True, message=f'{DOCUMENT_TYPES[doc_type]["name"]} uploaded successfully!')


@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    id_number = request.form.get('idNumber', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id_number=%s', (id_number,))
    learner = cur.fetchone()
    if not learner:
        cur.close(); db.close()
        return jsonify(success=False, error='No account found with this ID number.')
    otp     = generate_otp()
    expires = (datetime.datetime.utcnow() + datetime.timedelta(minutes=5)).isoformat()
    cur.execute('DELETE FROM otp_tokens WHERE identifier=%s AND purpose=%s', (id_number, 'pw_reset'))
    cur.execute('INSERT INTO otp_tokens(identifier,purpose,otp,expires_at) VALUES(%s,%s,%s,%s)',
               (id_number, 'pw_reset', otp, expires))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True, otp=otp, email=learner['email'])


@app.route('/verify-otp', methods=['POST'])
def verify_otp():
    id_number = request.form.get('idNumber', '').strip()
    entered   = request.form.get('otp', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM otp_tokens WHERE identifier=%s AND purpose=%s ORDER BY id DESC LIMIT 1',
        (id_number, 'pw_reset'))
    row = cur.fetchone()
    cur.close(); db.close()
    if not row:
        return jsonify(success=False, error='OTP session not found.')
    if datetime.datetime.utcnow() > datetime.datetime.fromisoformat(row['expires_at']):
        return jsonify(success=False, error='OTP expired. Please request a new one.')
    if entered != row['otp']:
        return jsonify(success=False, error='Invalid OTP. Please try again.')
    session['otp_verified_id'] = id_number
    return jsonify(success=True)


@app.route('/reset-password', methods=['POST'])
def reset_password():
    id_number = session.get('otp_verified_id')
    if not id_number:
        return jsonify(success=False, error='Session expired. Please restart.')
    new_pw  = request.form.get('newPassword', '').strip()
    confirm = request.form.get('confirmPassword', '').strip()
    if len(new_pw) < 8:
        return jsonify(success=False, error='Password must be at least 8 characters.')
    if new_pw != confirm:
        return jsonify(success=False, error='Passwords do not match.')
    db  = get_db()
    cur = db.cursor()
    cur.execute('UPDATE learners SET password_hash=%s WHERE id_number=%s',
               (generate_password_hash(new_pw), id_number))
    cur.execute('DELETE FROM otp_tokens WHERE identifier=%s AND purpose=%s', (id_number, 'pw_reset'))
    db.commit()
    cur.close(); db.close()
    session.pop('otp_verified_id', None)
    return jsonify(success=True)


@app.route('/apply-next-year', methods=['POST'])
@learner_required
def apply_next_year():
    if not is_application_window_open():
        open_year, next_year, last_feb = application_window_dates()
        return jsonify(success=False,
                       error=f'Applications are closed. The window opens 1 March {open_year} '
                             f'and closes {last_feb} February {open_year + 1}.')
    lid = session['learner_id']
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM applications WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (lid,))
    app_row = cur.fetchone()
    if not app_row:
        cur.close(); db.close()
        return jsonify(success=False, error='No existing application found.')
    next_grade = str(int(app_row['grade']) + 1)
    if int(next_grade) > 12:
        cur.close(); db.close()
        return jsonify(success=False, error='No further grades available.')
    target_year = get_application_year()
    cur.execute('SELECT id FROM applications WHERE learner_id=%s AND year=%s', (lid, target_year))
    if cur.fetchone():
        cur.close(); db.close()
        return jsonify(success=False, error=f'You have already applied for {target_year}.')
    now_iso = datetime.datetime.utcnow().isoformat()
    cur.execute('INSERT INTO applications(learner_id,grade,year,status,applied_at) VALUES(%s,%s,%s,%s,%s)',
               (lid, next_grade, target_year, 'Pending', now_iso))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True, message=f'Applied for Grade {next_grade} in {target_year}.')


# ── LIVE CHAT ─────────────────────────────────────────────────────────────────
@app.route('/chat/session', methods=['GET', 'POST'])
@learner_required
def chat_session():
    lid = session['learner_id']
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM chat_sessions WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (lid,))
    sess = cur.fetchone()
    if not sess:
        now_iso = datetime.datetime.utcnow().isoformat()
        cur.execute('INSERT INTO chat_sessions(learner_id,status,created_at,updated_at) VALUES(%s,%s,%s,%s) RETURNING id',
                   (lid, 'bot', now_iso, now_iso))
        sess_id = cur.fetchone()['id']
        # Welcome bot message
        bot_msg = "👋 Hello! I'm SIYATOP, your virtual assistant at Siyaphakama High School. How can I help you today? You can ask me about your application status, required documents, or anything else. If you need to speak to an admin, just type 'speak to admin'."
        cur.execute('INSERT INTO chat_messages(session_id,sender,message,sent_at,is_read) VALUES(%s,%s,%s,%s,1)',
                   (sess_id, 'bot', bot_msg, now_iso))
        db.commit()
        cur.execute('SELECT * FROM chat_sessions WHERE id=%s', (sess_id,))
        sess = cur.fetchone()
    cur.execute('SELECT * FROM chat_messages WHERE session_id=%s ORDER BY sent_at ASC', (sess['id'],))
    messages = cur.fetchall()
    # Mark learner messages as read for admin, but mark admin messages as read for learner
    cur.execute('UPDATE chat_messages SET is_read=1 WHERE session_id=%s AND sender=%s',
               (sess['id'], 'admin'))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True, session=dict(sess), messages=[dict(m) for m in messages])


@app.route('/chat/send', methods=['POST'])
@learner_required
def chat_send():
    lid     = session['learner_id']
    message = request.form.get('message', '').strip()
    if not message:
        return jsonify(success=False, error='Message cannot be empty.')
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM chat_sessions WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (lid,))
    sess = cur.fetchone()
    if not sess:
        cur.close(); db.close()
        return jsonify(success=False, error='No chat session found.')
    now_iso = datetime.datetime.utcnow().isoformat()
    cur.execute('INSERT INTO chat_messages(session_id,sender,message,sent_at,is_read) VALUES(%s,%s,%s,%s,0)',
               (sess['id'], 'learner', message, now_iso))
    cur.execute('UPDATE chat_sessions SET updated_at=%s WHERE id=%s', (now_iso, sess['id']))

    bot_reply = None
    if sess['status'] == 'bot':
        msg_lower = message.lower()
        if any(kw in msg_lower for kw in ['admin', 'human', 'person', 'staff', 'help me', 'speak to', 'talk to']):
            # Escalate to admin
            cur.execute('UPDATE chat_sessions SET status=%s WHERE id=%s', ('waiting', sess['id']))
            bot_reply = "⏳ I'm connecting you to a Siyaphakama admin now. Please hold on — an admin will reply to you shortly. Thank you for your patience! 🙏"
        else:
            # SIYATOP bot auto-responses
            if any(kw in msg_lower for kw in ['status', 'application', 'applied']):
                cur.execute('SELECT * FROM learners WHERE id=%s', (lid,))
                lrn = cur.fetchone()
                cur.execute('SELECT * FROM applications WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (lid,))
                app_row = cur.fetchone()
                if app_row:
                    bot_reply = f"📋 Your application for Grade {app_row['grade']} ({app_row['year']}) is currently **{app_row['status']}**. Applied on {app_row['applied_at'][:10]}."
                else:
                    bot_reply = "📋 I couldn't find an active application on your account. Please contact admin if you believe this is an error."
            elif any(kw in msg_lower for kw in ['document', 'upload', 'file', 'missing']):
                bot_reply = "📂 You can upload your documents on your dashboard under 'Required Documents'. Make sure to upload: Learner ID Copy, Parent ID Copy, School Report, and Proof of Residence. Need more help? Type 'speak to admin'."
            elif any(kw in msg_lower for kw in ['password', 'login', 'forgot']):
                bot_reply = "🔑 To reset your password, click 'Forgot Password' on the login page. You'll receive an OTP to reset it. Still stuck? Type 'speak to admin'."
            elif any(kw in msg_lower for kw in ['grade', 'class', 'subject']):
                bot_reply = "🏫 Grade 8 & 9 learners have fixed subjects. Grade 10-12 learners choose between Science and Humanities streams. Check your dashboard for your assigned subjects."
            elif any(kw in msg_lower for kw in ['when', 'date', 'open', 'close', 'deadline']):
                bot_reply = "📅 Applications are open from 1 March each year and close in February of the following year. Make sure to submit before the deadline!"
            elif any(kw in msg_lower for kw in ['hello', 'hi', 'hey', 'good']):
                bot_reply = "😊 Hello there! I'm SIYATOP. I'm here to help you with your Siyaphakama application. What would you like to know? You can ask about your application status, documents, or anything else!"
            elif any(kw in msg_lower for kw in ['thank', 'thanks']):
                bot_reply = "🌟 You're very welcome! Is there anything else I can help you with?"
            else:
                bot_reply = "🤔 I'm not sure I understood that. Here's what I can help with:\n• Application status\n• Document uploads\n• Password reset\n• Application dates\n• Class & subject info\n\nOr type **'speak to admin'** to chat with our team directly!"

    if bot_reply:
        cur.execute('INSERT INTO chat_messages(session_id,sender,message,sent_at,is_read) VALUES(%s,%s,%s,%s,0)',
                   (sess['id'], 'bot', bot_reply, datetime.datetime.utcnow().isoformat()))

    db.commit()
    # Return updated messages
    cur.execute('SELECT * FROM chat_messages WHERE session_id=%s ORDER BY sent_at ASC', (sess['id'],))
    messages = cur.fetchall()
    cur.execute('SELECT * FROM chat_sessions WHERE id=%s', (sess['id'],))
    updated_sess = cur.fetchone()
    cur.close(); db.close()
    return jsonify(success=True, session=dict(updated_sess), messages=[dict(m) for m in messages])


@app.route('/chat/poll', methods=['GET'])
@learner_required
def chat_poll():
    lid = session['learner_id']
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM chat_sessions WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (lid,))
    sess = cur.fetchone()
    if not sess:
        cur.close(); db.close()
        return jsonify(success=False)
    since = request.args.get('since', '')
    if since:
        cur.execute('SELECT * FROM chat_messages WHERE session_id=%s AND sent_at>%s ORDER BY sent_at ASC',
                   (sess['id'], since))
    else:
        cur.execute('SELECT * FROM chat_messages WHERE session_id=%s ORDER BY sent_at ASC', (sess['id'],))
    messages = cur.fetchall()
    cur.execute('UPDATE chat_messages SET is_read=1 WHERE session_id=%s AND sender IN (%s,%s)',
               (sess['id'], 'admin', 'bot'))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True, session=dict(sess), messages=[dict(m) for m in messages])


# ── ADMIN CHAT ────────────────────────────────────────────────────────────────
@app.route('/admin/chat/sessions')
@admin_required
def admin_chat_sessions():
    db  = get_db()
    cur = db.cursor()
    cur.execute('''
        SELECT cs.*, l.first_name, l.last_name, l.id_number,
               (SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id=cs.id AND cm.sender='learner' AND cm.is_read=0) as unread
        FROM chat_sessions cs
        JOIN learners l ON l.id=cs.learner_id
        WHERE cs.status IN ('waiting','active')
        ORDER BY cs.updated_at DESC
    ''')
    sessions = cur.fetchall()
    cur.close(); db.close()
    return jsonify(success=True, sessions=[dict(s) for s in sessions])


@app.route('/admin/chat/messages/<int:sess_id>')
@admin_required
def admin_chat_messages(sess_id):
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM chat_messages WHERE session_id=%s ORDER BY sent_at ASC', (sess_id,))
    messages = cur.fetchall()
    cur.execute('UPDATE chat_messages SET is_read=1 WHERE session_id=%s AND sender=%s', (sess_id, 'learner'))
    cur.execute('UPDATE chat_sessions SET status=%s WHERE id=%s AND status=%s', ('active', sess_id, 'waiting'))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True, messages=[dict(m) for m in messages])


@app.route('/admin/chat/send', methods=['POST'])
@admin_required
def admin_chat_send():
    sess_id = request.form.get('session_id', '').strip()
    message = request.form.get('message', '').strip()
    if not message or not sess_id:
        return jsonify(success=False, error='Missing data.')
    db  = get_db()
    cur = db.cursor()
    now_iso = datetime.datetime.utcnow().isoformat()
    cur.execute('INSERT INTO chat_messages(session_id,sender,message,sent_at,is_read) VALUES(%s,%s,%s,%s,0)',
               (sess_id, 'admin', message, now_iso))
    cur.execute('UPDATE chat_sessions SET status=%s, updated_at=%s WHERE id=%s', ('active', now_iso, sess_id))
    db.commit()
    cur.execute('SELECT * FROM chat_messages WHERE session_id=%s ORDER BY sent_at ASC', (sess_id,))
    messages = cur.fetchall()
    cur.close(); db.close()
    return jsonify(success=True, messages=[dict(m) for m in messages])


@app.route('/admin/chat/close/<int:sess_id>', methods=['POST'])
@admin_required
def admin_chat_close(sess_id):
    db  = get_db()
    cur = db.cursor()
    now_iso = datetime.datetime.utcnow().isoformat()
    cur.execute('UPDATE chat_sessions SET status=%s, updated_at=%s WHERE id=%s', ('closed', now_iso, sess_id))
    cur.execute('INSERT INTO chat_messages(session_id,sender,message,sent_at,is_read) VALUES(%s,%s,%s,%s,1)',
               (sess_id, 'bot', '✅ This chat session has been closed by admin. Thank you for contacting Siyaphakama High School!', now_iso))
    db.commit()
    cur.close(); db.close()
    return jsonify(success=True)


@app.route('/admin/chat/unread-count')
@admin_required
def admin_chat_unread_count():
    db  = get_db()
    cur = db.cursor()
    cur.execute('''
        SELECT COUNT(DISTINCT cs.id) as count
        FROM chat_sessions cs
        JOIN chat_messages cm ON cm.session_id=cs.id
        WHERE cs.status IN ('waiting','active') AND cm.sender='learner' AND cm.is_read=0
    ''')
    row = cur.fetchone()
    cur.close(); db.close()
    count = list(row.values())[0] if row else 0
    return jsonify(success=True, count=count)


# ── ADMIN ─────────────────────────────────────────────────────────────────────
@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if session.get('admin_id'):
        return redirect(url_for('admin_dashboard'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        db  = get_db()
        cur = db.cursor()
        cur.execute('SELECT * FROM admins WHERE username=%s', (username,))
        admin = cur.fetchone()
        cur.close(); db.close()
        if admin and check_password_hash(admin['password_hash'], password):
            session['admin_id']       = admin['id']
            session['admin_username'] = admin['username']
            return redirect(url_for('admin_dashboard'))
        error = 'Invalid username or password.'
    return render_template('admin/login.html', error=error)


@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_id', None)
    session.pop('admin_username', None)
    return redirect(url_for('admin_login'))


@app.route('/admin')
@admin_required
def admin_dashboard():
    db  = get_db()
    cur = db.cursor()
    filter = request.args.get('filter', 'all')
    def count(sql): cur.execute(sql); row = cur.fetchone(); return list(row.values())[0] if row else 0
    stats = {
        'total':    count("SELECT COUNT(*) FROM learners WHERE is_deleted=0"),
        'pending':  count("SELECT COUNT(*) FROM applications a JOIN learners l ON l.id=a.learner_id WHERE a.status='Pending' AND l.is_deleted=0"),
        'accepted': count("SELECT COUNT(*) FROM applications a JOIN learners l ON l.id=a.learner_id WHERE a.status='Accepted' AND l.is_deleted=0"),
        'declined': count("SELECT COUNT(*) FROM applications a JOIN learners l ON l.id=a.learner_id WHERE a.status='Declined' AND l.is_deleted=0"),
        'deleted':  count("SELECT COUNT(*) FROM learners WHERE is_deleted=1"),
    }
    # unread chat count
    cur.execute('''
        SELECT COUNT(DISTINCT cs.id) as count FROM chat_sessions cs
        JOIN chat_messages cm ON cm.session_id=cs.id
        WHERE cs.status IN ('waiting','active') AND cm.sender='learner' AND cm.is_read=0
    ''')
    row = cur.fetchone()
    stats['chat_unread'] = list(row.values())[0] if row else 0

    if filter == 'deleted':
        cur.execute('''
            SELECT l.id, l.first_name, l.last_name, l.id_number, l.email, l.cellphone,
                   l.deleted_at, a.grade, a.year, a.status, a.applied_at, a.id AS app_id
            FROM learners l
            LEFT JOIN applications a ON a.learner_id = l.id
            WHERE l.is_deleted=1
            ORDER BY l.deleted_at DESC
        ''')
    elif filter in ('pending', 'accepted', 'declined'):
        cur.execute('''
            SELECT l.id, l.first_name, l.last_name, l.id_number, l.email, l.cellphone,
                   NULL as deleted_at, a.grade, a.year, a.status, a.applied_at, a.id AS app_id
            FROM learners l
            LEFT JOIN applications a ON a.learner_id = l.id
            WHERE LOWER(a.status)=%s AND l.is_deleted=0
            ORDER BY a.applied_at DESC
        ''', (filter,))
    else:
        cur.execute('''
            SELECT l.id, l.first_name, l.last_name, l.id_number, l.email, l.cellphone,
                   NULL as deleted_at, a.grade, a.year, a.status, a.applied_at, a.id AS app_id
            FROM learners l
            LEFT JOIN applications a ON a.learner_id = l.id
            WHERE l.is_deleted=0
            ORDER BY a.applied_at DESC
        ''')
    learners = cur.fetchall()
    cur.close(); db.close()
    return render_template('admin/dashboard.html', stats=stats, learners=learners,
                           admin=session.get('admin_username'), active_filter=filter)


@app.route('/admin/learner/<int:lid>')
@admin_required
def admin_learner_detail(lid):
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id=%s', (lid,))
    learner = cur.fetchone()
    if not learner:
        cur.close(); db.close(); abort(404)
    cur.execute('SELECT * FROM applications WHERE learner_id=%s ORDER BY id DESC LIMIT 1', (lid,))
    app_row = cur.fetchone()
    cur.execute('SELECT * FROM parents WHERE learner_id=%s', (lid,))
    parent = cur.fetchone()
    cur.execute('SELECT code FROM subjects WHERE learner_id=%s', (lid,))
    subjects = [r['code'] for r in cur.fetchall()]
    cur.execute('SELECT * FROM documents WHERE learner_id=%s', (lid,))
    docs = cur.fetchall()
    cur.execute('SELECT * FROM email_log WHERE learner_id=%s ORDER BY sent_at DESC', (lid,))
    emails = cur.fetchall()
    cur.close(); db.close()
    return render_template('admin/learner_detail.html',
                           learner=learner, application=app_row, parent=parent,
                           subjects=subjects, docs=docs, doc_types=DOCUMENT_TYPES, emails=emails)


@app.route('/admin/learner/<int:lid>/delete', methods=['POST'])
@admin_required
def admin_delete_learner(lid):
    password = request.form.get('admin_password', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM admins WHERE id=%s', (session['admin_id'],))
    admin = cur.fetchone()
    if not check_password_hash(admin['password_hash'], password):
        cur.close(); db.close()
        flash('Incorrect admin password. Learner was not deleted.', 'error')
        return redirect(url_for('admin_learner_detail', lid=lid))
    now_iso = datetime.datetime.utcnow().isoformat()
    cur.execute('UPDATE learners SET is_deleted=1, deleted_at=%s WHERE id=%s', (now_iso, lid))
    db.commit()
    cur.close(); db.close()
    flash('Learner permanently removed. They may re-register if they wish.', 'success')
    return redirect(url_for('admin_dashboard'))


@app.route('/admin/grade/<grade>')
@admin_required
def admin_grade_view(grade):
    if grade not in ('8', '9', '10', '11', '12'):
        abort(404)
    db  = get_db()
    cur = db.cursor()
    classes = []
    if grade in ('8', '9'):
        for letter in ('A', 'B'):
            ck = f"{grade}{letter}"
            cur.execute('SELECT * FROM class_assignments WHERE class_key=%s', (ck,))
            cls_row = cur.fetchone()
            cur.execute('''
                SELECT l.id, l.first_name, l.last_name, l.id_number, l.learner_class, a.status
                FROM learners l JOIN applications a ON a.learner_id=l.id
                WHERE a.grade=%s AND l.learner_class=%s AND l.is_deleted=0
                ORDER BY l.first_name
            ''', (grade, letter))
            learners = cur.fetchall()
            classes.append({'key': ck, 'label': f'Grade {ck}', 'cls_row': cls_row, 'learners': learners})
    elif grade in ('10', '11', '12'):
        for stream in ('Science', 'Humanities'):
            ck = f"{grade}-{stream}"
            cur.execute('SELECT * FROM class_assignments WHERE class_key=%s', (ck,))
            cls_row = cur.fetchone()
            cur.execute('''
                SELECT l.id, l.first_name, l.last_name, l.id_number, l.learner_class, a.status
                FROM learners l JOIN applications a ON a.learner_id=l.id
                WHERE a.grade=%s AND l.learner_class=%s AND l.is_deleted=0
                ORDER BY l.first_name
            ''', (grade, stream))
            learners = cur.fetchall()
            classes.append({'key': ck, 'label': f'Grade {grade} — {stream}', 'cls_row': cls_row, 'learners': learners})
    cur.close(); db.close()
    return render_template('admin/grade_view.html', grade=grade, classes=classes,
                           admin=session.get('admin_username'))


@app.route('/admin/review/<int:app_id>', methods=['POST'])
@admin_required
def admin_review(app_id):
    decision = request.form.get('decision', '').strip()
    reason   = request.form.get('reason', '').strip()
    if decision not in ('Accepted', 'Declined'):
        flash('Invalid decision.', 'error')
        return redirect(url_for('admin_dashboard'))
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM applications WHERE id=%s', (app_id,))
    app_row = cur.fetchone()
    if not app_row:
        cur.close(); db.close(); abort(404)
    cur.execute('SELECT * FROM learners WHERE id=%s', (app_row['learner_id'],))
    learner = cur.fetchone()
    now_iso = datetime.datetime.utcnow().isoformat()
    cur.execute('UPDATE applications SET status=%s,decline_reason=%s,reviewed_at=%s WHERE id=%s',
               (decision, reason if decision == 'Declined' else None, now_iso, app_id))
    db.commit()
    full_name = f"{learner['first_name']} {learner['last_name']}"
    if decision == 'Accepted':
        body       = ai_accepted_msg(full_name, app_row['grade'], app_row['year'])
        subject    = f"[{SCHOOL_NAME}] 🎉 Application Accepted — Congratulations!"
        email_type = 'accepted'
    else:
        body       = ai_declined_msg(full_name, app_row['grade'], app_row['year'], reason or 'Not specified')
        subject    = f"[{SCHOOL_NAME}] Application Outcome"
        email_type = 'declined'
    sent = send_emailjs(learner['email'], subject, body, full_name)
    if sent:
        log_email(db, learner['id'], email_type, learner['email'])
        db.commit()
    cur.close(); db.close()
    flash(f'Application {decision}. {"Email sent to " + learner["email"] if sent else "Email could not be sent."}', 'success')
    return redirect(url_for('admin_learner_detail', lid=learner['id']))


@app.route('/admin/send-reminder/<int:lid>', methods=['POST'])
@admin_required
def admin_send_reminder(lid):
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id=%s', (lid,))
    learner = cur.fetchone()
    if not learner:
        cur.close(); db.close(); abort(404)
    cur.execute('SELECT * FROM documents WHERE learner_id=%s', (lid,))
    docs = cur.fetchall()
    is_disabled = bool(learner['has_disability'])
    missing = [DOCUMENT_TYPES[d['doc_type']]['name']
               for d in docs if not d['uploaded'] and (
                   DOCUMENT_TYPES.get(d['doc_type'], {}).get('required') or
                   (DOCUMENT_TYPES.get(d['doc_type'], {}).get('disability_only') and is_disabled)
               )]
    if not missing:
        cur.close(); db.close()
        flash('No missing required documents.', 'info')
        return redirect(url_for('admin_learner_detail', lid=lid))
    name    = f"{learner['first_name']} {learner['last_name']}"
    body    = ai_doc_reminder_msg(name, missing)
    subject = f"[{SCHOOL_NAME}] Action Required: Missing Documents"
    if send_emailjs(learner['email'], subject, body, name):
        log_email(db, lid, 'doc_reminder_manual', learner['email'])
        db.commit()
        flash(f'Reminder sent to {learner["email"]}.', 'success')
    else:
        flash('Failed to send reminder. Check SMTP configuration.', 'error')
    cur.close(); db.close()
    return redirect(url_for('admin_learner_detail', lid=lid))


@app.route('/admin/change-password', methods=['POST'])
@admin_required
def admin_change_password():
    current = request.form.get('current_password', '').strip()
    new_pw  = request.form.get('new_password', '').strip()
    confirm = request.form.get('confirm_password', '').strip()
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM admins WHERE id=%s', (session['admin_id'],))
    admin = cur.fetchone()
    if not check_password_hash(admin['password_hash'], current):
        flash('Current password is incorrect.', 'error')
    elif new_pw != confirm:
        flash('New passwords do not match.', 'error')
    elif len(new_pw) < 8:
        flash('Password must be at least 8 characters.', 'error')
    else:
        cur.execute('UPDATE admins SET password_hash=%s WHERE id=%s',
                   (generate_password_hash(new_pw), session['admin_id']))
        db.commit()
        flash('Password changed successfully.', 'success')
    cur.close(); db.close()
    return redirect(url_for('admin_dashboard'))


@app.route('/document/<int:lid>/<doc_type>')
def view_document(lid, doc_type):
    if not session.get('admin_id') and session.get('learner_id') != lid:
        abort(403)
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM documents WHERE learner_id=%s AND doc_type=%s', (lid, doc_type))
    doc = cur.fetchone()
    cur.close(); db.close()
    if not doc or not doc['uploaded'] or not doc['file_name']:
        abort(404)
    folder = os.path.join(app.config['UPLOAD_FOLDER'], str(lid))
    return send_from_directory(folder, doc['file_name'])


@app.route('/admin/classes')
@admin_required
def admin_classes():
    db  = get_db()
    cur = db.cursor()
    class_keys  = ['8A', '8B', '9A', '9B', '10-Science', '10-Humanities', '11-Science', '11-Humanities', '12-Science', '12-Humanities']
    assignments = {}
    for ck in class_keys:
        cur.execute('SELECT * FROM class_assignments WHERE class_key=%s', (ck,))
        row = cur.fetchone()
        if ck in ('8A', '8B', '9A', '9B'):
            grade = ck[0]
            cur.execute('''
                SELECT l.id, l.first_name, l.last_name, l.learner_class
                FROM learners l JOIN applications a ON a.learner_id = l.id
                WHERE a.grade=%s AND a.status='Accepted' AND l.learner_class=%s
                ORDER BY l.first_name
            ''', (grade, ck[1]))
        else:
            parts = ck.split('-')
            grade, stream = parts[0], parts[1]
            cur.execute('''
                SELECT l.id, l.first_name, l.last_name, l.learner_class
                FROM learners l JOIN applications a ON a.learner_id = l.id
                WHERE a.grade=%s AND a.status='Accepted' AND l.learner_class=%s
                ORDER BY l.first_name
            ''', (grade, stream))
        learners = cur.fetchall()
        assignments[ck] = {'row': row, 'learners': learners}
    unassigned = {}
    for g in ('8', '9'):
        cur.execute('''
            SELECT l.id, l.first_name, l.last_name
            FROM learners l JOIN applications a ON a.learner_id = l.id
            WHERE a.grade=%s AND a.status='Accepted' AND (l.learner_class IS NULL OR l.learner_class='')
            ORDER BY l.first_name
        ''', (g,))
        rows = cur.fetchall()
        if rows:
            unassigned[g] = rows
    cur.close(); db.close()
    return render_template('admin/classes.html', assignments=assignments,
                           unassigned=unassigned, admin=session.get('admin_username'))


@app.route('/admin/classes/save', methods=['POST'])
@admin_required
def admin_classes_save():
    class_key  = request.form.get('class_key', '').strip()
    teacher    = request.form.get('teacher', '').strip()
    rep1       = request.form.get('rep1', '').strip() or None
    rep2       = request.form.get('rep2', '').strip() or None
    valid_keys = ['8A', '8B', '9A', '9B', '10-Science', '10-Humanities', '11-Science', '11-Humanities', '12-Science', '12-Humanities']
    if class_key not in valid_keys:
        flash('Invalid class.', 'error')
        return redirect(url_for('admin_classes'))
    db  = get_db()
    cur = db.cursor()
    now_iso = datetime.datetime.utcnow().isoformat()
    cur.execute('SELECT id FROM class_assignments WHERE class_key=%s', (class_key,))
    if cur.fetchone():
        cur.execute('UPDATE class_assignments SET teacher=%s,rep1_learner_id=%s,rep2_learner_id=%s,updated_at=%s WHERE class_key=%s',
                   (teacher, rep1, rep2, now_iso, class_key))
    else:
        cur.execute('INSERT INTO class_assignments(class_key,teacher,rep1_learner_id,rep2_learner_id,updated_at) VALUES(%s,%s,%s,%s,%s)',
                   (class_key, teacher, rep1, rep2, now_iso))
    db.commit()
    cur.close(); db.close()
    flash(f'Class {class_key} saved successfully.', 'success')
    return redirect(url_for('admin_classes'))


@app.route('/admin/classes/upload-photo', methods=['POST'])
@admin_required
def admin_classes_upload_photo():
    class_key  = request.form.get('class_key', '').strip()
    photo_role = request.form.get('photo_role', '').strip()   # teacher | rep1 | rep2
    valid_keys = ['8A', '8B', '9A', '9B', '10-Science', '10-Humanities',
                  '11-Science', '11-Humanities', '12-Science', '12-Humanities']
    valid_roles = ('teacher', 'rep1', 'rep2')
    if class_key not in valid_keys or photo_role not in valid_roles:
        flash('Invalid class or role.', 'error')
        return redirect(url_for('admin_classes'))
    if 'photo' not in request.files or request.files['photo'].filename == '':
        flash('No file selected.', 'error')
        return redirect(url_for('admin_classes'))
    file = request.files['photo']
    ext  = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in {'png', 'jpg', 'jpeg', 'gif', 'webp'}:
        flash('Allowed image types: PNG, JPG, JPEG, GIF, WEBP.', 'error')
        return redirect(url_for('admin_classes'))
    folder   = os.path.join(app.config['UPLOAD_FOLDER'], 'class_photos')
    os.makedirs(folder, exist_ok=True)
    safe_key = class_key.replace('-', '_')
    filename = secure_filename(f"{safe_key}_{photo_role}.{ext}")
    file.save(os.path.join(folder, filename))
    col = f"{photo_role}_photo"
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT id FROM class_assignments WHERE class_key=%s', (class_key,))
    if cur.fetchone():
        cur.execute(f'UPDATE class_assignments SET {col}=%s WHERE class_key=%s', (filename, class_key))
    else:
        now_iso = datetime.datetime.utcnow().isoformat()
        cur.execute(f'INSERT INTO class_assignments(class_key,{col},updated_at) VALUES(%s,%s,%s)',
                    (class_key, filename, now_iso))
    db.commit()
    cur.close(); db.close()
    flash(f'Photo uploaded successfully for {photo_role}.', 'success')
    return redirect(url_for('admin_classes'))


@app.route('/class-photo/<filename>')
def class_photo(filename):
    """Serve class assignment photos (teacher / rep). Public."""
    filename = secure_filename(filename)
    folder   = os.path.join(app.config['UPLOAD_FOLDER'], 'class_photos')
    return send_from_directory(folder, filename)


@app.route('/admin/classes/assign', methods=['POST'])
@admin_required
def admin_assign_class():
    learner_id    = request.form.get('learner_id', '').strip()
    learner_class = request.form.get('learner_class', '').strip()
    if learner_class not in ('A', 'B'):
        flash('Invalid class assignment.', 'error')
        return redirect(url_for('admin_classes'))
    db  = get_db()
    cur = db.cursor()
    cur.execute('UPDATE learners SET learner_class=%s WHERE id=%s', (learner_class, learner_id))
    db.commit()
    cur.close(); db.close()
    flash('Learner assigned successfully.', 'success')
    return redirect(url_for('admin_classes'))


@app.route('/my-class-info')
def my_class_info():
    if 'learner_id' not in session:
        return jsonify(success=False, error='Not logged in.')
    db  = get_db()
    cur = db.cursor()
    cur.execute('SELECT * FROM learners WHERE id=%s', (session['learner_id'],))
    learner = cur.fetchone()
    cur.execute('SELECT * FROM applications WHERE learner_id=%s ORDER BY id DESC LIMIT 1',
                (session['learner_id'],))
    app_row = cur.fetchone()
    if not app_row:
        cur.close(); db.close()
        return jsonify(success=False, error='No application found.')
    grade         = app_row['grade']
    learner_class = learner['learner_class'] or ''
    if grade in ('8', '9'):
        if learner_class not in ('A', 'B'):
            cur.close(); db.close()
            return jsonify(success=True, grade=grade, assigned=False,
                           class_name=None, message='Your class has not been assigned yet.')
        class_key  = f"{grade}{learner_class}"
        class_name = f"Grade {grade}{learner_class}"
    elif grade in ('10', '11', '12'):
        if learner_class not in ('Science', 'Humanities'):
            cur.close(); db.close()
            return jsonify(success=True, grade=grade, assigned=False,
                           class_name=None, message='Your stream could not be determined.')
        class_key  = f"{grade}-{learner_class}"
        class_name = f"Grade {grade} — {learner_class}"
    else:
        class_key  = grade
        class_name = f"Grade {grade}"
    cur.execute('SELECT * FROM class_assignments WHERE class_key=%s', (class_key,))
    row = cur.fetchone()
    if not row:
        cur.close(); db.close()
        return jsonify(success=True, grade=grade, assigned=False,
                       class_name=class_name, message='Class teacher not yet assigned.')
    def rep_name(rep_id):
        if not rep_id: return None
        cur.execute('SELECT first_name, last_name FROM learners WHERE id=%s', (rep_id,))
        r = cur.fetchone()
        return f"{r['first_name']} {r['last_name']}" if r else None
    def photo_url(fname):
        if not fname: return None
        return url_for('class_photo', filename=fname)
    result = jsonify(
        success        = True,
        grade          = grade,
        assigned       = True,
        class_name     = class_name,
        teacher        = row['teacher'] or None,
        teacher_photo  = photo_url(row.get('teacher_photo')),
        rep1           = rep_name(row['rep1_learner_id']),
        rep1_photo     = photo_url(row.get('rep1_photo')),
        rep2           = rep_name(row['rep2_learner_id']),
        rep2_photo     = photo_url(row.get('rep2_photo')),
        updated        = (row['updated_at'] or '')[:10]
    )
    cur.close(); db.close()
    return result


os.makedirs('uploads', exist_ok=True)
init_db()

if __name__ == '__main__':
    app.run(debug=True)
