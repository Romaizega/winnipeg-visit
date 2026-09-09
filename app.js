'use strict';

// ══════════════════════════════════════════════
//  STORAGE
// ══════════════════════════════════════════════
const DB = {
  has(key) { return localStorage.getItem(key) !== null; },
  get(key, def=[]) { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (err) {
      console.error(`Failed to save ${key}:`, err);
      if (err?.name === 'QuotaExceededError') {
        setTimeout(() => toast('Storage is full. Large photos/audio need to be removed or compressed.'), 0);
      }
      return false;
    }
  },
  id() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
};

// Resize photos before putting them into localStorage.
// A phone photo can be several MB; localStorage is usually only ~5-10 MB total.
function compressImageFile(file, maxSize = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read image'));
    reader.onload = () => compressImageDataUrl(reader.result, maxSize, quality).then(resolve, reject);
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl, maxSize = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!dataUrl || !String(dataUrl).startsWith('data:image/')) { resolve(dataUrl); return; }
    const img = new Image();
    img.onerror = () => reject(new Error('Could not decode image'));
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
      const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // JPEG is dramatically smaller than an original phone PNG/HEIC conversion.
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
  });
}

async function compactStoredImages() {
  let meetingsDirty = false;
  for (const m of state.meetings) {
    for (const photo of (m.photos || [])) {
      if (photo?.data?.startsWith('data:image/') && photo.data.length > 350000) {
        try { photo.data = await compressImageDataUrl(photo.data); meetingsDirty = true; } catch {}
      }
    }
  }
  if (meetingsDirty) DB.set('meetings', state.meetings);

  let pricesDirty = false;
  for (const price of state.prices) {
    if (price?.photo?.startsWith('data:image/') && price.photo.length > 350000) {
      try { price.photo = await compressImageDataUrl(price.photo); pricesDirty = true; } catch {}
    }
  }
  if (pricesDirty) DB.set('prices', state.prices);
}


// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
const state = {
  meetings:  DB.get('meetings'),
  contacts:  DB.get('contacts'),
  districts: DB.get('districts'),
  budget:    DB.get('budget'),
  jobData:   DB.get('jobData'),
  prices:    DB.get('prices'),
  // navigation
  view: 'agenda',          // 'agenda' | 'meeting' | scanner screens
  activeTab: 'agenda',
  currentMeetingId: null,
  // recording (per-meeting)
  recording: false,
  mediaRecorder: null,
  audioChunks: [],
  recordingStart: null,
  lastScanImage: null
};

// ══════════════════════════════════════════════
//  SEED DATA
// ══════════════════════════════════════════════
function seedData() {
  if (!DB.has('meetings')) {
    state.meetings = [
      { id: DB.id(), name: 'Asper Campus, U of M',          org: 'University of Manitoba',      date: '2025-07-14', time: '10:00', status: 'done',  notes: 'Toured campus and infrastructure, met with coordinator.', photos: [], audios: [], contactId: null, icon: '🏛️' },
      { id: DB.id(), name: 'Manitoba Start',                 org: 'MPNP Office',                 date: '2025-07-14', time: '13:30', status: 'done',  notes: 'Discussed Settlement Plan. Need labour market + housing data in report.', photos: [], audios: [], contactId: null, icon: '🏛️' },
      { id: DB.id(), name: 'EGM — Engineers Geoscientists', org: 'EGM',                         date: '2025-07-14', time: '15:00', status: 'moved', notes: 'Rescheduled to next day.', photos: [], audios: [], contactId: null, icon: '⚙️' },
      { id: DB.id(), name: 'Bell MTS — RF Engineer',        org: 'Bell MTS',                    date: '2025-07-15', time: '09:00', status: 'plan',  notes: '', photos: [], audios: [], contactId: null, icon: '📡' },
      { id: DB.id(), name: 'Rogers — Telecom Dept',         org: 'Rogers Communications',       date: '2025-07-15', time: '14:00', status: 'plan',  notes: '', photos: [], audios: [], contactId: null, icon: '📡' }
    ];
    DB.set('meetings', state.meetings);
  }
  // back-fill photos/audios arrays for older records
  let dirty = false;
  state.meetings.forEach(m => {
    if (!m.photos) { m.photos = []; dirty = true; }
    if (!m.audios) { m.audios = []; dirty = true; }
  });
  if (dirty) DB.set('meetings', state.meetings);

  if (!DB.has('contacts')) {
    state.contacts = [
      { id: DB.id(), name: 'David Leblanc', org: 'Bell MTS',       role: 'Senior RF Engineer',  phone: '+1 (204) 555-0134', email: 'd.leblanc@bellmts.ca',        linkedin: 'linkedin.com/in/dleblanc', notes: 'Open to referral. Wants CV by Friday. LTE/5G roles open.', color: '#3b82f6' },
      { id: DB.id(), name: 'Sarah Rempel',  org: 'Manitoba Start', role: 'Immigration Advisor', phone: '+1 (204) 555-0288', email: 'srempel@manitobastart.com', linkedin: '',                        notes: 'Submit Settlement Plan after the report.', color: '#22c55e' }
    ];
    DB.set('contacts', state.contacts);
  }
  if (!DB.has('districts')) {
    state.districts = [
      { id: DB.id(), name: 'Tuxedo',        rent: '$2,400–2,800', type: '3-bed townhouse', pros: ['Good schools','Quiet','Safe'],           cons: ['Expensive','No BRT'] },
      { id: DB.id(), name: 'River Heights', rent: '$1,900–2,300', type: '2-bed apartment', pros: ['Close to downtown','Parks','Bike lanes'], cons: ['Paid parking','Noisier'] },
      { id: DB.id(), name: 'St. Vital',     rent: '$1,700–2,100', type: '3-bed house',     pros: ['Spacious','Good schools','Cheaper'],      cons: ['Far from centre','Need a car'] }
    ];
    DB.set('districts', state.districts);
  }
  if (!DB.has('budget')) {
    state.budget = [
      { id: DB.id(), item: 'Rent (avg)',              amount: 2100 },
      { id: DB.id(), item: 'Groceries',               amount: 800  },
      { id: DB.id(), item: 'Car + MPI insurance',     amount: 450  },
      { id: DB.id(), item: 'Childcare (CWELCC)',      amount: 300  },
      { id: DB.id(), item: 'Internet + phone',        amount: 180  },
      { id: DB.id(), item: 'Transit / gas',           amount: 150  },
      { id: DB.id(), item: 'Health / pharmacy',       amount: 120  }
    ];
    DB.set('budget', state.budget);
  }
  if (!DB.has('jobData')) {
    state.jobData = [
      { id: DB.id(), company: 'Bell MTS',             salary: '$85,000–105,000', requirements: 'P.Eng., LTE/5G, Huawei/Nokia',    notes: 'Actively hiring RF Optimization roles' },
      { id: DB.id(), company: 'Rogers Communications',salary: '$90,000–115,000', requirements: 'P.Eng., Antenna design, RF planning', notes: 'Downtown office, hybrid format' }
    ];
    DB.set('jobData', state.jobData);
  }
  if (!DB.has('prices')) {
    state.prices = [
      { id: DB.id(), store: 'Costco', name: 'Milk 4L',             price: 5.49,   currency: 'CAD', date: '2025-07-14', photo: null },
      { id: DB.id(), store: 'Sobeys', name: 'Chicken breast 1kg',  price: 12.99,  currency: 'CAD', date: '2025-07-14', photo: null },
      { id: DB.id(), store: 'IKEA',   name: 'KALLAX shelf unit',   price: 189.00, currency: 'CAD', date: '2025-07-15', photo: null }
    ];
    DB.set('prices', state.prices);
  }
}

