// auto-resize.js — Reports iframe content height to parent window
// Sends both growth AND shrinkage so the iframe always fits content
(function() {
  var lastHeight = 0;
  var pending = false;

  function measureHeight() {
    // Use offsetHeight — reliably reflects visible content (display:none excluded)
    return Math.max(
      document.body.offsetHeight,
      document.body.scrollHeight,
      document.documentElement.offsetHeight
    );
  }

  function reportHeight() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function() {
      pending = false;
      var h = measureHeight();
      // Always send, even if smaller — that's how we shrink
      if (h > 0 && h !== lastHeight) {
        lastHeight = h;
        window.parent.postMessage({ type: 'iframe-resize', height: h, src: window.location.pathname }, '*');
      }
    });
  }

  window.addEventListener('load', reportHeight);
  window.addEventListener('resize', reportHeight);

  if (typeof MutationObserver !== 'undefined') {
    var timer;
    var observer = new MutationObserver(function() {
      clearTimeout(timer);
      timer = setTimeout(reportHeight, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  // Fallback — check every 500ms in case mutations are missed
  setInterval(reportHeight, 500);
})();
