import { calculateAdditionalStrategy } from './additional-calculator.mjs';

self.onmessage = ({ data: { id, settings } }) => {
  try {
    self.postMessage({ id, type: 'progress', message: '옵션 확률과 등급별 종료 전략을 계산하고 있습니다…' });
    self.postMessage({ id, type: 'result', result: calculateAdditionalStrategy(settings) });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message || '입력값을 확인해 주세요.' });
  }
};
