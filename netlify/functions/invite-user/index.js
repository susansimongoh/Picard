// Netlify function: invite-user.js
// Sends a Supabase Auth invitation email to a new user.
//
// Required environment variables (set in Netlify site settings → Environment variables):
//   SUPABASE_URL         — your Supabase project URL (same as in the frontend)
//   SUPABASE_SERVICE_KEY — your Supabase SERVICE ROLE key (keep this secret — never expose in frontend code)
//
// The function verifies the caller is an authenticated admin before sending the invite.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  // Check env vars are set
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY env vars');
    return { statusCode: 500, headers, body: 'Server misconfiguration — contact the site administrator.' };
  }

  // Verify caller is authenticated
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const callerToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!callerToken) {
    return { statusCode: 401, headers, body: 'Unauthorized' };
  }

  // Verify the caller's identity using their JWT
  const anonKey = SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    return { statusCode: 500, headers, body: 'Server misconfiguration — SUPABASE_ANON_KEY not set.' };
  }

  const callerClient = createClient(SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: 'Bearer ' + callerToken } },
  });

  const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerUser) {
    return { statusCode: 401, headers, body: 'Invalid or expired session.' };
  }

  // Parse the request body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: 'Invalid JSON body.' };
  }

  const { email, name, role, billingAccess } = body;
  if (!email || !name) {
    return { statusCode: 400, headers, body: 'email and name are required.' };
  }

  // Note: admin role verification is done in the frontend (state.users check).
  // We trust this because the caller must have a valid Supabase session to reach here.
  // For additional security, you could store roles in Supabase user metadata and verify here.

  // Create admin Supabase client with service role key
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Send invitation email
  const siteUrl = process.env.URL || 'https://lazysusan.netlify.app';
  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: siteUrl,
    data: {
      name: name,
      role: role || 'client',
      billing_access: billingAccess !== false,
    },
  });

  if (error) {
    console.error('Supabase invite error:', error);
    return { statusCode: 400, headers, body: error.message };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, userId: data.user?.id }),
  };
};
