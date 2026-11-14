const https = require('https');
const Parser = require('rss-parser');

const parser = new Parser({
    customFields: {
        item: [
            ['media:thumbnail', 'mediaThumbnail'],
            ['media:content', 'mediaContent'],
        ],
    }
});

function fetchUrl(url, redirectsLeft = 3) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'web:earth-slideshow-viewer:v1.0.0 (by /u/earth_viewer_app)',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'close'
            },
            timeout: 8000
        }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
                const nextUrl = new URL(res.headers.location, url).toString();
                res.resume();
                return resolve(fetchUrl(nextUrl, redirectsLeft - 1));
            }

            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, statusMessage: res.statusMessage, body: data }));
        });

        req.on('timeout', () => req.destroy(new Error('Request timed out after 8s')));
        req.on('error', (err) => reject(err));
    });
}

exports.handler = async (event) => {
    const rawFeedUrl = event.queryStringParameters?.url;
    const isRaw = event.queryStringParameters?.raw === '1';

    if (!rawFeedUrl) {
        return {
            statusCode: 400,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Missing 'url' parameter" }),
        };
    }

    // Check if the URL has '#scrape' appended (or ?scrape=1)
    const isScrape = event.queryStringParameters?.scrape === '1' || rawFeedUrl.endsWith('#scrape');
    const feedUrl = rawFeedUrl.replace(/#scrape$/, '');

    try {
        // MODE 1: Raw XML mode for earth.html (Reddit)
        if (isRaw) {
            const targetUrl = feedUrl.replace('https://reddit.com', 'https://reddit.com');
            const result = await fetchUrl(targetUrl);

            if (result.status < 200 || result.status >= 300) {
                return {
                    statusCode: result.status,
                    headers: { "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({
                        error: `Source error ${result.status}`,
                        details: result.statusMessage || `HTTP ${result.status}`
                    }),
                };
            }

            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/xml; charset=utf-8",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=1800, s-maxage=1800"
                },
                body: result.body,
            };
        }

        // MODE 2: Scrape a team hub web page into RSS-style JSON items
        if (isScrape) {
            const response = await fetch(feedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml'
                }
            });

            if (!response.ok) {
                return {
                    statusCode: response.status,
                    headers: { "Access-Control-Allow-Origin": "*" },
                    body: JSON.stringify({ error: `Source error ${response.status}` }),
                };
            }

            const html = await response.text();
            const baseUrl = new URL(feedUrl);
            const seenUrls = new Set();
            const items = [];

            const linkRegex = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            let match;

            while ((match = linkRegex.exec(html)) !== null) {
                const href = match[1].trim();
                const title = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

                if (title.length < 28 || title.length > 180) continue;

                try {
                    const fullUrl = new URL(href, baseUrl.origin).toString();
                    if (!fullUrl.startsWith(baseUrl.origin)) continue;
                    if (seenUrls.has(fullUrl)) continue;
                    if (/\/(schedule|roster|stats|standings|tickets|shop|video)\b/i.test(fullUrl)) continue;

                    seenUrls.add(fullUrl);
                    items.push({
                        title: title,
                        link: fullUrl,
                        pubDate: new Date().toISOString(),
                        contentSnippet: `Story from ${baseUrl.hostname}`
                    });
                } catch (e) {}
            }

            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=900, s-maxage=900"
                },
                body: JSON.stringify({
                    title: `Stories from ${baseUrl.hostname}`,
                    items: items.slice(0, 25)
                }),
            };
        }

        // MODE 3: Standard JSON parsed mode for regular RSS feeds
        const response = await fetch(feedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/rss+xml, application/xml, text/xml, text/html',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://google.com',
                'Cache-Control': 'no-cache'
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
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Proxy Error", details: error.message }),
        };
    }
};
