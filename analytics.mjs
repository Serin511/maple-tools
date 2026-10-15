const measurementId = process.env.GA4_MEASUREMENT_ID;
let initialized = false;
let previousLocation;

function isLocalPage() {
  const { protocol, hostname } = window.location;
  return !['https:', 'http:'].includes(protocol)
    || hostname === 'localhost' || hostname.endsWith('.localhost')
    || hostname === '[::1]' || hostname === '0.0.0.0' || /^127\./.test(hostname);
}

function initialReferrer() {
  if (!document.referrer) return '';
  try {
    const url = new URL(document.referrer);
    return ['https:', 'http:'].includes(url.protocol) ? `${url.origin}${url.pathname}` : '';
  } catch {
    return '';
  }
}

// Called by Shell after its title changes, using only a known calculator ID.
export function trackPageView(page) {
  if (!measurementId || isLocalPage()) return;
  const pageLocation = `${window.location.origin}${window.location.pathname}#/${page}`;
  if (pageLocation === previousLocation) return;

  const parameters = {
    page_title: document.title,
    page_location: pageLocation,
    page_referrer: previousLocation ?? initialReferrer(),
  };
  if (!initialized) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
  }
  // Keep automatic engagement events on the same canonical virtual page.
  window.gtag('set', parameters);
  if (!initialized) {
    // Shell owns initial and hash-route pageviews. Disable enhanced measurement
    // in the GA4 web stream as well, to avoid automatic duplicate pageviews.
    window.gtag('config', measurementId, { send_page_view: false });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(script);
    initialized = true;
  }
  window.gtag('event', 'page_view', { ...parameters, send_to: measurementId });
  previousLocation = pageLocation;
}
