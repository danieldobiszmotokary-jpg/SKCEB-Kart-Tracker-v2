// Simple Node + Express server with a proxy endpoint to fetch Apex webpages.
// This avoids CORS issues when client-side JS fetches third-party Apex pages.

const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Proxy fetch endpoint: client POSTs { url: "https://..." }
app.post('/proxy-fetch', async (req, res) => {
  try {
    const url = req.body && req.body.url;
    if (!url) return res.status(400).json({ success: false, error: 'missing url' });
    const resp = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return res.json({ success: true, html: resp.data });
  } catch (err) {
    console.error('proxy-fetch error', err && err.message);
    return res.status(500).json({ success: false, error: 'fetch failed' });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

