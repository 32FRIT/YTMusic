const audio = document.querySelector('#audioPlayer');
const fileInput = document.querySelector('#fileInput');
const seek = document.querySelector('#seekBar');
const fullSeek = document.querySelector('#fullSeek');
const storeName = 'naghma-tracks-v1';
const maxMetadataScanSize = 16 * 1024 * 1024;
const playerSettingsStorageKey = 'naghma-player-settings';
const appThemeStorageKey = 'naghma-app-theme';
let tracks = [];
let current = -1;
let shuffled = false;
let repeat = 0;
let query = '';
let currentView = 'listen';
let libraryCategory = 'all';
let selectedAlbum = null;
let selectedArtist = null;
let selectedYoutubeFilter = 'songs';
let currentYoutubeBrowseItems = [];
let currentYoutubeBrowseQuery = '';
let currentYoutubePlaylist = null;
let youtubeSearchSnapshot = null;
let youtubeBrowsePageToken = '';
let pendingYoutubeSearch = null;
let youtubeBrowseRequestId = 0;
let libraryFavoritesOnly = false;
let layoutMode = localStorage.getItem('naghma-layout') || 'grid';
let activePlaylistId = null;
let activeQueueIds = null;
let playlists = readList('naghma-playlists');
const downloadsPlaylistId = 'naghma-downloads';
let sleepTimeout;
let toastTimeout;
let trackUrls = new Map();
let coverUrls = new Map();
let source = 'local';
let ytPlayer = null;
let ytApiReady = false;
let ytPendingId = null;
let ytQueue = [];
let ytQueueIndex = -1;
let ytTick;
let pointerReorder = null;
let recentPressTimer = null;
let recentPressCard = null;
let recentPressStart = null;
let recentLongPressTriggered = false;
let libraryPressTimer = null;
let libraryPressRow = null;
let libraryPressStart = null;
let libraryLongPressTriggered = false;
let currentYoutubeItem = null;
const playNextQueue = [];
const searchHistoryKey = 'naghma-youtube-searches';
const playedHistoryKey = 'naghma-youtube-played';
const lastPlaybackKey = 'naghma-last-playback';
const youtubeApiKeyStorageKey = 'naghma-youtube-data-api-key';
let lastPlaybackWriteAt = 0;
let ytPendingOptions = { autoplay: true, startSeconds: 0 };
const favorites = new Set(JSON.parse(localStorage.getItem('naghma-favorites') || '[]'));
const youtubeFavoritesKey = 'naghma-youtube-favorites';
const youtubeMetadataKey = 'naghma-youtube-metadata';
const libraryEntityMetadataKey = 'naghma-library-entity-metadata';
let youtubeFavorites = readList(youtubeFavoritesKey);
const colors = [['#df405a', '#4d1a28'], ['#4e6e80', '#182d3b'], ['#bc8651', '#482b20'], ['#7053a2', '#24193d'], ['#347d6a', '#16382f'], ['#a73f7d', '#401c38']];
const savedPlayerSettings = readObject(playerSettingsStorageKey);
const validThemes = ['dark', 'ocean', 'violet', 'forest', 'light'];
let playerSettings = {
  volume: Number.isFinite(savedPlayerSettings.volume) ? Math.max(0, Math.min(1, savedPlayerSettings.volume)) : 0.8,
  autoPlayNext: savedPlayerSettings.autoPlayNext !== false,
  shuffle: savedPlayerSettings.shuffle === true,
  repeat: ['off', 'all', 'one'].includes(savedPlayerSettings.repeat) ? savedPlayerSettings.repeat : 'off'
};
let appTheme = validThemes.includes(localStorage.getItem(appThemeStorageKey)) ? localStorage.getItem(appThemeStorageKey) : 'dark';
shuffled = playerSettings.shuffle;
repeat = { off: 0, all: 1, one: 2 }[playerSettings.repeat];

