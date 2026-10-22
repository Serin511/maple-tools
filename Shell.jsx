import { useEffect, useState } from 'react';
import App from './App.jsx';
import AbilityPage from './AbilityPage.jsx';
import FlamePage from './FlamePage.jsx';
import AdditionalPage from './AdditionalPage.jsx';
import AdditionalTradePage from './AdditionalTradePage.jsx';
import FlameTradePage from './FlameTradePage.jsx';
import { trackPageView } from './analytics.mjs';
import './ui.css';

// Add future calculators here to share navigation, titles and page state retention.
const calculators = [
  { id: 'potential', label: '잠재능력 장사', title: '잠재능력 장사', Page: App },
  { id: 'additional-trade', label: '에디셔널 잠재 장사', title: '에디셔널 잠재능력 장사', Page: AdditionalTradePage },
  { id: 'flame-trade', label: '추가옵션 장사', title: '추가옵션 장사', Page: FlameTradePage },
  { id: 'ability', label: '어빌리티 전략', title: '어빌리티 최적 전략', Page: AbilityPage },
  { id: 'flame', label: '추가옵션 효율 계산기', title: '추가옵션 효율 계산기', Page: FlamePage },
  { id: 'additional', label: '에디셔널 전략', title: '에디셔널 전략', Page: AdditionalPage },
];
const pageFromHash = () => calculators.find(({ id }) => location.hash === `#/${id}`)?.id || 'potential';

export default function Shell() {
  const [page, setPage] = useState(pageFromHash);
  const [visited, setVisited] = useState(() => ({ [page]: true }));
  useEffect(() => setVisited(previous => previous[page] ? previous : { ...previous, [page]: true }), [page]);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    document.title = `${calculators.find(({ id }) => id === page).title} | 메이플 계산기`;
    trackPageView(page);
  }, [page]);
  return <>
    <nav aria-label="계산기 페이지" className="maple-nav">
      <a href="#/potential" className="maple-brand">🍁 메이플 계산기</a>
      <div>{calculators.map(({ id, label }) => <a key={id} href={`#/${id}`} aria-current={page === id ? 'page' : undefined}>{label}</a>)}</div>
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
