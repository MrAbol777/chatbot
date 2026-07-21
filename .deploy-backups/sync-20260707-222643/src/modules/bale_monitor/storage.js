const fs = require('fs');
const path = require('path');

class MonitorStorage {
  constructor(dbPath) {
    const abs = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    this.filePath = abs;
    this.init();
  }

  init() {
    if (!fs.existsSync(this.filePath)) {
      this._write({ lastId: 0, monitors: [] });
    }
  }

  addInterval(chatId, url, intervalSeconds) {
    const state = this._read();
    const id = state.lastId + 1;
    const monitor = {
      id,
      chat_id: chatId,
      url,
      type: 'interval',
      interval_seconds: intervalSeconds,
      daily_time: null,
      is_paused: 0,
      created_at: new Date().toISOString()
    };
    state.lastId = id;
    state.monitors.push(monitor);
    this._write(state);
    return monitor;
  }

  addDaily(chatId, url, dailyTime) {
    const state = this._read();
    const id = state.lastId + 1;
    const monitor = {
      id,
      chat_id: chatId,
      url,
      daily_time: dailyTime,
      type: 'daily_at',
      interval_seconds: null,
      is_paused: 0,
      created_at: new Date().toISOString()
    };
    state.lastId = id;
    state.monitors.push(monitor);
    this._write(state);
    return monitor;
  }

  getById(id) {
    const state = this._read();
    return state.monitors.find((m) => m.id === Number(id)) || null;
  }

  listByChat(chatId) {
    const state = this._read();
    return state.monitors.filter((m) => m.chat_id === Number(chatId)).sort((a, b) => a.id - b.id);
  }

  listAll() {
    const state = this._read();
    return state.monitors.slice().sort((a, b) => a.id - b.id);
  }

  remove(chatId, id) {
    const state = this._read();
    const before = state.monitors.length;
    state.monitors = state.monitors.filter((m) => !(m.chat_id === Number(chatId) && m.id === Number(id)));
    this._write(state);
    return state.monitors.length !== before;
  }

  setPaused(chatId, id, paused) {
    const state = this._read();
    const monitor = state.monitors.find((m) => m.chat_id === Number(chatId) && m.id === Number(id));
    if (!monitor) return false;
    monitor.is_paused = paused ? 1 : 0;
    this._write(state);
    return true;
  }

  _read() {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(raw);
  }

  _write(state) {
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }
}

module.exports = { MonitorStorage };