// ══════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════
function setTab(tab) {
  // if in meeting detail, go back to agenda first
  if (state.view === 'meeting' && tab !== 'agenda') {
    exitMeeting();
  }
  state.activeTab = tab;
  state.view = tab;
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  document.querySelectorAll('.screen').forEach(el => el.classList.toggle('active', el.id === tab));
  renders[tab]?.();
}

function openMeeting(id) {
  const m = state.meetings.find(x => x.id === id);
  if (!m) return;
  state.currentMeetingId = id;
  state.view = 'meeting';
  // hide all screens, show meeting detail
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-meeting').classList.add('active');
  renderMeetingDetail(m);
}

function exitMeeting() {
  state.view = 'agenda';
  state.currentMeetingId = null;
  stopRecordingIfActive();
  document.getElementById('screen-meeting').classList.remove('active');
  document.getElementById('agenda').classList.add('active');
  renderAgenda();
}

// ══════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ══════════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════════
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function onOverlayClick(e) { if (e.target === e.currentTarget) closeModal(e.currentTarget.id); }

// ══════════════════════════════════════════════
//  MODULE 1: AGENDA (list view)
// ══════════════════════════════════════════════
function renderAgenda() {
  const list = document.getElementById('agenda-list');
  if (!state.meetings.length) {
    list.innerHTML = emptyState('calendar', 'No meetings yet.<br>Tap + to add the first one.');
    return;
  }
  const byDate = {};
  state.meetings.forEach(m => { (byDate[m.date] = byDate[m.date] || []).push(m); });

  list.innerHTML = Object.keys(byDate).sort().map(date => {
    const dayMeetings = byDate[date].sort((a,b) => a.time.localeCompare(b.time));
    const allDone = dayMeetings.every(m => m.status === 'done');
    const items = dayMeetings.map(m => {
      const st = { done:['status-done','Done'], plan:['status-plan','Planned'], moved:['status-moved','Moved'] };
      const [cls, lbl] = st[m.status] || st.plan;
      const hasContent = m.notes || m.photos?.length || m.audios?.length;
      return `<div class="meeting-item" onclick="openMeeting('${m.id}')">
        <div class="meeting-icon">${m.icon||'📅'}</div>
        <div class="meeting-body">
          <div class="meeting-name">${esc(m.name)}</div>
          <div class="meeting-meta">${m.time} · ${esc(m.org)}${hasContent ? ' <span class="has-content">●</span>' : ''}</div>
        </div>
        <span class="status-pill ${cls}">${lbl}</span>
      </div>`;
    }).join('');

    const done = dayMeetings.filter(m=>m.status==='done').length;
    return `<div class="day-group">
      <div class="day-label">
        <span>${formatDate(date)}</span>
        <button class="day-report-btn" onclick="openDayReport('${date}')">
          ${SVG.fileText} Day report
        </button>
      </div>
      ${items}
    </div>`;
  }).join('');
}

