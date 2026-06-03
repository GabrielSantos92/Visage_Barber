export async function sendPushNotification(
  token: string | null | undefined,
  title: string,
  body: string,
) {
  if (!token) return;
  fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: token, title, body, sound: 'default' }),
  }).catch(() => {});
}
