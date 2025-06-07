import { z } from 'zod';

interface ApprovalDialogOptions {
  clientId: string;
  clientName?: string;
  clientWebsite?: string;
  redirectUris?: string[];
  scopes?: string[];
}

// Helper to encode state data
export function encodeState(data: any): string {
  return btoa(JSON.stringify(data));
}

// Helper to decode state data
export function decodeState(encoded: string): any {
  try {
    return JSON.parse(atob(encoded));
  } catch {
    return null;
  }
}

// Check if a client ID has already been approved
export async function clientIdAlreadyApproved(
  request: Request,
  clientId: string,
  cryptoKey: CryptoKey
): Promise<boolean> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return false;

  const cookies = new Map();
  cookieHeader.split(';').forEach(cookie => {
    const [name, value] = cookie.trim().split('=');
    if (name && value) {
      cookies.set(name, decodeURIComponent(value));
    }
  });

  const approvedCookie = cookies.get('mcp-approved-clients');
  if (!approvedCookie) return false;

  try {
    const [clientIds, signature] = approvedCookie.split('.');
    
    // Verify signature
    const encoder = new TextEncoder();
    const data = encoder.encode(clientIds);
    const signatureBytes = new Uint8Array(atob(signature).split('').map(c => c.charCodeAt(0)));
    
    const isValid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, data);
    if (!isValid) return false;

    const approvedList = JSON.parse(atob(clientIds));
    return approvedList.includes(clientId);
  } catch {
    return false;
  }
}

// Render OAuth approval dialog
export function renderApprovalDialog(options: ApprovalDialogOptions): string {
  const { clientId, clientName, clientWebsite, redirectUris, scopes } = options;
  
  const scopesList = scopes && scopes.length > 0 
    ? scopes.map(scope => `<li>${sanitizeHtml(scope)}</li>`).join('')
    : '<li>No specific scopes requested</li>';

  const redirectUrisList = redirectUris && redirectUris.length > 0
    ? redirectUris.map(uri => `<li>${sanitizeHtml(uri)}</li>`).join('')
    : '<li>No redirect URIs specified</li>';

  return `
<!DOCTYPE html>
<html>
<head>
    <title>Authorize Application</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }
        .card {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
        }
        .app-info {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
        }
        .permissions {
            margin: 20px 0;
        }
        .permissions ul {
            margin: 10px 0;
            padding-left: 20px;
        }
        .actions {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-top: 30px;
        }
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            font-size: 16px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            text-align: center;
        }
        .btn-primary {
            background: #007bff;
            color: white;
        }
        .btn-secondary {
            background: #6c757d;
            color: white;
        }
        .btn:hover {
            opacity: 0.9;
        }
        .client-id {
            font-family: monospace;
            font-size: 14px;
            background: #f1f3f4;
            padding: 4px 8px;
            border-radius: 3px;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <h1>🔐 Authorize Application</h1>
            <p>An application is requesting access to your account.</p>
        </div>

        <div class="app-info">
            <h3>Application Details</h3>
            <p><strong>Name:</strong> ${sanitizeHtml(clientName || 'Unknown Application')}</p>
            ${clientWebsite ? `<p><strong>Website:</strong> <a href="${sanitizeHtml(clientWebsite)}" target="_blank">${sanitizeHtml(clientWebsite)}</a></p>` : ''}
            <p><strong>Client ID:</strong> <span class="client-id">${sanitizeHtml(clientId)}</span></p>
        </div>

        <div class="permissions">
            <h3>Requested Permissions</h3>
            <ul>
                ${scopesList}
            </ul>
        </div>

        <div class="permissions">
            <h3>Authorized Redirect URIs</h3>
            <ul>
                ${redirectUrisList}
            </ul>
        </div>

        <form method="POST" class="actions">
            <input type="hidden" name="client_id" value="${sanitizeHtml(clientId)}">
            <input type="hidden" name="action" value="approve">
            <button type="submit" class="btn btn-primary">✅ Authorize</button>
            <button type="button" class="btn btn-secondary" onclick="window.close()">❌ Deny</button>
        </form>
    </div>
</body>
</html>`;
}

// Parse redirect approval form submission
export async function parseRedirectApproval(
  request: Request,
  cryptoKey: CryptoKey
): Promise<{ approved: boolean; clientId: string; updatedCookie?: string }> {
  const formData = await request.formData();
  const clientId = formData.get('client_id') as string;
  const action = formData.get('action') as string;

  if (!clientId || action !== 'approve') {
    return { approved: false, clientId: clientId || '' };
  }

  // Get existing approved clients
  const cookieHeader = request.headers.get('Cookie');
  let approvedClients: string[] = [];

  if (cookieHeader) {
    const cookies = new Map();
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies.set(name, decodeURIComponent(value));
      }
    });

    const approvedCookie = cookies.get('mcp-approved-clients');
    if (approvedCookie) {
      try {
        const [clientIds, signature] = approvedCookie.split('.');
        const encoder = new TextEncoder();
        const data = encoder.encode(clientIds);
        const signatureBytes = new Uint8Array(atob(signature).split('').map(c => c.charCodeAt(0)));
        
        const isValid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, data);
        if (isValid) {
          approvedClients = JSON.parse(atob(clientIds));
        }
      } catch {
        // Invalid cookie, start fresh
      }
    }
  }

  // Add new client if not already approved
  if (!approvedClients.includes(clientId)) {
    approvedClients.push(clientId);
  }

  // Create new signed cookie
  const clientIds = btoa(JSON.stringify(approvedClients));
  const encoder = new TextEncoder();
  const data = encoder.encode(clientIds);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  
  const cookieValue = `${clientIds}.${signatureB64}`;
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1); // 1 year

  const updatedCookie = `mcp-approved-clients=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`;

  return {
    approved: true,
    clientId,
    updatedCookie
  };
}

// Generate crypto key for signing
export async function generateCryptoKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign', 'verify']
  );
}

// Import crypto key from raw bytes
export async function importCryptoKey(keyBytes: ArrayBuffer): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    keyBytes,
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign', 'verify']
  );
}

// Sanitize HTML to prevent XSS
function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}