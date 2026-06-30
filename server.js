const express = require('express');
const bodyParser = require('body-parser');
const { translate } = require('./translate');

const app = express();
const PORT = process.env.PORT || 9000;

app.use(bodyParser.json());

app.post('/translate', async (req, res) => {
  const { text, source_lang, target_lang } = req.body;

  try {
    const result = await translate(text, source_lang || 'AUTO', target_lang || 'ZH');
    const responseData = {
      alternatives: result.alternatives,
      code: 200,
      message: 'success',
      data: result.text,
      id: Math.floor(Math.random() * 10000000000),
      method: 'Free',
      source_lang: result.source_lang,
      target_lang: target_lang || 'ZH',
    };
    res.json(responseData);
  } catch (error) {
    const msg = error.message || 'Translation failed';
    const status = msg.includes('exceeds maximum length') ? 413
      : msg.includes('unsupported') || msg.includes('cannot be') ? 400
      : msg.includes('Too many requests') ? 429
      : 500;
    res.status(status).json({ code: status, message: msg });
  }
});

app.listen(PORT, () => {
  console.log('Server is running on http://localhost:' + PORT);
});
