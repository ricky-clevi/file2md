# file2md

[![npm version](https://badge.fury.io/js/file2md.svg)](https://badge.fury.io/js/file2md)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

다양한 문서 형식(PDF, DOCX, XLSX, PPTX, HWP, HWPX)을 **고급 레이아웃 보존**, **이미지 추출**, **차트 변환**, **한국어 문서 지원** 기능과 함께 마크다운으로 변환하는 현대적인 TypeScript 라이브러리입니다.

[English](README.md) | **한국어**

## ✨ 주요 기능

- 🔄 **다양한 형식 지원**: PDF, DOCX, XLSX, PPTX, HWP, HWPX
- 🎨 **레이아웃 보존**: 문서 구조, 표, 서식 유지
- 🖼️ **이미지 추출**: DOCX, PPTX, XLSX, HWP 문서에서 포함된 이미지 추출
- 📊 **차트 변환**: 차트를 마크다운 표로 변환
- 📝 **목록 및 표 지원**: 중첩된 목록과 복잡한 표 지원
- 🌏 **한국어 문서 지원**: HWP/HWPX 한국어 문서 형식 완전 지원
- 🔒 **타입 안전성**: 포괄적인 타입을 제공하는 완전한 TypeScript 지원
- ⚡ **현대적 ESM**: CommonJS 호환성을 갖춘 ES2022 모듈
- 🚀 **무설정**: 별도 설정 없이 바로 사용 가능
- 📄 **PDF 텍스트 추출**: 레이아웃 감지가 포함된 향상된 텍스트 추출

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
  extractImages: true
});

console.log(`✅ 변환 완료!`);
console.log(`📄 마크다운 길이: ${result.markdown.length}`);
console.log(`🖼️ 추출된 이미지: ${result.images.length}`);
console.log(`📊 찾은 차트: ${result.charts.length}`);
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
console.log(`📄 HWPX 페이지 수: ${hwpResult.metadata.pageCount}`);
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
  imageDir?: string;        // 추출된 이미지를 위한 디렉터리 (기본값: 'images')
  outputDir?: string;       // 슬라이드 스크린샷을 위한 출력 디렉터리 (PPTX, imageDir로 fallback)
  preserveLayout?: boolean; // 문서 레이아웃 유지 (기본값: true)
  extractCharts?: boolean;  // 차트를 표로 변환 (기본값: true)
  extractImages?: boolean;  // 포함된 이미지 추출 (기본값: true)
  maxPages?: number;        // PDF의 최대 페이지 수 (기본값: 무제한)
}
```

### 결과

```typescript
interface ConversionResult {
  markdown: string;           // 생성된 마크다운 내용
  images: ImageData[];        // 추출된 이미지 정보
  charts: ChartData[];        // 추출된 차트 데이터
  metadata: DocumentMetadata; // 처리 정보가 포함된 문서 메타데이터
}
```

## 🎯 형식별 특화 기능

### 📄 PDF
- ✅ **텍스트 추출** 및 레이아웃 향상
- ✅ **표 감지** 및 서식 지정
- ✅ **목록 인식** (글머리 기호, 번호)
- ✅ **제목 감지** (대문자, 콜론)
- ❌ **이미지 추출** (텍스트 전용 처리)

### 📝 DOCX
- ✅ **제목 계층** (H1-H6)
- ✅ **텍스트 서식** (굵게, 기울임꼴)
- ✅ **복잡한 표** 및 병합된 셀
- ✅ **중첩된 목록** 및 적절한 들여쓰기
- ✅ **포함된 이미지** 및 차트
- ✅ **셀 스타일링** (정렬, 색상)
- ✅ **글꼴 크기 보존** 및 서식

### 📊 XLSX
- ✅ **여러 워크시트**를 별도 섹션으로
- ✅ **셀 서식** (굵게, 색상, 정렬)
- ✅ **데이터 타입 보존**
- ✅ **차트 추출**을 데이터 표로
- ✅ **조건부 서식** 노트
- ✅ **공유 문자열** 처리 (대용량 파일)

### 🎬 PPTX
- ✅ **슬라이드별** 구성
- ✅ **텍스트 위치** 및 레이아웃
- ✅ **슬라이드별 이미지** 배치
- ✅ **슬라이드에서 표** 추출
- ✅ **다중 컬럼 레이아웃**
- ✅ **문서 속성에서 제목** 추출
- ✅ **차트 및 이미지** 인라인 삽입

### 🇰🇷 HWP (한글)
- ✅ **이진 형식** hwp.js를 사용한 파싱
- ✅ **한국어 텍스트 추출** 및 적절한 인코딩
- ✅ **포함된 내용에서 이미지** 추출
- ✅ **한국어 문서를 위한 레이아웃** 보존
- ✅ **저작권 메시지 필터링**으로 깔끔한 출력

### 🇰🇷 HWPX (한글 XML)
- ✅ **XML 기반 형식** JSZip을 사용한 파싱
- ✅ **대용량 문서를 위한 다중 섹션** 지원
- ✅ **이미지 참조를 위한 관계 매핑**
- ✅ **OWPML 구조** 파싱
- ✅ **향상된 한국어 텍스트** 처리
- ✅ **ZIP 아카이브에서 BinData 이미지** 추출

## 🖼️ 이미지 처리

이미지는 지정된 디렉터리에 자동으로 추출되고 저장됩니다:

```typescript
const result = await convert('./presentation.pptx', {
  imageDir: 'my-images'
});

// 결과 구조:
// my-images/
// ├── image_1.png
// ├── image_2.jpg
// └── chart_1.png

