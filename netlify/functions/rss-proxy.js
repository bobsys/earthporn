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
            const isRedirect = res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308;
            if (isRedirect && res.headers.location && redirectsLeft > 0) {
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

function decodeEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}

async function enrichArticleMetadata(item) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);

        const res = await fetch(item.link, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });
        clearTimeout(timer);

        if (!res.ok) return item;

        const fullHtml = await res.text();
        const headHtml = fullHtml.slice(0, 60000);

        const getMeta = (attrName) => {
            const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${attrName}["'][^>]+content=["'](?<val>[^"']+)["']`, 'i');
            const r2 = new RegExp(`<meta[^>]+content=["'](?<val>[^"']+)["'][^>]+(?:property|name)=["']${attrName}["']`, 'i');
            const m = headHtml.match(r1) || headHtml.match(r2);
            return m?.groups?.val ? decodeEntities(m.groups.val) : null;
        };

        const ogImage = getMeta('og:image') || getMeta('twitter:image');
        const ogDesc = getMeta('og:description') || getMeta('description') || getMeta('twitter:description');
        let pubTime = getMeta('article:published_time') || getMeta('og:updated_time') || getMeta('date') || getMeta('pubdate');

        // Fallback: check JSON-LD structured data for datePublished
        if (!pubTime) {
            const jsonLdDate = headHtml.match(/"datePublished"\s*:\s*"(?<val>[^"]+)"/i);
            if (jsonLdDate?.groups?.val) pubTime = jsonLdDate.groups.val;
        }

        if (ogImage && !item.thumbnail) item.thumbnail = ogImage;
        if (ogDesc) item.contentSnippet = ogDesc;
        if (pubTime) item.pubDate = pubTime;
    } catch (e) {
        // Keep hub-extracted values if article page blocks or times out
    }
    return item;
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

    const isScrape = event.queryStringParameters?.scrape === '1' || rawFeedUrl.endsWith('#scrape');
    const feedUrl = rawFeedUrl.replace(/#scrape$/, '');

    try {
        // MODE 1: Raw XML mode for earth.html (Reddit)
        if (isRaw) {
            const targetUrl = feedUrl.replace('https://www.reddit.com/', 'https://old.reddit.com/');
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

        // MODE 2: Scrape a web page and enrich stories with images, summaries, and dates
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
            const rawItems = [];

            const linkRegex = /<a\s+[^>]*href=["'](?<href>[^"'#]+)["'][^>]*>(?<text>[\s\S]*?)<\/a>/gi;
            let match;

            while ((match = linkRegex.exec(html)) !== null) {
                const href = match.groups?.href?.trim();
                const rawText = match.groups?.text || '';
                const title = decodeEntities(rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

                if (!href || title.length < 28 || title.length > 180) continue;

                try {
                    const fullUrl = new URL(href, baseUrl.origin).toString();
                    if (!fullUrl.startsWith(baseUrl.origin)) continue;
                    if (seenUrls.has(fullUrl)) continue;
                    if (/\/(schedule|roster|stats|standings|tickets|shop|video|player|_\/id)\b/i.test(fullUrl)) continue;

                    // Extract nearby image or paragraph summary from the surrounding card on the hub page
                    const contextWindow = html.slice(Math.max(0, match.index - 700), Math.min(html.length, match.index + 700));
                    const inlineImgMatch = contextWindow.match(/<img[^>]+(?:src|data-src)=["'](?<src>https?:\/\/[^"']+)["']/i);
                    const inlineDescMatch = contextWindow.match(/<p[^>]*>(?<desc>[\s\S]{30,260}?)<\/p>/i);

                    const fallbackDesc = inlineDescMatch?.groups?.desc
                        ? decodeEntities(inlineDescMatch.groups.desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
                        : `Story from ${baseUrl.hostname}`;

                    seenUrls.add(fullUrl);
                    rawItems.push({
                        title: title,
                        link: fullUrl,
                        pubDate: new Date().toISOString(),
                        thumbnail: inlineImgMatch?.groups?.src || null,
                        contentSnippet: fallbackDesc
                    });
                } catch (e) {}
            }

            // Enrich top 12 articles in parallel for og:image, og:description, and exact publish dates
            const topItems = rawItems.slice(0, 12);
            const enrichedItems = await Promise.all(topItems.map(item => enrichArticleMetadata(item)));

            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=900, s-maxage=900"
                },
                body: JSON.stringify({
                    title: `Stories from ${baseUrl.hostname}`,
                    items: enrichedItems
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
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "" },
                body: JSON.stringify(feed),
            };
        } catch (parseError) {
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "" },
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
