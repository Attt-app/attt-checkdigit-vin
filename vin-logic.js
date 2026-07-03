/* =====================================================================
   ATTT · Check-Digit VIN — logique application
   - Lecture VIN par OCR (OCR.Space gratuit + repli Tesseract côté appareil)
   - Vérification du check-digit UNIQUEMENT pour les WMI qui le respectent
   - Enregistrement local uniquement (aucune transmission de données)
   ===================================================================== */

// ── Tables VIN (ISO 3779 / SAE J853) ─────────────────────────────────
const VIN_MAP = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
const VIN_WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

const WMI_PAYS = {
  A:'Afrique du Sud',B:'Angola',C:'Bénin',D:'Égypte',E:'Éthiopie',F:'Mozambique',
  J:'Japon',K:'Corée du Sud',L:'Chine',M:'Inde',N:'Iran',P:'Philippines',
  R:'Taïwan',S:'Royaume-Uni',T:'Suisse',U:'États-Unis',
  V:'France',W:'Allemagne',X:'Russie',Y:'Suède',Z:'Italie',
  '1':'États-Unis','2':'Canada','3':'Mexique','4':'États-Unis','5':'États-Unis',
  '6':'Australie','7':'Nouvelle-Zélande','8':'Argentine','9':'Brésil'
};
const WMI_PAYS_2 = {
  VF:'France',VG:'France',VN:'France',VR:'France',VS:'Espagne',VV:'Espagne',
  WA:'Allemagne',WB:'Allemagne',WD:'Allemagne',WF:'Allemagne',WM:'Allemagne',
  WP:'Allemagne',WV:'Allemagne',TN:'Tunisie',
  SA:'Royaume-Uni',SB:'Royaume-Uni',SC:'Royaume-Uni',
  ZA:'Italie',ZC:'Italie',ZD:'Italie',ZF:'Italie',
  YS:'Suède',YT:'Suède',YV:'Suède',
  JA:'Japon',KL:'Corée du Sud',KM:'Corée du Sud',KN:'Corée du Sud',
  LA:'Chine',LB:'Chine',LC:'Chine',LD:'Chine',LE:'Chine',LF:'Chine',
  MA:'Inde',TM:'Tchéquie',TR:'Hongrie',UU:'Roumanie',
  '1G':'États-Unis','2G':'Canada','3G':'Mexique','9B':'Brésil'
};
const VIN_ANNEE = {
  A:2010,B:2011,C:2012,D:2013,E:2014,F:2015,G:2016,H:2017,J:2018,
  K:2019,L:2020,M:2021,N:2022,P:2023,R:2024,S:2025,T:2026,V:2027,
  W:2028,X:2029,Y:2030,'1':2031,'2':2032,'3':2033,'4':2034,'5':2035,'6':2036,
  '7':2037,'8':2038,'9':2039
};
const VIN_ANNEE_ANCIEN = {
  A:1980,B:1981,C:1982,D:1983,E:1984,F:1985,G:1986,H:1987,J:1988,
  K:1989,L:1990,M:1991,N:1992,P:1993,R:1994,S:1995,T:1996,V:1997,
  W:1998,X:1999,Y:2000,'1':2001,'2':2002,'3':2003,'4':2004,'5':2005,'6':2006,
  '7':2007,'8':2008,'9':2009
};

// Régions où le check-digit est obligatoire (FMVSS 115 : Amérique du Nord)
const WMI_CHECK_DIGIT_REGIONS = {
  '1':{ respecte:true,  region:'Amérique du Nord (USA)',    norme:'FMVSS 115' },
  '2':{ respecte:true,  region:'Amérique du Nord (Canada)', norme:'FMVSS 115' },
  '3':{ respecte:true,  region:'Amérique du Nord (Mexique)',norme:'FMVSS 115' },
  '4':{ respecte:true,  region:'Amérique du Nord (USA)',    norme:'FMVSS 115' },
  '5':{ respecte:true,  region:'Amérique du Nord (USA)',    norme:'FMVSS 115' }
};

// Surcharges manuelles : AUCUNE. La liste de référence (wmi-reference.js,
// colonne oui/non générée depuis NHTSA vPIC) fait autorité pour déterminer
// quels WMI appliquent le check-digit. Exemples : BMW/MINI/Volvo vérifiés
// (WBA, WBS, WBY, WBX, WMW, YV1-YV4, 3MW, 4US, 5UX...) = oui ; autres WMI
// européens non vérifiés = non (optionnel ISO 3779).
const WMI_CHECK_DIGIT_OVERRIDE = {};

