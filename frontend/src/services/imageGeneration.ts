export async function generateImage(prompt: string): Promise<string> {
  const response = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'ساخت عکس ناموفق بود.');
  }

  const data = await response.json();
  if (data.success && data.imageUrl) {
    return data.imageUrl;
  }

  throw new Error('لینک عکس دریافت نشد.');
}