// 마크다운에는 다음이 포함됩니다:
// ![슬라이드 1 이미지](my-images/image_1.png)
```

**참고:** PDF 파일은 텍스트 전용으로 처리됩니다. 필요시 전용 PDF 도구를 사용하여 이미지를 추출하세요.

## 📊 차트 변환

차트는 마크다운 표로 변환됩니다:

```markdown
#### 차트 1: 판매 데이터

| 카테고리 | 1분기 | 2분기 | 3분기 | 4분기 |
| --- | --- | --- | --- | --- |
| 매출 | 100 | 150 | 200 | 250 |
| 이익 | 20 | 30 | 45 | 60 |
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
    console.error('지원하지 않는 파일 형식');
  } else if (error instanceof FileNotFoundError) {
    console.error('파일을 찾을 수 없음');
  } else if (error instanceof ParseError) {
    console.error('문서 파싱 실패:', error.message);
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

### 대용량 문서 처리

```typescript
import { convert } from 'file2md';

// 대용량 문서 최적화
const result = await convert('./large-document.pdf', {
  maxPages: 50,              // PDF 처리 제한
  preserveLayout: true       // 레이아웃 분석 유지
});

// 향상된 PPTX 처리
const pptxResult = await convert('./presentation.pptx', {
  outputDir: 'slides',       // 슬라이드를 위한 별도 디렉터리
  extractCharts: true,       // 차트 데이터 추출
  extractImages: true        // 포함된 이미지 추출
});

// 성능 메트릭은 메타데이터에서 확인 가능
console.log('성능 메트릭:');
console.log(`- 처리 시간: ${result.metadata.processingTime}ms`);
console.log(`- 처리된 페이지: ${result.metadata.pageCount}`);
console.log(`- 추출된 이미지: ${result.metadata.imageCount}`);
console.log(`- 파일 타입: ${result.metadata.fileType}`);
```

## 📊 지원되는 형식

| 형식 | 확장자 | 레이아웃 | 이미지 | 차트 | 표 | 목록 |
|------|--------|----------|---------|------|-----|------|
| PDF  | `.pdf` | ✅      | ❌     | ❌   | ✅  | ✅   |
| Word | `.docx`| ✅      | ✅     | ✅   | ✅  | ✅   |
| Excel| `.xlsx`| ✅      | ❌     | ✅   | ✅  | ❌   |
| PowerPoint| `.pptx`| ✅   | ✅     | ✅   | ✅  | ❌   |
| HWP  | `.hwp` | ✅      | ✅     | ❌   | ❌  | ✅   |
| HWPX | `.hwpx`| ✅      | ✅     | ❌   | ❌  | ✅   |

> **참고**: PDF 처리는 향상된 레이아웃 감지를 통한 텍스트 추출에 중점을 둡니다. PDF 이미지 추출이 필요한 경우 전용 PDF 처리 도구 사용을 고려하세요.

## 🌏 한국어 문서 지원

file2md는 한국어 문서 형식에 대한 포괄적인 지원을 포함합니다:

### HWP (한글)
- 한글 (Hangul) 워드 프로세서에서 사용하는 **이진 형식**
- 한국 조직에서 여전히 널리 사용되는 **레거시 형식**
- 한국어 문자 인코딩을 통한 **완전한 텍스트 추출**
- **이미지 및 차트** 추출 지원

### HWPX (한글 XML)
- HWP의 후속 버전인 **현대적인 XML 기반** 형식
- XML 콘텐츠 파일을 포함한 **ZIP 아카이브 구조**
- 관계 매핑을 통한 **향상된 파싱**
- **다중 섹션** 및 복잡한 문서 지원

### 사용 예제

```typescript
// 한국어 문서 변환
const koreanDocs = [
  'report.hwp',      // 레거시 이진 형식
  'document.hwpx',   // 현대적인 XML 형식
  'presentation.pptx'
];

for (const doc of koreanDocs) {
  const result = await convert(doc, {
    imageDir: 'korean-docs-images',
    preserveLayout: true
  });
  
  console.log(`📄 ${doc}: ${result.markdown.length} 문자`);
  console.log(`🖼️ 이미지: ${result.images.length}`);
  console.log(`⏱️ 처리 시간: ${result.metadata.processingTime}ms`);
}
```

## 🔧 성능 및 구성

라이브러리는 합리적인 기본값으로 성능에 최적화되어 있습니다:

- **무설정** - 별도 설정 없이 바로 사용
- **효율적인 처리** - 다양한 문서 크기에 최적화
- **메모리 관리** - 임시 리소스의 적절한 정리
- **타입 안전성** - 완전한 TypeScript 지원

성능 메트릭은 모니터링 및 최적화를 위해 변환 결과에 포함됩니다.

## 🤝 기여하기

기여를 환영합니다! 언제든지 Pull Request를 제출해주세요.

1. 저장소 포크
2. 기능 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 변경사항 커밋 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 푸시 (`git push origin feature/amazing-feature`)
5. Pull Request 열기

### 개발 환경 설정

```bash
# 저장소 클론
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

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 라이선스됩니다 - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🔗 링크

- [npm 패키지](https://www.npmjs.com/package/file2md)
- [GitHub 저장소](https://github.com/ricky-clevi/file2md)
- [이슈 및 버그 신고](https://github.com/ricky-clevi/file2md/issues)

---

**❤️와 TypeScript로 제작** • **🖼️ 지능적 문서 파싱으로 향상** • **🇰🇷 한국어 문서 지원**