// ── Base WMI (chargée depuis wmi-reference.js : [WMI, Marque, "oui"/"non"]) ──
const WMI_REFERENCE_ROWS = Array.isArray(window.WMI_REFERENCE_ROWS) ? window.WMI_REFERENCE_ROWS : [];
const WMI_REFERENCE_MAP = (() => {
  const map = Object.create(null);
  WMI_REFERENCE_ROWS.forEach(row => {
    const wmi = String(row?.[0] || '').toUpperCase().trim();
    if (!wmi) return;
    map[wmi] = {
      wmi,
      marque: String(row?.[1] || '').trim(),
      checkDigit: String(row?.[2] || '').toLowerCase() === 'oui'
    };
  });
  return map;
})();

// ── Fonctions VIN ────────────────────────────────────────────────────
function calcCheckDigit(vin) {
  if (!vin || vin.length !== 17) return null;
  vin = vin.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = vin[i];
    const val = isNaN(c) ? (VIN_MAP[c] || 0) : parseInt(c, 10);
    sum += val * VIN_WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : r.toString();
}

function isVinFormatAllowed(vin) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(String(vin || '').toUpperCase());
}

function getVinWmiCode(vin) {
  const n = String(vin || '').toUpperCase();
  const base = n.substring(0, 3);
  if (base.length === 3 && base[2] === '9' && n.length >= 14) {
    const extended = base + n.substring(11, 14);
    if (WMI_REFERENCE_MAP[extended]) return extended;
  }
  return base;
}

function getWmiReference(wmiOrVin) {
  const value = String(wmiOrVin || '').toUpperCase().trim();
  if (!value) return null;
  if (WMI_REFERENCE_MAP[value]) return WMI_REFERENCE_MAP[value];
  if (value.length >= 17) {
    const vinWmi = getVinWmiCode(value);
    return WMI_REFERENCE_MAP[vinWmi] || WMI_REFERENCE_MAP[value.substring(0, 3)] || null;
  }
  return WMI_REFERENCE_MAP[value.substring(0, 3)] || null;
}

// Détermine si le VIN appartient à un WMI qui RESPECTE le check-digit
function getInfoCheckDigitModele(vin) {
  const normalized = String(vin || '').toUpperCase();
  const regionInfo = WMI_CHECK_DIGIT_REGIONS[normalized[0]] || null;
  const region = regionInfo ? regionInfo.region : (WMI_PAYS_2[normalized.substring(0, 2)] || WMI_PAYS[normalized[0]] || 'Région inconnue');
  const wmiRef = getWmiReference(normalized);
  const wmiCode = wmiRef ? wmiRef.wmi : normalized.substring(0, 3);
  const override = WMI_CHECK_DIGIT_OVERRIDE[wmiCode];
  if (wmiRef) {
    const respecte = (override !== undefined) ? override : wmiRef.checkDigit;
    return {
      respecte,
      region,
      norme: respecte ? (regionInfo ? 'FMVSS 115' : 'Check-digit constructeur') : 'ISO 3779 (check-digit optionnel)',
      wmi: wmiRef.wmi,
      marque: wmiRef.marque
    };
  }
  if (override !== undefined) {
    return { respecte: override, region, norme: override ? 'Check-digit constructeur' : 'ISO 3779 (check-digit optionnel)', wmi: wmiCode, marque: '' };
  }
  if (regionInfo) return Object.assign({ wmi: wmiCode, marque: '' }, regionInfo);
  return { respecte: false, region: 'Région inconnue / WMI non référencé', norme: 'ISO 3779', wmi: wmiCode, marque: '' };
}

// true / false / null selon que le WMI respecte (ou non) le check-digit
function checkDigitObligatoire(vin) {
  const info = getInfoCheckDigitModele(vin);
  return info ? info.respecte : null;
}

function decoderVinStructurel(vin) {
  if (!isVinFormatAllowed(vin)) return null;
  vin = vin.toUpperCase();
  const wmi = getVinWmiCode(vin);
  const c1 = vin[0], c12 = vin.substring(0, 2);
  const pays = WMI_PAYS_2[c12] || WMI_PAYS[c1] || 'Pays inconnu';
  const wmiRef = getWmiReference(wmi);
  const constructeur = (wmiRef && wmiRef.marque) || null;
  const annee = decodeAnneeModele(vin);
  return {
    wmi,
    vds: vin.substring(3, 9),
    vis: vin.substring(9, 17),
    pays,
    constructeur,
    anneeModele: annee,
    codeUsine: vin[10],
    numSerie: vin.substring(11, 17)
  };
}

