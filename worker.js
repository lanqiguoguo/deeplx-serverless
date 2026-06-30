/**
 * Cloudflare Worker — DeepL free translation proxy (independent, self-contained).
 *
 * Deploy (CLI):   wrangler deploy worker.js
 * Deploy (dash):  paste this file into the Workers editor, set the API_KEY
 *                 variable/secret, then Save & Deploy.
 *
 * Auth is path-based:  POST https://<worker-host>/<API_KEY>/translate
 * Body (JSON): { text, source_lang, target_lang }   (source_lang may be "AUTO")
 *
 * Set the secret via CLI:  wrangler secret put API_KEY
 *   or add a plaintext Var in the dashboard (Settings → Variables).
 */

const CHROME_EXTENSION_ID = 'cofdbpoegempjloogbncekinflcnj';
const CHROME_EXTENSION_VERSION = '1.86.0';
const IMPERSONATED_CHROME_MAJOR = '120';
const ONESHOT_FREE_ENDPOINT = 'https://oneshot-free.www.deepl.com/v1/translate';
const MAX_FREE_TEXT_LENGTH = 1500;

const INSTANCE_ID = crypto.randomUUID();

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/' + IMPERSONATED_CHROME_MAJOR + '.0.0.0 Safari/537.36';

// Language code mapping mirrors DeepLX's background.js arrays.
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

// Per-isolate cookie state. Worker isolates are long-lived, so this mirrors
// the per-instance cookie warming in translate.js.
let warmCookieJar = '';
let cookieWarmed = false;
let warmupPromise = null;

async function warmCookies() {
  if (cookieWarmed) return;
  if (warmupPromise) {
    await warmupPromise;
    return;
  }
  warmupPromise = (async () => {
    try {
      const resp = await fetch('https://www.deepl.com/translator', {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      const setCookies = resp.headers.getSetCookie
        ? resp.headers.getSetCookie()
        : (resp.headers.get('set-cookie') ? [resp.headers.get('set-cookie')] : []);
      if (setCookies && setCookies.length) {
        warmCookieJar = setCookies.map((c) => c.split(';')[0]).join('; ');
      }
    } catch (_) {}
    cookieWarmed = true;
    warmupPromise = null;
  })();
  await warmupPromise;
}

async function translate(text, sourceLang = 'AUTO', targetLang = 'ZH') {
  // Accept a single string or an array of strings (DeepLX-style batch).
  const isArray = Array.isArray(text);
  const items = isArray ? text : [text];
  if (items.length === 0) throw new Error('No text to translate');
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== 'string' || item.length === 0) {
      throw new Error(
        'text must be a non-empty string' +
        (isArray ? ' (array items must be strings)' : '')
      );
    }
    if (item.length > MAX_FREE_TEXT_LENGTH) {
      throw new Error(
        'text exceeds maximum length: ' + item.length +
        ' characters (limit is ' + MAX_FREE_TEXT_LENGTH + ')'
      );
    }
  }

  const resolvedTarget = resolveTargetLang(targetLang);
  const resolvedSource = resolveSourceLang(sourceLang);

  await warmCookies();

  const body = {
    text: items,
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

  if (resolvedSource) {
    body.source_lang = resolvedSource;
  }

  const reqHeaders = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'Authorization': 'None',
    'Origin': 'chrome-extension://' + CHROME_EXTENSION_ID,
    'User-Agent': UA,
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
  };

  if (warmCookieJar) {
    reqHeaders['Cookie'] = warmCookieJar;
  }

  const resp = await fetch(ONESHOT_FREE_ENDPOINT, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(body),
  });

  if (resp.status === 429) {
    throw new Error('Too many requests, your IP has been blocked by DeepL temporarily.');
  }
  if (resp.status !== 200) {
    throw new Error('Request failed with status code: ' + resp.status);
  }

  const data = await resp.json();
  const translations = data.translations;
  if (!translations || translations.length === 0) {
    throw new Error('Translation failed: empty translations array');
  }

  if (isArray) {
    return {
      text: translations.map((t) => t.text || ''),
      alternatives: translations.map((t) => t.alternatives || []),
      source_lang: translations[0] && translations[0].detected_source_language
        ? translations[0].detected_source_language.toUpperCase()
        : sourceLang,
      target_lang: targetLang,
    };
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

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const apiKey = parts[0];
    const route = parts[1];

    if (route === 'translate') {
      if (!apiKey || apiKey !== env.API_KEY) {
        return json({ code: 401, message: 'Unauthorized' }, 401);
      }

      if (request.method !== 'POST') {
        return json({ code: 405, message: 'Method Not Allowed' }, 405);
      }

      try {
        const { text, source_lang, target_lang } = await request.json();
        const result = await translate(text, source_lang || 'AUTO', target_lang || 'ZH');
        return json({
          alternatives: result.alternatives,
          code: 200,
          message: 'success',
          data: result.text,
          id: Math.floor(Math.random() * 10000000000),
          method: 'Free',
          source_lang: result.source_lang,
          target_lang: target_lang || 'ZH',
        }, 200);
      } catch (error) {
        const msg = error.message || 'Translation failed';
        const status = msg.includes('exceeds maximum length') ? 413
          : msg.includes('unsupported') || msg.includes('cannot be') ? 400
          : msg.includes('Too many requests') ? 429
          : 500;
        return json({ code: status, message: msg }, status);
      }
    }

    return new Response('Not Found', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  },
};
