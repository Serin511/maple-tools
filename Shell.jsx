import { useEffect, useState } from 'react';
import App from './App.jsx';
import AbilityPage from './AbilityPage.jsx';
import FlamePage from './FlamePage.jsx';
import AdditionalPage from './AdditionalPage.jsx';
import AdditionalTradePage from './AdditionalTradePage.jsx';
import FlameTradePage from './FlameTradePage.jsx';
import { trackPageView } from './analytics.mjs';
import { CALCULATOR_PAGES, PAGE_BY_ID, SITE_TITLE } from './calculator-pages.mjs';
import { getBasePath, pageFromPath, pagePath } from './routing.mjs';
import './ui.css';

const pageComponents = {
  potential: App,
  'additional-trade': AdditionalTradePage,
  'flame-trade': FlameTradePage,
  ability: AbilityPage,
  flame: FlamePage,
  additional: AdditionalPage,
};
const calculators = CALCULATOR_PAGES.map(page => ({ ...page, Page: pageComponents[page.id] }));
const pageIds = CALCULATOR_PAGES.map(({ id }) => id);
const hashPage = () => window.location.hash.startsWith('#/')
  ? PAGE_BY_ID[window.location.hash.slice(2).split(/[/?&]/, 1)[0]]?.id
  : undefined;
const routePage = () => pageFromPath(window.location.pathname, pageIds);
const pageFromLocation = () => hashPage() || routePage() || 'potential';

function cleanRoute(id, search = window.location.search) {
  return pagePath(window.location, id, pageIds, search);
}

function canonicalizeHashRoute(id) {
  if (window.location.protocol === 'file:') return;
  window.history.replaceState(null, '', cleanRoute(id));
}

function setMeta(selector, attributes, content) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function updatePageMetadata(page) {
  const canonicalUrl = window.location.protocol === 'file:'
    ? ''
    : `${window.location.origin}${cleanRoute(page.id, '')}`;
  const previewTitle = `${page.title} | ${SITE_TITLE}`;
  const description = page.description;
  document.title = previewTitle;
  setMeta('meta[name="description"]', { name: 'description' }, description);
  setMeta('meta[property="og:title"]', { property: 'og:title' }, page.title);
  setMeta('meta[property="og:description"]', { property: 'og:description' }, description);
  setMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, page.title);
  setMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, description);
  if (canonicalUrl) {
    let canonical = document.head.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
    const imageUrl = `${window.location.origin}${getBasePath(window.location.pathname, pageIds)}og/${page.id}.png`;
    setMeta('meta[property="og:url"]', { property: 'og:url' }, canonicalUrl);
    setMeta('meta[property="og:image"]', { property: 'og:image' }, imageUrl);
    setMeta('meta[property="og:image:alt"]', { property: 'og:image:alt' }, page.title);
    setMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, imageUrl);
    setMeta('meta[name="twitter:image:alt"]', { name: 'twitter:image:alt' }, page.title);
  }
}

export default function Shell() {
  const [page, setPage] = useState(() => {
    const selected = pageFromLocation();
    if (hashPage()) canonicalizeHashRoute(selected);
    return selected;
  });
  const [visited, setVisited] = useState(() => ({ [page]: true }));
  useEffect(() => setVisited(previous => previous[page] ? previous : { ...previous, [page]: true }), [page]);
  useEffect(() => {
    const onLocation = () => {
      const selected = pageFromLocation();
      if (hashPage()) canonicalizeHashRoute(selected);
      setPage(selected);
    };
    window.addEventListener('popstate', onLocation);
    window.addEventListener('hashchange', onLocation);
    return () => {
      window.removeEventListener('popstate', onLocation);
      window.removeEventListener('hashchange', onLocation);
    };
  }, []);
  useEffect(() => {
    const metadata = PAGE_BY_ID[page];
    updatePageMetadata(metadata);
    trackPageView(page);
  }, [page]);
  const navigate = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
      || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return;
    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin || window.location.protocol === 'file:') return;
    const match = calculators.find(({ id }) => destination.pathname === cleanRoute(id, '').split('?')[0]);
    if (!match) return;
    event.preventDefault();
    const nextPath = `${destination.pathname}${window.location.search}`;
    if (`${window.location.pathname}${window.location.search}` !== nextPath || window.location.hash) {
      window.history.pushState(null, '', nextPath);
    }
    setPage(match.id);
  };
  return <>
    <nav aria-label="계산기 페이지" className="maple-nav" onClick={navigate}>
      <a href={window.location.protocol === 'file:' ? '#/potential' : cleanRoute('potential')} className="maple-brand">🍁 메이플 계산기</a>
      <div>{calculators.map(({ id, label }) => <a key={id} href={window.location.protocol === 'file:' ? `#/${id}` : cleanRoute(id)} aria-current={page === id ? 'page' : undefined}>{label}</a>)}</div>
    </nav>
    {calculators.map(({ id, Page }) => (visited[id] || page === id) && <div key={id} hidden={page !== id}><Page /></div>)}
    <footer className="maple-site-footer">
      <div className="maple-site-footer-primary">
        <span>메이플 계산기</span>
        <nav aria-label="외부 링크">
          <a href="https://github.com/Serin511/maple-tools" target="_blank" rel="noopener noreferrer">GitHub · Serin511/maple-tools</a>
          <a href="mailto:serin.kim@celia.moe">Contact · serin.kim@celia.moe</a>
        </nav>
      </div>
      <div className="maple-site-footer-contributors">
        <span>Contributors</span>
        <nav aria-label="기여자 캐릭터">
          <a href="https://maplescouter.com/ko/info?name=%EC%84%B8%EB%A6%B0%EA%B2%B0" target="_blank" rel="noopener noreferrer">크로아@세린결</a>
          <a href="https://maplescouter.com/ko/info?name=%EC%BA%AC%EB%A5%98%EB%82%98" target="_blank" rel="noopener noreferrer">크로아@캬류나</a>
          <a href="https://maplescouter.com/ko/info?name=%EC%9D%B4%EB%AA%A8%EC%8A%A4%ED%95%9C%EB%B3%84%EB%B2%95" target="_blank" rel="noopener noreferrer">크로아@이모스한별법</a>
        </nav>
      </div>
    </footer>
  </>;
}
