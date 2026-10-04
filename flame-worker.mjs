import { calculateFlameStrategy } from './flame-calculator.mjs';

self.onmessage = ({ data }) => {
  const { id, settings } = data;
  try {
    self.postMessage({ id, type: 'progress', message: '추가옵션 확률과 중단점을 계산하고 있습니다…' });
    self.postMessage({ id, type: 'result', result: calculateFlameStrategy(settings) });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message || '계산에 실패했습니다. 입력값을 확인해 주세요.' });
  }
};