function openDb() { return new Promise((resolve, reject) => { const req = indexedDB.open(storeName, 1); req.onupgradeneeded = () => req.result.createObjectStore('tracks', { keyPath: 'id' }); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
async function dbRun(mode, fn) { const db = await openDb(); return new Promise((resolve, reject) => { const tx = db.transaction('tracks', mode); const result = fn(tx.objectStore('tracks')); tx.oncomplete = () => { db.close(); resolve(result?.result) }; tx.onerror = () => { db.close(); reject(tx.error) }; }); }
function makeId() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function colorFor(track) { return colors[track.colorIndex % colors.length]; }
function coverImage(track) { let image = coverUrls.get(track.id) || track.coverDataUrl || track.externalCover || ''; if (!image && track.coverBlob instanceof Blob) { image = URL.createObjectURL(track.coverBlob); coverUrls.set(track.id, image); } return image; }
function coverStyle(track) { const [a, b] = colorFor(track); const image = coverImage(track); return image ? `background:linear-gradient(#0002,#0002),url("${image}") center/cover` : `background:radial-gradient(circle at 32% 25%,${a},${b} 68%,#171719)`; }
function applyTrackTheme() {
  document.body.removeAttribute('data-track-theme');
  document.body.style.removeProperty('background-color');
  document.body.style.removeProperty('color');
  const root = document.documentElement;
  for (const property of ['--track-bg', '--track-panel', '--track-panel-raised', '--track-border', '--track-fg', '--track-muted', '--track-accent', 'background-color']) root.style.removeProperty(property);
  root.style.colorScheme = appTheme === 'light' ? 'light' : 'dark';
}
function applyAppTheme(theme) {
  appTheme = validThemes.includes(theme) ? theme : 'dark';
  document.body.dataset.appTheme = appTheme;
  document.documentElement.style.colorScheme = appTheme === 'light' ? 'light' : 'dark';
  document.querySelectorAll('[data-app-theme-option]').forEach(button => {
    const selected = button.dataset.appThemeOption === appTheme;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
function persistPlayerSettings() {
  localStorage.setItem(playerSettingsStorageKey, JSON.stringify(playerSettings));
}
function syncRepeatControls() {
  document.querySelector('#repeatBtn').classList.toggle('selected', repeat > 0);
  document.querySelector('#fullRepeat').classList.toggle('selected', repeat > 0);
  document.querySelector('#repeatBtn').textContent = repeat === 2 ? '↻¹' : '↻';
  document.querySelector('#fullRepeat').textContent = repeat === 2 ? '↻¹' : '↻';
}
function syncSettingsControls() {
  document.querySelector('#settingsVolume').value = String(playerSettings.volume);
  document.querySelector('#settingsVolumeValue').value = `${Math.round(playerSettings.volume * 100)}%`;
  document.querySelector('#settingsVolumeValue').textContent = `${Math.round(playerSettings.volume * 100)}%`;
  document.querySelector('#settingsAutoPlayNext').checked = playerSettings.autoPlayNext;
  document.querySelector('#settingsShuffle').checked = playerSettings.shuffle;
  document.querySelector('#settingsRepeat').value = playerSettings.repeat;
  document.querySelector('#shuffleBtn').classList.toggle('selected', shuffled);
  document.querySelector('#fullShuffle').classList.toggle('selected', shuffled);
  syncRepeatControls();
}
applyAppTheme(appTheme);
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function extractEmbeddedCover(file) { try { const first = await file.slice(0, 10).arrayBuffer(); const head = new Uint8Array(first); if (head.length >= 10 && head[0] === 73 && head[1] === 68 && head[2] === 51) { const version = head[3]; const tagSize = ((head[6] & 127) << 21) | ((head[7] & 127) << 14) | ((head[8] & 127) << 7) | (head[9] & 127); const bytes = new Uint8Array(await file.slice(10, Math.min(file.size, 10 + tagSize)).arrayBuffer()); const view = new DataView(bytes.buffer); let offset = 0; while (offset + 10 <= bytes.length) { const frame = String.fromCharCode(...bytes.slice(offset, offset + 4)); if (!frame.trim() || frame.charCodeAt(0) === 0) break; const size = version === 4 ? ((bytes[offset + 4] & 127) << 21) | ((bytes[offset + 5] & 127) << 14) | ((bytes[offset + 6] & 127) << 7) | (bytes[offset + 7] & 127) : view.getUint32(offset + 4, false); if (size <= 0 || offset + 10 + size > bytes.length) break; if (frame === 'APIC') { const start = offset + 10, end = offset + 10 + size, encoding = bytes[start]; let mimeEnd = start + 1; while (mimeEnd < end && bytes[mimeEnd] !== 0) mimeEnd++; const mime = new TextDecoder().decode(bytes.slice(start + 1, mimeEnd)) || 'image/jpeg'; const descStart = mimeEnd + 2; let imageStart = descStart; if (encoding === 1 || encoding === 2) { while (imageStart + 1 < end && (bytes[imageStart] !== 0 || bytes[imageStart + 1] !== 0)) imageStart += 2; imageStart += 2; } else { while (imageStart < end && bytes[imageStart] !== 0) imageStart++; imageStart++; } if (imageStart < end) return { blob: new Blob([bytes.slice(imageStart, end)], { type: mime }), type: mime }; } offset += 10 + size; } } if (file.size > maxMetadataScanSize) return null; return await extractM4aCover(file); } catch { return null; } }
async function extractM4aCover(file) { try { const bytes = new Uint8Array(await file.arrayBuffer()); const view = new DataView(bytes.buffer); const box = (start, end, name, skip = 0) => { for (let pos = start; pos + 8 <= end;) { let size = view.getUint32(pos, false); const type = String.fromCharCode(...bytes.slice(pos + 4, pos + 8)); let header = 8; if (size === 1) { if (pos + 16 > end) break; size = Number(view.getBigUint64(pos + 8, false)); header = 16; } else if (size === 0) size = end - pos; if (size < header || pos + size > end) break; if (type === name) return { start: pos + header + skip, end: pos + size }; pos += size; } return null; }; const moov = box(0, bytes.length, 'moov'); if (!moov) return null; const udta = box(moov.start, moov.end, 'udta'); const metaParent = udta || moov; const meta = box(metaParent.start, metaParent.end, 'meta', 4); if (!meta) return null; const ilst = box(meta.start, meta.end, 'ilst'); if (!ilst) return null; const covr = box(ilst.start, ilst.end, 'covr'); if (!covr) return null; const data = box(covr.start, covr.end, 'data'); if (!data || data.start + 8 >= data.end) return null; const format = view.getUint32(data.start, false) & 255; const start = data.start + 8; let mime = format === 14 ? 'image/png' : 'image/jpeg'; if (bytes[start] === 137 && bytes[start + 1] === 80) mime = 'image/png'; return { blob: new Blob([bytes.slice(start, data.end)], { type: mime }), type: mime }; } catch { return null; } }
function decodeTagText(bytes, encoding = 3) { try { const label = encoding === 0 ? 'windows-1252' : encoding === 1 ? 'utf-16' : encoding === 2 ? 'utf-16be' : 'utf-8'; return new TextDecoder(label).decode(bytes).replace(/\u0000/g, '').replace(/^\uFEFF/, '').trim(); } catch { return ''; } }
async function extractId3Metadata(file) {
  const result = {};
  try {
    const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (header.length >= 10 && header[0] === 73 && header[1] === 68 && header[2] === 51) {
      const version = header[3];
      const tagSize = ((header[6] & 127) << 21) | ((header[7] & 127) << 14) | ((header[8] & 127) << 7) | (header[9] & 127);
      const bytes = new Uint8Array(await file.slice(10, 10 + tagSize).arrayBuffer());
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let offset = 0;
      if ((header[5] & 0x40) && bytes.length >= 4) {
        const extSize = version === 4 ? ((bytes[0] & 127) << 21) | ((bytes[1] & 127) << 14) | ((bytes[2] & 127) << 7) | (bytes[3] & 127) : view.getUint32(0, false);
        offset = version === 4 ? extSize : extSize + 4;
      }
      const fields = version === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
      while (offset < bytes.length) {
        const headerSize = version === 2 ? 6 : 10;
        if (offset + headerSize > bytes.length) break;
        const idLength = version === 2 ? 3 : 4;
        const id = String.fromCharCode(...bytes.slice(offset, offset + idLength));
        if (!id.trim() || id.charCodeAt(0) === 0) break;
        let size;
        if (version === 2) size = (bytes[offset + 3] << 16) | (bytes[offset + 4] << 8) | bytes[offset + 5];
        else if (version === 4) size = ((bytes[offset + 4] & 127) << 21) | ((bytes[offset + 5] & 127) << 14) | ((bytes[offset + 6] & 127) << 7) | (bytes[offset + 7] & 127);
        else size = view.getUint32(offset + 4, false);
        const content = offset + headerSize;
        if (size <= 0 || content + size > bytes.length) break;
        const field = fields[id];
        if (field && size > 1) result[field] = decodeTagText(bytes.slice(content + 1, content + size), bytes[content]);
        offset = content + size;
      }
    }
    if (!result.title || !result.artist || !result.album) {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 128)).arrayBuffer());
      if (tail.length === 128 && String.fromCharCode(...tail.slice(0, 3)) === 'TAG') {
        const decodeLegacy = range => decodeTagText(tail.slice(...range), 0);
        result.title ||= decodeLegacy([3, 33]); result.artist ||= decodeLegacy([33, 63]); result.album ||= decodeLegacy([63, 93]);
      }
    }
  } catch { }
  return result;
}
async function extractM4aMetadata(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const known = { [String.fromCharCode(0xa9) + 'nam']: 'title', [String.fromCharCode(0xa9) + 'ART']: 'artist', [String.fromCharCode(0xa9) + 'alb']: 'album' };
    const readBoxes = (start, end) => {
      const boxes = [];
      for (let pos = start; pos + 8 <= end;) {
        let size = view.getUint32(pos, false); const type = String.fromCharCode(...bytes.slice(pos + 4, pos + 8)); let header = 8;
        if (size === 1) { if (pos + 16 > end) break; size = Number(view.getBigUint64(pos + 8, false)); header = 16; }
        else if (size === 0) size = end - pos;
        if (size < header || pos + size > end) break;
        boxes.push({ type, start: pos + header, end: pos + size }); pos += size;
      }
      return boxes;
    };
    const result = {};
    const visit = (start, end, depth = 0) => {
      if (depth > 8) return;
      for (const box of readBoxes(start, end)) {
        if (known[box.type]) {
          for (const data of readBoxes(box.start, box.end)) if (data.type === 'data' && data.end > data.start + 8) {
            const value = decodeTagText(bytes.slice(data.start + 8, data.end), 3);
            if (value) result[known[box.type]] = value;
          }
        }
        if (['moov', 'udta', 'meta', 'ilst'].includes(box.type)) visit(box.start + (box.type === 'meta' ? 4 : 0), box.end, depth + 1);
      }
    };
    visit(0, bytes.length);
    return result;
  } catch { return {}; }
}
async function extractAudioMetadata(file) {
  const metadata = await extractId3Metadata(file);
  if (metadata.title && metadata.artist && metadata.album) return metadata;
  if (file.size <= maxMetadataScanSize && (/\.(m4a|mp4|m4b|m4p)$/i.test(file.name || '') || /audio\/(mp4|x-m4a)/i.test(file.type || ''))) return { ...await extractM4aMetadata(file), ...metadata };
  return metadata;
}
function fmt(sec) { if (!Number.isFinite(sec) || sec < 0) return '0:00'; return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`; }
function currentOrderKey() { return libraryFavoritesOnly ? 'naghma-order-favorites' : activePlaylistId ? `naghma-order-${activePlaylistId}` : 'naghma-order-all'; }
function sortMusic(items) { const list = [...items]; const newest = (a, b) => (b.addedAt || b.stamp || 0) - (a.addedAt || a.stamp || 0); const savedOrder = readList(currentOrderKey()); if (!savedOrder.length) return list.sort(newest); const positions = new Map(savedOrder.map((id, index) => [id, index])); return list.sort((a, b) => { const ai = positions.get(a.id), bi = positions.get(b.id); if (ai === undefined && bi === undefined) return newest(a, b); if (ai === undefined) return -1; if (bi === undefined) return 1; return ai - bi; }); }
function reorderTrack(sourceId, targetId) { if (!sourceId || !targetId || sourceId === targetId) return; const ids = getActiveTracks().map(track => track.id); const from = ids.indexOf(sourceId), to = ids.indexOf(targetId); if (from < 0 || to < 0) return; ids.splice(to, 0, ids.splice(from, 1)[0]); localStorage.setItem(currentOrderKey(), JSON.stringify(ids)); render(); }
function normalizeYoutubeItem(item) { const metadata = readObject(youtubeMetadataKey)[item.id] || {}; const thumbnail = metadata.coverDataUrl || item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`; return { ...item, ...metadata, sourceType: 'youtube', title: Object.hasOwn(metadata, 'title') ? metadata.title : item.title, artist: Object.hasOwn(metadata, 'artist') ? metadata.artist : item.artist, album: Object.hasOwn(metadata, 'album') ? metadata.album : item.album || 'YouTube', thumbnail, externalCover: thumbnail, colorIndex: Number.isInteger(item.colorIndex) ? item.colorIndex : 0, addedAt: item.addedAt || item.playedAt || Date.now() }; }
function readObject(key) { try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function isYoutubeFavorite(id) { return youtubeFavorites.some(item => item.id === id); }
function saveYoutubeFavorites() { localStorage.setItem(youtubeFavoritesKey, JSON.stringify(youtubeFavorites)); }
function addItemToPlaylist(playlist, item) {
  if (item.sourceType === 'youtube') {
    playlist.youtubeItems ||= [];
    if (playlist.youtubeItems.some(saved => saved.id === item.id)) return false;
    playlist.youtubeItems.push(normalizeYoutubeItem(item));
  } else {
    playlist.trackIds ||= [];
    if (playlist.trackIds.includes(item.id)) return false;
    playlist.trackIds.push(item.id);
  }
  persistPlaylists();
  return true;
}
function setFavoriteForItem(item) {
  if (item.sourceType === 'youtube') {
    if (isYoutubeFavorite(item.id)) { youtubeFavorites = youtubeFavorites.filter(saved => saved.id !== item.id); showToast('أُزيلت الأغنية من المفضلة'); }
    else { youtubeFavorites.unshift(normalizeYoutubeItem(item)); showToast('أُضيفت الأغنية إلى المفضلة'); }
    saveYoutubeFavorites();
  } else {
    if (favorites.has(item.id)) { favorites.delete(item.id); showToast('أُزيلت الأغنية من المفضلة'); }
    else { favorites.add(item.id); showToast('أُضيفت الأغنية إلى المفضلة'); }
    localStorage.setItem('naghma-favorites', JSON.stringify([...favorites]));
  }
  render();
  if (item.sourceType === 'youtube') updateYoutubeFavoriteButtons();
}
function showToast(message) { let node = document.querySelector('.toast'); if (!node) { node = document.createElement('div'); node.className = 'toast'; document.body.append(node); } node.textContent = message; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => node.remove(), 2300); }
function setSleepTimer(minutes) { clearTimeout(sleepTimeout); sleepTimeout = setTimeout(() => { if (source === 'youtube') ytPlayer?.pauseVideo?.(); else audio.pause(); document.querySelector('#playerOverlay').classList.add('hidden'); updatePlayButtons(); showToast('انتهت المدة؛ أُوقفت الموسيقى وأُغلق المشغّل'); sleepTimeout = null; }, minutes * 60000); showToast(`ستتوقف الموسيقى بعد ${minutes} دقيقة`); }
function openSleepTimer() { document.querySelector('#playerOverlay').classList.add('hidden'); document.querySelector('.modal-backdrop')?.remove(); const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = `<section class="queue-panel timer-panel"><div class="queue-header"><h3>المؤقت</h3><button class="close-button" aria-label="إغلاق">×</button></div><p>اختر مدة إيقاف الموسيقى</p><div class="timer-options">${[5, 10, 15, 30, 45, 60].map(n => `<button class="timer-option" data-minutes="${n}">${n} دقيقة</button>`).join('')}</div>${sleepTimeout ? '<button class="timer-cancel" data-cancel-timer>إلغاء المؤقت الحالي</button>' : ''}</section>`; document.body.append(backdrop); backdrop.addEventListener('click', e => { if (e.target === backdrop || e.target.closest('.close-button')) { backdrop.remove(); return; } const option = e.target.closest('[data-minutes]'); if (option) { setSleepTimer(Number(option.dataset.minutes)); backdrop.remove(); return; } if (e.target.closest('[data-cancel-timer]')) { clearTimeout(sleepTimeout); sleepTimeout = null; showToast('أُلغي المؤقت'); backdrop.remove(); } }); }
function persistPlaylists() { localStorage.setItem('naghma-playlists', JSON.stringify(playlists)); }
function ensureDownloadsPlaylist(trackIds = tracks.map(track => track.id)) {
  let playlist = playlists.find(item => item.id === downloadsPlaylistId) || playlists.find(item => item.name?.trim() === 'التنزيلات');
  if (!playlist) playlist = { id: downloadsPlaylistId, name: 'التنزيلات', trackIds: [], system: 'downloads' };
  playlist.id = downloadsPlaylistId;
  playlist.name = 'التنزيلات';
  playlist.system = 'downloads';
  playlist.trackIds = [...new Set([...(playlist.trackIds || []).filter(id => tracks.some(track => track.id === id)), ...trackIds.filter(id => tracks.some(track => track.id === id))])];
  playlists = [playlist, ...playlists.filter(item => item !== playlist)];
  persistPlaylists();
  return playlist;
}
function openCreatePlaylist(track = null) { const returnToPlayer = !!track; document.querySelector('#playerOverlay').classList.add('hidden'); document.querySelector('.modal-backdrop')?.remove(); const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop'; backdrop.innerHTML = `<form class="queue-panel playlist-form"><div class="queue-header"><h3>قائمة تشغيل جديدة</h3><button type="button" class="close-button" aria-label="إغلاق">×</button></div><label for="playlistName">اسم القائمة</label><input id="playlistName" maxlength="40" placeholder="أدخل اسم القائمة" autocomplete="off"><div class="playlist-form-actions"><button class="hero-button" type="submit">إنشاء القائمة</button><button class="text-button cancel-playlist" type="button">إلغاء</button></div></form>`; document.body.append(backdrop); const form = backdrop.querySelector('form'); form.addEventListener('submit', e => { e.preventDefault(); const name = form.querySelector('#playlistName').value.trim(); if (!name) { showToast('يرجى إدخال اسم القائمة'); return; } const item = typeof track === 'string' ? tracks.find(saved => saved.id === track) : track; const playlist = { id: makeId(), name, trackIds: [], youtubeItems: [] }; if (item) addItemToPlaylist(playlist, item); playlists.push(playlist); persistPlaylists(); if (item) { backdrop.remove(); openFullPlayer(); showToast('أُنشئت القائمة وأُضيفت إليها الأغنية'); } else { activePlaylistId = playlist.id; libraryCategory = 'playlist'; libraryFavoritesOnly = false; currentView = 'library'; backdrop.remove(); render(); showToast('أُنشئت قائمة التشغيل'); } }); backdrop.addEventListener('click', e => { if (e.target === backdrop || e.target.closest('.close-button,.cancel-playlist')) { backdrop.remove(); if (returnToPlayer) openFullPlayer(); } }); form.querySelector('#playlistName').focus(); }
function openPlaylistManager(playlistId) {
  const playlist = playlists.find(item => item.id === playlistId);
  if (!playlist || playlist.id === downloadsPlaylistId || playlist.system) { showToast('لا يمكن تعديل هذه القائمة'); return; }
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<form class="queue-panel playlist-form"><div class="queue-header"><h3>إدارة قائمة التشغيل</h3><button type="button" class="close-button" aria-label="إغلاق">×</button></div><label for="managedPlaylistName">اسم القائمة</label><input id="managedPlaylistName" maxlength="40" value="${esc(playlist.name)}" autocomplete="off" required><div class="playlist-form-actions"><button class="hero-button" type="submit">حفظ الاسم</button><button class="playlist-delete-button" type="button" data-delete-playlist>حذف القائمة</button></div></form>`;
  document.body.append(backdrop);
  const form = backdrop.querySelector('form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = form.querySelector('#managedPlaylistName').value.trim();
    if (!name) { showToast('يرجى إدخال اسم القائمة'); return; }
    playlist.name = name;
    persistPlaylists();
    backdrop.remove();
    render();
    showToast('تم تعديل اسم القائمة');
  });
  backdrop.addEventListener('click', event => {
    if (event.target === backdrop || event.target.closest('.close-button')) { backdrop.remove(); return; }
    if (!event.target.closest('[data-delete-playlist]')) return;
    if (!window.confirm(`هل تريد حذف قائمة «${playlist.name}»؟`)) return;
    playlists = playlists.filter(item => item.id !== playlist.id);
    persistPlaylists();
    if (activePlaylistId === playlist.id) {
      activePlaylistId = downloadsPlaylistId;
      libraryCategory = 'playlist';
      libraryFavoritesOnly = false;
    }
    const order = readList('naghma-library-order').filter(id => id !== `playlist:${playlist.id}`);
    localStorage.setItem('naghma-library-order', JSON.stringify(order));
    backdrop.remove();
    render();
    showToast('تم حذف قائمة التشغيل');
  });
  form.querySelector('#managedPlaylistName').focus();
}
function openAddToPlaylist() { const item = currentNowPlayingItem(); if (!item) { showToast('يرجى تشغيل أغنية أولًا'); return; } document.querySelector('#playerOverlay').classList.add('hidden'); openNowPlayingPlaylistPicker(item); }
function getActiveTracks() {
  let list = tracks.filter(t => !query || `${t.title} ${t.artist} ${t.album}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  let youtubeItems = [];
  if (currentView === 'library' && libraryCategory === 'favorites') {
    list = list.filter(t => favorites.has(t.id));
    youtubeItems = youtubeFavorites.map(normalizeYoutubeItem);
  }
  if (currentView === 'library' && libraryCategory === 'playlist' && activePlaylistId) {
    const playlist = playlists.find(p => p.id === activePlaylistId);
    list = list.filter(t => playlist?.trackIds?.includes(t.id));
    youtubeItems = (playlist?.youtubeItems || []).map(normalizeYoutubeItem);
  }
  if (currentView === 'library' && libraryCategory === 'album') list = selectedAlbum ? list.filter(t => (t.album || 'بدون ألبوم') === selectedAlbum) : [];
  if (currentView === 'library' && libraryCategory === 'artist') list = selectedArtist ? list.filter(t => (t.artist || 'فنان غير معروف') === selectedArtist) : [];
  if (currentView === 'library' && libraryCategory === 'playlists') list = [];
  return sortMusic([...list, ...youtubeItems]);
}
function currentNowPlayingItem() {
  if (source === 'youtube' && currentYoutubeItem) return normalizeYoutubeItem(currentYoutubeItem);
  const track = currentTrack();
  return track ? { ...track, sourceType: 'local' } : null;
}
function openNowPlayingMenu() {
  const item = currentNowPlayingItem();
  if (!item) { showToast('شغّل أغنية أولًا'); return; }
  const player = document.querySelector('#playerOverlay');
  player.querySelector('.now-playing-menu')?.remove();
  const liked = item.sourceType === 'youtube' ? isYoutubeFavorite(item.id) : favorites.has(item.id);
  const image = item.sourceType === 'youtube' ? item.thumbnail : coverImage(item);
  const menu = document.createElement('div');
  menu.className = 'now-playing-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'خيارات الأغنية');
  menu.innerHTML = `${image ? `<img class="now-playing-menu-cover" src="${esc(image)}" alt="">` : ''}<div class="now-playing-menu-shade"></div><section class="now-playing-menu-content"><div class="now-playing-menu-header"><span>${esc(item.artist || (item.sourceType === 'youtube' ? 'YouTube' : 'ملف من جهازك'))}</span><button class="icon-button" data-now-action="close" aria-label="إغلاق">×</button><h2>${esc(item.title)}</h2></div><button class="recent-action" data-now-action="favorite">${liked ? '♥' : '♡'} <span>${liked ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}</span></button><button class="recent-action" data-now-action="playlist">＋ <span>إضافة إلى قائمة تشغيل</span></button><button class="recent-action" data-now-action="edit">✎ <span>تعديل بيانات الأغنية</span></button><button class="recent-action recent-action-delete" data-now-action="delete">⌫ <span>حذف من المكتبة</span></button></section>`;
  player.append(menu);
  menu.addEventListener('click', async e => {
    if (e.target === menu || e.target.closest('[data-now-action="close"]')) { menu.remove(); return; }
    const action = e.target.closest('[data-now-action]')?.dataset.nowAction;
    if (action === 'favorite') { menu.remove(); setFavoriteForItem(item); if (item.sourceType === 'local') paintTrack(); openNowPlayingMenu(); }
    if (action === 'playlist') { menu.remove(); openNowPlayingPlaylistPicker(item); }
    if (action === 'edit') { menu.remove(); openTrackEditor(item); }
    if (action === 'delete') {
      if (!window.confirm(`هل تريد حذف «${item.title}» من المكتبة؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
      try {
        await deleteLibraryItem(item);
        menu.remove();
        render();
        showToast('حُذفت الأغنية من المكتبة');
      } catch (error) {
        console.error('تعذر حذف الأغنية من المكتبة', error);
        showToast('تعذر حذف الأغنية من المكتبة');
      }
    }
  });
}
function openNowPlayingPlaylistPicker(item) {
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<section class="queue-panel"><div class="queue-header"><h3>اختر قائمة التشغيل</h3><button class="close-button" aria-label="إغلاق">×</button></div>${playlists.length ? playlists.map(p => `<button class="playlist-choice" data-pick-playlist="${esc(p.id)}"><span>♫</span><strong>${esc(p.name)}</strong><small>${(p.trackIds?.length || 0) + (p.youtubeItems?.length || 0)} أغنية</small></button>`).join('') : '<p class="eyebrow">لا توجد قوائم تشغيل بعد.</p>'}<button class="add-small" data-create-playlist-from-item>＋ إنشاء قائمة تشغيل</button></section>`;
  document.body.append(backdrop);
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop || e.target.closest('.close-button')) { backdrop.remove(); openFullPlayer(); return; }
    if (e.target.closest('[data-create-playlist-from-item]')) { backdrop.remove(); openCreatePlaylist(item); return; }
    const choice = e.target.closest('[data-pick-playlist]');
    if (!choice) return;
    const playlist = playlists.find(saved => saved.id === choice.dataset.pickPlaylist);
    const added = playlist && addItemToPlaylist(playlist, item);
    backdrop.remove();
    if (added) { render(); showToast(`أُضيفت إلى ${playlist.name}`); }
    else showToast(playlist ? 'الأغنية موجودة بالفعل في القائمة' : 'تعذرت إضافة الأغنية');
    openFullPlayer();
  });
}
function fileAsDataUrl(file) { return new Promise((resolve, reject) => { const fallback = () => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }; if (!window.createImageBitmap) { fallback(); return; } createImageBitmap(file).then(bitmap => { const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale)); canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); resolve(canvas.toDataURL('image/jpeg', .82)); }).catch(fallback); }); }
function libraryEntityKey(type, name) { return `${type}:${name}`; }
function getLibraryEntityMetadata(type, name) { return readObject(libraryEntityMetadataKey)[libraryEntityKey(type, name)] || {}; }
function openLibraryEntityEditor(type, originalName) {
  const field = type === 'artist' ? 'artist' : 'album';
  const fallbackName = type === 'artist' ? 'فنان غير معروف' : 'بدون ألبوم';
  const tracksForEntity = tracks.filter(track => ((track[field] || '').trim() || fallbackName) === originalName);
  if (!tracksForEntity.length) { showToast('تعذر العثور على الأغاني التابعة لهذا العنصر'); return; }
  const existing = getLibraryEntityMetadata(type, originalName);
  const displayedName = existing.name || originalName;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<form class="queue-panel playlist-form edit-track-form"><div class="queue-header"><h3>تعديل ${type === 'artist' ? 'الفنان' : 'الألبوم'}</h3><button type="button" class="close-button" aria-label="إغلاق">×</button></div><label>${type === 'artist' ? 'اسم الفنان' : 'اسم الألبوم'}<input type="text" name="name" maxlength="120" value="${esc(displayedName)}" required></label><label>صورة ${type === 'artist' ? 'الفنان' : 'الألبوم'}<input type="file" name="cover" accept="image/*"></label><button class="hero-button" type="submit">حفظ التعديلات</button></form>`;
  document.body.append(backdrop);
  const form = backdrop.querySelector('form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    const cover = form.elements.cover.files?.[0];
    if (!name) { showToast(`اكتب اسم ${type === 'artist' ? 'الفنان' : 'الألبوم'}`); return; }
    try {
      const metadata = readObject(libraryEntityMetadataKey);
      const updated = { ...existing, name };
      if (cover) updated.coverDataUrl = await fileAsDataUrl(cover);
      delete metadata[libraryEntityKey(type, originalName)];
      metadata[libraryEntityKey(type, name)] = updated;
      localStorage.setItem(libraryEntityMetadataKey, JSON.stringify(metadata));
      for (const track of tracksForEntity) {
        track[field] = name;
        await dbRun('readwrite', store => store.put(track));
      }
      if (currentTrack() && tracksForEntity.some(track => track.id === currentTrack().id)) paintTrack();
      else render();
      backdrop.remove();
      showToast(`تم تعديل ${type === 'artist' ? 'الفنان' : 'الألبوم'}`);
    } catch (error) {
      console.error('تعذر حفظ تعديل الفنان أو الألبوم', error);
      showToast('تعذر حفظ التعديلات');
    }
  });
  backdrop.addEventListener('click', event => { if (event.target === backdrop || event.target.closest('.close-button')) backdrop.remove(); });
  form.elements.name.focus();
}
function setupLibraryEntityActions(host) {
  let timer = null;
  let pressed = null;
  let startPoint = null;
  let didLongPress = false;
  host.onpointerdown = event => {
    const card = event.target.closest('[data-open-artist],[data-open-album]');
    if (!card || event.button !== 0) return;
    pressed = card;
    startPoint = { x: event.clientX, y: event.clientY };
    didLongPress = false;
    timer = setTimeout(() => {
      didLongPress = true;
      card.classList.add('long-pressed');
      openLibraryEntityEditor(card.hasAttribute('data-open-artist') ? 'artist' : 'album',
        card.dataset.openArtist ?? card.dataset.openAlbum);
      setTimeout(() => card.classList.remove('long-pressed'), 450);
    }, 500);
  };
  host.onpointermove = event => {
    if (!timer || !startPoint) return;
    if (Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > 12) {
      clearTimeout(timer);
      timer = null;
      pressed = null;
      startPoint = null;
    }
  };
  const finish = () => {
    clearTimeout(timer);
    timer = null;
    pressed = null;
    startPoint = null;
    if (didLongPress) {
      host.dataset.ignoreEntityClick = 'true';
      setTimeout(() => delete host.dataset.ignoreEntityClick, 450);
    }
  };
  host.onpointerup = finish;
  host.onpointercancel = finish;
}
function openTrackEditor(item, returnToPlayer = true) {
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<form class="queue-panel playlist-form edit-track-form"><div class="queue-header"><h3>تعديل بيانات الأغنية</h3><button type="button" class="close-button" aria-label="إغلاق">×</button></div><label>اسم الأغنية<input type="text" name="title" maxlength="120" value="${esc(item.title || '')}" required></label><label>اسم المغني<input type="text" name="artist" maxlength="120" value="${esc(item.artist || '')}"></label><label>اسم الألبوم<input type="text" name="album" maxlength="120" value="${esc(item.album || (item.sourceType === 'youtube' ? 'YouTube' : ''))}"></label><label>غلاف الأغنية<input type="file" name="cover" accept="image/*"></label><button class="hero-button" type="submit">حفظ التعديلات</button></form>`;
  document.body.append(backdrop);
  const form = backdrop.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const title = form.elements.title.value.trim();
    const artist = form.elements.artist.value.trim();
    const album = form.elements.album.value.trim();
    const cover = form.elements.cover.files?.[0];
    if (!title) { showToast('اكتب اسم الأغنية'); return; }
    if (item.sourceType === 'local') {
      const track = tracks.find(saved => saved.id === item.id);
      if (!track) { showToast('تعذر العثور على الملف الصوتي'); return; }
      track.title = title; track.artist = artist; track.album = album;
      if (cover) { track.coverBlob = cover; track.coverMime = cover.type || 'image/jpeg'; coverUrls.set(track.id, URL.createObjectURL(cover)); }
      await dbRun('readwrite', store => store.put(track));
      if (currentTrack()?.id === track.id) paintTrack(); else render();
      showToast('تم حفظ بيانات الأغنية وغلافها');
    } else {
      const metadata = readObject(youtubeMetadataKey);
      const updated = { ...(metadata[item.id] || {}), title, artist, album };
      if (cover) updated.coverDataUrl = await fileAsDataUrl(cover);
      metadata[item.id] = updated;
      localStorage.setItem(youtubeMetadataKey, JSON.stringify(metadata));
      currentYoutubeItem = normalizeYoutubeItem({ ...currentYoutubeItem, ...updated });
      const history = readList(playedHistoryKey).map(saved => saved.id === item.id && (saved.sourceType || 'youtube') === 'youtube' ? { ...saved, ...updated, thumbnail: updated.coverDataUrl || saved.thumbnail } : saved);
      localStorage.setItem(playedHistoryKey, JSON.stringify(history));
      youtubeFavorites = youtubeFavorites.map(saved => saved.id === item.id ? { ...saved, ...updated, thumbnail: updated.coverDataUrl || saved.thumbnail } : saved); saveYoutubeFavorites();
      playlists.forEach(playlist => { playlist.youtubeItems = (playlist.youtubeItems || []).map(saved => saved.id === item.id ? { ...saved, ...updated, thumbnail: updated.coverDataUrl || saved.thumbnail } : saved); }); persistPlaylists();
      const updatedItem = currentYoutubeItem;
      applyTrackTheme(updatedItem);
      for (const selector of ['#ytNowTitle', '#nowTitle', '#fullTitle', '#nowPlayingLabel']) document.querySelector(selector).textContent = updatedItem.title;
      document.querySelector('#nowArtist').textContent = `${updatedItem.artist} · YouTube`;
      document.querySelector('#fullArtist').textContent = `${updatedItem.artist} · YouTube`;
      const coverCss = `background:linear-gradient(#0002,#0002),url('${updatedItem.thumbnail}') center/cover`;
      document.querySelector('#miniCover').style.cssText = coverCss; document.querySelector('#fullCover').style.cssText = coverCss;
      if (navigator.mediaSession && 'MediaMetadata' in window) { try { navigator.mediaSession.metadata = new MediaMetadata({ title: updatedItem.title, artist: updatedItem.artist, album: updatedItem.album || 'YouTube', artwork: [{ src: updatedItem.thumbnail, sizes: '480x360', type: 'image/jpeg' }] }); } catch { } }
      render(); showToast('تم حفظ بيانات الأغنية وغلافها');
    }
    backdrop.remove();
    if (returnToPlayer) openFullPlayer();
  });
  backdrop.addEventListener('click', e => { if (e.target === backdrop || e.target.closest('.close-button')) { backdrop.remove(); if (returnToPlayer) openFullPlayer(); } });
}
function getLibraryNavEntries() {
  const entries = [
    { id: 'albums', label: 'الألبومات', icon: '▦' },
    { id: 'artists', label: 'فنانين', icon: '♙' },
    { id: 'favorites', label: 'المفضلة', icon: '♥' },
    ...playlists.map(playlist => ({ id: `playlist:${playlist.id}`, label: playlist.name, icon: '♫', playlistId: playlist.id, manageable: playlist.id !== downloadsPlaylistId && !playlist.system })),
    { id: 'create-playlist', label: 'إنشاء قائمة تشغيل', icon: '＋' }
  ];
  const savedOrder = readList('naghma-library-order');
  const position = new Map(savedOrder.map((id, index) => [id, index]));
  return entries.sort((a, b) => {
    const ai = position.get(a.id), bi = position.get(b.id);
    if (a.id === 'create-playlist' && bi === undefined) return 1;
    if (b.id === 'create-playlist' && ai === undefined) return -1;
    if (ai === undefined && bi === undefined) return 0;
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    return ai - bi;
  });
}
function setupLibraryNavReordering(host) {
  let pressTimer = null;
  let pressed = null;
  let dragging = false;
  host.onpointerdown = event => {
    const entry = event.target.closest('[data-library-entry]');
    if (!entry || event.target.closest('[data-playlist-actions]') || event.button !== 0) return;
    pressed = entry;
    pressTimer = setTimeout(() => {
      dragging = true;
      entry.classList.add('reordering');
    }, 450);
  };
  host.onpointermove = event => {
    if (!dragging || !pressed) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-library-entry]');
    if (!target || target === pressed || target.parentElement !== host) return;
    const rect = target.getBoundingClientRect();
    host.insertBefore(pressed, event.clientY < rect.top + rect.height / 2 ? target : target.nextSibling);
  };
  const finish = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (dragging) {
      localStorage.setItem('naghma-library-order', JSON.stringify([...host.querySelectorAll('[data-library-entry]')].map(item => item.dataset.libraryEntry)));
      host.querySelectorAll('.reordering').forEach(item => item.classList.remove('reordering'));
      host.dataset.ignoreClick = 'true';
      setTimeout(() => delete host.dataset.ignoreClick, 350);
    }
    pressed = null;
    dragging = false;
  };
  host.onpointerup = finish;
  host.onpointercancel = finish;
  host.onclick = event => {
    if (host.dataset.ignoreClick) { delete host.dataset.ignoreClick; return; }
    const actions = event.target.closest('[data-playlist-actions]');
    if (actions) {
      event.preventDefault();
      event.stopPropagation();
      openPlaylistManager(actions.dataset.playlistActions);
      return;
    }
    const button = event.target.closest('[data-library-nav-id]');
    if (!button) return;
    const id = button.dataset.libraryNavId;
    if (id === 'create-playlist') { openCreatePlaylist(); return; }
    if (id.startsWith('playlist:')) {
      activePlaylistId = id.slice('playlist:'.length);
      libraryCategory = 'playlist';
    } else {
      activePlaylistId = null;
      libraryCategory = id;
      selectedAlbum = null;
      selectedArtist = null;
    }
    libraryFavoritesOnly = libraryCategory === 'favorites';
    render();
  };
}
function render() {
  const list = getActiveTracks();
  renderPlayedHistory();
  markNowPlayingCards();
  const rows = document.querySelector('#trackList');
  const browseGrid = document.querySelector('#libraryBrowseGrid');
  const browseLibrary = currentView === 'library' && ['albums', 'artists', 'playlists'].includes(libraryCategory) &&
    !(libraryCategory === 'albums' && selectedAlbum) && !(libraryCategory === 'artists' && selectedArtist) &&
    !(libraryCategory === 'playlists' && activePlaylistId);
  rows.classList.toggle('hidden', browseLibrary);
  browseGrid.classList.toggle('hidden', currentView !== 'library' || !browseLibrary);
  rows.classList.toggle('library-list-view', currentView === 'library' && layoutMode === 'list');
  rows.classList.toggle('library-cover-grid', currentView === 'library' && layoutMode === 'grid' &&
    ['playlist', 'album', 'artist', 'favorites'].includes(libraryCategory));
  document.querySelector('#albumGrid').classList.toggle('list-view', layoutMode === 'list');
  rows.classList.toggle('grid-view', layoutMode === 'grid');
  document.querySelector('#gridViewBtn').classList.toggle('selected', layoutMode === 'grid');
  document.querySelector('#listViewBtn').classList.toggle('selected', layoutMode === 'list');
  document.querySelector('#recentGridViewBtn').classList.toggle('selected', layoutMode === 'grid');
  document.querySelector('#recentListViewBtn').classList.toggle('selected', layoutMode === 'list');
  rows.innerHTML = list.map((t, i) => { const isYoutube = t.sourceType === 'youtube'; const liked = isYoutube ? isYoutubeFavorite(t.id) : favorites.has(t.id); const image = coverImage(t); const isCurrent = isCurrentTrackItem(t); const playing = isCurrent && isMediaPlaying(); const artist = esc(t.artist || (isYoutube ? 'YouTube' : 'ملف من جهازك')); const album = esc(isYoutube ? t.album || 'YouTube' : t.album || '—'); const favoriteButton = `<button class="row-more" data-favorite="${esc(t.id)}" aria-label="المفضلة">${liked ? '♥' : '♡'}</button>`; return `<div class="track-row ${isCurrent ? 'current-track-active' : ''} ${playing ? 'playing' : ''}" data-id="${esc(t.id)}" data-source-type="${isYoutube ? 'youtube' : 'local'}"><button class="drag-handle" data-drag-handle="${esc(t.id)}" aria-label="اسحب لترتيب ${esc(t.title)}" title="اسحب لإعادة الترتيب"><span></span><span></span><span></span><span></span></button><span class="track-index">${playing ? '♫' : String(i + 1).padStart(2, '0')}</span>${currentView === 'library' && layoutMode === 'list' ? `<div class="track-thumb" style="${coverStyle(t)}">${image ? `<img class="track-thumb-image" src="${esc(image)}" alt="غلاف ${esc(t.title)}">` : '♫'}</div><span class="track-title">${esc(t.title)}</span><span class="track-artist">${artist}</span><span class="track-album">${album}</span><span class="track-duration">${fmt(t.duration)}</span>${favoriteButton}` : `<div class="track-thumb" style="${coverStyle(t)}">${image ? `<img class="track-thumb-image" src="${esc(image)}" alt="غلاف ${esc(t.title)}">` : '♫'}</div><div class="track-meta"><strong>${esc(t.title)}</strong><small>${artist}</small></div><span class="track-album">${album}</span><span class="track-duration">${fmt(t.duration)}</span>${isYoutube ? '' : `<button class="row-cover" data-cover="${esc(t.id)}" aria-label="اختيار صورة الغلاف" title="اختيار صورة الغلاف">▧</button>`}${favoriteButton}`}</div>`; }).join('') || `<div class="empty-state"><div class="empty-note">♫</div><h3>${query ? 'لا توجد أغانٍ مطابقة' : libraryFavoritesOnly ? 'لا توجد أغانٍ في المفضلة' : activePlaylistId ? 'قائمة التشغيل فارغة' : 'مكتبتك فارغة'}</h3><p>${query ? 'جرّب اسمًا آخر أو أضف ملفًا صوتيًا.' : libraryFavoritesOnly ? 'اضغط على رمز القلب بجانب أي أغنية لإضافتها هنا.' : activePlaylistId ? 'شغّل أغنية، ثم اضغط «إلى قائمة» لإضافتها هنا.' : 'أضف ملفاتك الصوتية من جهازك لتظهر هنا.'}</p>${libraryFavoritesOnly || activePlaylistId ? '' : `<button class="hero-button" id="emptyImport">اختر أغانٍ</button>`}</div>`;
  rows.querySelector('#emptyImport')?.addEventListener('click', () => fileInput.click());
  const titleMap = { listen: 'استمع الآن', browse: 'تصفح', settings: 'الإعدادات', radio: 'راديو', library: 'المكتبة', albums: 'الألبومات', artists: 'فنانين', playlists: 'قوائم التشغيل' };
  document.querySelector('#pageTitle').textContent = titleMap[currentView] || 'استمع الآن';
  const browsing = currentView === 'browse';
  document.querySelector('#browsePage').classList.toggle('hidden', !browsing);
  document.querySelector('#settingsPage').classList.toggle('hidden', currentView !== 'settings');
  const showTrackControls = !browsing && currentView !== 'listen' && !browseLibrary;
  document.querySelector('#collectionControls').classList.toggle('hidden', !showTrackControls);
  document.querySelector('#recentSection').classList.toggle('hidden', currentView !== 'listen');
  document.querySelector('#listenSearchSection').classList.add('hidden');
  document.querySelector('#librarySection').classList.toggle('hidden', browsing || currentView === 'listen' || currentView === 'settings');
  renderHistory();
  const activePlaylist = playlists.find(p => p.id === activePlaylistId);
  const libraryTitle = libraryCategory === 'playlist' ? activePlaylist?.name || 'قائمة التشغيل' :
    libraryCategory === 'album' && selectedAlbum ? selectedAlbum :
      libraryCategory === 'artist' && selectedArtist ? selectedArtist :
        ({ all: 'كل الأغاني', albums: 'الألبومات', artists: 'فنانين', favorites: 'الأغاني المفضلة', playlists: 'قوائم التشغيل', album: 'الألبومات', artist: 'فنانين' }[libraryCategory] || 'كل الأغاني');
  document.querySelector('#pageTitle').textContent = currentView === 'library' ? libraryTitle : titleMap[currentView] || 'استمع الآن';
  const folders = document.querySelector('#libraryFolders');
  folders.classList.toggle('hidden', currentView !== 'library');
  folders.innerHTML = currentView !== 'library' ? '' : getLibraryNavEntries().map(entry => {
    const active = entry.id === libraryCategory || entry.id === `playlist:${activePlaylistId}` || (entry.id === 'playlists' && libraryCategory === 'playlists');
    const count = entry.id === 'all' ? tracks.length : entry.id === 'favorites' ? favorites.size + youtubeFavorites.length :
      entry.id.startsWith('playlist:') ? (() => { const playlist = playlists.find(item => item.id === entry.id.slice(9)); return (playlist?.trackIds?.length || 0) + (playlist?.youtubeItems?.length || 0); })() : null;
    return `<div class="library-nav-entry" data-library-entry="${esc(entry.id)}"><button class="library-nav-item ${active ? 'active' : ''}" data-library-nav-id="${esc(entry.id)}" title="اضغط مطولًا لإعادة الترتيب"><span class="library-nav-icon">${entry.icon}</span><span>${esc(entry.label)}</span>${count === null ? '' : `<small>${count}</small>`}</button>${entry.manageable ? `<button class="library-nav-actions" type="button" data-playlist-actions="${esc(entry.playlistId)}" aria-label="إدارة قائمة ${esc(entry.label)}" title="إدارة القائمة">⋯</button>` : ''}</div>`;
  }).join('');
  setupLibraryNavReordering(folders);
  const browseItems = [];
  if (browseLibrary && libraryCategory === 'albums') {
    const groups = new Map();
    tracks.forEach(track => { const name = (track.album || '').trim() || 'بدون ألبوم'; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(track); });
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ar')).forEach(([name, group]) => {
      const track = group[0], entity = getLibraryEntityMetadata('album', name), image = entity.coverDataUrl || coverImage(track);
      browseItems.push(`<article class="album-card library-entity-card" data-open-album="${esc(name)}"><div class="cover" style="${coverStyle(track)}">${image ? `<img class="cover-art" src="${esc(image)}" alt="">` : '<i>♫</i>'}</div><strong>${esc(entity.name || name)}</strong><small>${group.length} أغنية</small></article>`);
    });
  } else if (browseLibrary && libraryCategory === 'artists') {
    const groups = new Map();
    tracks.forEach(track => { const name = (track.artist || '').trim() || 'فنان غير معروف'; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(track); });
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'ar')).forEach(([name, group]) => {
      const track = group[0], entity = getLibraryEntityMetadata('artist', name), image = entity.coverDataUrl || coverImage(track);
      browseItems.push(`<article class="album-card library-entity-card" data-open-artist="${esc(name)}"><div class="cover" style="${coverStyle(track)}">${image ? `<img class="cover-art" src="${esc(image)}" alt="">` : '<i>♫</i>'}</div><strong>${esc(entity.name || name)}</strong><small>${group.length} أغنية</small></article>`);
    });
  } else if (browseLibrary && libraryCategory === 'playlists') {
    playlists.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar')).forEach(playlist => {
      const firstTrack = tracks.find(track => playlist.trackIds?.includes(track.id));
      browseItems.push(`<article class="album-card library-entity-card" data-open-playlist="${esc(playlist.id)}"><div class="cover" style="${firstTrack ? coverStyle(firstTrack) : 'background:linear-gradient(145deg,#7760bd,#39305d)'}"><i>♫</i>${playlist.id !== downloadsPlaylistId && !playlist.system ? `<button class="playlist-card-actions" type="button" data-playlist-actions="${esc(playlist.id)}" aria-label="إدارة قائمة ${esc(playlist.name)}">⋯</button>` : ''}</div><strong>${esc(playlist.name)}</strong><small>${(playlist.trackIds?.length || 0) + (playlist.youtubeItems?.length || 0)} أغنية</small></article>`);
    });
  }
  browseGrid.innerHTML = browseLibrary ? browseItems.join('') || '<div class="empty-state"><div class="empty-note">♫</div><h3>لا توجد عناصر بعد</h3><p>أضف أغاني أو أنشئ قائمة تشغيل لتظهر هنا.</p></div>' : '';
  browseGrid.onclick = event => {
    if (browseGrid.dataset.ignoreEntityClick) { delete browseGrid.dataset.ignoreEntityClick; return; }
    const playlistActions = event.target.closest('[data-playlist-actions]');
    if (playlistActions) { event.preventDefault(); event.stopPropagation(); openPlaylistManager(playlistActions.dataset.playlistActions); return; }
    const album = event.target.closest('[data-open-album]');
    const artist = event.target.closest('[data-open-artist]');
    const playlist = event.target.closest('[data-open-playlist]');
    if (album) { selectedAlbum = album.dataset.openAlbum; libraryCategory = 'album'; }
    else if (artist) { selectedArtist = artist.dataset.openArtist; libraryCategory = 'artist'; }
    else if (playlist) { activePlaylistId = playlist.dataset.openPlaylist; libraryCategory = 'playlist'; }
    else return;
    render();
  };
  setupLibraryEntityActions(browseGrid);
  document.querySelector('#libraryImportBtn').onclick = () => fileInput.click();
  syncNav();
}
function syncNav() { document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === currentView)); }
function currentTrack() { return tracks[current] || null; }
function isCurrentTrackItem(item) { return source === 'youtube' ? item.sourceType === 'youtube' && currentYoutubeItem?.id === item.id : item.sourceType !== 'youtube' && currentTrack()?.id === item.id; }
function isMediaPlaying() { if (source === 'youtube') { try { return ytPlayer?.getPlayerState?.() === 1; } catch { return false; } } return !audio.paused; }
function markNowPlayingCards() { document.querySelectorAll('#albumGrid .album-card').forEach(card => { const item = card.dataset.video ? { id: card.dataset.video, sourceType: 'youtube' } : { id: card.dataset.track, sourceType: 'local' }; card.classList.toggle('current-track-active', !!item.id && isCurrentTrackItem(item)); }); }
function persistLastPlayback(force = false, positionOverride = null) {
  const now = Date.now();
  if (!force && now - lastPlaybackWriteAt < 1100) return;
  let item, position = 0;
  if (source === 'youtube' && currentYoutubeItem) {
    item = currentYoutubeItem;
    try { position = positionOverride ?? (ytPlayer?.getCurrentTime?.() || 0); } catch { }
  } else if (source === 'local' && currentTrack()) { item = currentTrack(); position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0; }
  if (positionOverride !== null) position = positionOverride;
  if (!item) return;
  localStorage.setItem(lastPlaybackKey, JSON.stringify({ id: item.id, sourceType: source, title: item.title, artist: item.artist || '', album: item.album || '', thumbnail: item.thumbnail || '', position, savedAt: now }));
  lastPlaybackWriteAt = now;
}
function restoreLastPlayback() {
  const saved = readObject(lastPlaybackKey);
  if (!saved.id) return;
  const position = Math.max(0, Number(saved.position) || 0);
  if (saved.sourceType === 'youtube') {
    const item = normalizeYoutubeItem(saved);
    currentYoutubeItem = item; source = 'youtube'; ytQueue = [item]; ytQueueIndex = 0;
    applyTrackTheme(item);
    document.querySelector('#youtubePlayerShell').classList.remove('hidden');
    document.querySelector('#ytNowTitle').textContent = item.title;
    document.querySelector('#ytNowArtist').textContent = item.artist || 'YouTube';
    document.querySelector('#nowTitle').textContent = item.title;
    document.querySelector('#nowArtist').textContent = `${item.artist || 'YouTube'} · YouTube`;
    document.querySelector('#fullTitle').textContent = item.title;
    document.querySelector('#nowPlayingLabel').textContent = item.title;
    document.querySelector('#fullArtist').textContent = `${item.artist || 'YouTube'} · YouTube`;
    const coverCss = `background:linear-gradient(#0002,#0002),url('${item.thumbnail}') center/cover`;
    document.querySelector('#miniCover').style.cssText = coverCss; document.querySelector('#fullCover').style.cssText = coverCss;
    document.querySelector('#favoriteBtn').textContent = isYoutubeFavorite(item.id) ? '♥' : '♡';
    document.querySelector('#fullFavorite').textContent = isYoutubeFavorite(item.id) ? '♥' : '♡';
    document.querySelector('#favoriteBtn').classList.toggle('liked', isYoutubeFavorite(item.id));
    document.querySelector('#fullFavorite').classList.toggle('liked', isYoutubeFavorite(item.id));
    loadYoutubeApi(); createYoutubePlayer(item.id, { autoplay: false, startSeconds: position });
    render(); updatePlayButtons(); return;
  }
  const index = tracks.findIndex(track => track.id === saved.id);
  if (index < 0) return;
  current = index; source = 'local'; activeQueueIds = tracks.map(track => track.id);
  audio.src = trackUrls.get(saved.id) || URL.createObjectURL(tracks[index].blob);
  trackUrls.set(saved.id, audio.src);
  audio.addEventListener('loadedmetadata', () => {
    if (currentTrack()?.id !== saved.id) return;
    audio.currentTime = Math.min(position, Number.isFinite(audio.duration) ? audio.duration : position);
    syncLocalTimeline(); persistLastPlayback(true, audio.currentTime);
  }, { once: true });
  audio.load(); paintTrack(); updatePlayButtons();
}
function syncLocalTimeline() {
  if (!Number.isFinite(audio.duration)) return;
  const value = Math.round(audio.currentTime / audio.duration * 1000);
  seek.value = value; fullSeek.value = value;
  document.querySelector('#currentTime').textContent = fmt(audio.currentTime);
  document.querySelector('#duration').textContent = fmt(audio.duration);
  document.querySelector('#fullCurrent').textContent = fmt(audio.currentTime);
  document.querySelector('#fullDuration').textContent = fmt(audio.duration);
}
function paintTrack() { const t = currentTrack(); if (!t) return; applyTrackTheme({ ...t, sourceType: 'local' }); document.querySelector('#nowTitle').textContent = t.title; document.querySelector('#nowArtist').textContent = t.artist || 'ملف من جهازك'; document.querySelector('#miniCover').style.cssText = coverStyle(t); document.querySelector('#fullCover').style.cssText = coverStyle(t); document.querySelector('#fullTitle').textContent = t.title; document.querySelector('#nowPlayingLabel').textContent = t.title; document.querySelector('#fullArtist').textContent = t.artist || 'ملف من جهازك'; const liked = favorites.has(t.id); document.querySelector('#favoriteBtn').textContent = liked ? '♥' : '♡'; document.querySelector('#favoriteBtn').classList.toggle('liked', liked); document.querySelector('#fullFavorite').textContent = liked ? '♥' : '♡'; document.querySelector('#fullFavorite').classList.toggle('liked', liked); updateMediaSession(t); render(); }
function playTrack(id, autoplay = true, queueIds = null) { let index = tracks.findIndex(t => t.id === id); if (index < 0) return; if (queueIds !== false) activeQueueIds = Array.isArray(queueIds) ? [...queueIds] : tracks.map(t => t.id); source = 'local'; const t = tracks[index]; document.querySelector('#youtubePlayerShell').classList.add('hidden'); ytPlayer?.pauseVideo?.(); if (current === index && audio.src) { applyTrackTheme({ ...t, sourceType: 'local' }); autoplay ? audio.play().catch(() => showToast('اضغط زر التشغيل للسماح بتشغيل الصوت')) : null; persistLastPlayback(true); render(); return; } current = index; audio.src = trackUrls.get(t.id) || URL.createObjectURL(t.blob); trackUrls.set(t.id, audio.src); audio.load(); paintTrack(); persistLastPlayback(true, 0); if (autoplay) audio.play().then(() => updatePlayButtons()).catch(() => showToast('اضغط زر التشغيل لبدء الأغنية')); }
function playFromLibrary(id) { playTrack(id, true, getActiveTracks().map(t => t.id)); }
function updatePlayButtons() { let playing = !audio.paused; if (source === 'youtube' && ytPlayer) { try { playing = ytPlayer.getPlayerState() === 1; } catch { playing = false; } } document.querySelector('#playBtn').textContent = playing ? 'Ⅱ' : '▶'; document.querySelector('#fullPlay').textContent = playing ? 'Ⅱ' : '▶'; document.querySelector('#playBtn').setAttribute('aria-label', playing ? 'إيقاف مؤقت' : 'تشغيل'); document.querySelector('#fullPlay').setAttribute('aria-label', playing ? 'إيقاف مؤقت' : 'تشغيل'); if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; }
function togglePlay() { if (source === 'youtube') { if (!ytPlayer) { showToast('جارٍ تهيئة مشغّل YouTube'); return; } const state = ytPlayer.getPlayerState(); if (state === 1) ytPlayer.pauseVideo(); else ytPlayer.playVideo(); return; } if (!currentTrack()) { if (tracks.length) { playTrack(tracks[0].id); return; } showToast('أضف أغانٍ أولًا'); fileInput.click(); return; } if (audio.paused) audio.play().catch(() => showToast('تعذر تشغيل الملف في المتصفح')); else audio.pause(); updatePlayButtons(); }
function next(automatic = false) { if (automatic && !playerSettings.autoPlayNext) { updatePlayButtons(); return; } if (playNextQueue.length) { const item = playNextQueue.shift(); if (item.sourceType === 'youtube') { ytQueue = [normalizeYoutubeItem(item)]; ytQueueIndex = 0; playYoutube(ytQueue[0]); } else { playTrack(item.id, true, activeQueueIds || tracks.map(track => track.id)); } return; } if (source === 'youtube' && ytQueue.length) { if (repeat === 2) { ytPlayer?.seekTo(0, true); ytPlayer?.playVideo(); return; } let n = shuffled ? Math.floor(Math.random() * ytQueue.length) : ytQueueIndex + 1; if (n >= ytQueue.length) { if (repeat === 1) n = 0; else return; } ytQueueIndex = n; playYoutube(ytQueue[n], false); return; } const queue = activeQueueIds ? activeQueueIds.map(id => tracks.find(t => t.id === id)).filter(Boolean) : tracks; if (!queue.length) return; if (repeat === 2 && current >= 0) { audio.currentTime = 0; audio.play(); return; } const at = queue.findIndex(t => t.id === currentTrack()?.id); let n; if (shuffled && queue.length > 1) { do { n = Math.floor(Math.random() * queue.length); } while (queue[n].id === currentTrack()?.id); } else n = at + 1; if (n >= queue.length) { if (repeat === 1) n = 0; else { audio.pause(); audio.currentTime = 0; updatePlayButtons(); return; } } playTrack(queue[n].id, true, false); }
function prev() { if (source === 'youtube' && ytQueue.length) { if (ytPlayer?.getCurrentTime() > 3) { ytPlayer.seekTo(0, true); return; } const n = Math.max(0, ytQueueIndex - 1); ytQueueIndex = n; playYoutube(ytQueue[n], false); return; } if (audio.currentTime > 3) { audio.currentTime = 0; return; } const queue = activeQueueIds ? activeQueueIds.map(id => tracks.find(t => t.id === id)).filter(Boolean) : tracks; if (!queue.length) return; const at = queue.findIndex(t => t.id === currentTrack()?.id); let n = at - 1; if (n < 0) n = repeat === 1 ? queue.length - 1 : 0; playTrack(queue[n].id, true, false); }
function updateYoutubeFavoriteButtons() { const liked = !!currentYoutubeItem && isYoutubeFavorite(currentYoutubeItem.id); for (const selector of ['#favoriteBtn', '#fullFavorite']) { const button = document.querySelector(selector); button.textContent = liked ? '♥' : '♡'; button.classList.toggle('liked', liked); } }
function toggleFavorite() { if (source === 'youtube' && currentYoutubeItem) { setFavoriteForItem(currentYoutubeItem); return; } const t = currentTrack(); if (!t) return; setFavoriteForItem({ ...t, sourceType: 'local' }); paintTrack(); }
function updateMediaSession(t) { if (!('mediaSession' in navigator)) return; const artwork = makeArtwork(t); try { navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'نغمة', album: t.album || 'مكتبتي', artwork: [{ src: artwork, sizes: '512x512', type: t.coverMime || 'image/png' }] }); navigator.mediaSession.setActionHandler('play', () => audio.play()); navigator.mediaSession.setActionHandler('pause', () => audio.pause()); navigator.mediaSession.setActionHandler('previoustrack', prev); navigator.mediaSession.setActionHandler('nexttrack', next); navigator.mediaSession.setActionHandler('seekto', e => { if (Number.isFinite(e.seekTime)) audio.currentTime = e.seekTime; }); navigator.mediaSession.setActionHandler('seekbackward', e => audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10))); navigator.mediaSession.setActionHandler('seekforward', e => audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + (e.seekOffset || 10))); } catch { } }
function makeArtwork(t) { if (coverUrls.has(t.id)) return coverUrls.get(t.id); const [a, b] = colorFor(t); const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512; const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, 512, 512); gradient.addColorStop(0, a); gradient.addColorStop(1, b); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 512); ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(256, 256, 160, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#171719'; ctx.beginPath(); ctx.arc(256, 256, 70, 0, Math.PI * 2); ctx.fill(); ctx.font = '92px Arial'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText('♫', 256, 287); return canvas.toDataURL('image/png'); }
function openQueue() {
  document.querySelector('#playerOverlay').classList.add('hidden');
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div'); backdrop.className = 'modal-backdrop';
  const queuedItems = playNextQueue.map(item => item.sourceType === 'youtube' ? normalizeYoutubeItem(item) : tracks.find(track => track.id === item.id)).filter(Boolean);
  const currentQueue = activeQueueIds ? activeQueueIds.map(id => tracks.find(track => track.id === id)).filter(Boolean) : tracks;
  const queue = [...queuedItems, ...currentQueue];
  backdrop.innerHTML = `<div class="queue-panel"><div class="queue-header"><h3>التالي في قائمة التشغيل</h3><button class="close-button" aria-label="إغلاق">×</button></div>${queuedItems.length ? '<div class="recent-actions-heading">سيُشغّل بعد الحالية</div>' : ''}${queue.length ? queue.map((item, index) => `<div class="queue-item ${index >= queuedItems.length && item.sourceType !== 'youtube' && currentTrack()?.id === item.id ? 'current' : ''}" data-id="${esc(item.id)}" data-source-type="${item.sourceType || 'local'}" data-upnext="${index < queuedItems.length ? index : ''}"><div class="track-thumb" style="${coverStyle(item)}">♫</div><div><strong>${esc(item.title)}</strong><small>${esc(item.artist || (item.sourceType === 'youtube' ? 'YouTube' : 'ملف من جهازك'))}</small></div><span>${item.sourceType === 'youtube' ? 'YouTube' : fmt(item.duration)}</span></div>`).join('') : '<p class="eyebrow">أضف أغانٍ لإنشاء قائمة تشغيل.</p>'}<button class="add-small" id="queueAdd">＋ أضف أغاني</button></div>`;
  document.body.append(backdrop);
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop || e.target.closest('.close-button')) { backdrop.remove(); return; }
    const item = e.target.closest('.queue-item');
    if (item) {
      const selected = queue.find(track => track.id === item.dataset.id && (track.sourceType || 'local') === item.dataset.sourceType);
      if (item.dataset.upnext !== '') playNextQueue.splice(Number(item.dataset.upnext), 1);
      if (selected?.sourceType === 'youtube') { ytQueue = [selected]; ytQueueIndex = 0; playYoutube(selected); }
      else if (selected) playTrack(selected.id, true, false);
      backdrop.remove(); return;
    }
    if (e.target.closest('#queueAdd')) fileInput.click();
  });
}
function openFullPlayer() { document.querySelector('#playerOverlay').classList.remove('hidden'); }
function changeView(view) { currentView = view; if (['library', 'playlists', 'albums', 'artists'].includes(view)) { currentView = 'library'; libraryCategory = view === 'library' ? 'playlist' : view; libraryFavoritesOnly = false; activePlaylistId = view === 'library' ? downloadsPlaylistId : null; selectedAlbum = null; selectedArtist = null; } if (view === 'favorites') { currentView = 'library'; libraryCategory = 'favorites'; libraryFavoritesOnly = true; activePlaylistId = null; } if (view === 'radio') { showToast('ستُضاف خدمة الراديو بعد اختيار مصدر بث مرخّص'); currentView = 'listen'; } render(); if (currentView === 'browse') document.querySelector('#browserAddressInput').focus({ preventScroll: true }); else if (currentView === 'library') document.querySelector('#librarySection').scrollIntoView({ behavior: 'smooth', block: 'start' }); else window.scrollTo({ top: 0, behavior: 'smooth' }); }

