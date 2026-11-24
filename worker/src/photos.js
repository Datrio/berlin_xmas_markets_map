const KEY = /^[a-z0-9-]+\.(jpg|webp)$/;

// Photo object keys in R2 look like <market-slug>-<hash8>.jpg; anything else is not read from the bucket.
export const isPhotoKey = (key) => typeof key === 'string' && KEY.test(key);

export const photoContentType = (key) => (key.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
