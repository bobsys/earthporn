exports.handler = async (event) => {
    const feedUrl = event.queryStringParameters?.url;

    if (!feedUrl) {
        return {
            statusCode: 400,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Missing 'url' parameter" }),
        };
    }

    try {
        // Convert Reddit .rss URLs to clean .json URLs automatically
        const targetUrl = feedUrl.includes('reddit.com/r/')
            ? feedUrl.replace(/\/?\.rss.*$/, '.json?limit=30')
            : feedUrl;

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EarthSlideshowBot/1.0; +https://netlify.app)',
                'Accept': 'application/json, application/rss+xml, text/xml'
            }
        });

        if (!response.ok) {
            return {
                statusCode: response.status,
                headers: { "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ error: `Source error ${response.status}`, details: response.statusText }),
            };
        }

        const text = await response.text();

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                // Cache on Netlify's CDN for 30 minutes so repeated refreshes don't hit Reddit
                "Cache-Control": "public, max-age=1800, s-maxage=1800"
            },
            body: text,
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Proxy Error", details: error.message }),
        };
    }
};