function readList(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function saveSearch(term) { const history = readList(searchHistoryKey).filter(item => item.toLowerCase() !== term.toLowerCase()); history.unshift(term); localStorage.setItem(searchHistoryKey, JSON.stringify(history.slice(0, 8))); renderHistory(); }
function renderHistory() { const terms = readList(searchHistoryKey); const markup = terms.map(term => `<button class="history-chip" data-term="${esc(term)}">⌕ ${esc(term)}</button>`).join('') || '<span class="eyebrow">ستظهر عمليات البحث هنا.</span>'; const host = document.querySelector('#searchHistory'); if (host) host.innerHTML = markup; const homeHost = document.querySelector('#listenSearchHistory'); if (homeHost) homeHost.innerHTML = markup; const browseHost = document.querySelector('#browseSearchHistory'); if (browseHost) browseHost.innerHTML = markup; }
function renderPlayedHistory() { const host = document.querySelector('#albumGrid'); if (!host) return; let items = readList(playedHistoryKey).map(item => { const track = item.sourceType === 'local' ? tracks.find(t => t.id === item.id) : null; return track ? { ...track, sourceType: 'local', playedAt: item.playedAt } : item.sourceType === 'local' ? null : normalizeYoutubeItem({ ...item, sourceType: 'youtube' }); }).filter(Boolean); items.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0)); items = items.slice(0, 12); host.innerHTML = items.map(item => item.sourceType === 'local' ? `<article class="album-card" data-track="${esc(item.id)}"><div class="cover" style="${coverStyle(item)}">${coverUrls.has(item.id) ? `<img class="cover-art" src="${esc(coverUrls.get(item.id))}" alt="غلاف ${esc(item.title)}">` : '<i>♫</i>'}<button class="card-play" data-play="${esc(item.id)}" aria-label="تشغيل">▶</button></div><strong>${esc(item.title)}</strong><small>${esc(item.artist || 'ملف من جهازك')}</small></article>` : `<article class="album-card yt-recent-card" data-video="${esc(item.id)}"><div class="cover" style="background-image:linear-gradient(#0002,#0003),url('${esc(item.thumbnail || `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`)}');background-size:cover;background-position:center"><button class="card-play" data-video="${esc(item.id)}" aria-label="تشغيل">▶</button><span class="yt-badge">▶ YouTube</span></div><strong>${esc(item.title)}</strong><small>${esc(item.artist)}</small></article>`).join('') || '<div class="browse-empty recent-empty"><span>◷</span></div>'; }
function openRecentActions(id, sourceType, fromLibrary = false, libraryItem = null) {
  const recent = readList(playedHistoryKey).find(item => item.id === id && (item.sourceType || 'youtube') === sourceType);
  if (!recent && !fromLibrary) return;
  const storedItem = sourceType === 'local' ? tracks.find(track => track.id === id) : recent ? normalizeYoutubeItem(recent) : null;
  const item = libraryItem || (storedItem ? { ...storedItem, sourceType } : null);
  if (!item) return;
  document.querySelector('.modal-backdrop')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<section class="queue-panel recent-actions-panel"><div class="queue-header"><div><span class="eyebrow">${esc(item.artist || (sourceType === 'youtube' ? 'YouTube' : 'ملف من جهازك'))}</span><h3>${esc(item.title)}</h3></div><button class="close-button" aria-label="إغلاق">×</button></div>${recent ? '<button class="recent-action" data-recent-action="remove">⌫ <span>إزالة من شُغّلت مؤخرًا</span></button>' : ''}<button class="recent-action" data-recent-action="favorite">${(sourceType === 'youtube' ? isYoutubeFavorite(id) : favorites.has(id)) ? '♥' : '♡'} <span>${(sourceType === 'youtube' ? isYoutubeFavorite(id) : favorites.has(id)) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}</span></button><button class="recent-action" data-recent-action="next">＋ <span>إضافة إلى التشغيل التالي</span></button>${fromLibrary ? '<button class="recent-action" data-recent-action="edit">✎ <span>تعديل بيانات الأغنية</span></button>' : ''}<div class="recent-actions-heading">إضافة إلى قائمة تشغيل</div>${playlists.length ? playlists.map(playlist => `<button class="playlist-choice" data-recent-playlist="${esc(playlist.id)}"><span>♫</span><strong>${esc(playlist.name)}</strong><small>${(playlist.trackIds?.length || 0) + (playlist.youtubeItems?.length || 0)} أغنية</small></button>`).join('') : '<p class="eyebrow">أنشئ قائمة تشغيل من المكتبة أولًا.</p>'}${fromLibrary ? '<button class="recent-action recent-action-delete" data-recent-action="delete">⌫ <span>حذف من المكتبة</span></button>' : ''}</section>`;
  document.body.append(backdrop);
  backdrop.addEventListener('click', async e => {
    if (e.target === backdrop || e.target.closest('.close-button')) { backdrop.remove(); return; }
    const action = e.target.closest('[data-recent-action]')?.dataset.recentAction;
    if (action === 'remove') {
      const items = readList(playedHistoryKey).filter(old => !(old.id === id && (old.sourceType || 'youtube') === sourceType));
      localStorage.setItem(playedHistoryKey, JSON.stringify(items));
      backdrop.remove(); render(); showToast('أُزيلت الأغنية من شُغّلت مؤخرًا'); return;
    }
    if (action === 'delete') {
      if (!window.confirm(`هل تريد حذف «${item.title}» من المكتبة؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
      try {
        await deleteLibraryItem(item);
        backdrop.remove();
        render();
        showToast('حُذفت الأغنية من المكتبة');
      } catch (error) {
        console.error('تعذر حذف الأغنية من المكتبة', error);
        showToast('تعذر حذف الأغنية من المكتبة');
      }
      return;
    }
    if (action === 'edit') {
      backdrop.remove();
      openTrackEditor(item, false);
      return;
    }
    if (action === 'favorite') { backdrop.remove(); setFavoriteForItem(item); return; }
    if (action === 'next') { playNextQueue.push(sourceType === 'local' ? { id: item.id, sourceType: 'local' } : normalizeYoutubeItem(item)); backdrop.remove(); showToast('أُضيفت إلى التشغيل التالي'); return; }
    const choice = e.target.closest('[data-recent-playlist]');
    if (choice) {
      const playlist = playlists.find(saved => saved.id === choice.dataset.recentPlaylist);
      const added = playlist && addItemToPlaylist(playlist, item);
      backdrop.remove(); render(); showToast(added ? `أُضيفت إلى ${playlist.name}` : 'الأغنية موجودة بالفعل في القائمة');
    }
  });
}
async function deleteLibraryItem(item) {
  const sourceType = item.sourceType || 'local';
  if (sourceType !== 'youtube') {
    const deletingCurrentTrack = source === 'local' && currentTrack()?.id === item.id;
    await dbRun('readwrite', store => store.delete(item.id));
    const index = tracks.findIndex(track => track.id === item.id);
    if (index >= 0) tracks.splice(index, 1);
    const trackUrl = trackUrls.get(item.id);
    const coverUrl = coverUrls.get(item.id);
    if (trackUrl) URL.revokeObjectURL(trackUrl);
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    trackUrls.delete(item.id);
    coverUrls.delete(item.id);
    if (deletingCurrentTrack) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      current = -1;
      source = 'local';
      document.querySelector('#youtubePlayerShell').classList.add('hidden');
      document.querySelector('#nowTitle').textContent = 'اختر أغنية لبدء الاستماع';
      document.querySelector('#nowArtist').textContent = 'مكتبتك الموسيقية';
      document.querySelector('#fullTitle').textContent = 'اختر أغنية لبدء الاستماع';
      document.querySelector('#fullArtist').textContent = 'مكتبتك الموسيقية';
      document.querySelector('#nowPlayingLabel').textContent = 'مكتبتك الموسيقية';
      document.querySelector('#miniCover').style.cssText = '';
      document.querySelector('#fullCover').style.cssText = '';
      document.querySelector('#favoriteBtn').textContent = '♡';
      document.querySelector('#fullFavorite').textContent = '♡';
      document.querySelector('#favoriteBtn').classList.remove('liked');
      document.querySelector('#fullFavorite').classList.remove('liked');
      document.querySelector('#currentTime').textContent = '0:00';
      document.querySelector('#duration').textContent = '0:00';
      document.querySelector('#fullCurrent').textContent = '0:00';
      document.querySelector('#fullDuration').textContent = '0:00';
      seek.value = 0;
      fullSeek.value = 0;
      localStorage.removeItem(lastPlaybackKey);
      applyTrackTheme(null);
      updatePlayButtons();
    } else if (index >= 0 && index < current) current--;
  } else {
    youtubeFavorites = youtubeFavorites.filter(saved => saved.id !== item.id);
    saveYoutubeFavorites();
  }
  favorites.delete(item.id);
  localStorage.setItem('naghma-favorites', JSON.stringify([...favorites]));
  playlists = playlists.map(playlist => ({
    ...playlist,
    trackIds: (playlist.trackIds || []).filter(id => id !== item.id),
    youtubeItems: (playlist.youtubeItems || []).filter(saved => saved.id !== item.id)
  }));
  persistPlaylists();
  const playedItems = readList(playedHistoryKey).filter(saved => !(saved.id === item.id && (saved.sourceType || 'youtube') === sourceType));
  localStorage.setItem(playedHistoryKey, JSON.stringify(playedItems));
  activeQueueIds = activeQueueIds?.filter(id => id !== item.id) || null;
  for (let i = playNextQueue.length - 1; i >= 0; i--) {
    if (playNextQueue[i].id === item.id && (playNextQueue[i].sourceType || 'local') === sourceType) playNextQueue.splice(i, 1);
  }
}
function addPlayed(item) { const sourceType = item.sourceType || 'youtube'; const list = readList(playedHistoryKey).filter(old => !(old.id === item.id && (old.sourceType || 'youtube') === sourceType)); list.unshift({ id: item.id, title: item.title, artist: item.artist, thumbnail: item.thumbnail || '', sourceType, playedAt: Date.now() }); localStorage.setItem(playedHistoryKey, JSON.stringify(list.slice(0, 12))); render(); }
function addLocalPlayed(track) { addPlayed({ id: track.id, title: track.title, artist: track.artist, sourceType: 'local' }); }
function getYoutubeApiKey() { return localStorage.getItem(youtubeApiKeyStorageKey) || ''; }
function updateYoutubeApiSetup() {
  const hasKey = !!getYoutubeApiKey();
  document.querySelector('#youtubeApiMessage').textContent = hasKey
    ? 'المفتاح محفوظ على هذا الجهاز. البحث متاح، ولا يلزم تسجيل الدخول.'
    : 'أضف مفتاح YouTube Data API لعرض الأغاني والقوائم العامة. لا يلزم تسجيل الدخول.';
  document.querySelector('#youtubeApiStatus').textContent = hasKey ? 'متصل' : 'غير مُعدّ';
  document.querySelector('#youtubeApiStatus').classList.toggle('configured', hasKey);
  document.querySelector('#toggleYoutubeApiSettings').textContent = hasKey ? 'تغيير المفتاح' : 'إعداد المفتاح';
  document.querySelector('#settingsKeyNote').textContent = hasKey
    ? 'المفتاح محفوظ محليًا في هذا المتصفح، ولا يُرسل إلى خادم التطبيق. طلبات البحث تذهب مباشرة إلى Google.'
    : 'لم تتم إضافة مفتاح بعد. يُحفظ المفتاح محليًا في هذا المتصفح، وتُرسل طلبات البحث مباشرة إلى Google.';
  document.querySelector('#clearYoutubeApiKey').classList.toggle('hidden', !hasKey);
}
function youtubeApiErrorMessage(data, response) {
  const reason = data?.error?.errors?.[0]?.reason;
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') return 'تم استهلاك حصة البحث اليومية للمفتاح. جرّب مجددًا لاحقًا.';
  if (reason === 'keyInvalid' || response.status === 401) return 'مفتاح API غير صالح. راجعه أو أدخل مفتاحًا آخر.';
  if (reason === 'ipRefererBlocked' || reason === 'refererNotAllowed') return 'المفتاح لا يسمح لهذا الموقع. راجع قيود المواقع في Google Cloud.';
  if (reason === 'accessNotConfigured') return 'فعّل YouTube Data API v3 في مشروع Google Cloud المرتبط بالمفتاح.';
  return data?.error?.message || 'تعذر جلب النتائج من YouTube. تحقق من المفتاح والاتصال.';
}
async function fetchYoutubeApi(resource, params) {
  params.set('key', getYoutubeApiKey());
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${resource}?${params}`, {
    headers: { Accept: 'application/json' }
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('تعذر قراءة استجابة YouTube. حاول مرة أخرى.'); }
  if (!response.ok) throw new Error(youtubeApiErrorMessage(data, response));
  return data;
}
function youtubeThumbnail(snippet, videoId = '') {
  const url = snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.high?.url || snippet?.thumbnails?.default?.url;
  return url?.startsWith('https://') ? url : videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : '';
}
function renderYoutubeBrowseResults() {
  const host = document.querySelector('#youtubeBrowseResults');
  host.classList.add('grid-view');
  host.innerHTML = currentYoutubeBrowseItems.map(item => {
    const isPlaylist = item.resultType === 'playlist';
    const action = isPlaylist ? `data-open-youtube-playlist="${esc(item.id)}"` : `data-browse-video="${esc(item.id)}"`;
    return `<button type="button" class="youtube-result" ${action}><img src="${esc(item.thumbnail)}" alt="" loading="lazy"><span class="result-copy"><strong>${esc(item.title)}</strong><small>${esc(item.artist || (isPlaylist ? 'قائمة تشغيل' : 'YouTube'))}</small></span><span class="result-play" aria-hidden="true">${isPlaylist ? '☷' : '▶'}</span></button>`;
  }).join('') || (currentYoutubePlaylist
    ? '<div class="browse-empty"><span>♫</span><strong>لا توجد أغنيات متاحة في هذه القائمة</strong></div>'
    : '<div class="browse-empty"><span>⌕</span><strong>ابحث عن أغنية أو قائمة لتظهر النتائج هنا</strong></div>');
  document.querySelector('#youtubeBrowseTitle').textContent = currentYoutubePlaylist?.title || (selectedYoutubeFilter === 'playlists' ? 'قوائم التشغيل' : 'الأغاني');
  document.querySelector('#youtubePlaylistBack').classList.toggle('hidden', !currentYoutubePlaylist);
  document.querySelector('#youtubeLoadMore').classList.toggle('hidden', !youtubeBrowsePageToken);
}
function mapYoutubeSearchItem(item, filter) {
  const snippet = item.snippet || {};
  const id = filter === 'playlists' ? item.id?.playlistId : item.id?.videoId;
  if (!id) return null;
  return filter === 'playlists'
    ? { id, title: snippet.title || 'قائمة تشغيل', artist: snippet.channelTitle || 'YouTube Music', thumbnail: youtubeThumbnail(snippet), resultType: 'playlist' }
    : normalizeYoutubeItem({ id, title: snippet.title || 'أغنية', artist: snippet.channelTitle || 'YouTube', thumbnail: youtubeThumbnail(snippet, id) });
}
async function fetchYoutubeSearchPage(pageToken = '', append = false) {
  const requestId = ++youtubeBrowseRequestId;
  const filter = selectedYoutubeFilter;
  const params = new URLSearchParams({ part: 'snippet', q: currentYoutubeBrowseQuery, type: filter === 'playlists' ? 'playlist' : 'video', maxResults: '24' });
  if (filter === 'songs') params.set('videoCategoryId', '10');
  if (pageToken) params.set('pageToken', pageToken);
  document.querySelector('#externalSearchStatus').textContent = 'جاري البحث في الأغاني والقوائم العامة…';
  document.querySelector('#youtubeLoadMore').disabled = true;
  try {
    const data = await fetchYoutubeApi('search', params);
    if (requestId !== youtubeBrowseRequestId) return;
    const items = (data.items || []).map(item => mapYoutubeSearchItem(item, filter)).filter(Boolean);
    currentYoutubeBrowseItems = append ? [...currentYoutubeBrowseItems, ...items] : items;
    youtubeBrowsePageToken = data.nextPageToken || '';
    youtubeSearchSnapshot = { items: currentYoutubeBrowseItems, query: currentYoutubeBrowseQuery, filter, pageToken: youtubeBrowsePageToken };
    renderYoutubeBrowseResults();
    document.querySelector('#externalSearchStatus').textContent = items.length
      ? `ظهرت ${currentYoutubeBrowseItems.length} نتيجة من YouTube.`
      : 'لم نعثر على نتائج. جرّب كلمات بحث أخرى.';
  } catch (error) {
    if (requestId !== youtubeBrowseRequestId) return;
    console.error('تعذر البحث في YouTube Data API', error);
    document.querySelector('#externalSearchStatus').textContent = error.message;
  } finally {
    if (requestId === youtubeBrowseRequestId) document.querySelector('#youtubeLoadMore').disabled = false;
  }
}
async function searchYoutubeMusic(term, filter = selectedYoutubeFilter) {
  term = term.trim();
  if (!term) { showToast('اكتب اسم الأغنية أو الفنان أولًا'); return; }
  saveSearch(term);
  currentView = 'browse';
  currentYoutubeBrowseQuery = term;
  currentYoutubePlaylist = null;
  currentYoutubeBrowseItems = [];
  youtubeBrowsePageToken = '';
  youtubeSearchSnapshot = null;
  pendingYoutubeSearch = { term, filter };
  selectYoutubeFilter(filter);
  document.querySelector('#browserAddressInput').value = term;
  document.querySelector('#youtubeBrowseTitle').textContent = filter === 'playlists' ? 'قوائم التشغيل' : 'الأغاني';
  document.querySelector('#externalSearchStatus').textContent = 'استعد للبحث عن الأغاني والقوائم العامة.';
  if (!getYoutubeApiKey()) {
    currentView = 'settings';
    render();
    document.querySelector('#youtubeApiKeyForm').classList.remove('hidden');
    document.querySelector('#externalSearchStatus').textContent = 'أضف مفتاح YouTube Data API من الإعدادات للبحث داخل التطبيق.';
    document.querySelector('#youtubeApiKeyInput').focus({ preventScroll: true });
    return;
  }
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderYoutubeBrowseResults();
  pendingYoutubeSearch = null;
  await fetchYoutubeSearchPage();
}
async function fetchYoutubePlaylistPage(pageToken = '', append = false) {
  if (!currentYoutubePlaylist) return;
  const requestId = ++youtubeBrowseRequestId;
  const params = new URLSearchParams({ part: 'snippet,contentDetails', playlistId: currentYoutubePlaylist.id, maxResults: '50' });
  if (pageToken) params.set('pageToken', pageToken);
  document.querySelector('#externalSearchStatus').textContent = `جاري تحميل قائمة «${currentYoutubePlaylist.title}»…`;
  document.querySelector('#youtubeLoadMore').disabled = true;
  try {
    const data = await fetchYoutubeApi('playlistItems', params);
    if (requestId !== youtubeBrowseRequestId || !currentYoutubePlaylist) return;
    const items = (data.items || []).map(item => {
      const snippet = item.snippet || {};
      const id = snippet.resourceId?.videoId || item.contentDetails?.videoId;
      return id ? normalizeYoutubeItem({
        id,
        title: snippet.title || 'أغنية',
        artist: snippet.videoOwnerChannelTitle || snippet.channelTitle || 'YouTube',
        thumbnail: youtubeThumbnail(snippet, id)
      }) : null;
    }).filter(Boolean);
    currentYoutubeBrowseItems = append ? [...currentYoutubeBrowseItems, ...items] : items;
    youtubeBrowsePageToken = data.nextPageToken || '';
    renderYoutubeBrowseResults();
    document.querySelector('#externalSearchStatus').textContent = currentYoutubeBrowseItems.length
      ? `أغاني قائمة «${currentYoutubePlaylist.title}»`
      : 'لا توجد أغنيات متاحة في هذه القائمة العامة.';
  } catch (error) {
    if (requestId !== youtubeBrowseRequestId) return;
    console.error('تعذر تحميل قائمة YouTube', error);
    document.querySelector('#externalSearchStatus').textContent = error.message;
  } finally {
    if (requestId === youtubeBrowseRequestId) document.querySelector('#youtubeLoadMore').disabled = false;
  }
}
async function openYoutubePlaylist(playlistId, title) {
  currentYoutubePlaylist = { id: playlistId, title };
  currentYoutubeBrowseItems = [];
  youtubeBrowsePageToken = '';
  renderYoutubeBrowseResults();
  await fetchYoutubePlaylistPage();
}
function showYoutubeSearchResults() {
  if (!youtubeSearchSnapshot) return;
  ++youtubeBrowseRequestId;
  currentYoutubePlaylist = null;
  currentYoutubeBrowseItems = youtubeSearchSnapshot.items;
  currentYoutubeBrowseQuery = youtubeSearchSnapshot.query;
  selectedYoutubeFilter = youtubeSearchSnapshot.filter;
  youtubeBrowsePageToken = youtubeSearchSnapshot.pageToken;
  selectYoutubeFilter(selectedYoutubeFilter);
  renderYoutubeBrowseResults();
  document.querySelector('#externalSearchStatus').textContent = 'نتائج البحث عن: ' + currentYoutubeBrowseQuery;
}
function selectYoutubeFilter(filter) {
  selectedYoutubeFilter = filter;
  document.querySelectorAll('.youtube-search-filters [data-youtube-filter]').forEach(button => {
    const selected = button.dataset.youtubeFilter === filter;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}
function loadYoutubeApi() { if (window.YT?.Player) { ytApiReady = true; return; } if (document.querySelector('#yt-api-script')) return; const script = document.createElement('script'); script.id = 'yt-api-script'; script.src = 'https://www.youtube.com/iframe_api'; document.head.append(script); window.onYouTubeIframeAPIReady = () => { ytApiReady = true; if (ytPendingId) createYoutubePlayer(ytPendingId, ytPendingOptions); }; }
function createYoutubePlayer(videoId, options = { autoplay: true, startSeconds: 0 }) {
  ytPendingId = videoId; ytPendingOptions = options;
  if (!ytApiReady || !window.YT?.Player) return;
  const load = player => options.autoplay === false ? player.cueVideoById({ videoId, startSeconds: options.startSeconds || 0 }) : player.loadVideoById(videoId);
  if (ytPlayer) { load(ytPlayer); if (options.autoplay === false) startYoutubeTimer(); return; }
  ytPlayer = new YT.Player('youtubePlayer', { height: '180', width: '100%', videoId, playerVars: { autoplay: options.autoplay === false ? 0 : 1, playsinline: 1, rel: 0, origin: location.protocol === 'file:' ? '' : location.origin }, events: {
    onReady: event => { event.target.setVolume(playerSettings.volume * 100); if (options.autoplay === false) { event.target.cueVideoById({ videoId, startSeconds: options.startSeconds || 0 }); startYoutubeTimer(); } else event.target.playVideo(); },
    onStateChange: event => { if (event.data === YT.PlayerState.PLAYING) { source = 'youtube'; startYoutubeTimer(); updatePlayButtons(); persistLastPlayback(true); } else if (event.data === YT.PlayerState.PAUSED) { updatePlayButtons(); persistLastPlayback(true); } else if (event.data === YT.PlayerState.CUED) { updateYoutubeTimeline(); updatePlayButtons(); persistLastPlayback(true); } else if (event.data === YT.PlayerState.ENDED) { updatePlayButtons(); next(true); } },
    onError: () => showToast('الفيديو غير متاح للتشغيل المضمّن')
  } });
}
function updateYoutubeTimeline() { if (!ytPlayer) return; try { const time = ytPlayer.getCurrentTime(), duration = ytPlayer.getDuration(); if (!duration) return; const value = Math.round(time / duration * 1000); seek.value = value; fullSeek.value = value; document.querySelector('#currentTime').textContent = fmt(time); document.querySelector('#duration').textContent = fmt(duration); document.querySelector('#fullCurrent').textContent = fmt(time); document.querySelector('#fullDuration').textContent = fmt(duration); } catch { } }
function startYoutubeTimer() { clearInterval(ytTick); ytTick = setInterval(() => { if (source !== 'youtube' || !ytPlayer) return; updateYoutubeTimeline(); updatePlayButtons(); persistLastPlayback(); }, 700); }
function playYoutube(item, updateHistory = true) { if (!item) return; currentYoutubeItem = normalizeYoutubeItem(item); item = currentYoutubeItem; applyTrackTheme(item); source = 'youtube'; audio.pause(); document.querySelector('#youtubePlayerShell').classList.remove('hidden'); document.querySelector('#ytNowTitle').textContent = item.title; document.querySelector('#ytNowArtist').textContent = item.artist; document.querySelector('#nowTitle').textContent = item.title; document.querySelector('#nowArtist').textContent = item.artist + ' · YouTube'; document.querySelector('#fullTitle').textContent = item.title; document.querySelector('#nowPlayingLabel').textContent = item.title; document.querySelector('#fullArtist').textContent = item.artist + ' · YouTube'; const thumb = item.thumbnail; document.querySelector('#miniCover').style.cssText = `background:linear-gradient(#0002,#0002),url('${thumb}') center/cover`; document.querySelector('#fullCover').style.cssText = `background:linear-gradient(#0002,#0002),url('${thumb}') center/cover`; document.querySelector('#favoriteBtn').textContent = isYoutubeFavorite(item.id) ? '♥' : '♡'; document.querySelector('#fullFavorite').textContent = isYoutubeFavorite(item.id) ? '♥' : '♡'; document.querySelector('#favoriteBtn').classList.toggle('liked', isYoutubeFavorite(item.id)); document.querySelector('#fullFavorite').classList.toggle('liked', isYoutubeFavorite(item.id)); addPlayed({ ...item, thumbnail: thumb, sourceType: 'youtube' }); if (navigator.mediaSession && 'MediaMetadata' in window) { try { navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist, album: item.album || 'YouTube', artwork: [{ src: thumb, sizes: '480x360', type: 'image/jpeg' }] }); navigator.mediaSession.setActionHandler('play', () => ytPlayer?.playVideo()); navigator.mediaSession.setActionHandler('pause', () => ytPlayer?.pauseVideo()); navigator.mediaSession.setActionHandler('previoustrack', prev); navigator.mediaSession.setActionHandler('nexttrack', next); } catch { } } loadYoutubeApi(); if (ytApiReady) createYoutubePlayer(item.id); else ytPendingId = item.id; updatePlayButtons(); }

function playFromActiveListItem(item) {
  const list = getActiveTracks();
  if (item.sourceType === 'youtube') {
    ytQueue = list.filter(track => track.sourceType === 'youtube').map(normalizeYoutubeItem);
    ytQueueIndex = ytQueue.findIndex(track => track.id === item.id);
    playYoutube(item);
  } else {
    activeQueueIds = list.filter(track => track.sourceType !== 'youtube').map(track => track.id);
    if (source === 'local' && currentTrack()?.id === item.id) togglePlay();
    else playTrack(item.id, true, false);
  }
}

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => changeView(b.dataset.view)));
document.querySelector('#gridViewBtn').addEventListener('click', () => { layoutMode = 'grid'; localStorage.setItem('naghma-layout', layoutMode); render(); });
document.querySelector('#listViewBtn').addEventListener('click', () => { layoutMode = 'list'; localStorage.setItem('naghma-layout', layoutMode); render(); });
document.querySelector('#recentGridViewBtn').addEventListener('click', () => { layoutMode = 'grid'; localStorage.setItem('naghma-layout', layoutMode); render(); });
document.querySelector('#recentListViewBtn').addEventListener('click', () => { layoutMode = 'list'; localStorage.setItem('naghma-layout', layoutMode); render(); });
document.querySelector('#importBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const selectedFiles = [...fileInput.files || []];
  const audioExtensions = /\.(mp3|m4a|m4b|m4p|mp4|aac|wav|aiff?|flac|ogg|oga|opus|caf|amr)$/i;
  const files = selectedFiles.filter(file => file.type.startsWith('audio/') || audioExtensions.test(file.name));
  if (!files.length) {
    fileInput.value = '';
    if (selectedFiles.length) showToast('اختر ملفًا صوتيًا بصيغة مدعومة');
    return;
  }
  fileInput.disabled = true;
  try {
    const prepared = [];
    for (const file of files) {
      const base = file.name.replace(/\.[^.]+$/, '');
      prepared.push({ file, base, metadata: await extractAudioMetadata(file), cover: await extractEmbeddedCover(file) });
    }
    const addedTracks = prepared.map((entry, index) => {
      const metadata = entry.metadata || {};
      const track = { id: makeId(), title: metadata.title?.trim() || entry.base, artist: metadata.artist?.trim() || 'ملف من جهازك', album: metadata.album?.trim() || 'مكتبتي', duration: 0, blob: entry.file, fileName: entry.file.name, metadataRead: true, colorIndex: (tracks.length + index) % colors.length, addedAt: Date.now() };
      if (entry.cover) { track.coverBlob = entry.cover.blob; track.coverMime = entry.cover.type; }
      return track;
    });
    const db = await openDb();
    await new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction('tracks', 'readwrite');
        for (const track of addedTracks) tx.objectStore('tracks').put(track);
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('تعذر حفظ الملفات الصوتية')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('تم إلغاء حفظ الملفات الصوتية')); };
    });
    tracks.push(...addedTracks);
    for (const track of addedTracks) if (track.coverBlob) coverUrls.set(track.id, URL.createObjectURL(track.coverBlob));
    ensureDownloadsPlaylist();
    render();
    showToast(`أُضيفت ${files.length} ${files.length === 1 ? 'أغنية' : 'أغانٍ'} إلى مكتبتك`);
    if (current < 0) playTrack(addedTracks[0].id, false);
  } catch (error) {
    console.error('تعذرت إضافة الملفات الصوتية', error);
    showToast('تعذرت إضافة الملفات؛ تحقق من مساحة التخزين وحاول مجددًا');
  } finally {
    fileInput.disabled = false;
    fileInput.value = '';
  }
});
document.querySelector('#emptyImport').addEventListener('click', () => fileInput.click()); document.querySelector('#searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchYoutubeMusic(e.currentTarget.value); } });
document.querySelector('#browserAddressForm').addEventListener('submit', e => { e.preventDefault(); searchYoutubeMusic(document.querySelector('#browserAddressInput').value); });
document.querySelectorAll('.youtube-search-filters [data-youtube-filter]').forEach(button => button.addEventListener('click', () => selectYoutubeFilter(button.dataset.youtubeFilter)));
document.querySelector('#toggleYoutubeApiSettings').addEventListener('click', () => {
  const form = document.querySelector('#youtubeApiKeyForm');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) document.querySelector('#youtubeApiKeyInput').focus({ preventScroll: true });
});
document.querySelector('#youtubeApiKeyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const input = document.querySelector('#youtubeApiKeyInput');
  const key = input.value.trim();
  if (!key) { showToast('أدخل مفتاح YouTube Data API أولًا'); return; }
  try {
    localStorage.setItem(youtubeApiKeyStorageKey, key);
    input.value = '';
    document.querySelector('#youtubeApiKeyForm').classList.add('hidden');
    updateYoutubeApiSetup();
    const pending = pendingYoutubeSearch;
    pendingYoutubeSearch = null;
    if (pending) await searchYoutubeMusic(pending.term, pending.filter);
    else showToast('تم حفظ مفتاح YouTube Data API على هذا الجهاز');
  } catch (error) {
    console.error('تعذر حفظ مفتاح YouTube Data API', error);
    showToast('تعذر حفظ المفتاح في مساحة التخزين المحلية');
  }
});
document.querySelector('#clearYoutubeApiKey').addEventListener('click', () => {
  try {
    ++youtubeBrowseRequestId;
    localStorage.removeItem(youtubeApiKeyStorageKey);
    updateYoutubeApiSetup();
    document.querySelector('#youtubeApiKeyForm').classList.add('hidden');
    currentYoutubeBrowseItems = [];
    currentYoutubePlaylist = null;
    youtubeSearchSnapshot = null;
    youtubeBrowsePageToken = '';
    renderYoutubeBrowseResults();
    document.querySelector('#externalSearchStatus').textContent = 'أُزيل المفتاح. أضف مفتاحًا جديدًا للبحث.';
  } catch (error) {
    console.error('تعذر مسح مفتاح YouTube Data API', error);
    showToast('تعذر مسح المفتاح من مساحة التخزين المحلية');
  }
});
document.querySelector('#youtubeBrowseResults').addEventListener('click', e => {
  const playlistButton = e.target.closest('[data-open-youtube-playlist]');
  if (playlistButton) {
    const playlist = currentYoutubeBrowseItems.find(item => item.id === playlistButton.dataset.openYoutubePlaylist);
    if (playlist) openYoutubePlaylist(playlist.id, playlist.title);
    return;
  }
  const videoButton = e.target.closest('[data-browse-video]');
  if (!videoButton) return;
  const queue = currentYoutubeBrowseItems.filter(item => item.resultType !== 'playlist');
  const index = queue.findIndex(item => item.id === videoButton.dataset.browseVideo);
  if (index < 0) return;
  ytQueue = queue;
  ytQueueIndex = index;
  playYoutube(queue[index]);
});
document.querySelector('#youtubePlaylistBack').addEventListener('click', showYoutubeSearchResults);
document.querySelector('#youtubeLoadMore').addEventListener('click', () => {
  if (!youtubeBrowsePageToken) return;
  if (currentYoutubePlaylist) fetchYoutubePlaylistPage(youtubeBrowsePageToken, true);
  else fetchYoutubeSearchPage(youtubeBrowsePageToken, true);
});
document.querySelector('#youtubeMusicShortcuts').addEventListener('click', e => {
  const button = e.target.closest('[data-youtube-query]');
  if (button) {
    selectYoutubeFilter(button.dataset.youtubeFilter);
    searchYoutubeMusic(button.dataset.youtubeQuery, button.dataset.youtubeFilter);
  }
});
document.querySelector('#listenSearchHistory').addEventListener('click', e => { const button = e.target.closest('[data-term]'); if (button) searchYoutubeMusic(button.dataset.term); });
document.querySelector('#browseSearchHistory').addEventListener('click', e => { const button = e.target.closest('[data-term]'); if (button) searchYoutubeMusic(button.dataset.term); });
document.querySelector('#browseFromHistory').addEventListener('click', () => changeView('browse'));
updateYoutubeApiSetup();

