function decodeEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#8217;/g, '’')
        .replace(/&#8220;/g, '“')
        .replace(/&#8221;/g, '”')
        .replace(/&#8212;/g, '—')
        .trim();
}

exports.handler = async (event) => {
    const articleUrl = event.queryStringParameters?.url;
    if (!articleUrl) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing 'url' parameter" }) };
    }

    try {
        const res = await fetch(articleUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });

        if (!res.ok) {
            return { statusCode: res.status, body: JSON.stringify({ error: `Source returned HTTP ${res.status}` }) };
        }

        const html = await res.text();

        const getMeta = (name) => {
            const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["'](?<val>[^"']+)["']`, 'i');
            const r2 = new RegExp(`<meta[^>]+content=["'](?<val>[^"']+)["'][^>]+(?:property|name)=["']${name}["']`, 'i');
            const m = html.match(r1) || html.match(r2);
            return m?.groups?.val ? decodeEntities(m.groups.val) : null;
        };

        const title = getMeta('og:title') || decodeEntities(html.match(/<title[^>]*>(?<val>[\s\S]*?)<\/title>/i)?.groups?.val || '');
        const image = getMeta('og:image') || getMeta('twitter:image');
        const siteName = getMeta('og:site_name') || new URL(articleUrl).hostname.replace(/^www\./, '');

        // Strip scripts, styles, nav, headers, footers, and forms before extracting paragraphs
        const cleanedHtml = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<aside[\s\S]*?<\/aside>/gi, '');

        // Prefer <article> content if present; otherwise scan cleaned body
        const articleMatch = cleanedHtml.match(/<article[^>]*>(?<bodyHtml>[\s\S]*?)<\/article>/i);
        const targetHtml = articleMatch?.groups?.bodyHtml || cleanedHtml;

        const paragraphs = [];
        const pRegex = /<p[^>]*>(?<text>[\s\S]*?)<\/p>/gi;
        let match;

        while ((match = pRegex.exec(targetHtml)) !== null) {
            const cleanText = decodeEntities(
                (match.groups?.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
            );
            // Filter out short UI captions, cookie notices, and boilerplate
            if (cleanText.length < 45) continue;
            if (/^(sign up|subscribe|copyright|all rights reserved|advertisement|read more|share this)/i.test(cleanText)) continue;
            paragraphs.push(cleanText);
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=1800, s-maxage=1800"
            },
            body: JSON.stringify({
                title,
                image,
                siteName,
                paragraphs: paragraphs.slice(0, 40)
            })
        };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: "Reader Error", details: err.message }) };
    }
};
