const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const SCHEDULE_FILE = '/app/data/schedule.json';

function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_FILE)) {
    const def = [
      { day: 'Sun', open: false, start: '09:00', end: '17:00' },
      { day: 'Mon', open: true,  start: '08:00', end: '18:00' },
      { day: 'Tue', open: true,  start: '08:00', end: '18:00' },
      { day: 'Wed', open: true,  start: '08:00', end: '18:00' },
      { day: 'Thu', open: true,  start: '08:00', end: '18:00' },
      { day: 'Fri', open: true,  start: '08:00', end: '18:00' },
      { day: 'Sat', open: false, start: '09:00', end: '14:00' },
    ];
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(def, null, 2));
    return def;
  }
  return JSON.parse(fs.readFileSync(SCHEDULE_FILE));
}

function saveSchedule(schedule) {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
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
  return s.open && mins >= toMins(s.start) && mins < toMins(s.end);
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
  const { notifyDiscord } = require('./bot');
  notifyDiscord(isOpenNow(schedule), schedule);
  res.json({ ok: true });
});

app.get('/api/status', (req, res) => {
  const schedule = loadSchedule();
  const now = new Date();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = schedule[day];
  const open = isOpenNow(schedule);

  let nextEvent = null;
  if (open) {
    nextEvent = { type: 'close', time: today.end };
  } else {
    for (let i = 1; i <= 7; i++) {
      const di = (day + i) % 7;
      if (schedule[di].open) {
        nextEvent = { type: 'open', day: schedule[di].day, time: schedule[di].start, daysAway: i };
        break;
      }
    }
  }

  res.json({ open, schedule, nextEvent });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
