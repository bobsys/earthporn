const Parser = require('rss-parser');
const parser = new Parser({
    customFields: {
        item: [
            ['media:thumbnail', 'mediaThumbnail'],
            ['media:content', 'mediaContent'],
        ],
    }
});

exports.handler = async (event, context) => {
    const feedUrl = event.queryStringParameters.url;

    if (!feedUrl) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Missing 'url' parameter" }),
        };
    }

    try {
        const response = await fetch(feedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, text/html',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Cache-Control': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        if (!response.ok) {
            return {
                statusCode: response.status,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ error: `Source error ${response.status}`, details: response.statusText }),
            };
        }

        const xml = await response.text();
        const trimmedXml = xml.trim();

        try {
            const feed = await parser.parseString(trimmedXml);
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify(feed),
            };
        } catch (parseError) {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ error: "Parse Error", details: parseError.message, raw: trimmedXml.slice(0, 20000) }),
            };
        }
    } catch (error) {
        return {
            statusCode: 200,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Parse Error", details: error.message }),
        };
    }
};