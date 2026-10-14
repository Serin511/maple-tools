import { calculatePotentialStrategy } from './potential-calculator.mjs';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, type: 'progress', message: '판매 정책과 기대 수익을 계산하고 있습니다…' });
    const result = calculatePotentialStrategy(data.settings);
    self.postMessage({ id: data.id, type: 'result', result });
  } catch (failure) {
    self.postMessage({ id: data.id, type: 'error', message: failure.message || '계산하지 못했습니다.' });
  }
};
