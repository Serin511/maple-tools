export const SITE_TITLE = '메이플 계산기';
export const SITE_DESCRIPTION = '메이플스토리 잠재능력·추가옵션 장사 수익과 어빌리티·추가옵션·에디셔널 효율 전략을 계산합니다.';

export const SITE_PREVIEW = {
  id: 'home',
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
};

export const CALCULATOR_PAGES = [
  {
    id: 'potential',
    label: '잠재능력 장사',
    title: '잠재능력 장사',
    description: '잠재능력 재설정 비용과 시세를 바탕으로 장사의 기대 수익과 판매 기준을 계산합니다.',
    accent: '#d99b62',
    summary: '재설정 비용과 판매 시세로 기대 수익을 비교합니다.',
  },
  {
    id: 'additional-trade',
    label: '에디셔널 잠재 장사',
    title: '에디셔널 잠재능력 장사',
    description: '에디셔널 잠재능력의 매입가·판매가·재설정 비용으로 기대 수익을 계산합니다.',
    accent: '#69b8a2',
    summary: '에디셔널 잠재능력 재설정의 기대 수익을 계산합니다.',
  },
  {
    id: 'flame-trade',
    label: '추가옵션 장사',
    title: '추가옵션 장사',
    description: '추가옵션 매입가와 시세를 바탕으로 기대 수익이 높은 판매 기준을 계산합니다.',
    accent: '#e28662',
    summary: '추가옵션의 재설정 수익과 판매 기준을 비교합니다.',
  },
  {
    id: 'ability',
    label: '어빌리티 전략',
    title: '어빌리티 최적 전략',
    description: '원하는 어빌리티 옵션을 얻는 기대 비용과 옵션 확보 순서를 계산합니다.',
    accent: '#9f8be0',
    summary: '목표 어빌리티를 위한 옵션 확보 순서와 기대 비용을 찾습니다.',
  },
  {
    id: 'flame',
    label: '추가옵션 효율 계산기',
    title: '추가옵션 효율 계산기',
    description: '내 스탯 효율과 재설정 비용을 반영해 추가옵션의 적절한 종료 기준을 계산합니다.',
    accent: '#ee9c69',
    summary: '내 스탯 효율과 비용으로 추가옵션 종료 기준을 계산합니다.',
  },
  {
    id: 'additional',
    label: '에디셔널 전략',
    title: '에디셔널 전략',
    description: '에디셔널 잠재능력의 스탯 효율과 재설정 비용을 바탕으로 멈출 기준을 비교합니다.',
    accent: '#69a9cc',
    summary: '에디셔널 잠재능력의 환산 효율과 재설정 기준을 비교합니다.',
  },
];

export const PAGE_BY_ID = Object.fromEntries(CALCULATOR_PAGES.map(page => [page.id, page]));
