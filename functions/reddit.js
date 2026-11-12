exports.handler = async function (event) {
  const sub = event.queryStringParameters?.sub;

  if (!sub || !/^[a-zA-Z0-9_]+$/.test(sub)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid subreddit name" })
    };
  }

  try {
    const response = await fetch(`https://www.reddit.com/r/${sub}.json?limit=25`, {
      headers: {
        "User-Agent": "web:earth-slideshow-app:v1.0 (by /u/netlify_user)"
      }
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Reddit returned ${response.status}` })
      };
    }

    const json = await response.json();
    const posts = json?.data?.children || [];

    const items = posts
      .map(post => post.data)
      .filter(data => data.url && /\.(jpg|jpeg|png)$/i.test(data.url) && data.url.includes("i.redd.it"))
      .map(data => ({
        url: data.url,
        sub: sub,
        date: new Date(data.created_utc * 1000).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric"
        })
      }));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=1800, s-maxage=1800"
      },
      body: JSON.stringify(items)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
