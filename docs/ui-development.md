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
| `TradePriceEditor` | `description`, `actions`, `gradeOptions`, `gradeValue`, `onGradeChange`, `children` | 오른쪽 넓은 판매가 카드·등급 선택·시세 입력 안내를 공유 |
| `TradeEquipmentSettings` | `values`, `onChange`, `levelOptions`, `partOptions`, `startGradeOptions`, `pityFields`, `labels` | 장사 메뉴의 매입가·장비·실패 스택·수수료·처분가를 같은 순서로 입력 |
| `TradeResetCostSettings` | `costs`, `note` | 등급별 재설정 비용을 같은 카드·정렬로 입력 |
| `PityStackFields` | `fields` | 현재 등급부터 도달 가능한 천장 스택을 장비 설정에서 입력 |
| `ToggleField` | `on`, `onChange`, `label`, `color`, `description` | 미라클·판매 정책·결과 유지 옵션을 같은 스위치로 제공 |
| `PrimeCubeSettings` | `prime`, `onChange`, `options`, `label`, `priceLabel`, `description`, `optimization` | 세 잠재능력 메뉴의 프라임 활성화·가격·고정 첫 줄 선택·최적화 결과를 공유 |
| `CharacterEfficiencySettings` | `settings`, `onChange`, `onMainStatChange`, `criticalDamageDisabled`, `children` | 두 에디셔널 메뉴의 공통 레벨·환산 효율 패널 |
| `CalculatorFooter` | `children` | 기본 브라우저 저장 안내 또는 기능별 안내 |

`NumericField`의 `scale`은 저장값을 화면에 표시할 배율이다. 예를 들어 메소를 억 메소로 입력하려면 `scale={1e-8}`, 1당 효율을 +10당 효율로 입력하려면 `scale={10}`이다. 빈칸을 자동으로 0으로 바꾸지 않고 검증에서 명시적으로 처리한다. 모든 입력은 보이는 label 또는 `aria-label`이 있어야 한다.

장사 메뉴는 **장비 설정**에서 매입가→레벨 제한→착용 부위→시작 등급(필요한 메뉴만)→현재 실패 스택→수수료→처분가 순서를 공유한다. `TradeEquipmentSettings`의 금액은 메소 단위이며 화면에서 억 메소로 변환한다. 일반 잠재능력의 기존 억 단위 문자열 저장 형식은 페이지 어댑터에서만 변환하고, 빈 문자열을 0으로 바꾸지 않는다. 레벨·부위 선택지는 각 계산기의 실제 지원 범위를 전달한다. 현재 등급보다 낮은 스택은 화면에서 숨겨도 저장된 값을 유지한다.

두 장사 메뉴의 **판매가**는 `TradePriceEditor.jsx`를 사용해 `calculator-results`의 첫 카드로 둔다. 설정 패널 옆의 넓은 영역을 쓰고, 모바일에서는 한 열의 전체 폭을 쓴다. 제목·억 메소 단위·등급 버튼·설명·입력 보존 안내와 계산 버튼 위치는 공통으로 제공한다. 일반 잠재능력의 스탯 가격표와 에디셔널의 추가·삭제 가능한 조건 행은 각 모델에 맞는 본문으로 전달한다. 등급 버튼은 `aria-pressed`로 선택을 공개하며, 페이지별 별도 카드 크기나 좁은 사이드바로 판매가 입력을 옮기지 않는다.

두 에디셔널 화면의 등급업 확률과 천장 한도는 고정값이다. 설정·프리셋을 복원할 때 고정값으로 적용하며 현재 스택과 수정한 비용은 보존한다. 스택은 장비 설정에서만 수정하고, **재설정 비용**에는 비용만 둔다. 엔진의 합성 확률·천장 테스트용 API와 사용자가 조작하는 UI 설정을 구분한다.

캐릭터 효율의 공통 기본값과 주스탯→부스탯 매핑은 `additional-data.mjs`에서 가져온다. 패널의 초기값·초기화 버튼·계산 엔진이 같은 기본값을 사용해야 한다. 드롭·메소는 이 환산 모델에 포함하지 않는다. 전략만의 쿨타임 환산 같은 추가 설정은 공통 패널의 `children`에 별도 영역으로 넣는다. 장사 메뉴는 네 주스탯의 가격 조건을 동시에 비교하므로 단일 주스탯 선택을 요구하지 않는다.

프라임 설정은 `PrimeCubeSettings`에 `{ on, cost, fixedKey }`를 전달한다. `cost`는 메소 단위이며 `NumericField`에서 억 메소로 표시한다. 일반 잠재능력의 기존 `primeOn`·`primeCostEok`·`primeFixed` 저장 형식은 페이지에서만 변환한다. 에디셔널은 `settings.prime` 객체를 저장하고 기본 가격은 14억 메소다. 공통 컴포넌트는 모드를 켤 때 `fixedKey: 'auto'`를 선택하고, **고정할 1줄 옵션**의 첫 항목으로 **자동 최적화**를 제공한다. 저장된 유효한 수동 선택을 복원할 때는 이 활성화 동작을 다시 실행하지 않는다.

고정 후보는 각 모델의 현재 부위·레벨에서 실제 가능한 레전드리 첫 줄 목록을 전달한다. 옵션 이름을 임의로 합치거나 같은 환산 점수라는 이유로 후보를 합치지 않는다. 장비 변경으로 수동 후보가 무효가 되면 자동 최적화로 돌아간다. 선택한 옵션·프라임 미사용과 비교한 이득은 엔진이 반환한 `optimization`으로 표시하며 화면에서 다시 계산하지 않는다. 장사 모델의 목적은 총 재설정 횟수당 기대 이득이고, 전략 모델의 목적은 스탯 상승의 가치에서 총비용을 뺀 기대값이다. 프라임 사용이 유리하지 않으면 미사용 판단을 설명한다.

## 디자인 토큰과 반응형

공통 색·글꼴은 `ui.css`의 `--ui-*` 변수에 정의한다. 배경, 패널, 테두리, 본문·보조 글자, 강조 색을 개별 페이지에 다시 하드코딩하지 않는다. 공통 CSS는 Shell에서 기능별 CSS 뒤에 가져온다. 기본 화면은 최대 1240px, 설정 350px + 결과 영역, 간격 22px이고 740px 이하에서는 한 열로 바뀐다. 375px에서도 문서 전체가 가로로 넘치지 않아야 한다. 넓은 확률표·가격표는 해당 카드 안에서만 가로 스크롤한다.

키보드 focus가 보이게 하고, 선택 버튼에는 `aria-pressed`, 스위치에는 `role="switch"`와 `aria-checked`를 사용한다. 세부 설명을 여는 기능은 버튼·details로 조작 가능해야 하며 마우스 hover만으로 제공하지 않는다. 터치 환경의 최소 입력·버튼 높이는 44px이고 움직임 줄이기 설정을 존중한다.

숫자 입력은 공통 CSS에서 브라우저의 증감 화살표를 숨긴다. 새 숫자 입력도 `NumericField`를 사용하고 각 페이지에서 spinner 스타일을 다시 정의하지 않는다.

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

공통 설정을 검증할 때는 `main:visible` 안에서 컨트롤을 찾는다. Shell이 이전 페이지를 유지하므로 같은 이름의 입력이 숨겨진 페이지에도 있을 수 있다. 프라임 회귀에는 활성화 시 자동 선택, 14억 기본 가격, 수동 선택의 저장·복원, 부위·레벨 변경에 따른 후보 갱신, 실제 Worker의 프라임 결과를 포함한다.