document.querySelector('#closeYoutubePlayer').addEventListener('click', () => { ytPlayer?.pauseVideo?.(); document.querySelector('#youtubePlayerShell').classList.add('hidden'); updatePlayButtons(); });
const recentGrid = document.querySelector('#albumGrid');
recentGrid.addEventListener('pointerdown', e => {
  const card = e.target.closest('.album-card[data-track], .album-card[data-video]');
  if (!card || (e.pointerType === 'mouse' && e.button !== 0)) return;
  clearTimeout(recentPressTimer);
  recentPressCard = { id: card.dataset.track || card.dataset.video, sourceType: card.dataset.video ? 'youtube' : 'local' };
  recentPressStart = { x: e.clientX, y: e.clientY };
  recentPressTimer = setTimeout(() => {
    const target = recentPressCard;
    if (!target) return;
    recentLongPressTriggered = true;
    setTimeout(() => { recentLongPressTriggered = false; }, 1200);
    recentPressCard = null;
    openRecentActions(target.id, target.sourceType);
  }, 550);
});
recentGrid.addEventListener('pointermove', e => {
  if (!recentPressCard || !recentPressStart) return;
  if (Math.hypot(e.clientX - recentPressStart.x, e.clientY - recentPressStart.y) > 12) { clearTimeout(recentPressTimer); recentPressTimer = null; recentPressCard = null; recentPressStart = null; }
});
for (const eventName of ['pointerup', 'pointercancel', 'pointerleave']) recentGrid.addEventListener(eventName, () => { clearTimeout(recentPressTimer); recentPressTimer = null; recentPressCard = null; recentPressStart = null; });
recentGrid.addEventListener('contextmenu', e => {
  const card = e.target.closest('.album-card[data-track], .album-card[data-video]');
  if (!card) return;
  e.preventDefault(); recentLongPressTriggered = true; setTimeout(() => { recentLongPressTriggered = false; }, 1200);
  openRecentActions(card.dataset.track || card.dataset.video, card.dataset.video ? 'youtube' : 'local');
});
recentGrid.addEventListener('click', e => {
  if (recentLongPressTriggered) { recentLongPressTriggered = false; e.preventDefault(); return; }
  const video = e.target.closest('[data-video]');
  if (video) { const item = readList(playedHistoryKey).find(t => t.id === video.dataset.video && (t.sourceType || 'youtube') === 'youtube'); if (item) { ytQueue = [normalizeYoutubeItem(item)]; ytQueueIndex = 0; playYoutube(item); } return; }
  const card = e.target.closest('[data-track]');
  if (card) { const item = tracks.find(track => track.id === card.dataset.track); if (item) playTrack(item.id); }
});
document.querySelector('#trackList').addEventListener('click', e => {
  if (libraryLongPressTriggered) { libraryLongPressTriggered = false; e.preventDefault(); return; }
  if (e.target.closest('[data-cover], [data-drag-handle]')) return;
  const row = e.target.closest('.track-row');
  const item = row && getActiveTracks().find(track => track.id === row.dataset.id);
  if (!item) return;
  if (e.target.closest('[data-favorite]')) { setFavoriteForItem(item); return; }
  playFromActiveListItem(item);
});
const trackList = document.querySelector('#trackList');
trackList.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button, [data-cover], [data-drag-handle]')) return;
  const row = e.target.closest('.track-row');
  if (!row) return;
  clearTimeout(libraryPressTimer);
  libraryPressRow = row;
  libraryPressStart = { x: e.clientX, y: e.clientY };
  libraryPressTimer = setTimeout(() => {
    if (!libraryPressRow) return;
    const item = getActiveTracks().find(track => track.id === libraryPressRow.dataset.id);
    if (!item) return;
    libraryLongPressTriggered = true;
    setTimeout(() => { libraryLongPressTriggered = false; }, 1200);
    openRecentActions(item.id, item.sourceType || 'local', true, item);
    libraryPressRow = null;
    libraryPressStart = null;
    libraryPressTimer = null;
  }, 500);
});
trackList.addEventListener('pointermove', e => {
  if (!libraryPressRow || !libraryPressStart) return;
  if (Math.hypot(e.clientX - libraryPressStart.x, e.clientY - libraryPressStart.y) > 12) {
    clearTimeout(libraryPressTimer);
    libraryPressTimer = null;
    libraryPressRow = null;
    libraryPressStart = null;
  }
});
for (const eventName of ['pointerup', 'pointercancel', 'pointerleave']) trackList.addEventListener(eventName, () => {
  clearTimeout(libraryPressTimer);
  libraryPressTimer = null;
  libraryPressRow = null;
  libraryPressStart = null;
});
trackList.addEventListener('contextmenu', e => {
  const row = e.target.closest('.track-row');
  if (!row || e.target.closest('button, [data-cover], [data-drag-handle]')) return;
  const item = getActiveTracks().find(track => track.id === row.dataset.id);
  if (!item) return;
  e.preventDefault();
  libraryLongPressTriggered = true;
  setTimeout(() => { libraryLongPressTriggered = false; }, 1200);
  openRecentActions(item.id, item.sourceType || 'local', true, item);
});
trackList.addEventListener('pointerdown', e => { const handle = e.target.closest('[data-drag-handle]'); if (!handle || e.button !== 0) return; pointerReorder = { id: handle.dataset.dragHandle, pointerId: e.pointerId, handle, targetId: handle.dataset.dragHandle }; handle.closest('.track-row')?.classList.add('is-dragging'); handle.setPointerCapture(e.pointerId); e.preventDefault(); });
trackList.addEventListener('pointermove', e => { if (!pointerReorder || pointerReorder.pointerId !== e.pointerId) return; const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.track-row'); trackList.querySelectorAll('.drop-target').forEach(row => row.classList.remove('drop-target')); pointerReorder.targetId = target?.dataset.id || null; if (target) target.classList.add('drop-target'); });
trackList.addEventListener('pointerup', e => { if (!pointerReorder || pointerReorder.pointerId !== e.pointerId) return; const { id, targetId } = pointerReorder; pointerReorder = null; trackList.querySelectorAll('.is-dragging,.drop-target').forEach(row => row.classList.remove('is-dragging','drop-target')); reorderTrack(id, targetId); });
trackList.addEventListener('pointercancel', () => { pointerReorder = null; trackList.querySelectorAll('.is-dragging,.drop-target').forEach(row => row.classList.remove('is-dragging','drop-target')); });
document.querySelector('#trackList').addEventListener('click', e => { const cover = e.target.closest('[data-cover]'); if (cover) { window.coverTarget = cover.dataset.cover; document.querySelector('#coverInput').click(); } });
document.querySelector('#coverInput').addEventListener('change', async e => { const file = e.target.files?.[0]; const t = tracks.find(item => item.id === window.coverTarget); if (!file || !t) return; t.coverBlob = file; t.coverMime = file.type || 'image/png'; coverUrls.set(t.id, URL.createObjectURL(file)); await dbRun('readwrite', s => s.put(t)); e.target.value = ''; if (currentTrack()?.id === t.id) paintTrack(); else render(); showToast('تم تحديث غلاف الأغنية وشاشة القفل'); });
document.querySelector('#playBtn').addEventListener('click', togglePlay); document.querySelector('#fullPlay').addEventListener('click', togglePlay); document.querySelector('#nextBtn').addEventListener('click', next); document.querySelector('#fullNext').addEventListener('click', next); document.querySelector('#prevBtn').addEventListener('click', prev); document.querySelector('#fullPrev').addEventListener('click', prev);
document.querySelector('#seekBack10').addEventListener('click', () => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, audio.currentTime - 10); }); document.querySelector('#seekForward10').addEventListener('click', () => { if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10); });
document.querySelector('#shuffleBtn').addEventListener('click', e => { shuffled = !shuffled; playerSettings.shuffle = shuffled; persistPlayerSettings(); e.currentTarget.classList.toggle('selected', shuffled); document.querySelector('#fullShuffle').classList.toggle('selected', shuffled); document.querySelector('#settingsShuffle').checked = shuffled; showToast(shuffled ? 'التشغيل العشوائي مفعّل' : 'التشغيل العشوائي متوقف'); }); document.querySelector('#fullShuffle').addEventListener('click', () => document.querySelector('#shuffleBtn').click());
document.querySelector('#repeatBtn').addEventListener('click', () => { repeat = (repeat + 1) % 3; playerSettings.repeat = ['off', 'all', 'one'][repeat]; persistPlayerSettings(); syncRepeatControls(); document.querySelector('#settingsRepeat').value = playerSettings.repeat; showToast(['التكرار متوقف', 'تكرار قائمة التشغيل', 'تكرار الأغنية'][repeat]); }); document.querySelector('#fullRepeat').addEventListener('click', () => document.querySelector('#repeatBtn').click());
document.querySelector('#favoriteBtn').addEventListener('click', toggleFavorite); document.querySelector('#fullFavorite').addEventListener('click', toggleFavorite); document.querySelector('#queueBtn').addEventListener('click', openQueue); document.querySelector('#fullQueue').addEventListener('click', openQueue); document.querySelector('#addToPlaylist').addEventListener('click', openAddToPlaylist); document.querySelector('#overlayMore').addEventListener('click', openNowPlayingMenu);
document.querySelector('.now-track').addEventListener('click', e => { if (!e.target.closest('button')) openFullPlayer(); }); document.querySelector('#closePlayer').addEventListener('click', () => document.querySelector('#playerOverlay').classList.add('hidden')); document.querySelector('#playerOverlay').addEventListener('click', e => { if (e.target.id === 'playerOverlay') e.currentTarget.classList.add('hidden'); }); document.querySelector('#sleepTimer').addEventListener('click', openSleepTimer);
const volume = document.querySelector('#volumeBar'), fullVolume = document.querySelector('#fullVolume'), settingsVolume = document.querySelector('#settingsVolume');
function setPlayerVolume(value) {
  const level = Math.max(0, Math.min(1, Number(value)));
  playerSettings.volume = level;
  audio.volume = level;
  if (source === 'youtube') ytPlayer?.setVolume?.(level * 100);
  volume.value = String(level);
  fullVolume.value = String(level);
  settingsVolume.value = String(level);
  document.querySelector('#settingsVolumeValue').value = `${Math.round(level * 100)}%`;
  document.querySelector('#settingsVolumeValue').textContent = `${Math.round(level * 100)}%`;
  persistPlayerSettings();
}
volume.addEventListener('input', () => setPlayerVolume(volume.value));
fullVolume.addEventListener('input', () => setPlayerVolume(fullVolume.value));
settingsVolume.addEventListener('input', () => setPlayerVolume(settingsVolume.value));
document.querySelector('#settingsAutoPlayNext').addEventListener('change', e => {
  playerSettings.autoPlayNext = e.currentTarget.checked;
  persistPlayerSettings();
});
document.querySelector('#settingsShuffle').addEventListener('change', e => {
  shuffled = e.currentTarget.checked;
  playerSettings.shuffle = shuffled;
  document.querySelector('#shuffleBtn').classList.toggle('selected', shuffled);
  document.querySelector('#fullShuffle').classList.toggle('selected', shuffled);
  persistPlayerSettings();
});
document.querySelector('#settingsRepeat').addEventListener('change', e => {
  playerSettings.repeat = e.currentTarget.value;
  repeat = { off: 0, all: 1, one: 2 }[playerSettings.repeat];
  syncRepeatControls();
  persistPlayerSettings();
});
document.querySelectorAll('[data-app-theme-option]').forEach(button => button.addEventListener('click', () => {
  applyAppTheme(button.dataset.appThemeOption);
  localStorage.setItem(appThemeStorageKey, appTheme);
}));
volume.value = String(playerSettings.volume);
fullVolume.value = String(playerSettings.volume);
audio.volume = playerSettings.volume;
syncSettingsControls();
function seekTo(value) { if (source === 'youtube' && ytPlayer) { try { const duration = ytPlayer.getDuration(); if (duration) ytPlayer.seekTo((Number(value) / 1000) * duration, true); } catch { } return; } if (Number.isFinite(audio.duration)) audio.currentTime = (Number(value) / 1000) * audio.duration; }
seek.addEventListener('input', () => seekTo(seek.value)); fullSeek.addEventListener('input', () => seekTo(fullSeek.value));
audio.addEventListener('timeupdate', () => { if (source !== 'local' || !Number.isFinite(audio.duration)) return; const value = Math.round(audio.currentTime / audio.duration * 1000); seek.value = value; fullSeek.value = value; document.querySelector('#currentTime').textContent = fmt(audio.currentTime); document.querySelector('#duration').textContent = fmt(audio.duration); document.querySelector('#fullCurrent').textContent = fmt(audio.currentTime); document.querySelector('#fullDuration').textContent = fmt(audio.duration); if (navigator.mediaSession && 'setPositionState' in navigator.mediaSession) try { navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: audio.currentTime }); } catch { } });
audio.addEventListener('loadedmetadata', () => { const t = currentTrack(); if (!t) return; t.duration = audio.duration; dbRun('readwrite', s => s.put(t)); document.querySelector('#duration').textContent = fmt(audio.duration); document.querySelector('#fullDuration').textContent = fmt(audio.duration); render(); }); audio.addEventListener('play', () => { updatePlayButtons(); if (source === 'local' && currentTrack()) addLocalPlayed(currentTrack()); }); audio.addEventListener('pause', updatePlayButtons); audio.addEventListener('ended', () => next(true));
document.addEventListener('keydown', e => { if (e.target.matches('input')) return; if (e.code === 'Space') { e.preventDefault(); togglePlay(); } if (e.code === 'ArrowRight') next(); if (e.code === 'ArrowLeft') prev(); if (e.key === 'Escape') document.querySelector('#playerOverlay').classList.add('hidden'); });
async function start() {
  try {
    const saved = await dbRun('readonly', store => store.getAll());
    tracks = (saved || []).sort((a, b) => a.addedAt - b.addedAt);
    ensureDownloadsPlaylist();
    const changed = [];
    for (const track of tracks) {
      if (!track.blob) continue;
      trackUrls.set(track.id, URL.createObjectURL(track.blob));
      const audioFile = track.fileName && window.File ? new File([track.blob], track.fileName, { type: track.blob.type }) : track.blob;
      if (!track.metadataRead) {
        const metadata = await extractAudioMetadata(audioFile);
        const canFillDefaults = track.artist === 'ملف من جهازك' || track.album === 'مكتبتي' || !track.artist;
        if (canFillDefaults) {
          if (metadata.title) track.title = metadata.title;
          if (metadata.artist) track.artist = metadata.artist;
          if (metadata.album) track.album = metadata.album;
        }
        track.metadataRead = true;
        changed.push(track);
      }
      if (track.coverBlob) coverUrls.set(track.id, URL.createObjectURL(track.coverBlob));
      else {
        const cover = await extractEmbeddedCover(audioFile);
        if (cover) { track.coverBlob = cover.blob; track.coverMime = cover.type; coverUrls.set(track.id, URL.createObjectURL(cover.blob)); changed.push(track); }
      }
    }
    if (changed.length) await dbRun('readwrite', store => changed.forEach(track => store.put(track)));
    render();
  } catch { showToast('تعذر فتح مكتبة الموسيقى في المتصفح'); }
}
localStorage.removeItem('naghma-jamendo-client-id');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(() => { });
start();
