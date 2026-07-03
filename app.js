/* =====================================================================
   ATTT · Check-Digit VIN — interface (caméra, OCR, affichage, envoi)
   ===================================================================== */

const $ = (id) => document.getElementById(id);

// État
let stream = null;
const photos = [];          // dataURL des photos capturées (max 3)
let ocrWorker = null;
let lastResult = null;      // { vin, decode, info, verdict }

// ── Helpers UI ───────────────────────────────────────────────────────
function showLoader(txt) { $('loaderText').textContent = txt || 'Traitement…'; $('loader').classList.add('open'); }
function hideLoader() { $('loader').classList.remove('open'); }
function setFeedback(html) { $('feedback').innerHTML = html || ''; }
function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast ' + type; }, 2800);
}

// ── Caméra ───────────────────────────────────────────────────────────
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    const v = $('video');
    v.srcObject = stream;
    await v.play();
    v.style.display = 'block';
    $('preview').style.display = 'none';
    $('camPlaceholder').style.display = 'none';
    $('scanFrame').style.display = 'block';
    $('btnCapture').disabled = false;
    setFeedback('<span class="msg-ok">Caméra active — cadrez le numéro de châssis.</span>');
  } catch (e) {
    setFeedback('<span class="msg-err">Accès caméra refusé. Utilisez « Galerie ».</span>');
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('video').style.display = 'none';
  $('scanFrame').style.display = 'none';
}

