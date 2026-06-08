// Envío de correos con Resend (https://resend.com) usando su API REST.
// Si no hay RESEND_API_KEY configurada, no falla: imprime el enlace en los logs
// (modo desarrollo) para poder probar el flujo sin enviar correos reales.

const FROM = process.env.MAIL_FROM || 'Mis Láminas <onboarding@resend.dev>';

function emailHtml(link) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0c1622;color:#eef2f7;padding:32px;border-radius:16px;max-width:480px;margin:auto">
    <h1 style="margin:0 0 6px;font-size:20px;color:#34d07f">⚽ Mis Láminas</h1>
    <p style="margin:0 0 20px;color:#9fb0c0">Mundial 2026</p>
    <p style="margin:0 0 22px;line-height:1.5">Toca el botón para entrar a tu colección. El enlace vence en <strong>15 minutos</strong> y solo sirve una vez.</p>
    <a href="${link}" style="display:inline-block;background:#34d07f;color:#06281a;font-weight:700;text-decoration:none;padding:13px 22px;border-radius:12px">Entrar a Mis Láminas</a>
    <p style="margin:22px 0 0;color:#6f8294;font-size:13px">Si no pediste este enlace, ignora este correo.</p>
  </div>`;
}

// Envía el enlace mágico. Devuelve { dev: true } si fue por consola (sin API key).
export async function sendMagicLink(email, link) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`\n🔗 [DEV] Enlace mágico para ${email}:\n   ${link}\n`);
    return { dev: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: 'Tu enlace para entrar a Mis Láminas',
      html: emailHtml(link),
      text: `Entra a Mis Láminas con este enlace (vence en 15 minutos, un solo uso):\n${link}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend respondió ${res.status}: ${body}`);
  }
  return { dev: false };
}