function openAddMeeting() {
  ['am-name','am-org','am-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('am-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('am-time').value = '10:00';
  openModal('modal-add-meeting');
}

function saveAddMeeting() {
  const name = document.getElementById('am-name').value.trim();
  if (!name) { toast('Enter a meeting name'); return; }
  const k = name.toLowerCase();
  const icon = k.includes('bell')||k.includes('rogers')||k.includes('rf') ? '📡'
    : k.includes('egm')||k.includes('engineer') ? '⚙️'
    : k.includes('school')||k.includes('univer')||k.includes('asper') ? '🏛️' : '📅';
  const m = { id:DB.id(), name, org:document.getElementById('am-org').value.trim(), date:document.getElementById('am-date').value, time:document.getElementById('am-time').value, status:'plan', notes:document.getElementById('am-notes').value, photos:[], audios:[], contactId:null, icon };
  state.meetings.push(m);
  DB.set('meetings', state.meetings);
  closeModal('modal-add-meeting');
  renderAgenda();
  toast('Meeting added');
}

// ══════════════════════════════════════════════
//  MODULE 1b: MEETING DETAIL (inner screen)
// ══════════════════════════════════════════════
function renderMeetingDetail(m) {
  // Header
  document.getElementById('md-title').textContent = m.name;
  document.getElementById('md-subtitle').textContent = formatDate(m.date) + ' · ' + m.time + ' · ' + m.org;

  // Status bar
  const statusBar = document.getElementById('md-status-bar');
  const statusMap = { done:['status-done','Done ✓'], plan:['status-plan','Planned'], moved:['status-moved','Moved'] };
  const [cls, lbl] = statusMap[m.status] || statusMap.plan;
  statusBar.innerHTML = `
    <button class="status-pill ${cls} status-cycle-btn" onclick="cycleMeetingStatus('${m.id}')">${lbl}</button>
    <button class="md-delete-btn" onclick="confirmDeleteMeeting('${m.id}')">${SVG.trash}</button>`;

  // Notes
  const notesEl = document.getElementById('md-notes');
  notesEl.value = m.notes || '';
  notesEl.oninput = () => saveMeetingField(m.id, 'notes', notesEl.value);

  // Contact link
  renderMeetingContact(m);

  // Photos
  renderMeetingPhotos(m);

  // Audio
  renderMeetingAudios(m);
}

function saveMeetingField(id, field, value) {
  const m = state.meetings.find(x => x.id === id);
  if (!m) return;
  m[field] = value;
  DB.set('meetings', state.meetings);
}

function cycleMeetingStatus(id) {
  const m = state.meetings.find(x => x.id === id);
  if (!m) return;
  const order = ['plan','done','moved'];
  m.status = order[(order.indexOf(m.status)+1)%3];
  DB.set('meetings', state.meetings);
  renderMeetingDetail(m);
}

function confirmDeleteMeeting(id) {
  if (!confirm('Delete this meeting?')) return;
  state.meetings = state.meetings.filter(x => x.id !== id);
  DB.set('meetings', state.meetings);
  exitMeeting();
  toast('Meeting deleted');
}

function renderMeetingContact(m) {
  const box = document.getElementById('md-contact-box');
  const c = m.contactId ? state.contacts.find(x => x.id === m.contactId) : null;
  if (c) {
    const initials = c.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    box.innerHTML = `
      <div class="md-contact-card">
        <div class="avatar" style="background:${c.color}22;color:${c.color};width:36px;height:36px;font-size:12px;">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:500;">${esc(c.name)}</div>
          <div style="font-size:11px;color:var(--text2);">${esc(c.role)} · ${esc(c.org)}</div>
        </div>
        <button class="btn-icon" onclick="unlinkContact('${m.id}')">${SVG.x}</button>
      </div>`;
  } else {
    box.innerHTML = `<button class="btn-add" onclick="openLinkContact('${m.id}')" style="margin:0;">${SVG.user} Link a contact</button>`;
  }
}

function openLinkContact(meetingId) {
  const list = document.getElementById('link-contact-list');
  list.innerHTML = state.contacts.map(c => {
    const initials = c.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    return `<div class="contact-pick-item" onclick="linkContact('${meetingId}','${c.id}')">
      <div class="avatar" style="background:${c.color}22;color:${c.color};width:36px;height:36px;font-size:12px;">${initials}</div>
      <div><div style="font-size:14px;font-weight:500;">${esc(c.name)}</div><div style="font-size:12px;color:var(--text2);">${esc(c.org)}</div></div>
    </div>`;
  }).join('') || '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px;">No contacts yet — add them in the Contacts tab</div>';
  openModal('modal-link-contact');
}

function linkContact(meetingId, contactId) {
  const m = state.meetings.find(x => x.id === meetingId);
  if (!m) return;
  m.contactId = contactId;
  DB.set('meetings', state.meetings);
  closeModal('modal-link-contact');
  renderMeetingContact(m);
}

function unlinkContact(meetingId) {
  const m = state.meetings.find(x => x.id === meetingId);
  if (!m) return;
  m.contactId = null;
  DB.set('meetings', state.meetings);
  renderMeetingContact(m);
}

// ── Meeting Photos ──
function renderMeetingPhotos(m) {
  const grid = document.getElementById('md-photo-grid');
  const thumbs = (m.photos||[]).map((p,i) => `
    <div class="media-thumb" onclick="viewMeetingPhoto('${m.id}',${i})">
      <img src="${p.data}" alt="${esc(p.label)}" />
    </div>`).join('');
  grid.innerHTML = thumbs + `
    <div class="media-thumb media-thumb-add" onclick="document.getElementById('md-photo-input').click()">
      ${SVG.camera}<div class="media-thumb-label">Add photo</div>
    </div>`;
}

async function handleMeetingPhoto(input) {
  const file = input.files[0]; if (!file) return;
  const m = state.meetings.find(x => x.id === state.currentMeetingId); if (!m) return;
  try {
    const data = await compressImageFile(file);
    if (!m.photos) m.photos = [];
    m.photos.push({ data, label: file.name, date: new Date().toLocaleDateString('en-CA') });
    if (!DB.set('meetings', state.meetings)) { m.photos.pop(); return; }
    renderMeetingPhotos(m);
    toast('Photo added');
  } catch (err) {
    console.error(err);
    toast('Could not read photo');
  } finally {
    input.value = '';
  }
}

function viewMeetingPhoto(meetingId, idx) {
  const m = state.meetings.find(x => x.id === meetingId); if (!m) return;
  const p = m.photos[idx]; if (!p) return;
  document.getElementById('view-img').src = p.data;
  document.getElementById('view-label').textContent = p.label;
  document.getElementById('view-delete').onclick = () => {
    m.photos.splice(idx, 1);
    DB.set('meetings', state.meetings);
    closeModal('modal-view-photo');
    renderMeetingPhotos(m);
    toast('Photo deleted');
  };
  openModal('modal-view-photo');
}

// ── Meeting Audio ──
function renderMeetingAudios(m) {
  const recBtn = document.getElementById('md-rec-btn');
  const recInd = document.getElementById('md-rec-indicator');
  const list   = document.getElementById('md-audio-list');

  if (state.recording) {
    recInd.style.display = 'flex';
    recBtn.innerHTML = SVG.stop + ' Stop recording';
    recBtn.style.cssText = 'border-color:rgba(239,68,68,0.4);color:var(--red);';
  } else {
    recInd.style.display = 'none';
    recBtn.innerHTML = SVG.mic + ' Record voice note';
    recBtn.style.cssText = '';
  }

  if (!m.audios?.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = m.audios.map((a,i) => `
    <div class="audio-row">
      <button class="play-btn" onclick="playMeetingAudio('${m.id}',${i})">${SVG.play}</button>
      <div class="audio-info">
        <div class="audio-name">${esc(a.name)}</div>
        <div class="audio-meta">${a.date} · ${a.duration}</div>
      </div>
      <button class="btn-icon" onclick="deleteMeetingAudio('${m.id}',${i})">${SVG.trash}</button>
    </div>`).join('');
}

function playMeetingAudio(meetingId, idx) {
  const m = state.meetings.find(x => x.id === meetingId); if (!m) return;
  const a = m.audios[idx]; if (!a) return;
  new Audio(a.data).play();
}

function deleteMeetingAudio(meetingId, idx) {
  const m = state.meetings.find(x => x.id === meetingId); if (!m) return;
  m.audios.splice(idx, 1);
  DB.set('meetings', state.meetings);
  renderMeetingAudios(m);
  toast('Note deleted');
}

async function toggleMeetingRecording() {
  if (state.recording) { state.mediaRecorder.stop(); return; }
  const m = state.meetings.find(x => x.id === state.currentMeetingId); if (!m) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);
    state.recordingStart = Date.now();
    state.mediaRecorder.ondataavailable = e => state.audioChunks.push(e.data);
    state.mediaRecorder.onstop = () => {
      const blob = new Blob(state.audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = e => {
        const dur = Math.round((Date.now() - state.recordingStart) / 1000);
        const name = prompt('Note title:') || 'Voice note';
        if (!m.audios) m.audios = [];
        m.audios.push({ name, data: e.target.result, date: new Date().toLocaleDateString('en-CA'), duration: `${Math.floor(dur/60)}:${(dur%60).toString().padStart(2,'0')}` });
        DB.set('meetings', state.meetings);
        renderMeetingAudios(m);
        toast('Note saved');
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
      state.recording = false;
      renderMeetingAudios(m);
    };
    state.mediaRecorder.start();
    state.recording = true;
    renderMeetingAudios(m);
  } catch { toast('Microphone access denied'); }
}

function stopRecordingIfActive() {
  if (state.recording && state.mediaRecorder) {
    try { state.mediaRecorder.stop(); } catch {}
    state.recording = false;
  }
}

// ══════════════════════════════════════════════
//  DAY REPORT
// ══════════════════════════════════════════════
function openDayReport(date) {
  const meetings = state.meetings
    .filter(m => m.date === date)
    .sort((a,b) => a.time.localeCompare(b.time));
  if (!meetings.length) { toast('No meetings on this day'); return; }
  generateDayReportPDF(date, meetings);
}

function generateDayReportPDF(date, meetings) {
  const dateLabel = formatDate(date);
  const done  = meetings.filter(m=>m.status==='done').length;
  const total = meetings.length;

  const meetingSections = meetings.map(m => {
    const c = m.contactId ? state.contacts.find(x=>x.id===m.contactId) : null;
    const statusLabel = { done:'Completed', plan:'Planned', moved:'Rescheduled' }[m.status] || m.status;
    const statusColor = { done:'#065f46', plan:'#1e40af', moved:'#92400e' }[m.status] || '#333';
    const statusBg    = { done:'#d1fae5', plan:'#dbeafe', moved:'#fef3c7' }[m.status] || '#eee';

    const photosHTML = (m.photos||[]).length ? `
      <div class="photo-strip">
        ${m.photos.slice(0,6).map(p=>`<div class="photo-item"><img src="${p.data}" alt="${esc(p.label)}" /></div>`).join('')}
      </div>` : '';

    const contactHTML = c ? `
      <div class="contact-ref">
        <strong>Contact:</strong> ${esc(c.name)} · ${esc(c.role)} · ${esc(c.org)}
        ${c.phone ? ` · ${esc(c.phone)}` : ''}
        ${c.email ? ` · <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}
      </div>` : '';

    const audioHTML = (m.audios||[]).length ? `<div class="audio-note">🎙 ${m.audios.length} voice note${m.audios.length!==1?'s':''} recorded</div>` : '';

    return `
      <div class="meeting-block">
        <div class="meeting-block-header">
          <div>
            <div class="meeting-block-time">${m.time}</div>
            <div class="meeting-block-name">${m.icon||'📅'} ${esc(m.name)}</div>
            <div class="meeting-block-org">${esc(m.org)}</div>
          </div>
          <span class="badge" style="background:${statusBg};color:${statusColor};">${statusLabel}</span>
        </div>
        ${contactHTML}
        ${m.notes ? `<div class="notes-box">${esc(m.notes).replace(/\n/g,'<br>')}</div>` : '<div class="notes-empty">No notes recorded for this meeting.</div>'}
        ${photosHTML}
        ${audioHTML}
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Day Report — ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Arial, sans-serif; font-size: 11pt; color: #111; line-height: 1.6; }

  .cover { background: #1a3a6b; color: #fff; padding: 32px 40px; margin-bottom: 0; }
  .cover h1 { font-size: 22pt; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 4px; }
  .cover h2 { font-size: 13pt; font-weight: 400; opacity: 0.8; margin-bottom: 20px; }
  .cover-stats { display: flex; gap: 24px; }
  .stat { text-align: center; background: rgba(255,255,255,0.12); border-radius: 8px; padding: 10px 20px; }
  .stat .val { font-size: 22pt; font-weight: 700; }
  .stat .lbl { font-size: 9pt; opacity: 0.75; margin-top: 2px; }

  .body { padding: 28px 40px; }

  .meeting-block { border: 1px solid #e0e5ef; border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
  .meeting-block-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 18px 12px; background: #f7f9fd; border-bottom: 1px solid #e0e5ef; }
  .meeting-block-time { font-size: 10pt; color: #666; margin-bottom: 3px; }
  .meeting-block-name { font-size: 14pt; font-weight: 700; color: #1a3a6b; }
  .meeting-block-org  { font-size: 10pt; color: #555; margin-top: 2px; }
  .badge { font-size: 9pt; padding: 4px 10px; border-radius: 99px; font-weight: 600; white-space: nowrap; margin-top: 4px; }

  .contact-ref { padding: 10px 18px; background: #eef2ff; font-size: 10pt; color: #374151; border-bottom: 1px solid #e0e5ef; }
  .contact-ref a { color: #1a3a6b; }
  .notes-box   { padding: 14px 18px; font-size: 11pt; line-height: 1.7; white-space: pre-wrap; }
  .notes-empty { padding: 14px 18px; font-size: 10pt; color: #aaa; font-style: italic; }
  .audio-note  { padding: 8px 18px 12px; font-size: 10pt; color: #666; }

  .photo-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px 18px; border-top: 1px solid #e0e5ef; background: #fafafa; }
  .photo-item img { width: 100%; height: 110px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; display: block; }

  .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #ddd; font-size: 9pt; color: #999; text-align: center; }

  @media print {
    body { font-size: 10pt; }
    .meeting-block { page-break-inside: avoid; }
    .photo-strip { grid-template-columns: repeat(4, 1fr); }
  }
  @page { margin: 15mm 18mm; }
</style>
</head>
<body>

<div class="cover">
  <h1>Day Report</h1>
  <h2>🇨🇦 Winnipeg Exploratory Visit · ${dateLabel}</h2>
  <div class="cover-stats">
    <div class="stat"><div class="val">${done}</div><div class="lbl">Completed</div></div>
    <div class="stat"><div class="val">${total - done}</div><div class="lbl">Remaining</div></div>
    <div class="stat"><div class="val">${meetings.reduce((s,m)=>s+(m.photos?.length||0),0)}</div><div class="lbl">Photos</div></div>
    <div class="stat"><div class="val">${meetings.reduce((s,m)=>s+(m.audios?.length||0),0)}</div><div class="lbl">Voice notes</div></div>
  </div>
</div>

<div class="body">
  ${meetingSections}
  <div class="footer">Generated ${new Date().toLocaleDateString('en-CA')} · Winnipeg Visit app · All times local (CDT)</div>
</div>

</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
  toast('Day report opened');
}

// ══════════════════════════════════════════════
//  MODULE 2: CONTACTS
// ══════════════════════════════════════════════
function renderContacts() {
  const list = document.getElementById('contacts-list');
  if (!state.contacts.length) { list.innerHTML = emptyState('users', 'No contacts yet.<br>Add one after a meeting.'); return; }
  list.innerHTML = state.contacts.map(contactHTML).join('');
}

function contactHTML(c) {
  const initials = c.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  const fields = [
    c.phone    ? `<div class="field-row">${SVG.phone}<span>${esc(c.phone)}</span></div>` : '',
    c.email    ? `<div class="field-row">${SVG.mail}<a class="field-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : '',
    c.linkedin ? `<div class="field-row">${SVG.link}<a class="field-link" href="https://${esc(c.linkedin)}" target="_blank">LinkedIn</a></div>` : ''
  ].filter(Boolean).join('');
  return `<div class="contact-card" onclick="openContactDetail('${c.id}')">
    <div class="contact-top">
      <div class="avatar" style="background:${c.color}22;color:${c.color}">${initials}</div>
      <div class="contact-info">
        <div class="contact-name">${esc(c.name)}</div>
        <div class="contact-role">${esc(c.role)} · ${esc(c.org)}</div>
      </div>
    </div>
    ${fields ? `<div class="contact-fields">${fields}</div>` : ''}
    ${c.notes ? `<div class="contact-note">${esc(c.notes)}</div>` : ''}
  </div>`;
}

function openContactDetail(id) {
  const c = state.contacts.find(x=>x.id===id); if (!c) return;
  ['name','org','role','phone','email','linkedin','notes'].forEach(k => document.getElementById('cd-'+k).value = c[k]||'');
  document.getElementById('cd-delete').onclick = () => { deleteContact(id); closeModal('modal-contact-detail'); };
  document.getElementById('cd-save').onclick   = () => saveContactDetail(id);
  openModal('modal-contact-detail');
}

function saveContactDetail(id) {
  const c = state.contacts.find(x=>x.id===id); if (!c) return;
  ['name','org','role','phone','email','linkedin','notes'].forEach(k => c[k] = document.getElementById('cd-'+k).value.trim());
  DB.set('contacts', state.contacts);
  closeModal('modal-contact-detail'); renderContacts(); toast('Contact saved');
}

function deleteContact(id) {
  state.contacts = state.contacts.filter(x=>x.id!==id);
  // unlink from meetings
  state.meetings.forEach(m => { if (m.contactId===id) m.contactId=null; });
  DB.set('contacts', state.contacts); DB.set('meetings', state.meetings);
  renderContacts(); toast('Contact deleted');
}

function openAddContact() {
  ['ac-name','ac-org','ac-role','ac-phone','ac-email','ac-linkedin','ac-notes'].forEach(id => document.getElementById(id).value='');
  openModal('modal-add-contact');
}

function saveAddContact() {
  const name = document.getElementById('ac-name').value.trim();
  if (!name) { toast('Enter contact name'); return; }
  const colors = ['#3b82f6','#22c55e','#f59e0b','#a855f7','#ec4899','#14b8a6'];
  state.contacts.push({ id:DB.id(), name, org:document.getElementById('ac-org').value.trim(), role:document.getElementById('ac-role').value.trim(), phone:document.getElementById('ac-phone').value.trim(), email:document.getElementById('ac-email').value.trim(), linkedin:document.getElementById('ac-linkedin').value.trim(), notes:document.getElementById('ac-notes').value.trim(), color:colors[state.contacts.length%colors.length] });
  DB.set('contacts', state.contacts); closeModal('modal-add-contact'); renderContacts(); toast('Contact added');
}

// ══════════════════════════════════════════════
//  MODULE 3: DATA
// ══════════════════════════════════════════════
function renderData() { renderJobData(); renderDistricts(); renderBudget(); }

// edit state
let _editJobId = null;
let _editPriceId = null;

function renderJobData() {
  document.getElementById('job-list').innerHTML = state.jobData.map(j=>`
    <div class="card" onclick="openJobDetail('${j.id}')" style="cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:7px;">
        <div style="font-size:14px;font-weight:600;">${esc(j.company)}</div>
        <div style="font-size:13px;color:var(--green);font-weight:600;">${esc(j.salary)} <span style="color:var(--text3);font-size:11px;">✎</span></div>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:5px;">${esc(j.requirements)}</div>
      ${j.notes?`<div style="font-size:12px;color:var(--text3);">${esc(j.notes)}</div>`:''}
    </div>`).join('') + `<button class="btn-add" onclick="openAddJob()">${SVG.plus} Add company</button>`;
}

function openJobDetail(id) {
  _editJobId = id;
  const j = state.jobData.find(x=>x.id===id); if(!j) return;
  document.getElementById('aj-company').value = j.company;
  document.getElementById('aj-salary').value = j.salary;
  document.getElementById('aj-requirements').value = j.requirements || '';
  document.getElementById('aj-notes').value = j.notes || '';
  document.getElementById('aj-modal-title').textContent = 'Edit company';
  document.getElementById('aj-btn-delete').style.display = '';
  document.getElementById('aj-btn-save').textContent = 'Save';
  openModal('modal-add-job');
}

function openAddJob() {
  _editJobId = null;
  ['aj-company','aj-salary','aj-requirements','aj-notes'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('aj-modal-title').textContent = 'Company / Job';
  document.getElementById('aj-btn-delete').style.display = 'none';
  document.getElementById('aj-btn-save').textContent = 'Add';
  openModal('modal-add-job');
}

function saveAddJob() {
  const company = document.getElementById('aj-company').value.trim();
  if(!company){toast('Enter company name');return;}
  const salary = document.getElementById('aj-salary').value.trim();
  const requirements = document.getElementById('aj-requirements').value.trim();
  const notes = document.getElementById('aj-notes').value.trim();
  if (_editJobId) {
    const j = state.jobData.find(x=>x.id===_editJobId);
    if (j) { j.company=company; j.salary=salary; j.requirements=requirements; j.notes=notes; }
    toast('Company saved');
  } else {
    state.jobData.push({id:DB.id(),company,salary,requirements,notes});
    toast('Company added');
  }
  DB.set('jobData',state.jobData);
  _editJobId=null;
  closeModal('modal-add-job');
  renderData();
}

function deleteJob() {
  if(!_editJobId) return;
  if(!confirm('Delete this company?')) return;
  state.jobData = state.jobData.filter(x=>x.id!==_editJobId);
  DB.set('jobData',state.jobData);
  _editJobId=null;
  closeModal('modal-add-job');
  renderData();
  toast('Company deleted');
}

function renderDistricts() {
  document.getElementById('district-list').innerHTML = state.districts.map(d=>`
    <div class="district-card" onclick="openDistrictDetail('${d.id}')">
      <div class="district-name">${esc(d.name)}</div>
      <div class="district-rent">${esc(d.rent)} · ${esc(d.type)}</div>
      <div class="tags">
        ${(d.pros||[]).map(p=>`<span class="tag tag-pos">${esc(p)}</span>`).join('')}
        ${(d.cons||[]).map(c=>`<span class="tag tag-neg">${esc(c)}</span>`).join('')}
      </div>
    </div>`).join('') + `<button class="btn-add" onclick="openAddDistrict()">${SVG.plus} Add neighbourhood</button>`;
}

let _editBudgetId = null;

function renderBudget() {
  const total = state.budget.reduce((s,b)=>s+Number(b.amount),0);
  document.getElementById('budget-body').innerHTML = state.budget.map(b=>`
    <tr onclick="openBudgetDetail('${b.id}')" style="cursor:pointer;">
      <td style="color:var(--text2);">${esc(b.item)} <span style="color:var(--text3);font-size:11px;">✎</span></td>
      <td style="text-align:right;font-weight:500;">$${Number(b.amount).toLocaleString()}</td>
    </tr>`).join('');
  document.getElementById('budget-total').textContent = '$'+total.toLocaleString();
}

function openBudgetDetail(id) {
  _editBudgetId = id;
  const b = state.budget.find(x=>x.id===id); if(!b) return;
  document.getElementById('ab-item').value = b.item;
  document.getElementById('ab-amount').value = b.amount;
  document.getElementById('ab-modal-title').textContent = 'Edit budget item';
  document.getElementById('ab-btn-delete').style.display = '';
  document.getElementById('ab-btn-save').textContent = 'Save';
  openModal('modal-add-budget');
}

function openAddBudget() {
  _editBudgetId = null;
  document.getElementById('ab-item').value = '';
  document.getElementById('ab-amount').value = '';
  document.getElementById('ab-modal-title').textContent = 'Budget item';
  document.getElementById('ab-btn-delete').style.display = 'none';
  document.getElementById('ab-btn-save').textContent = 'Add';
  openModal('modal-add-budget');
}

function saveAddBudget() {
  const item = document.getElementById('ab-item').value.trim();
  const amount = parseFloat(document.getElementById('ab-amount').value);
  if(!item || isNaN(amount)){ toast('Fill in all fields'); return; }
  if (_editBudgetId) {
    const b = state.budget.find(x=>x.id===_editBudgetId);
    if(b){ b.item=item; b.amount=amount; }
    toast('Item saved');
  } else {
    state.budget.push({id:DB.id(), item, amount});
    toast('Item added');
  }
  DB.set('budget', state.budget);
  _editBudgetId = null;
  closeModal('modal-add-budget');
  renderBudget();
}

function deleteBudgetItem() {
  if(!_editBudgetId) return;
  if(!confirm('Delete this budget item?')) return;
  state.budget = state.budget.filter(x=>x.id!==_editBudgetId);
  DB.set('budget', state.budget);
  _editBudgetId = null;
  closeModal('modal-add-budget');
  renderBudget();
  toast('Item deleted');
}

function openAddJob() {
  ['aj-company','aj-salary','aj-requirements','aj-notes'].forEach(id=>document.getElementById(id).value='');
  resetJobModal();
  openModal('modal-add-job');
}
function saveAddJob() {
  const company = document.getElementById('aj-company').value.trim(); if(!company){toast('Enter company name');return;}
  state.jobData.push({id:DB.id(),company,salary:document.getElementById('aj-salary').value.trim(),requirements:document.getElementById('aj-requirements').value.trim(),notes:document.getElementById('aj-notes').value.trim()});
  DB.set('jobData',state.jobData);closeModal('modal-add-job');renderData();toast('Company added');
}
function openDistrictDetail(id) {
  const d=state.districts.find(x=>x.id===id)||{};
  document.getElementById('dd-name').value=d.name||''; document.getElementById('dd-rent').value=d.rent||'';
  document.getElementById('dd-type').value=d.type||''; document.getElementById('dd-pros').value=(d.pros||[]).join(', ');
  document.getElementById('dd-cons').value=(d.cons||[]).join(', ');
  document.getElementById('dd-save').onclick=()=>saveDistrict(id);
  document.getElementById('dd-delete').onclick=()=>{state.districts=state.districts.filter(x=>x.id!==id);DB.set('districts',state.districts);closeModal('modal-district');renderData();toast('Neighbourhood deleted');};
  openModal('modal-district');
}
function saveDistrict(id) {
  let d=state.districts.find(x=>x.id===id);if(!d){d={id};state.districts.push(d);}
  d.name=document.getElementById('dd-name').value.trim(); d.rent=document.getElementById('dd-rent').value.trim();
  d.type=document.getElementById('dd-type').value.trim();
  d.pros=document.getElementById('dd-pros').value.split(',').map(s=>s.trim()).filter(Boolean);
  d.cons=document.getElementById('dd-cons').value.split(',').map(s=>s.trim()).filter(Boolean);
  DB.set('districts',state.districts);closeModal('modal-district');renderData();toast('Neighbourhood saved');
}
function openAddDistrict() {
  ['dd-name','dd-rent','dd-type','dd-pros','dd-cons'].forEach(id=>document.getElementById(id).value='');
  const newId=DB.id();
  document.getElementById('dd-save').onclick=()=>saveDistrict(newId);
  document.getElementById('dd-delete').onclick=()=>closeModal('modal-district');
  openModal('modal-district');
}

// ══════════════════════════════════════════════
//  MODULE 4: PRICES
// ══════════════════════════════════════════════
function renderScanner() {
  const stores = [...new Set(state.prices.map(p=>p.store))].length;
  const total  = state.prices.reduce((s,p)=>s+Number(p.price),0);
  document.getElementById('scan-stores').textContent = stores;
  document.getElementById('scan-items').textContent  = state.prices.length;
  document.getElementById('scan-total').textContent  = '$'+total.toFixed(2);
  renderPriceList();
}

function renderPriceList() {
  const list = document.getElementById('price-list');
  if (!state.prices.length) { list.innerHTML = emptyState('tag', 'No prices yet.<br>Photograph a price tag or add manually.'); return; }
  const byStore = {};
  state.prices.forEach(p=>{ (byStore[p.store]=byStore[p.store]||[]).push(p); });
  list.innerHTML = Object.keys(byStore).sort().map(store=>{
    const items = byStore[store].map(p=>`
      <div class="price-item" onclick="openPriceDetail('${p.id}')" style="cursor:pointer;">
        ${p.photo ? `<img class="price-thumb" src="${p.photo}" alt="price tag"/>` : `<div class="price-thumb-placeholder">${SVG.tag}</div>`}
        <div class="price-item-info">
          <div class="price-item-name">${esc(p.name)}</div>
          <div class="price-item-meta">${esc(p.store)} · ${p.date}</div>
        </div>
        <div class="price-item-price">$${Number(p.price).toFixed(2)}</div>
        <span style="font-size:11px;color:var(--text3);padding:4px;">✎</span>
      </div>`).join('');
    return `<div class="store-group"><div class="store-label">${esc(store)} <span>${byStore[store].length} item${byStore[store].length!==1?'s':''}</span></div>${items}</div>`;
  }).join('');
}

function openPriceDetail(id) {
  _editPriceId = id;
  const p = state.prices.find(x=>x.id===id); if(!p) return;
  document.getElementById('ap-name').value = p.name;
  document.getElementById('ap-price').value = p.price;
  document.getElementById('ap-store').value = p.store;
  const prev = document.getElementById('ap-preview');
  if(p.photo){ state.lastScanImage=p.photo; prev.src=p.photo; prev.style.display='block'; }
  else { state.lastScanImage=null; prev.src=''; prev.style.display='none'; }
  document.getElementById('ap-modal-title').textContent = 'Edit price';
  document.getElementById('ap-btn-delete').style.display = '';
  document.getElementById('ap-btn-save').textContent = 'Save';
  openModal('modal-add-price');
}

function openScanModal(photoData) {
  _editPriceId = null;
  state.lastScanImage = photoData || null;
  document.getElementById('ap-name').value='';
  document.getElementById('ap-price').value='';
  document.getElementById('ap-store').value='';
  const prev = document.getElementById('ap-preview');
  if(photoData){ prev.src=photoData; prev.style.display='block'; }
  else { prev.src=''; prev.style.display='none'; }
  document.getElementById('ap-modal-title').textContent = 'Add price';
  document.getElementById('ap-btn-delete').style.display = 'none';
  document.getElementById('ap-btn-save').textContent = 'Save';
  openModal('modal-add-price');
}

function deletePrice() {
  if(!_editPriceId) return;
  if(!confirm('Delete this item?')) return;
  state.prices = state.prices.filter(x=>x.id!==_editPriceId);
  DB.set('prices',state.prices);
  _editPriceId=null;
  closeModal('modal-add-price');
  renderScanner();
  toast('Item deleted');
}

async function handleScanInput(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Select an image file'); input.value=''; return; }
  try {
    const result = await compressImageFile(file);
    openScanModal(result);
  } catch (err) {
    console.error(err);
    toast('Could not read photo');
  } finally {
    input.value = '';
  }
}

async function handlePricePhotoInput(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Select an image file'); input.value=''; return; }
  try {
    state.lastScanImage = await compressImageFile(file);
    const prev = document.getElementById('ap-preview');
    prev.src = state.lastScanImage;
    prev.style.display = 'block';
  } catch (err) {
    console.error(err);
    toast('Could not read photo');
  } finally {
    input.value = '';
  }
}

function savePrice() {
  const name = document.getElementById('ap-name').value.trim();
  const price = parseFloat(document.getElementById('ap-price').value);
  const store = document.getElementById('ap-store').value.trim() || 'Unknown';
  if(!name || isNaN(price) || price < 0){ toast('Fill in name and price'); return; }
  if (_editPriceId) {
    const p = state.prices.find(x=>x.id===_editPriceId);
    if (p) { p.name=name; p.price=price; p.store=store; if(state.lastScanImage) p.photo=state.lastScanImage; }
    toast('Price saved');
  } else {
    state.prices.push({id:DB.id(),name,price,currency:'CAD',store,date:new Date().toLocaleDateString('en-CA'),photo:state.lastScanImage});
    toast(`Saved: ${name} — $${price.toFixed(2)}`);
  }
  DB.set('prices', state.prices);
  _editPriceId = null;
  state.lastScanImage = null;
  closeModal('modal-add-price');
  renderScanner();
}

// ══════════════════════════════════════════════
//  FULL TRIP PDF
// ══════════════════════════════════════════════
function exportPDF() {
  const today = new Date().toLocaleDateString('en-CA',{year:'numeric',month:'long',day:'numeric'});
  const budgetTotal = state.budget.reduce((s,b)=>s+Number(b.amount),0);
  const priceTotal  = state.prices.reduce((s,p)=>s+Number(p.price),0);

  const rows = (arr, cols, fn) => arr.length
    ? arr.map(fn).join('')
    : `<tr><td colspan="${cols}" style="text-align:center;color:#aaa;font-style:italic;padding:16px;">None recorded</td></tr>`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<title>Exploratory Visit Report — Winnipeg</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,serif;font-size:11pt;color:#111;line-height:1.5}
  .cover{text-align:center;padding:70px 40px 50px;border-bottom:3px solid #1a3a6b;margin-bottom:36px}
  .cover h1{font-size:24pt;font-weight:bold;color:#1a3a6b;margin-bottom:6px}
  .cover h2{font-size:13pt;font-weight:normal;color:#555;margin-bottom:28px}
  .cover-meta{display:inline-block;background:#f0f4ff;border:1px solid #c8d4f0;border-radius:8px;padding:16px 28px;text-align:left;font-size:10pt}
  .cover-meta p{margin:3px 0} .cover-meta strong{color:#1a3a6b}
  section{margin-bottom:32px;page-break-inside:avoid}
  section:not(:last-child){border-bottom:1px solid #ddd;padding-bottom:28px}
  h2{font-size:13pt;color:#1a3a6b;border-left:4px solid #1a3a6b;padding-left:10px;margin-bottom:14px;font-family:Arial,sans-serif;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:8px}
  th{background:#1a3a6b;color:#fff;padding:7px 10px;text-align:left;font-family:Arial,sans-serif;font-size:9pt}
  td{padding:7px 10px;border-bottom:1px solid #e8e8e8;vertical-align:top}
  tr:nth-child(even) td{background:#f8f9fc}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .sub{color:#666;font-size:9pt}
  .badge{display:inline-block;font-size:8pt;padding:2px 7px;border-radius:99px;font-family:Arial,sans-serif;font-weight:600}
  .total-row td{background:#eef2ff!important;font-size:10pt;border-top:2px solid #c8d4f0}
  .store-hr td{background:#f0f4ff!important;color:#1a3a6b;padding:6px 10px;border-top:1px solid #c8d4f0}
  .photo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px}
  .photo-item img{width:100%;height:110px;object-fit:cover;border-radius:4px;border:1px solid #ddd}
  .photo-caption{font-size:8pt;color:#555;text-align:center;margin-top:3px}
  .sum-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
  .sum-box{background:#f0f4ff;border:1px solid #c8d4f0;border-radius:6px;padding:10px;text-align:center}
  .sum-box .val{font-size:16pt;font-weight:bold;color:#1a3a6b}
  .sum-box .lbl{font-size:8pt;color:#666;margin-top:2px}
  .footer{margin-top:36px;padding-top:14px;border-top:1px solid #ddd;font-size:8.5pt;color:#888;text-align:center;font-family:Arial,sans-serif}
  @media print{body{font-size:10pt}section{page-break-inside:avoid}h2{page-break-after:avoid}}
  @page{margin:18mm}
</style>
</head><body>
<div class="cover">
  <div style="font-size:42pt;margin-bottom:14px;">🇨🇦</div>
  <h1>Exploratory Visit Report</h1>
  <h2>Manitoba Provincial Nominee Program (MPNP)</h2>
  <div class="cover-meta">
    <p><strong>Destination:</strong> Winnipeg, Manitoba, Canada</p>
    <p><strong>Report generated:</strong> ${today}</p>
    <p><strong>Meetings completed:</strong> ${state.meetings.filter(m=>m.status==='done').length} of ${state.meetings.length}</p>
    <p><strong>Contacts established:</strong> ${state.contacts.length}</p>
  </div>
</div>

<section>
  <h2>1. Meetings</h2>
  <div class="sum-grid">
    <div class="sum-box"><div class="val">${state.meetings.filter(m=>m.status==='done').length}</div><div class="lbl">Completed</div></div>
    <div class="sum-box"><div class="val">${state.meetings.filter(m=>m.status==='plan').length}</div><div class="lbl">Planned</div></div>
    <div class="sum-box"><div class="val">${state.meetings.reduce((s,m)=>s+(m.photos?.length||0),0)}</div><div class="lbl">Photos</div></div>
    <div class="sum-box"><div class="val">${state.meetings.reduce((s,m)=>s+(m.audios?.length||0),0)}</div><div class="lbl">Voice notes</div></div>
  </div>
  <table><thead><tr><th>Date/Time</th><th>Meeting</th><th>Status</th><th>Key Outcomes</th></tr></thead><tbody>
  ${rows(state.meetings.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)), 4, m=>{
    const sc={'done':'#d1fae5','plan':'#dbeafe','moved':'#fef3c7'};
    const tc={'done':'#065f46','plan':'#1e40af','moved':'#92400e'};
    const sl={'done':'Done','plan':'Planned','moved':'Rescheduled'};
    const c=m.contactId?state.contacts.find(x=>x.id===m.contactId):null;
    return `<tr><td>${m.date}<br><span class="sub">${m.time}</span></td>
      <td><strong>${esc(m.name)}</strong><br><span class="sub">${esc(m.org)}</span>${c?`<br><span class="sub">👤 ${esc(c.name)}</span>`:''}</td>
      <td><span class="badge" style="background:${sc[m.status]||'#eee'};color:${tc[m.status]||'#333'}">${sl[m.status]||m.status}</span></td>
      <td>${esc(m.notes)}</td></tr>`;
  })}
  </tbody></table>
</section>

<section>
  <h2>2. Contacts Established</h2>
  <table><thead><tr><th>Name / Role</th><th>Organisation</th><th>Contact</th><th>Key Takeaways</th></tr></thead><tbody>
  ${rows(state.contacts, 4, c=>`<tr>
    <td><strong>${esc(c.name)}</strong><br><span class="sub">${esc(c.role)}</span></td>
    <td>${esc(c.org)}</td>
    <td>${esc(c.phone)}<br><span class="sub">${esc(c.email)}</span></td>
    <td>${esc(c.notes)}</td></tr>`)}
  </tbody></table>
</section>

<section>
  <h2>3. Labour Market — Engineering / Telecom</h2>
  <table><thead><tr><th>Company</th><th>Salary Range</th><th>Requirements</th><th>Notes</th></tr></thead><tbody>
  ${rows(state.jobData, 4, j=>`<tr><td><strong>${esc(j.company)}</strong></td><td>${esc(j.salary)}</td><td>${esc(j.requirements)}</td><td>${esc(j.notes)}</td></tr>`)}
  </tbody></table>
</section>

<section>
  <h2>4. Housing — Neighbourhoods</h2>
  <table><thead><tr><th>Neighbourhood</th><th>Rent/mo</th><th>Type</th><th>Assessment</th></tr></thead><tbody>
  ${rows(state.districts, 4, d=>`<tr><td><strong>${esc(d.name)}</strong></td><td>${esc(d.rent)}</td><td>${esc(d.type)}</td>
    <td>${(d.pros||[]).map(p=>`✓ ${esc(p)}`).join('<br>')}${d.cons?.length?'<br>'+(d.cons.map(c=>`✗ ${esc(c)}`).join('<br>')):''}
    </td></tr>`)}
  </tbody></table>
</section>

<section>
  <h2>5. Family Budget (CAD / month)</h2>
  <table><thead><tr><th>Item</th><th class="num">Amount</th></tr></thead><tbody>
  ${state.budget.map(b=>`<tr><td>${esc(b.item)}</td><td class="num">$${Number(b.amount).toLocaleString()}</td></tr>`).join('')}
  <tr class="total-row"><td><strong>Monthly total</strong></td><td class="num"><strong>$${budgetTotal.toLocaleString()}</strong></td></tr>
  <tr class="total-row"><td><strong>Annual estimate</strong></td><td class="num"><strong>$${(budgetTotal*12).toLocaleString()}</strong></td></tr>
  </tbody></table>
</section>

<section>
  <h2>6. Cost of Living — Prices Collected</h2>
  <table><thead><tr><th>Item</th><th class="num">Price CAD</th><th>Date</th></tr></thead><tbody>
  ${[...new Set(state.prices.map(p=>p.store))].sort().map(store=>{
    const items=state.prices.filter(p=>p.store===store);
    const sub=items.reduce((s,p)=>s+Number(p.price),0);
    return `<tr class="store-hr"><td colspan="3"><strong>${esc(store)}</strong> — subtotal $${sub.toFixed(2)}</td></tr>`
      +items.map(p=>`<tr><td>${esc(p.name)}</td><td class="num">$${Number(p.price).toFixed(2)}</td><td class="sub">${p.date}</td></tr>`).join('');
  }).join('') || '<tr><td colspan="3" style="text-align:center;color:#aaa;font-style:italic;padding:16px;">None recorded</td></tr>'}
  ${state.prices.length?`<tr class="total-row"><td><strong>Grand total</strong></td><td class="num"><strong>$${priceTotal.toFixed(2)}</strong></td><td></td></tr>`:''}
  </tbody></table>
</section>

${state.prices.filter(p=>p.photo).length ? `
<section>
  <h2>7. Price Tag Photos</h2>
  <div class="photo-grid">
    ${state.prices.filter(p=>p.photo).slice(0,12).map(p=>`
      <div class="photo-item">
        <img src="${p.photo}" alt="${esc(p.name)}"/>
        <div class="photo-caption">${esc(p.name)}<br><strong>$${Number(p.price).toFixed(2)}</strong> · ${esc(p.store)}</div>
      </div>`).join('')}
  </div>
</section>` : ''}

<div class="footer">Generated ${today} · Winnipeg Visit app · All prices in Canadian dollars (CAD)</div>
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
  toast('Full report opened');
}

// ══════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════
function esc(s) { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function formatDate(d) { if(!d) return ''; return new Date(d+'T00:00:00').toLocaleDateString('en-CA',{weekday:'long',day:'numeric',month:'long'}); }
function emptyState(icon, text) { return `<div class="empty">${SVG[icon]||''}<p class="empty-text">${text}</p></div>`; }

// ══════════════════════════════════════════════
//  SVG ICONS
// ══════════════════════════════════════════════
const SVG = {
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  users:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
  tag:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  plus:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`,
  mic:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v4M8 23h8"/></svg>`,
  play:     `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`,
  stop:     `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`,
  trash:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>`,
  camera:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  phone:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.5 12.4 19.79 19.79 0 0 1 1.42 3.8 2 2 0 0 1 3.4 1.6h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.67-1.67a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.5 16.4z"/></svg>`,
  mail:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/></svg>`,
  link:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  user:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  x:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
  arrowLeft:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`,
  fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:14px;height:14px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`
};

// ══════════════════════════════════════════════
//  RENDER MAP
// ══════════════════════════════════════════════
const renders = { agenda:renderAgenda, contacts:renderContacts, data:renderData, scanner:renderScanner };

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  seedData();
  await compactStoredImages();
  setTab('agenda');
});