function capturePhoto() {
  const v = $('video');
  if (!v.videoWidth) { toast('Caméra non prête', 'err'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  addPhoto(dataUrl);
  stopCamera();
  showPreview(dataUrl);
  processImage(dataUrl);
}

function showPreview(dataUrl) {
  const p = $('preview');
  p.src = dataUrl;
  p.style.display = 'block';
  $('camPlaceholder').style.display = 'none';
}

function addPhoto(dataUrl) {
  photos.unshift(dataUrl);
  if (photos.length > 3) photos.length = 3;
  renderThumbs();
}

function renderThumbs() {
  const wrap = $('thumbs');
  wrap.innerHTML = photos.map(p => `<img src="${p}" alt="photo VIN">`).join('');
}

// Galerie
function onGalleryChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    addPhoto(reader.result);
    showPreview(reader.result);
    processImage(reader.result);
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

// ── Prétraitement image pour OCR ─────────────────────────────────────
function preprocess(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1400;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      // Niveaux de gris + renforcement du contraste
      for (let i = 0; i < d.length; i += 4) {
        let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        g = g < 110 ? g * 0.6 : Math.min(255, g * 1.25);
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── OCR multi-moteur : OCR.Space (API gratuite) + repli Tesseract ─────
// Clé OCR.Space : clé de démo publique par défaut (limitée). Pour un usage
// réel, obtenez une clé gratuite (25 000 requêtes/mois) sur ocr.space et
// exécutez dans la console : localStorage.setItem('attt_ocr_key', 'VOTRE_CLE')
const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';
function ocrSpaceKey() { return (localStorage.getItem('attt_ocr_key') || 'helloworld').trim(); }

async function getWorker() {
  if (ocrWorker) return ocrWorker;
  // langPath doit être une URL absolue : le worker Tesseract ne peut pas
  // résoudre un chemin relatif dans son WorkerGlobalScope.
  const langPath = new URL('assets', location.href).href;
  ocrWorker = await Tesseract.createWorker('eng', 1, {
    langPath,
    gzip: false
  });
  await ocrWorker.setParameters({
    tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789',
    tessedit_pageseg_mode: '6'
  });
  return ocrWorker;
}

// OCR.Space — moteur 2, meilleur pour l'alphanumérique gravé
async function ocrSpace(dataUrl) {
  const form = new FormData();
  form.append('base64Image', dataUrl);
  form.append('apikey', ocrSpaceKey());
  form.append('language', 'eng');
  form.append('OCREngine', '2');
  form.append('scale', 'true');
  form.append('detectOrientation', 'true');
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(OCR_SPACE_URL, { method: 'POST', body: form, signal: ctrl.signal });
    const json = await res.json();
    if (json.IsErroredOnProcessing || !json.ParsedResults || !json.ParsedResults[0]) return '';
    return extraireVIN(json.ParsedResults[0].ParsedText || '');
  } finally {
    clearTimeout(to);
  }
}

// Tesseract.js — 100 % côté appareil (repli hors-ligne)
async function ocrTesseract(dataUrl) {
  const worker = await getWorker();
  const { data } = await worker.recognize(dataUrl);
  return extraireVIN(data.text || '');
}

async function processImage(dataUrl) {
  showLoader('Lecture OCR du VIN…');
  try {
    const pre = await preprocess(dataUrl);
    let vin = '';
    let moteur = '';

    // 1) OCR.Space (API gratuite) si connexion disponible
    if (navigator.onLine) {
      try {
        const v = await ocrSpace(pre);
        if (v) { vin = v; moteur = 'OCR.Space'; }
      } catch (e) { console.warn('[OCR.Space]', e.message); }
    }

    // 2) Repli Tesseract (local) si OCR.Space échoue ou VIN incomplet (< 17)
    if (!vin || vin.length < 17) {
      try {
        const v = await ocrTesseract(pre);
        if (v && v.length >= vin.length) { vin = v; moteur = moteur ? moteur + '+Tesseract' : 'Tesseract'; }
      } catch (e) { console.warn('[Tesseract]', e.message); }
    }

    // 3) Auto-correction par check-digit (pour les WMI qui le respectent)
    let corrige = false;
    if (vin.length === 17) {
      const fixed = corrigerVINparCheckDigit(vin);
      if (fixed !== vin) { vin = fixed; corrige = true; }
    }

    hideLoader();
    if (vin && vin.length >= 8) {
      $('vinField').value = vin;
      let msg = '✓ VIN détecté (' + (moteur || 'OCR') + ')';
      if (corrige) msg += ' — auto-corrigé ✔';
      setFeedback('<span class="msg-ok">' + msg + ' — vérifiez puis enregistrez.</span>');
      if (vin.length === 17) analyzeVin();
    } else {
      setFeedback('<span class="msg-missing">⚠ VIN non lisible. Rapprochez-vous / améliorez l’éclairage, ou saisissez-le manuellement.</span>');
    }
  } catch (e) {
    hideLoader();
    setFeedback('<span class="msg-err">Erreur OCR : ' + e.message + '. Saisie manuelle possible.</span>');
  }
}

// ── Analyse & affichage ──────────────────────────────────────────────
function analyzeVin() {
  const vin = $('vinField').value.toUpperCase().trim();
  if (!isVinFormatAllowed(vin)) {
    setFeedback('<span class="msg-err">Le VIN doit comporter 17 caractères valides (sans I, O, Q).</span>');
    $('resultBlock').style.display = 'none';
    return;
  }
  const info = getInfoCheckDigitModele(vin);
  const decode = decoderVinStructurel(vin);

  let verdict;
  const badge = $('checkBadge');

  if (info.respecte === true) {
    const computed = calcCheckDigit(vin);
    const actual = vin[8];
    const isValid = computed === actual;
    verdict = { supporte: true, valide: isValid, computed, actual };
    badge.className = 'check-badge ' + (isValid ? 'check-valid-bg' : 'check-invalid-bg');
    badge.innerHTML = `
      <span class="big ${isValid ? 'check-valid' : 'check-invalid'}">${isValid ? 'CHECK-DIGIT VALIDE ✓' : 'CHECK-DIGIT NON VALIDE ✗'}</span>
      Position 9 : <b>${actual}</b> &nbsp;|&nbsp; Calculé : <b>${computed}</b><br>
      <small>WMI ${info.wmi} — ${info.marque || info.region} · ${info.norme}</small>`;
  } else {
    verdict = { supporte: false };
    badge.className = 'check-badge check-na-bg';
    badge.innerHTML = `
      <span class="big check-na">CHECK-DIGIT NON APPLICABLE</span>
      Ce modèle ne respecte pas le check-digit.<br>
      <small>WMI ${info.wmi} — ${info.marque || info.region} · ${info.norme}</small>`;
  }

  // Détails
  $('detailGrid').innerHTML = `
    <div><div class="k">VIN</div><div class="v" style="font-family:monospace">${vin}</div></div>
    <div><div class="k">WMI</div><div class="v">${info.wmi}</div></div>
    <div><div class="k">Constructeur</div><div class="v">${(decode && decode.constructeur) || info.marque || '—'}</div></div>
    <div><div class="k">Pays</div><div class="v">${(decode && decode.pays) || '—'}</div></div>
    <div><div class="k">Année modèle</div><div class="v">${(decode && decode.anneeModele) || '—'}</div></div>
    <div><div class="k">N° série</div><div class="v">${(decode && decode.numSerie) || '—'}</div></div>`;

  lastResult = { vin, decode, info, verdict, at: new Date().toISOString() };
  $('resultBlock').style.display = 'block';
  $('btnSend').disabled = false;
  setFeedback('');
  $('resultBlock').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Historique local (50 derniers scans) ─────────────────────────────
const HISTORY_KEY = 'attt_history';
const HISTORY_MAX = 50;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (e) {}
}
function addToHistory(record) {
  const list = loadHistory();
  list.unshift(record);          // le plus récent en tête
  saveHistory(list);             // saveHistory tronque à 50
  renderHistory();
}
function clearHistory() {
  if (!confirm('Vider tout l’historique local ?')) return;
  saveHistory([]);
  renderHistory();
  toast('Historique vidé', '');
}
function renderHistory() {
  const wrap = $('historyList');
  if (!wrap) return;
  const list = loadHistory();
  const empty = $('historyEmpty');
  $('historyCount').textContent = list.length ? '(' + list.length + '/' + HISTORY_MAX + ')' : '';
  if (!list.length) { wrap.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  wrap.innerHTML = list.map(r => {
    const cd = r.checkDigit || {};
    const badge = !cd.applicable ? '<span class="hist-badge hist-na">CD N/A</span>'
      : (cd.valide ? '<span class="hist-badge hist-ok">Valide</span>' : '<span class="hist-badge hist-ko">Non valide</span>');
    const when = String(r.horodatage || '').replace('T', ' ').slice(0, 16);
    return `<div class="hist-item">
      <div class="hist-vin">${r.vin}</div>
      <div class="hist-meta">${r.marque || r.wmi || ''} · ${when}</div>
      <div class="hist-tags">${badge}</div>
    </div>`;
  }).join('');
}

// ── Enregistrer (historique local uniquement, aucun envoi) ────────────
// Le bouton « Enregistrer » ne fait qu'un enregistrement local. Aucune
// donnée n'est transmise à un tiers : le libellé correspond exactement à
// l'action, sans transmission cachée.
function saveRecord() {
  if (!lastResult) return;
  const v = lastResult;
  const record = {
    vin: v.vin,
    wmi: v.info.wmi,
    marque: v.info.marque || (v.decode && v.decode.constructeur) || '',
    pays: (v.decode && v.decode.pays) || '',
    anneeModele: (v.decode && v.decode.anneeModele) || '',
    checkDigit: v.verdict.supporte
      ? { applicable: true, valide: v.verdict.valide, calcule: v.verdict.computed, position9: v.verdict.actual }
      : { applicable: false },
    horodatage: v.at
  };
  addToHistory(record);
  toast('Enregistré dans l’historique ✓', 'ok');
  $('btnSend').disabled = true;
}

// ── Réinitialiser ────────────────────────────────────────────────────
function resetAll() {
  stopCamera();
  photos.length = 0;
  renderThumbs();
  $('vinField').value = '';
  $('preview').style.display = 'none';
  $('camPlaceholder').style.display = 'block';
  $('resultBlock').style.display = 'none';
  $('btnSend').disabled = true;
  setFeedback('');
  lastResult = null;
}

// ── Câblage ──────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  $('btnCam').addEventListener('click', startCamera);
  $('btnCapture').addEventListener('click', capturePhoto);
  $('galleryInput').addEventListener('change', onGalleryChange);
  $('btnAnalyze').addEventListener('click', analyzeVin);
  $('vinField').addEventListener('input', () => { $('vinField').value = $('vinField').value.toUpperCase(); });
  $('vinField').addEventListener('keydown', (e) => { if (e.key === 'Enter') analyzeVin(); });
  $('btnReset').addEventListener('click', resetAll);
  $('btnSend').addEventListener('click', saveRecord);
  $('btnClearHistory').addEventListener('click', clearHistory);

  renderHistory();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
});
