const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Endpoint to fetch and parse Apex Timing link
app.post('/fetch-laps', async (req, res) => {
    try {
        const { url } = req.body;
        const response = await axios.get(url);
        const html = response.data;
        const $ = cheerio.load(html);

        let kartData = [];

        // Universal parser: finds tables or divs with lap times
        $('tr').each((i, el) => {
            const tds = $(el).find('td');
            if (tds.length >= 3) {
                const number = $(tds[0]).text().trim();
                const transponder = $(tds[1]).text().trim();
                const lapTime = parseFloat($(tds[2]).text().trim());
                if (!isNaN(lapTime)) {
                    kartData.push({ number, transponder, lapTime });
                }
            }
        });

        res.json({ success: true, kartData });
    } catch (error) {
        console.error(error);
        res.json({ success: false, error: 'Failed to fetch Apex Timing data' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
