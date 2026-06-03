/**
 * Renders the brief markdown into a polished HTML email.
 *
 * Uses inline styles for email client compatibility (no external CSS).
 */
import { marked } from 'marked';
import { format } from 'date-fns';

/**
 * @param {string|null} audioUrl  - public URL to the MP3 (e.g. https://rokt-daily.rokt.com/audio/brief-42.mp3)
 *                                  Pass null to omit the Listen button.
 */
export function renderHtml(exec, date, briefMd, sourceData, urgentFlags, audioUrl = null) {
  const html = marked.parse(briefMd);
  const formattedDate = format(new Date(date), 'EEEE, MMMM d, yyyy');
  const urgentSection = urgentFlags.length > 0
    ? `<div style="background:#fff0f0;border-left:4px solid #e53e3e;padding:12px 16px;margin-bottom:20px;border-radius:4px;">
        <strong style="color:#c53030">🚨 Urgent items flagged</strong>
        <ul style="margin:8px 0 0;padding-left:20px;color:#742a2a;">
          ${urgentFlags.map(f => `<li style="margin:4px 0">${escHtml(f)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rokt Daily — ${formattedDate}</title>
</head>
<body style="margin:0;padding:0;background:#f7f8fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fc;">
<tr><td align="center" style="padding:32px 16px;">

  <!-- Card -->
  <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);overflow:hidden;max-width:600px;">

    <!-- Header -->
    <tr>
      <td style="background:#1a1a2e;padding:28px 36px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px;">Rokt Daily</span>
              <span style="color:#6b7aff;font-size:14px;margin-left:10px;">for ${escHtml(exec.name)}</span>
            </td>
            <td align="right">
              <span style="color:#a0a8c0;font-size:12px;">${escHtml(formattedDate)}</span>
            </td>
          </tr>
          ${audioUrl ? `<tr><td colspan="2" style="padding-top:14px;">
            <a href="${audioUrl}" style="display:inline-block;background:#6b7aff;color:#ffffff;font-size:13px;font-weight:600;padding:8px 18px;border-radius:20px;text-decoration:none;letter-spacing:0.2px;">
              ▶&nbsp; Listen to your brief
            </a>
            <span style="color:#6b8098;font-size:11px;margin-left:12px;">~3 min · ElevenLabs</span>
          </td></tr>` : ''}
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding:28px 36px;">
        ${urgentSection}
        <div style="
          color:#1a1a2e;
          font-size:15px;
          line-height:1.7;
        ">
          ${patchHtml(html)}
        </div>
      </td>
    </tr>

    <!-- Source badges -->
    <tr>
      <td style="padding:0 36px 20px;">
        <div style="font-size:11px;color:#9aa0b0;">
          Sources pulled:
          ${Object.entries(sourceData)
            .map(([s, d]) => `<span style="display:inline-block;background:${d.error ? '#fef2f2' : '#f0f4ff'};color:${d.error ? '#b91c1c' : '#3730a3'};border-radius:4px;padding:2px 8px;margin:2px 3px;font-weight:600;">${s}${d.error ? ' ⚠' : ''}</span>`)
            .join('')}
        </div>
      </td>
    </tr>

    <!-- Q&A CTA -->
    <tr>
      <td style="background:#f0f4ff;padding:18px 36px;border-top:1px solid #e8ecf8;">
        <p style="margin:0;font-size:13px;color:#4a5568;">
          💬 <strong>Have a question?</strong> Reply to this email or message <code style="background:#e8ecf8;padding:1px 5px;border-radius:3px;">/ask-rokt-daily</code> in Slack.
        </p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:16px 36px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#c0c5d0;">
          Rokt Daily · Automated executive intelligence · ${new Date().getFullYear()}
        </p>
      </td>
    </tr>

  </table>
</td></tr>
</table>
</body>
</html>`;
}

function escHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Patch marked output with inline email-safe styles
function patchHtml(html) {
  return html
    .replace(/<h1>/g, '<h1 style="font-size:20px;font-weight:700;color:#1a1a2e;margin:24px 0 8px;">')
    .replace(/<h2>/g, '<h2 style="font-size:16px;font-weight:700;color:#2d3748;margin:20px 0 6px;border-bottom:1px solid #e8ecf8;padding-bottom:6px;">')
    .replace(/<h3>/g, '<h3 style="font-size:14px;font-weight:600;color:#4a5568;margin:16px 0 4px;">')
    .replace(/<p>/g, '<p style="margin:8px 0;color:#2d3748;">')
    .replace(/<ul>/g, '<ul style="margin:8px 0;padding-left:20px;">')
    .replace(/<li>/g, '<li style="margin:5px 0;color:#2d3748;">')
    .replace(/<strong>/g, '<strong style="color:#1a1a2e;">')
    .replace(/<code>/g, '<code style="background:#f0f4ff;padding:1px 5px;border-radius:3px;font-size:13px;color:#3730a3;">');
}
