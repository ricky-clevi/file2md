# file2md

PDF, DOCX, XLSX, PPTX, HWP, HWPX 문서를 Node.js에서 Markdown으로 변환합니다.
Markdown 문자열, 추출한 이미지 경로, 차트 데이터, 처리 메타데이터를 반환합니다.

[English](README.md) | **한국어**

## 설치

**Node.js 20.9 이상**이 필요합니다.

```sh
npm install file2md
```

## 사용법

```ts
import { convert } from 'file2md';

const result = await convert('./보고서.docx', {
  imageDir: './report-images',
  preserveLayout: true,
  extractImages: true,
  extractCharts: true,
});
console.log(result.markdown);
console.log(result.images);
console.log(result.metadata);
```

CommonJS도 지원합니다.

```js
const { convert } = require('file2md');

async function main() {
  const result = await convert('./보고서.pdf', { maxPages: 10 });
  console.log(result.markdown);
}
main().catch(console.error);
```

입력은 로컬 파일 경로 또는 Node.js `Buffer`입니다. 확장자가 아닌 파일 내용을
확인합니다. URL을 다운로드하거나 Markdown 파일을 자동으로 저장하지 않습니다.
필요하면 반환된 `result.markdown`을 직접 저장하세요.

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

숫자 옵션은 양의 안전한 정수여야 합니다. PDF, HWP, 네이티브 이미지 처리 모듈은
필요한 경우에만 불러옵니다.

## 결과 및 형식별 지원

결과는 `markdown`, `images`, `charts`, `metadata`를 포함합니다.
이미지에는 원본 경로(`originalPath`)와 저장 경로(`savedPath`)가 있으며,
차트에는 종류, 제목, 범주, 숫자 계열이 있습니다.

`metadata`에는 파일 형식, MIME, 페이지/시트/슬라이드 수, 이미지/차트 수,
처리 시간(ms), 형식별 추가 정보가 있습니다. DOCX와 HWP/HWPX는 페이지를
계산하지 않으므로 `pageCount`가 1입니다. HWP/HWPX의 구역 수는
`metadata.additional.sectionCount`에 있습니다.

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
외부 엔터티를 차단하며, 중첩을 128단계로 제한합니다. 문서의 관계 URL을
네트워크에서 가져오지 않습니다.

메모리 검사는 개별 변환이 아닌 전체 Node.js 프로세스를 관찰합니다. 시간 제한은
비동기 작업과 파싱 중 검사에 적용되지만 이미 실행 중인 동기 파서/네이티브
작업을 즉시 중단할 수는 없습니다. 악의적인 파일에 대한 강한 CPU/메모리 격리가
필요하면 운영체제 한도가 있는 별도 프로세스나 워커에서 실행하세요. 실패하기 전에
저장한 이미지는 남을 수 있으므로 문서별 디렉터리를 사용하는 것이 좋습니다.

## 이전 구현과 달라진 점

- 보안 패치된 Sharp를 사용하며 최소 Node 버전이 20.9로 변경되었습니다.
- ESM/CommonJS 진입점이 하나의 구현과 TypeScript 선언을 공유합니다.
- `pdf-parse` 대신 `unpdf`를 사용하며 PDF 페이지 제한을 실제로 적용합니다.
- 중복 XML 파서를 순서 보존 SAX 파서 하나로 통합했습니다.
- JSDOM, 브라우저 폴리필, 고정 렌더링 대기, 사용하지 않는 시각 파서를 제거했습니다.
- 정상 Office 문서를 거부하던 ZIP/XML 검사를 수정했습니다.
- 사용자 지정 이미지 경로를 반영하고 파일명 충돌을 방지합니다.
- `preserveLayout: false`가 지원되는 스타일 처리를 끕니다.

Node 지원 범위, Markdown 서식, 생성 이미지 파일명이 바뀌므로 업그레이드 전에
이전 출력에 의존하는 부분을 확인하세요.

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

`npm run release:dry`는 버전을 바꾸지 않고 검사 및 배포 미리보기를 수행합니다.
`npm run release`는 검사와 인증 확인 후 두 매니페스트의 패치 버전을 올리고
배포합니다. `release:retry`는 버전 변경을 건너뜁니다. 호환성이 바뀌는 변경은
배포 전에 적절한 major/minor 버전을 직접 선택해야 합니다.

`main` 워크플로는 검사 후 npm에 배포하고 버전과 태그를 기록합니다. PR과 다른
브랜치는 배포 없이 CI만 수행합니다. 로컬 설치나 빌드가 배포를 실행하지 않습니다.

MIT 라이선스.
