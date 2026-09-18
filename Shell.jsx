import { useEffect, useState } from 'react';
import App from './App.jsx';
import AbilityPage from './AbilityPage.jsx';
export default function Shell() {
  const [page,setPage]=useState(()=>location.hash==='#/ability'?'ability':'potential');
  const [visited,setVisited]=useState(()=>({[page]:true}));
  useEffect(()=>setVisited(prev=>prev[page]?prev:{...prev,[page]:true}),[page]);
  useEffect(()=>{const onHash=()=>setPage(location.hash==='#/ability'?'ability':'potential');window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash);},[]);
  useEffect(()=>{document.title=page==='ability'?'어빌리티 최적 전략 | 메이플 계산기':'잠재능력 장사 | 메이플 계산기';},[page]);
  return <><nav aria-label="계산기 페이지" className="maple-nav"><a href="#/potential" className="maple-brand">🍁 메이플 계산기</a><div><a href="#/potential" aria-current={page==='potential'?'page':undefined}>잠재능력 장사</a><a href="#/ability" aria-current={page==='ability'?'page':undefined}>어빌리티 전략 <span>NEW</span></a></div></nav>
    <style>{`.maple-nav{font-family:'Apple SD Gothic Neo',system-ui,sans-serif;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px max(20px,calc((100% - 1240px)/2));background:#171c24;border-bottom:1px solid #2c3440;color:#e8e6df}.maple-nav a{color:#a8b1bd;text-decoration:none;font-size:13px;white-space:nowrap}.maple-nav .maple-brand{font-size:16px;font-weight:800;color:#eee}.maple-nav>div{display:flex;gap:22px;align-items:center}.maple-nav a[aria-current]{color:#ffac69}.maple-nav span{font-size:9px;color:#a58afa;margin-left:4px}@media(max-width:520px){.maple-nav{align-items:flex-start;flex-direction:column;gap:16px}.maple-nav>div{gap:24px}}`}</style>
    {(visited.potential||page==='potential')&&<div hidden={page!=='potential'}><App/></div>}
    {(visited.ability||page==='ability')&&<div hidden={page!=='ability'}><AbilityPage/></div>}</>;
}