// Le code d'année (position 10) est cyclique sur 30 ans : ex. "3" = 1983 / 2003 / 2033.
// La position 7 n'étant pas un indicateur fiable du cycle, on retient l'année la
// plus récente qui reste plausible (≤ année courante + 1), ce qui évite les
// années futures aberrantes (p.ex. 2033 sur un véhicule de 2003).
function decodeAnneeModele(vin) {
  if (!vin || vin.length < 10) return null;
  const code = vin[9];
  const recent = VIN_ANNEE[code] || null;        // 2010-2039
  const older = VIN_ANNEE_ANCIEN[code] || null;   // 1980-2009
  const maxPlausible = new Date().getFullYear() + 1;
  if (recent && recent <= maxPlausible) return recent;
  if (older) return older;
  return recent || null;
}

// Extraction du VIN depuis un texte OCR brut
function extraireVIN(text) {  const clean = String(text || '').toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/O/g, '0').replace(/Q/g, '0').replace(/I/g, '1')
    .replace(/\s+/g, '')
    .trim();
  if (clean.length < 8) return '';
  if (clean.length < 17) {
    const m = clean.match(/[A-HJ-NPR-Z0-9]{8,17}/);
    return m ? m[0] : clean;
  }
  const candidates = [];
  for (let start = 0; start <= clean.length - 17; start++) {
    const cand = clean.substring(start, start + 17);
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(cand)) candidates.push(cand);
  }
  if (!candidates.length) {
    const m = clean.match(/[A-HJ-NPR-Z0-9]{8,17}/g);
    return m ? m.sort((a, b) => b.length - a.length)[0] : clean.substring(0, 17);
  }
  let best = candidates[0], maxScore = -Infinity;
  for (const cand of candidates) {
    let score = 0;
    const info = getInfoCheckDigitModele(cand);
    const cd = calcCheckDigit(cand);
    if (info.respecte === true) {
      score += (cd === cand[8]) ? 1000 : -180;
    } else if (cd === cand[8]) {
      score += 150;
    }
    if (/^[A-Z]{3}/.test(cand)) score += 50;
    else if (/^[A-Z]{2}[0-9]/.test(cand)) score += 30;
    if (getWmiReference(cand)) score += 120;
    if (score > maxScore) { maxScore = score; best = cand; }
  }
  return best;
}

// Auto-correction : pour un VIN dont le WMI RESPECTE le check-digit, tente de
// corriger une confusion OCR fréquente (0/D, 1/L, 5/S, 8/B, 6/G, 2/Z, 4/A…)
// afin de retrouver un VIN dont le check-digit est valide. Ne touche pas les
// VIN des régions où le check-digit n'est pas requis.
function corrigerVINparCheckDigit(vin) {
  if (!vin || vin.length !== 17) return vin;
  const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
  if (!vinPattern.test(vin)) return vin;
  if (checkDigitObligatoire(vin) === false) return vin;
  const expected = calcCheckDigit(vin);
  if (expected === vin[8]) return vin; // déjà valide

  const paires = {
    '0': ['D'], 'D': ['0'], '1': ['L'], 'L': ['1'], 'Z': ['2'], '2': ['Z'],
    'S': ['5'], '5': ['S'], 'B': ['8'], '8': ['B'], 'G': ['6'], '6': ['G'],
    'A': ['4'], '4': ['A']
  };
  const ambiguiteCD = {
    'X': ['8', '1'], '8': ['X', 'B'], 'B': ['8'], '0': ['O', 'D'], 'O': ['0'],
    'D': ['0'], '1': ['I', 'X'], 'I': ['1'], '5': ['S'], 'S': ['5'],
    '2': ['Z'], 'Z': ['2'], '6': ['G'], 'G': ['6']
  };
  // Cas simple : la position 9 elle-même a été mal lue
  if (vinPattern.test(vin.slice(0, 8) + expected + vin.slice(9)) && (ambiguiteCD[vin[8]] || []).includes(expected)) {
    return vin.slice(0, 8) + expected + vin.slice(9);
  }

  const candidats = [];
  const distincts = new Set();
  for (let i = 0; i < 17; i++) {
    if (i === 8) continue;
    const alts = paires[vin[i]];
    if (!alts) continue;
    for (const alt of alts) {
      const cand = vin.slice(0, i) + alt + vin.slice(i + 1);
      if (!vinPattern.test(cand)) continue;
      if (calcCheckDigit(cand) !== cand[8]) continue;
      let score = 100;
      if (i < 3) score -= 45;
      if (/[A-Z]/.test(vin[i]) && /[0-9]/.test(alt)) score -= 15;
      if (/[0-9]/.test(vin[i]) && /[A-Z]/.test(alt)) score -= 8;
      if (cand.slice(0, 3) !== vin.slice(0, 3)) score -= 10;
      candidats.push({ cand, score });
      distincts.add(cand);
    }
  }
  // Correction uniquement si UNE seule possibilité : on n'invente jamais un VIN
  // quand plusieurs corrections sont possibles (on laisse l'humain vérifier).
  if (distincts.size === 1) return candidats[0].cand;
  return vin;
}
