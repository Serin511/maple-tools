import { calculateFlameTrade } from './flame-trade-calculator.mjs';

self.onmessage = ({ data: { id, settings } }) => {
  try {
    self.postMessage({ id, type: 'progress', message: '추가옵션 확률과 판매 기준을 계산하고 있습니다…' });
    self.postMessage({ id, type: 'result', result: calculateFlameTrade(settings) });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message || '입력값을 확인해 주세요.' });
  }
};
