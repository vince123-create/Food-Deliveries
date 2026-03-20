const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const DATA_DIR = '/app/data';
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');

function loadSchedule() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SCHEDULE_FILE)) {
      const def = [
        { day: 'Sun', open: true,  start: '12:00', end: '23:00' },
        { day: 'Mon', open: true,  start: '11:00', end: '23:30' },
        { day: 'Tue', open: true,  start: '17:30', end: '23:30' },
        { day: 'Wed', open: true,  start: '11:00', end: '23:30' },
        { day: 'Thu', open: true,  start: '17:30', end: '23:30' },
        { day: 'Fri', open: true,  start: '11:00', end: '23:30' },
        { day: 'Sat', open: true,  start: '12:00', end: '23:00' },
      ];
      fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(def, null, 2));
      return def;
    }
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE));
  } catch(e) {
    console.error('Error loading schedule:', e);
    return [];
  }
}

function saveSchedule(schedule) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
  } catch(e) {
    console.error('Error saving schedule:', e);
  }
}

function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function isOpenNow(schedule) {
  const now = new Date();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const s = schedule[day];
  return s && s.open && mins >= toMins(s.start) && mins < toMins(s.end);
}

app.get('/api/schedule', (req, res) => {
  res.json(loadSchedule());
});

app.post('/api/schedule', (req, res) => {
  const pwd = req.headers['x-admin-password'];
  if (pwd !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const schedule = req.body;
  saveSchedule(schedule);
  try {
    const { notifyDiscord } = require('./bot');
    notifyDiscord(isOpenNow(schedule), schedule);
  } catch(e) {}
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  const schedule = loadSchedule();
  const now = new Date();
  const day = now.getDay();
  const open = isOpenNow(schedule);
  const today = schedule[day];
  let nextEvent = null;
  if (open) {
    nextEvent = { type: 'close', time: today.end };
  } else {
    for (let i = 1; i <= 7; i++) {
      const di = (day + i) % 7;
      if (schedule[di] && schedule[di].open) {
        nextEvent = { type: 'open', day: schedule[di].day, time: schedule[di].start, daysAway: i };
        break;
      }
    }
  }
  res.json({ open, schedule, nextEvent });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
