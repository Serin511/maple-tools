import { calculateAdditionalTrade } from './additional-trade-calculator.mjs';

self.onmessage = ({ data: { id, settings } }) => {
  try {
    self.postMessage({ id, type: 'progress', message: '옵션 확률, 등급업과 가격 조건을 계산하고 있습니다…' });
    self.postMessage({ id, type: 'result', result: calculateAdditionalTrade(settings) });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message || '입력값을 확인해 주세요.' });
  }
};
