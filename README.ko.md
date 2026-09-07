# file2md

PDF, DOCX, XLSX, PPTX, HWP, HWPX 문서를 Node.js에서 Markdown으로 변환합니다.
검색, 지식 베이스, 콘텐츠 처리에 사용할 문서를 준비하세요.
하나의 API로 Markdown 문자열, 이미지 경로, 캐시된 차트 데이터, 메타데이터를 반환합니다.

[English](README.md) | **한국어**

[npm](https://www.npmjs.com/package/file2md) · [소스 코드](https://github.com/ricky-clevi/file2md) · [문제 제보](https://github.com/ricky-clevi/file2md/issues)

[빠른 시작](#빠른-시작) · [예제](#예제) · [지원 형식](#지원-형식) · [옵션](#옵션) · [변환 결과](#변환-결과) · [오류와 자원 제한](#오류와-자원-제한)

## 설치

**Node.js 20.9 이상**이 필요합니다. JavaScript와 TypeScript, ESM과 CommonJS를
지원하며 타입 선언을 포함합니다. Node.js 라이브러리로, CLI나 브라우저 빌드는
제공하지 않습니다.

```sh
npm install file2md
```

## 빠른 시작

`report.docx` 문서 옆에 `convert.mjs`를 만드세요.

```js
import { writeFile } from 'node:fs/promises';
import { convert } from 'file2md';

const result = await convert('./report.docx', {
  imageDir: './images/report',
});

await writeFile('./report.md', result.markdown, 'utf8');
console.log(result.metadata);
```

`node convert.mjs`로 실행하면 현재 작업 디렉터리에 `report.md`를 저장하고,
지원하는 내장 이미지를 `images/report/`에 저장합니다. Markdown의 이미지 경로가
유지되도록 파일을 옮길 때 이미지 폴더도 함께 옮기세요. 지원 형식에서는 레이아웃
보존, 이미지 추출, 차트 추출이 기본으로 켜져 있습니다.

`convert(input, options?)`는 `Promise<ConversionResult>`를 반환합니다. 입력은 로컬
파일 경로 또는 Node.js `Buffer`이며, 확장자가 아닌 내용으로 형식을 판단합니다.
URL을 다운로드하거나 Markdown을 자동 저장하지는 않습니다. 위 예제는 Node의
`writeFile`로 저장합니다.

## 예제

### Buffer 변환

애플리케이션이 이미 문서 바이트를 가지고 있을 때 사용할 수 있습니다.

```js
import { readFile } from 'node:fs/promises';
import { convert } from 'file2md';

const buffer = await readFile('./report.xlsx');
const result = await convert(buffer);
console.log(result.markdown);
```

### 이미지 저장 없이 콘텐츠 변환

```js
import { convert } from 'file2md';

const { markdown } = await convert('./report.docx', {
  preserveLayout: false,
  extractImages: false,
  extractCharts: false,
});

console.log(markdown);
```

스타일 보강과 이미지/차트 추출을 끕니다. 결과는 여전히 Markdown이며 표 구조는
유지합니다. 이미지 디렉터리는 만들지 않습니다.

### CommonJS 사용 및 PDF 페이지 제한

`.cjs` 파일로 저장하거나 CommonJS 프로젝트에서 사용하세요.

```js
const { convert } = require('file2md');

async function main() {
  const result = await convert('./report.pdf', { maxPages: 10 });
  console.log(result.markdown);
  console.log(result.metadata.pageCount);
}

main().catch(console.error);
```

`maxPages`는 PDF에만 적용됩니다. 모든 페이지를 읽은 뒤 메타데이터만 줄이는 것이
아니라 실제 텍스트 추출 범위를 제한합니다.

## 지원 형식

| 형식 | 동작 및 한계 |
| --- | --- |
| PDF | `unpdf`의 PDF.js로 텍스트를 추출하고 제목/목록/표를 추정합니다. OCR과 이미지 추출은 지원하지 않습니다. |
| DOCX | 문단/표 순서, 기본 서식, 제목, 목록, 링크, 이미지, 캐시된 차트. 모든 상속 스타일이나 페이지 배치를 재현하지 않습니다. |
| XLSX | 관계 파일 기준 시트 순서, 공유/인라인 문자열, 불리언, 캐시된 수식 결과, 일반적인 날짜/백분율, 셀 스타일, 차트. 수식을 계산하지 않으며 빈 행 간격은 압축합니다. |
| PPTX | 실제 슬라이드 순서, 그룹 텍스트, 표, 이미지, 차트. 스크린샷이나 픽셀 단위 배치를 재현하지 않습니다. |
| HWP | 브라우저 없이 `hwp.js` 데이터 파서로 지원되는 HWP 5 문서를 읽습니다. 텍스트와 이미지를 추출하며 이진 표는 텍스트로 펼칩니다. 암호화된 형식 등은 실패할 수 있습니다. |
| HWPX | XML 구역 순서, 문단, 표, 매니페스트/관계 기반 이미지 참조. 짧은 텍스트와 숫자도 보존합니다. |

Markdown의 제약 때문에 병합 셀, 좌표, 글꼴, 도형은 원본과 같지 않을 수 있습니다.
표의 병합 영역은 빈 격자 셀로 근사합니다. 스캔한 PDF는 먼저 OCR이 필요합니다.

## 옵션

| 옵션 | 기본값 | 동작 |
| --- | --- | --- |
| `imageDir` | `images` | 이미지 저장 위치. 작업 디렉터리 기준 상대 경로와 절대 경로를 지원합니다. |
| `outputDir` | `imageDir` | 모든 형식의 이미지 저장 위치를 덮어씁니다. 슬라이드 스크린샷을 생성하지 않습니다. |
| `preserveLayout` | `true` | 지원하는 텍스트 스타일 및 PDF 레이아웃 추정을 적용합니다. false여도 표 구조는 유지합니다. |
| `extractImages` | `true` | DOCX, PPTX, HWP, HWPX의 이미지를 저장합니다. |
| `extractCharts` | `true` | Office 파일의 캐시된 차트 데이터를 추출합니다. |
| `maxPages` | 전체 | PDF에서 실제로 읽는 페이지 수와 반환하는 페이지 수를 제한합니다. |
| `maxFileSize` | 100 MiB | 입력 파일 크기 제한. 읽기 전과 읽는 중에 검사합니다. |
| `maxMemoryUsage` | 500 MiB | 프로세스 힙 메모리 한도. 외부 메모리는 절반, RSS는 1.5배로 제한합니다. |
| `timeout` | 60,000 ms | 처리 시간 제한. 동기/네이티브 작업의 제한은 아래를 참고하세요. |
| `maxExtractedFiles` | 1,000 | 디렉터리를 포함한 ZIP 항목 수 제한. |
| `maxExtractedSize` | 500 MiB | 압축 해제 후 전체 크기 제한. |
| `maxIndividualFileSize` | ZIP 50 MiB / XML 10 MiB | 지정하면 두 한도를 함께 변경합니다. |
| `enablePathValidation` | `true` | ZIP 원본 경로의 상위 디렉터리 접근, 절대 경로, 예약 이름을 검사합니다. |
| `enableXXEProtection` | `true` | 호환성 옵션. false여도 DTD와 외부 엔터티는 허용하지 않습니다. |

크기와 메모리 한도는 **바이트**, `timeout`은 **밀리초** 단위입니다.
예를 들어 `maxFileSize: 20 * 1024 * 1024`는 입력을 20 MiB로 제한합니다.
숫자 옵션은 양의 안전한 정수여야 합니다. PDF, HWP, 네이티브 이미지 처리 모듈은
필요한 경우에만 불러옵니다.

## 변환 결과

결과는 `markdown`, `images`, `charts`, `metadata`를 포함합니다.
이미지에는 원본 경로(`originalPath`)와 절대 파일 경로(`savedPath`)가 있으며,
차트에는 종류, 제목, 범주, 숫자 계열이 있습니다. Markdown 이미지 URL은 설정한
이미지 디렉터리를 기준으로 별도로 생성합니다.

```ts
import type { ImageData, ChartData, DocumentMetadata } from 'file2md';

interface ConversionResult {
  readonly markdown: string;
  readonly images: readonly ImageData[];
  readonly charts: readonly ChartData[];
  readonly metadata: DocumentMetadata;
}
```

`metadata`에는 파일 형식, MIME, 페이지/시트/슬라이드 수, 이미지/차트 수,
처리 시간(ms), 형식별 추가 정보가 있습니다. DOCX와 HWP/HWPX는 페이지를
계산하지 않으므로 `pageCount`가 1입니다. HWP/HWPX의 구역 수는
`metadata.additional.sectionCount`에 있습니다.

## 이미지

이미지를 실제로 저장할 때만 디렉터리를 만듭니다. 파일명에는 내용 해시가
포함되어 여러 문서 또는 동시 변환 사이의 충돌을 방지하며, 기존 파일을
조용히 덮어쓰지 않습니다.

TIFF와 AVIF는 Sharp로 PNG로 변환합니다. PNG, JPEG, GIF, SVG, WebP 등은
원본 바이트를 유지합니다. BMP, WMF, EMF는 원래 확장자를 유지하므로 브라우저
표시에는 별도 변환이 필요할 수 있습니다. 변환하지 않은 이미지를 PNG로
잘못 표시하지 않습니다.

Markdown의 이미지 참조는 설정한 저장 디렉터리를 사용합니다. Markdown 파일을
다른 위치에 저장한다면 최종 위치에 맞는 경로를 선택하세요. SVG는 원본 그대로
추출하며 인라인 HTML용으로 정화하지 않습니다. 렌더링하거나 공개할 때는 문서와
이미지를 신뢰할 수 없는 입력으로 취급하세요.

## 오류와 자원 제한

```ts
import { convert, ConversionError, SecurityError } from 'file2md';

try {
  await convert('./보고서.docx');
} catch (error) {
  if (error instanceof SecurityError) console.error(error.securityCode);
  else if (error instanceof ConversionError) console.error(error.code, error.message);
  else throw error;
}
```

`ParseError`, `InvalidFileError`, `UnsupportedFormatError`, `FileNotFoundError`,
`ResourceLimitError`를 포함한 오류 클래스를 런타임에 내보냅니다. 내부 오류는
`originalError`에 남으므로 외부 응답에 그대로 노출하지 마세요.

ZIP은 추출 전에 검사하고 스트리밍 중에도 크기를 제한합니다. 기본 압축률 한도는
100:1입니다. XML은 정상적인 네임스페이스와 이스케이프 문자를 허용하고, DTD와
외부 엔터티를 차단하며, 중첩을 128단계로 제한합니다. 표와 스프레드시트 격자,
차트 데이터 확장도 제한하여 작은 입력이 과도한 출력을 만들지 않도록 합니다. 문서의 관계 URL을
네트워크에서 가져오지 않습니다.

메모리 검사는 개별 변환이 아닌 전체 Node.js 프로세스를 관찰합니다. 시간 제한은
비동기 작업과 파싱 중 검사에 적용되지만 이미 실행 중인 동기 파서/네이티브
작업을 즉시 중단할 수는 없습니다. 악의적인 파일에 대한 강한 CPU/메모리 격리가
필요하면 운영체제 한도가 있는 별도 프로세스에서 실행하세요. 실패하기 전에
저장한 이미지는 남을 수 있으므로 문서별 디렉터리를 사용하는 것이 좋습니다.

## 이전 구현에서 업그레이드

이전 출력에 의존하는 애플리케이션은 다음 변경을 확인하세요.

- **실행 환경:** Node.js 20.9 이상이 필요합니다.
- **이미지:** 파일명에 내용 해시가 포함됩니다. 이름을 예측하는 대신
  `result.images`를 사용하세요. 사용자 지정 디렉터리는 모든 지원 형식에 반영됩니다.
- **Markdown:** 문단 순서, 관계 참조, 텍스트 디코딩 수정으로 출력이 달라질 수
  있습니다. `preserveLayout: false`는 지원되는 스타일 보강을 끕니다.
- **PDF:** `maxPages`는 실제 추출 범위를 제한하며 처리한 페이지만 집계합니다.

ESM과 CommonJS는 오류/클래스의 동일성을 포함하여 하나의 구현을 공유합니다.

## 개발 및 배포

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

`dist/`에는 ESM 진입점, `dist/cjs/`에는 공유 CommonJS 구현이 생성됩니다. 소스, 테스트 자료,
소스맵은 배포하지 않습니다.

### GitHub Actions로 배포

[`.github/workflows/publish.yml`](https://github.com/ricky-clevi/file2md/blob/main/.github/workflows/publish.yml)은
`main` 푸시를 검사합니다. 지정된 소스/빌드 파일이 최신 Git 태그와 다르거나 태그가
없으면 새 버전을 배포합니다.

1. npm 배포 자격 증명을 저장소 Actions 시크릿 **`NPM_TOKEN`**으로 추가합니다.
   체크아웃, 버전 커밋, 태그, GitHub 릴리스는 내장 `GITHUB_TOKEN`을 사용합니다.
   별도의 `GH_TOKEN` 시크릿은 필요하지 않습니다.
2. 변경 사항을 `main`에 푸시합니다. 의존성 설치 후 린트, 타입 검사, 테스트와
   빌드를 수행합니다.
3. 배포가 필요하면 `package.json`과 `package-lock.json`의 패치 버전을 올려
   npm에 배포한 뒤 버전 커밋, 태그, GitHub 릴리스를 기록합니다.

누락된 자격 증명을 추가했다면 실패한 Actions 실행에서 **Re-run all jobs**를
선택하세요. **Publish package** 단계의 성공을 확인해야 합니다. 빌드 성공만으로
npm 배포가 완료된 것은 아닙니다.

지정된 파일이 최신 태그와 같으면 README만 바꾼 커밋은 새 npm 버전을 만들지
않습니다. README는 다음 패키지 배포에 반영됩니다. PR과 다른 브랜치는 배포 없이
CI만 실행합니다.

### 로컬 배포 명령

| 명령 | 동작 |
| --- | --- |
| `npm run release:dry` | 버전 변경이나 배포 없이 검증하고 패키지 내용을 미리 봅니다. |
| `npm run release` | 검증, npm 인증 확인 후 두 매니페스트의 패치 버전을 올려 배포합니다. |
| `npm run release:retry` | 버전을 올리지 않고 현재 버전을 검증하여 배포합니다. 아직 배포하지 않은 버전에만 사용하세요. |

배포 스크립트는 **패치 버전만** 올립니다. 호환성이 바뀌는 릴리스는 major 버전을
명시적으로 선택하고 워크플로의 자동 버전 증가를 고려해야 합니다. 로컬 배포
명령은 Git 커밋, 태그, GitHub 릴리스를 만들지 않습니다. 설치나 빌드만으로는
배포가 실행되지 않습니다.

## 라이선스

[MIT](LICENSE).
