const Parser = require('rss-parser');
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
});

exports.handler = async (event) => {
  const { url } = event.queryStringParameters;

  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing URL parameter' }),
    };
  }

  try {
    const feed = await parser.parseURL(url);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(feed),
    };
  } catch (error) {
    console.error('Error fetching RSS:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to fetch or parse RSS feed',
        details: error.message,
      }),
    };
  }
};