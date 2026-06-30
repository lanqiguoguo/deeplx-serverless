/**
 * Tencent EdgeOne Edge Function — DeepL free translation proxy.
 *
 * 与 Cloudflare worker.js 同源逻辑,适配 EdgeOne 边缘函数运行时:
 *   - 入口用 ServiceWorker 风格 addEventListener('fetch')(EdgeOne 主流写法)
 *   - 无 env 参数,API_KEY 用顶部常量(或改用 EdgeOne 环境变量,见注释)
 *   - cookie 读取兼容 getSetCookie / get('set-cookie')
 *
 * 部署:EdgeOne 控制台 → 站点 → 边缘函数 → 新建函数 → 粘贴本文件 → 部署
 *       再在「规则引擎/路由」里把 `你的域名/<前缀>/*` 路由到该函数。
 * 调用:POST https://<你的域名>/<API_KEY>/translate
 *
 * ⚠️ 需在 EdgeOne 文档/控制台核对的点(见下方 ★ 标注)。
 */

// ★ API_KEY:最简单是直接改这里。若 EdgeOne 支持环境变量/密钥,优先用平台机制读取。
const API_KEY = 'CHANGE_ME';

const CHROME_EXTENSION_ID = 'cofdbpoegempjloogbncekinflcnj';
const CHROME_EXTENSION_VERSION = '1.86.0';
const IMPERSONATED_CHROME_MAJOR = '120';
const ONESHOT_FREE_ENDPOINT = 'https://oneshot-free.www.deepl.com/v1/translate';
const MAX_FREE_TEXT_LENGTH = 1500;

const INSTANCE_ID =
  (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'edg-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/' + IMPERSONATED_CHROME_MAJOR + '.0.0.0 Safari/537.36';

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
  'EN': 'en-US',
  'PT': 'pt-BR',
};

const sourceLangMap = Object.assign({}, targetLangMap, {
  'EN': 'en', 'PT': 'pt',
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

// 隔离实例级 cookie 状态(边缘 isolate 长驻,与 SCF/Workers 同理)
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
      // ★ getSetCookie 在 EdgeOne 若不可用则回退到 get
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
  if (!text || text.length === 0) throw new Error('No text to translate');
  if (text.length > MAX_FREE_TEXT_LENGTH) {
    throw new Error(
      'text exceeds maximum length: ' + text.length +
      ' characters (limit is ' + MAX_FREE_TEXT_LENGTH + ')'
    );
  }

  const resolvedTarget = resolveTargetLang(targetLang);
  const resolvedSource = resolveSourceLang(sourceLang);

  await warmCookies();

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
  if (resolvedSource) body.source_lang = resolvedSource;

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
  if (warmCookieJar) reqHeaders['Cookie'] = warmCookieJar;

  // ★ 若 EdgeOne 对第三方域子请求有限制,需在控制台放行 deepl.com
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
  const t = translations[0];
  if (!t.text) throw new Error('Translation failed: missing translation text');

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

async function handleRequest(request) {
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
    if (!apiKey || apiKey !== API_KEY) {
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
}

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});
