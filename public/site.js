document.querySelectorAll('.track-cover img').forEach((image) => {
  const cover = image.closest('.track-cover');
  const markMissing = () => cover?.classList.add('is-missing');
  if (image.complete && image.naturalWidth === 0) markMissing();
  image.addEventListener('error', markMissing, { once: true });
});
