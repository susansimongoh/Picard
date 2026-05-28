// Netlify function: notify-billing
// Sends an email alert when a month's billing total falls below 80% of the monthly budget target.
//
// Required environment variables (set in Netlify site settings → Environment variables):
//   RESEND_API_KEY       — API key from resend.com (create at resend.com/api-keys)
//   SUPABASE_URL         — your Supabase project URL
//   SUPABASE_ANON_KEY    — your Supabase anon/public key (used to verify the caller's session)
//
// The function verifies the caller is an authenticated user before sending any email.

const RESEND_API_KEY  = process.env.RESEND_API_KEY;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Sender address — update this once you've verified a domain in Resend.
// Until then, onboarding@resend.dev works for testing.
const FROM_ADDRESS = process.env.NOTIFY_FROM_EMAIL || 'onboarding@resend.dev';
const FROM_NAME    = process.env.NOTIFY_FROM_NAME  || 'Tote Board';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — billing alert not sent');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'RESEND_API_KEY not configured' }) };
  }

  // Verify the caller has a valid Supabase session
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${callerToken}` }
      });
      if (!verifyRes.ok) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired session' }) };
      }
    } catch (e) {
      console.error('Session verify error:', e);
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Could not verify session' }) };
    }
  }

  // Parse request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { recipientEmail, recipientName, month, monthTotal, threshold, monthlyBudget } = body;

  if (!recipientEmail || !month || monthTotal == null || !monthlyBudget) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: recipientEmail, month, monthTotal, monthlyBudget' }) };
  }

  const fmt = n => 'SGD ' + Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const emailHtml = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;color:#0d1424;">
  <div style="background:#003087;padding:24px 28px;border-radius:12px 12px 0 0;">
    <div style="color:#fff;font-size:18px;font-weight:700;">Billing update — ${month}</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #dde1ec;border-top:none;border-radius:0 0 12px 12px;">
    <p style="margin:0 0 20px;">Hi Will,</p>
    <p style="margin:0 0 24px;">${month}'s billing is currently below the 80% monthly budget threshold. We're currently at <strong>${fmt(monthTotal)}</strong> out of <strong>${fmt(monthlyBudget)}</strong> available.</p>
    <a href="https://lazysusan.netlify.app" style="display:inline-block;background:#003087;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Open Tote Board</a>
  </div>
</div>`;

  // Send via Resend
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_ADDRESS}>`,
        to: [recipientEmail],
        subject: `Billing update – ${month}`,
        html: emailHtml,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Resend error:', res.status, errBody);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Email send failed', detail: errBody }) };
    }

    const data = await res.json();
    console.log('Billing alert sent to', recipientEmail, 'for', month, '| Resend ID:', data.id);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: data.id }) };

  } catch (e) {
    console.error('notify-billing error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error', detail: e.message }) };
  }
};
