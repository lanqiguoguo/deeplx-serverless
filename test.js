const { translate } = require('./translate');

;(async () => {
  // Example calls
  console.log(await translate('明天你好', 'ZH', 'EN'));
  console.log(
    await translate(
      'Generate a cryptographically strong random string',
      'EN',
      'ZH'
    )
  );
})();
