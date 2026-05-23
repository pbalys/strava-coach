export async function POST(request) {
  const body = await request.json();
  const { endpoint, method = 'GET', tokenBody } = body;

  try {
    if (tokenBody) {
      // Token refresh
      const res = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokenBody)
      });
      const data = await res.json();
      return Response.json(data);
    }

    // API call
    const { accessToken, path } = body;
    const res = await fetch(`https://www.strava.com/api/v3${path}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
