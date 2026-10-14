# 공통 UI와 새 계산기 개발

다섯 계산기는 `ui.jsx`의 컴포넌트와 `ui.css`의 디자인 토큰·레이아웃을 공유한다. 기능마다 전체 페이지 스타일을 복사하지 않고 이 기반 위에 결과 표시와 계산 규칙을 추가한다. 메뉴 사이를 이동해도 방문한 페이지의 입력·결과는 유지한다.

## 페이지 구조

`Shell.jsx`의 `calculators` 목록에 `id`, 메뉴 `label`, 문서 `title`, 페이지 컴포넌트를 한 번 등록한다. 경로는 `#/id`이며 메뉴 선택 상태·브라우저 제목·방문 페이지 보존은 Shell이 처리한다. 각 페이지의 루트는 `main.calculator-page`다. 현재 보이는 페이지에 주 제목 `h1`과 main 영역이 하나씩 있어야 한다.

```jsx
import { CalculatorHeader, CalculatorCard, CalculateButton, CalculatorFooter } from './ui.jsx';

export default function ExamplePage() {
  return <main className="calculator-page example-page">
    <CalculatorHeader eyebrow="EXAMPLE STRATEGY" scope="지원 대상"
      title={<>새 기능 <em>계산기</em></>}
      description="필요한 입력과 계산 결과의 의미를 설명합니다." />
    <div className="calculator-layout">
      <section className="calculator-settings" aria-label="새 기능 계산 설정">
        <CalculatorCard><h2>입력 설정</h2>{/* 기능별 입력 */}</CalculatorCard>
        <CalculateButton onClick={calculate}>
          계산하기<span aria-hidden="true">→</span>
        </CalculateButton>
        <p className="calculator-status" role="status" aria-live="polite">{progress}</p>
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="calculator-results" aria-label="새 기능 계산 결과" aria-busy={busy}>
        <CalculatorCard>{/* 결과 또는 입력 대기·계산 진행 상태 */}</CalculatorCard>
      </section>
    </div>
    <CalculatorFooter />
  </main>;
}
```

이 예시의 `calculate`, `progress`, `error`, `busy`는 페이지에서 정의하는 상태와 동작이다. 카드가 `details` 또는 `div`여야 하면 `as="details"` 또는 `as="div"`를 지정한다. 페이지별 클래스는 도메인에 필요한 표·그래프·상태 색상에만 사용한다.

## 공통 컴포넌트

| 컴포넌트 | 주요 속성 | 사용 기준 |
| --- | --- | --- |
| `CalculatorHeader` | `eyebrow`, `scope`, `title`, `description` | 한 페이지에 한 번. 강조할 제목은 `em` 사용 |
| `CalculatorCard` | `as`, `className`, 일반 HTML 속성 | 설정·결과 패널. 여백·테두리는 공통 스타일 사용 |
| `CalculateButton` | `onClick`, `disabled`, `children` | 설정으로 계산·재계산하는 기본 동작 |
| `NumericField` | `label`, `value`, `onChange`, `unit`, `scale`, `min`, `max`, `step` | 숫자와 단위를 함께 입력. 상태는 숫자 또는 빈 문자열 |
| `PresetControls` | `names`, `presetName`, `setPresetName`, `selectedName`, `onSelect`, `onSave`, `onDelete` | 이름·Enter 저장·선택 적용·삭제를 같은 방식으로 제공 |
| `CharacterEfficiencySettings` | `settings`, `onChange`, `onMainStatChange`, `criticalDamageDisabled`, `children` | 두 에디셔널 메뉴의 공통 레벨·환산 효율 패널 |
| `CalculatorFooter` | `children` | 기본 브라우저 저장 안내 또는 기능별 안내 |

`NumericField`의 `scale`은 저장값을 화면에 표시할 배율이다. 예를 들어 메소를 억 메소로 입력하려면 `scale={1e-8}`, 1당 효율을 +10당 효율로 입력하려면 `scale={10}`이다. 빈칸을 자동으로 0으로 바꾸지 않고 검증에서 명시적으로 처리한다. 모든 입력은 보이는 label 또는 `aria-label`이 있어야 한다.

