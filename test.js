const { translate } = require('./translate');

;(async () => {
  // Single string
  console.log(await translate('明天你好', 'ZH', 'EN'));
  console.log(await translate('Generate a cryptographically strong random string', 'EN', 'ZH'));

  // Array (batch) — DeepLX-style multi-paragraph input.
  // Returns { text: [...], alternatives: [[...], ...], ... }
  console.log(await translate(['hello world', 'goodbye', 'thank you'], 'EN', 'ZH'));
})();
