// api/remove-bg.js
export const config = {
  api: {
    bodyParser: false, // Disables default body parsing for raw stream handling
  },
};

// Stream to Buffer helper with Abort / Error Guard
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const removeBgKey = process.env.REMOVEBG_API_KEY;
    if (!removeBgKey) {
      return res.status(500).json({
        error: 'API Key missing! Make sure REMOVEBG_API_KEY is set in .env',
      });
    }

    // 1. Read body buffer securely
    const rawBody = await getRawBody(req);
    const contentType = req.headers['content-type'];

    if (!contentType || !contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Invalid content-type. Expected multipart/form-data.' });
    }

    // 2. Fetch call with explicit Timeout (AbortSignal) to prevent hanging requests
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s timeout

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': removeBgKey,
        'Content-Type': contentType,
        'Accept': 'image/png',
      },
      body: rawBody,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // 3. Error Handling from Remote API
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Remove.bg API Error:', errorText);
      return res.status(response.status).json({
        error: `Remove.bg Error (${response.status}): ${errorText || 'Failed to process image'}`,
      });
    }

    // 4. FAST PIPING: Direct Stream Buffer Output
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    // Convert Web ReadableStream directly to Node Buffer and send
    const imageArrayBuffer = await response.arrayBuffer();
    return res.status(200).send(Buffer.from(imageArrayBuffer));

  } catch (error) {
    console.error('Server Proxy Error:', error);

    if (error.name === 'AbortError') {
      return res.status(504).json({ error: 'Processing timeout from API server.' });
    }

    return res.status(500).json({ 
      error: error.message || 'Internal Proxy Server Error' 
    });
  }
}