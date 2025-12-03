// server.js - static server + proxy to fetch Apex pages (avoids CORS)
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/proxy-fetch', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ success: false, error: 'missing url' });
    const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return res.json({ success: true, html: r.data });
  } catch (err) {
    console.error('proxy-fetch error', err && err.message);
    return res.status(500).json({ success: false, error: 'fetch failed' });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
