# file2md

[![npm version](https://badge.fury.io/js/file2md.svg)](https://badge.fury.io/js/file2md)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

다양한 문서 형식(PDF, DOCX, XLSX, PPTX, HWP, HWPX)을 **고급 레이아웃 보존**, **실제 PDF 이미지 추출**, **차트 변환**, **한국어 문서 지원** 기능과 함께 마크다운으로 변환하는 현대적인 TypeScript 라이브러리입니다.

[English](README.md) | **한국어**

## ✨ 주요 기능

- 🔄 **다양한 형식 지원**: PDF, DOCX, XLSX, PPTX, HWP, HWPX
- 🎨 **레이아웃 보존**: 문서 구조, 표, 서식 유지
- 🖼️ **실제 PDF 이미지 추출**: pdf2pic을 사용하여 PDF 페이지를 실제 PNG 이미지로 변환
- 📊 **차트 변환**: 차트를 마크다운 표로 변환
- 📝 **목록 및 표 지원**: 중첩된 목록과 복잡한 표 지원
- 🌏 **한국어 문서 지원**: HWP/HWPX 한국어 문서 형식 완전 지원
- 🔒 **타입 안전성**: 포괄적인 타입을 제공하는 완전한 TypeScript 지원
- ⚡ **현대적 ESM**: CommonJS 호환성을 갖춘 ES2022 모듈
- 🚀 **무설정**: 별도 설정 없이 바로 사용 가능
- 🎯 **시각적 파싱**: 향상된 PPTX 파싱 및 시각적 레이아웃 분석

## 📦 설치

```bash
npm install file2md
```

## 🚀 빠른 시작

### TypeScript / ES 모듈

```typescript
import { convert } from 'file2md';

// 파일 경로로 변환
const result = await convert('./document.pdf');
console.log(result.markdown);

// 옵션과 함께 변환
const result = await convert('./presentation.pptx', {
  imageDir: 'extracted-images',
  preserveLayout: true,
  extractCharts: true,
  useVisualParser: true // 향상된 PPTX 파싱
});

console.log(`✅ 변환 완료!`);
console.log(`📄 마크다운 길이: ${result.markdown.length}`);
console.log(`🖼️ 추출된 이미지: ${result.images.length}`);
console.log(`📊 발견된 차트: ${result.charts.length}`);
console.log(`⏱️ 처리 시간: ${result.metadata.processingTime}ms`);
```

### 한국어 문서 지원 (HWP/HWPX)

```typescript
import { convert } from 'file2md';

// 한국어 HWP 문서 변환
const hwpResult = await convert('./document.hwp', {
  imageDir: 'hwp-images',
  preserveLayout: true,
  extractImages: true
});

// 한국어 HWPX 문서 변환 (XML 기반 형식)
const hwpxResult = await convert('./document.hwpx', {
  imageDir: 'hwpx-images',
  preserveLayout: true,
  extractImages: true
});

console.log(`🇰🇷 HWP 내용: ${hwpResult.markdown.substring(0, 100)}...`);
console.log(`📄 HWPX 페이지: ${hwpResult.metadata.pageCount}`);
```

### CommonJS

```javascript
const { convert } = require('file2md');

const result = await convert('./document.docx');
console.log(result.markdown);
```

### 버퍼에서 변환

```typescript
import { convert } from 'file2md';
import { readFile } from 'fs/promises';

const buffer = await readFile('./document.xlsx');
const result = await convert(buffer, {
  imageDir: 'spreadsheet-images'
});
```

## 📋 API 참조

### `convert(input, options?)`

**매개변수:**
- `input: string | Buffer` - 파일 경로 또는 문서 데이터가 포함된 버퍼
- `options?: ConvertOptions` - 변환 옵션

**반환값:** `Promise<ConversionResult>`

### 옵션

```typescript
interface ConvertOptions {
  imageDir?: string;        // 추출된 이미지 디렉터리 (기본값: 'images')
  outputDir?: string;       // 슬라이드 스크린샷 출력 디렉터리 (PPTX용, imageDir로 폴백)
  preserveLayout?: boolean; // 문서 레이아웃 유지 (기본값: true)
  extractCharts?: boolean;  // 차트를 표로 변환 (기본값: true)
  extractImages?: boolean;  // 임베디드 이미지 추출 (기본값: true)
  maxPages?: number;        // PDF 최대 페이지 수 (기본값: 무제한)
  useVisualParser?: boolean; // PPTX용 향상된 시각적 파싱 (기본값: true)
}
```

### 결과

```typescript
interface ConversionResult {
  markdown: string;           // 생성된 마크다운 콘텐츠
  images: ImageData[];        // 추출된 이미지 정보
  charts: ChartData[];        // 추출된 차트 데이터
  metadata: DocumentMetadata; // 처리 정보가 포함된 문서 메타데이터
}
```

## 🎯 형식별 세부 기능

### 📄 PDF
- ✅ **텍스트 추출** 및 레이아웃 향상
- ✅ **표 감지** 및 서식 지정
- ✅ **목록 인식** (글머리 기호, 번호)
- ✅ **제목 감지** (모든 대문자, 콜론)
- ✅ **실제 이미지 추출** pdf2pic 사용 - PDF 페이지를 PNG 이미지로 변환
- ✅ **임베디드 이미지 감지** 및 추출

### 📝 DOCX
- ✅ **제목 계층 구조** (H1-H6)
- ✅ **텍스트 서식** (굵게, 기울임꼴)
- ✅ **복잡한 표** 병합된 셀 포함
- ✅ **중첩된 목록** 적절한 들여쓰기 포함
- ✅ **임베디드 이미지** 및 차트
- ✅ **셀 스타일링** (정렬, 색상)
- ✅ **글꼴 크기 보존** 및 서식

### 📊 XLSX
- ✅ **여러 워크시트** 별도 섹션으로 구분
- ✅ **셀 서식** (굵게, 색상, 정렬)
- ✅ **데이터 타입 보존**
- ✅ **차트 추출** 데이터 표로 변환
- ✅ **조건부 서식** 메모
- ✅ **공유 문자열** 대용량 파일 처리

### 🎬 PPTX
- ✅ **슬라이드별** 구성
- ✅ **텍스트 위치 지정** 및 레이아웃
- ✅ **슬라이드별 이미지 배치**
- ✅ **슬라이드에서 표 추출**
- ✅ **다중 열 레이아웃**
- ✅ **향상된 레이아웃 분석을 통한 시각적 파싱**
- ✅ **문서 속성에서 제목 추출**
- ✅ **차트 및 이미지** 인라인 임베딩

### 🇰🇷 HWP (한국어)
- ✅ **바이너리 형식** hwp.js를 사용한 파싱
- ✅ **한국어 텍스트 추출** 적절한 인코딩 포함
- ✅ **임베디드 콘텐츠에서 이미지 추출**
- ✅ **한국어 문서용 레이아웃 보존**
- ✅ **저작권 메시지 필터링** 깔끔한 출력

### 🇰🇷 HWPX (한국어 XML)
- ✅ **XML 기반 형식** JSZip을 사용한 파싱
- ✅ **대용량 문서용 다중 섹션 지원**
- ✅ **이미지 참조용 관계 매핑**
- ✅ **OWPML 구조** 파싱
- ✅ **향상된 한국어 텍스트** 처리
- ✅ **ZIP 아카이브에서 BinData 이미지 추출**

## 🖼️ 이미지 처리

이미지는 자동으로 추출되어 지정된 디렉터리에 저장됩니다:

```typescript
const result = await convert('./presentation.pptx', {
  imageDir: 'my-images'
});

// 결과 구조:
// my-images/
// ├── image_1.png
// ├── image_2.jpg
// └── chart_1.png

// 마크다운에 포함될 내용:
// ![Slide 1 Image](my-images/image_1.png)
```

## 📊 차트 변환

차트는 마크다운 표로 변환됩니다:

```markdown
#### Chart 1: 매출 데이터

| 카테고리 | 1분기 | 2분기 | 3분기 | 4분기 |
| --- | --- | --- | --- | --- |
| 매출 | 100 | 150 | 200 | 250 |
| 수익 | 20 | 30 | 45 | 60 |
```

## 🛡️ 오류 처리

```typescript
import { 
  convert, 
  UnsupportedFormatError, 
  FileNotFoundError,
  ParseError 
} from 'file2md';

try {
  const result = await convert('./document.pdf');
} catch (error) {
  if (error instanceof UnsupportedFormatError) {
    console.error('지원하지 않는 파일 형식입니다');
  } else if (error instanceof FileNotFoundError) {
    console.error('파일을 찾을 수 없습니다');
  } else if (error instanceof ParseError) {
    console.error('문서 파싱에 실패했습니다:', error.message);
  }
}
```

## 🧪 고급 사용법

### 일괄 처리

```typescript
import { convert } from 'file2md';
import { readdir } from 'fs/promises';

async function convertFolder(folderPath: string) {
  const files = await readdir(folderPath);
  const results = [];
  
  for (const file of files) {
    if (file.match(/\.(pdf|docx|xlsx|pptx|hwp|hwpx)$/i)) {
      try {
        const result = await convert(`${folderPath}/${file}`, {
          imageDir: 'batch-images',
          extractImages: true
        });
        results.push({ file, success: true, result });
      } catch (error) {
        results.push({ file, success: false, error });
      }
    }
  }
  
  return results;
}
```

### PDF 이미지 추출 옵션

```typescript
import { convert } from 'file2md';

// 이미지 중심 PDF용 (스캔된 문서)
const result = await convert('./scanned-document.pdf', {
  imageDir: 'pdf-images',
  maxPages: 10,          // 대용량 PDF용 페이지 제한
  extractImages: true    // PDF-이미지 변환 활성화
});

console.log(`PDF에서 ${result.images.length}개의 페이지 이미지를 추출했습니다`);
```

## 📊 지원 형식

| 형식 | 확장자 | 레이아웃 | 이미지 | 차트 | 표 | 목록 |
|------|-------|---------|-------|------|----|----|
| PDF    | `.pdf`    | ✅     | ✅     | ❌     | ✅     | ✅    |
| Word   | `.docx`   | ✅     | ✅     | ✅     | ✅     | ✅    |
| Excel  | `.xlsx`   | ✅     | ❌     | ✅     | ✅     | ❌    |
| PowerPoint | `.pptx` | ✅   | ✅     | ✅     | ✅     | ❌    |
| HWP    | `.hwp`    | ✅     | ✅     | ❌     | ❌     | ✅    |
| HWPX   | `.hwpx`   | ✅     | ✅     | ❌     | ❌     | ✅    |

> **PDF 이미지**: pdf2pic 라이브러리를 사용하여 PDF 페이지를 실제 PNG 이미지로 변환

## 🌏 한국어 문서 지원

file2md는 한국어 문서 형식에 대한 포괄적인 지원을 제공합니다:

### HWP (한글)
- 한글 워드프로세서에서 사용하는 **바이너리 형식**
- 한국 조직에서 여전히 널리 사용되는 **레거시 형식**
- 한국어 문자 인코딩을 통한 **완전한 텍스트 추출**
- **이미지 및 차트** 추출 지원

### HWPX (한글 XML)
- HWP의 후속작인 **현대적인 XML 기반** 형식
- XML 콘텐츠 파일을 포함한 **ZIP 아카이브 구조**
- 관계 매핑을 통한 **향상된 파싱**
- **다중 섹션** 및 복잡한 문서 지원

### 사용 예제

```typescript
// 한국어 문서 변환
const koreanDocs = [
  'report.hwp',      // 레거시 바이너리 형식
  'document.hwpx',   // 현대적 XML 형식
  'presentation.pptx'
];

for (const doc of koreanDocs) {
  const result = await convert(doc, {
    imageDir: 'korean-docs-images',
    preserveLayout: true
  });
  
  console.log(`📄 ${doc}: ${result.markdown.length} 문자`);
  console.log(`🖼️ 이미지: ${result.images.length}`);
  console.log(`⏱️ ${result.metadata.processingTime}ms에 처리 완료`);
}
```

## 🔧 성능 및 설정

```typescript
import { convert } from 'file2md';

// 대용량 문서 최적화
const result = await convert('./large-document.pdf', {
  maxPages: 50,              // PDF 처리 페이지 제한
  extractImages: true,       // PDF 이미지 추출 활성화
  preserveLayout: true       // 레이아웃 분석 유지
});

// 향상된 PPTX 처리
const pptxResult = await convert('./presentation.pptx', {
  useVisualParser: true,     // 시각적 레이아웃 분석 활성화
  outputDir: 'slides',       // 슬라이드용 별도 디렉터리
  extractCharts: true,       // 차트 데이터 추출
  extractImages: true        // 임베디드 이미지 추출
});

// 메타데이터에서 성능 지표 확인 가능
console.log('성능 지표:');
console.log(`- 처리 시간: ${result.metadata.processingTime}ms`);
console.log(`- 처리된 페이지: ${result.metadata.pageCount}`);
console.log(`- 추출된 이미지: ${result.metadata.imageCount}`);
console.log(`- 파일 타입: ${result.metadata.fileType}`);
```

## 🤝 기여하기

기여를 환영합니다! 언제든 풀 리퀘스트를 제출해 주세요.

1. 저장소를 포크합니다
2. 기능 브랜치를 생성합니다 (`git checkout -b feature/amazing-feature`)
3. 변경 사항을 커밋합니다 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 푸시합니다 (`git push origin feature/amazing-feature`)
5. 풀 리퀘스트를 엽니다

### 개발 환경 설정

```bash
# 저장소 복제
git clone https://github.com/ricky-clevi/file2md.git
cd file2md

# 의존성 설치
npm install

# 테스트 실행
npm test

# 프로젝트 빌드
npm run build

# 린팅 실행
npm run lint
```

## 📄 라이센스

이 프로젝트는 MIT 라이센스에 따라 라이센스가 부여됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🔗 링크

- [npm 패키지](https://www.npmjs.com/package/file2md)
- [GitHub 저장소](https://github.com/ricky-clevi/file2md)
- [이슈 및 버그 신고](https://github.com/ricky-clevi/file2md/issues)

---

**❤️와 TypeScript로 제작** • **🖼️ 실제 PDF 이미지 추출 기능 향상** • **🇰🇷 한국어 문서 지원**