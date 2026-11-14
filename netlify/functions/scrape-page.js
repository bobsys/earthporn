function decodeEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .trim();
}

async function enrichArticle(item) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(item.link, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            }
        });
        clearTimeout(timer);
        if (!res.ok) return item;

        const head = (await res.text()).slice(0, 60000);
        const getMeta = (name) => {
            const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["'](?<val>[^"']+)["']`, 'i');
            const r2 = new RegExp(`<meta[^>]+content=["'](?<val>[^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i');
            const m = head.match(r1) || head.match(r2);
            return m?.groups?.val ? decodeEntities(m.groups.val) : null;
        };

        const ldDesc = head.match(/"description"\s*:\s*"(?<val>[^"]{25,300})"/i)?.groups?.val;
        const firstPara = head.match(/<p[^>]*>(?<val>[^<]{40,280})<\/p>/i)?.groups?.val;
        const desc = getMeta('og:description') || getMeta('description') || ldDesc || firstPara;

        const img = getMeta('og:image') || getMeta('twitter:image');
        const ldDate = head.match(/"datePublished"\s*:\s*"(?<val>[^"]+)"/i)?.groups?.val;
        const pub = getMeta('article:published_time') || getMeta('og:updated_time') || ldDate;

        if (img) item.thumbnail = img;
        if (desc) item.contentSnippet = desc;
        if (pub) item.pubDate = pub;
    } catch (e) {}
    return item;
}

exports.handler = async (event) => {
    const rawUrl = event.queryStringParameters?.url;
    if (!rawUrl) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing 'url' parameter" }) };
    }

    const pageUrl = rawUrl.replace(/#scrape$/, '');

    try {
        const res = await fetch(pageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html'
            }
        });
        if (!res.ok) {
            return { statusCode: res.status, body: JSON.stringify({ error: `Source error ${res.status}` }) };
        }

        const html = await res.text();
        const base = new URL(pageUrl);
        const seen = new Set();
        const rawItems = [];

        const linkRegex = /<a\s+[^>]*href=["'](?<href>[^"'#]+)["'][^>]*>(?<text>[\s\S]*?)<\/a>/gi;
        let match;

        while ((match = linkRegex.exec(html)) !== null) {
            const href = match.groups?.href?.trim();
            const title = decodeEntities((match.groups?.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
            if (!href || title.length < 28 || title.length > 180) continue;

            try {
                const fullUrl = new URL(href, base.origin).toString();
                if (!fullUrl.startsWith(base.origin) || seen.has(fullUrl)) continue;
                if (/\/(schedule|roster|stats|standings|tickets|shop|video|player|_\/id)\b/i.test(fullUrl)) continue;

                const win = html.slice(Math.max(0, match.index - 700), Math.min(html.length, match.index + 700));
                const imgMatch = win.match(/<img[^>]+(?:src|data-src)=["'](?<src>https?:\/\/[^"']+)["']/i);
                const descMatch = win.match(/<p[^>]*>(?<desc>[\s\S]{30,260}?)<\/p>/i);

                seen.add(fullUrl);
                rawItems.push({
                    title,
                    link: fullUrl,
                    pubDate: new Date().toISOString(),
                    thumbnail: imgMatch?.groups?.src || null,
                    contentSnippet: descMatch?.groups?.desc
                        ? decodeEntities(descMatch.groups.desc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
                        : `Story from ${base.hostname}`
                });
            } catch (e) {}
        }

        const items = await Promise.all(rawItems.slice(0, 12).map(enrichArticle));

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=900, s-maxage=900"
            },
            body: JSON.stringify({ title: `Stories from ${base.hostname}`, items })
        };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: "Scrape Error", details: err.message }) };
    }
};
