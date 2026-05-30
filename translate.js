const axios = require('axios').default;
const crypto = require('crypto');
const https = require('https');

const CHROME_EXTENSION_ID = 'cofdbpoegempjloogbagkncekinflcnj';
const CHROME_EXTENSION_VERSION = '1.86.0';
const IMPERSONATED_CHROME_MAJOR = '120';
const ONESHOT_FREE_ENDPOINT = 'https://oneshot-free.www.deepl.com/v1/translate';
const MAX_FREE_TEXT_LENGTH = 1500;

const INSTANCE_ID = crypto.randomUUID();

// Language code mapping mirrors DeepLX's background.js arrays
// Keys: uppercase caller input. Values: lowercase BCP-47 forms the oneshot endpoint expects.
const targetLangMap = {
  'AR': 'ar', 'BG': 'bg', 'CS': 'cs', 'DA': 'da', 'DE': 'de', 'EL': 'el',
  'EN-GB': 'en-GB', 'EN-US': 'en-US',
  'ES': 'es', 'ES-419': 'es-419', 'ET': 'et', 'FI': 'fi', 'FR': 'fr',
  'HE': 'he', 'HU': 'hu', 'ID': 'id', 'IT': 'it', 'JA': 'ja', 'KO': 'ko',
  'LT': 'lt', 'LV': 'lv', 'NB': 'nb', 'NL': 'nl', 'PL': 'pl',
  'PT-BR': 'pt-BR', 'PT-PT': 'pt-PT',
  'RO': 'ro', 'RU': 'ru', 'SK': 'sk', 'SL': 'sl', 'SV': 'sv',
  'TR': 'tr', 'UK': 'uk', 'VI': 'vi',
  'ZH': 'zh-Hans', 'ZH-HANS': 'zh-Hans', 'ZH-HANT': 'zh-Hant',
  'EN': 'en-US',   // convenience alias
  'PT': 'pt-BR',   // convenience alias
};

const sourceLangMap = Object.assign({}, targetLangMap, {
  'EN': 'en', 'PT': 'pt',  // source-only generic codes
});

function resolveTargetLang(code) {
  if (!code) throw new Error('target_lang is required');
  if (code.toUpperCase() === 'AUTO') throw new Error('target_lang cannot be "auto"');
  const v = targetLangMap[code.toUpperCase()];
  if (!v) throw new Error('unsupported target_lang "' + code + '"');
  return v;
}

function resolveSourceLang(code) {
  if (!code || code.toUpperCase() === 'AUTO') return '';
  const v = sourceLangMap[code.toUpperCase()];
  if (!v) throw new Error('unsupported source_lang "' + code + '"');
  return v;
}

let warmCookieJar = '';
let cookieWarmed = false;
const warmupLock = { warming: false };

const client = axios.create({
  timeout: 20000,
  maxRedirects: 0,
  httpsAgent: new https.Agent({ keepAlive: true }),
});

async function warmCookies() {
  if (cookieWarmed || warmupLock.warming) return;
  warmupLock.warming = true;
  try {
    const resp = await axios.get('https://www.deepl.com/translator', {
      timeout: 5000,
      httpsAgent: new https.Agent({ keepAlive: true }),
    });
    const setCookie = resp.headers['set-cookie'];
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      warmCookieJar = cookies.map(c => c.split(';')[0]).join('; ');
    }
  } catch (_) {}
  cookieWarmed = true;
}

async function translate(text, sourceLang = 'AUTO', targetLang = 'ZH') {
  if (!text || text.length === 0) throw new Error('No text to translate');
  if (text.length > MAX_FREE_TEXT_LENGTH) {
    throw new Error('text exceeds maximum length: ' + text.length + ' characters (limit is ' + MAX_FREE_TEXT_LENGTH + ')');
  }

  const resolvedTarget = resolveTargetLang(targetLang);
  const resolvedSource = resolveSourceLang(sourceLang);

  warmCookies();

  const body = {
    text: [text],
    target_lang: resolvedTarget,
    usage_type: 'Translate',
    app_information: {
      os: 'brex_macOS',
      os_version: 'brex_chrome_' + IMPERSONATED_CHROME_MAJOR + '.0.0.0',
      app_version: CHROME_EXTENSION_VERSION,
      app_build: 'chrome_web_store',
      instance_id: INSTANCE_ID,
    },
  };

  // Only include source_lang if not empty (autodetect)
  if (resolvedSource) {
    body.source_lang = resolvedSource;
  }

  const reqHeaders = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Authorization': 'None',
    'Origin': 'chrome-extension://' + CHROME_EXTENSION_ID,
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };

  if (warmCookieJar) {
    reqHeaders['Cookie'] = warmCookieJar;
  }

  const response = await client.post(ONESHOT_FREE_ENDPOINT, body, { headers: reqHeaders });

  if (response.status === 429) {
    throw new Error('Too many requests, your IP has been blocked by DeepL temporarily.');
  }
  if (response.status !== 200) {
    throw new Error('Request failed with status code: ' + response.status);
  }

  const translations = response.data.translations;
  if (!translations || translations.length === 0) {
    throw new Error('Translation failed: empty translations array');
  }

  const t = translations[0];
  if (!t.text) {
    throw new Error('Translation failed: missing translation text');
  }

  return {
    text: t.text,
    alternatives: t.alternatives || [],
    source_lang: t.detected_source_language
      ? t.detected_source_language.toUpperCase()
      : sourceLang,
    target_lang: targetLang,
  };
}

exports.translate = translate;