캐릭터 효율의 공통 기본값과 주스탯→부스탯 매핑은 `additional-data.mjs`에서 가져온다. 패널의 초기값·초기화 버튼·계산 엔진이 같은 기본값을 사용해야 한다. 드롭·메소는 이 환산 모델에 포함하지 않는다. 전략만의 쿨타임 환산 같은 추가 설정은 공통 패널의 `children`에 별도 영역으로 넣는다. 장사 메뉴는 네 주스탯의 가격 조건을 동시에 비교하므로 단일 주스탯 선택을 요구하지 않는다.

## 디자인 토큰과 반응형

공통 색·글꼴은 `ui.css`의 `--ui-*` 변수에 정의한다. 배경, 패널, 테두리, 본문·보조 글자, 강조 색을 개별 페이지에 다시 하드코딩하지 않는다. 공통 CSS는 Shell에서 기능별 CSS 뒤에 가져온다. 기본 화면은 최대 1240px, 설정 350px + 결과 영역, 간격 22px이고 740px 이하에서는 한 열로 바뀐다. 375px에서도 문서 전체가 가로로 넘치지 않아야 한다. 넓은 확률표·가격표는 해당 카드 안에서만 가로 스크롤한다.

키보드 focus가 보이게 하고, 선택 버튼에는 `aria-pressed`, 스위치에는 `role="switch"`와 `aria-checked`를 사용한다. 세부 설명을 여는 기능은 버튼·details로 조작 가능해야 하며 마우스 hover만으로 제공하지 않는다. 터치 환경의 최소 입력·버튼 높이는 44px이고 움직임 줄이기 설정을 존중한다.

## 계산·입력·저장 동작

- 현재 입력의 오류는 `role="alert"`, 준비·진행·완료는 `role="status"`로 표시한다. 서버·Worker가 시작됐다는 이유만으로 계산 완료로 표시하지 않는다.
- 입력이 달라지거나 재계산하면 이전 요청을 무효화하고 Worker를 종료한다. 요청 ID나 Worker identity가 일치하는 응답만 채택한다. 이전 결과와 새 입력의 확률·가격을 섞어서 표시하지 않는다.
- 잠재능력 장사는 시세 변경 시 자동 계산하며 같은 계산 버튼으로 재시도할 수 있다. 비용이 큰 계산은 UI 스레드에서 실행하지 않는다. 새 Worker는 `build.mjs`에서 번들링하고 `make_html.mjs`에 JSON script로 포함해야 한다.
- 정확 해석 기대값과 몬테카를로 백분위는 구분한다. 시뮬레이션 예산이 부족하면 정확 해석 결과는 유지하고 시뮬레이션만 안내한다.
- 저장된 JSON을 그대로 상태로 넣지 않는다. 배열·객체·enum·숫자를 정규화하고, 저장소 접근이 차단돼도 페이지가 동작해야 한다. 의도적으로 비운 행 배열 `[]`와 사용자 지정 효율 0은 유효한 값이다.
- 프리셋은 같은 이름 입력·저장·선택 후 즉시 적용·삭제 순서로 제공한다. 개별 브라우저에 저장되며 서버에 전송하지 않는다.

## 검증과 문서

계산 엔진은 JSX에서 분리한 순수 `.mjs` 모듈로 만든다. `npm test`에서 독립적인 수식·기하분포·확률 질량 보존 등으로 검증하고, 단순히 구현의 내부 배열을 복제한 테스트로 대체하지 않는다. 실제 확률 데이터의 출처·지원 범위·근사 가정은 `docs/*-model.md`에 기록한다.

`npm run test:ui`는 실제 프로덕션 HTML을 빌드하고 임시 HTTP 서버·Chromium을 생성·정리한다. 새 메뉴를 추가하면 `tests/browser/ui.test.mjs`의 경로 목록과 실제 계산 시나리오를 함께 추가한다. 제목·메뉴 상태, 모바일 폭, 대표 Worker 결과, 입력 오류와 복구, 저장·프리셋, 키보드 조작을 검증한다. CI와 main 배포는 엔진·브라우저 검증을 통과한 뒤 진행한다.
