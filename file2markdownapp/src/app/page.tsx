'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ErrorBoundary } from '../components/ErrorBoundary';

interface ConversionResult {
  success: boolean;
  filename: string;
  hasImages: boolean;
  downloadUrl: string;
  error?: string;
  markdown?: string;
  imageCount?: number;
  chartCount?: number;
  metadata?: Record<string, unknown>;
  stats?: {
    inputBytes?: number;
    markdownBytes?: number;
    compressionRatio?: number | null;
    imageCount?: number;
    chartCount?: number;
    processingTimeMs?: number;
  };
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extractImages, setExtractImages] = useState(true);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setResult(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/x-hwp': ['.hwp'],
      'application/x-hwpx': ['.hwpx'],
      'application/x-cfb': ['.hwp'] // CFB files with .hwp extension
    },
    multiple: false,
    maxSize: 50 * 1024 * 1024 // 50MB limit
  });

  const handleConvert = async () => {
    if (!selectedFile) return;

    setIsConverting(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('preserveLayout', String(true));
    formData.append('extractImages', String(extractImages));
    formData.append('extractCharts', String(true));

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        // Try to surface server-provided error
        let serverMsg = response.statusText || 'Request failed';
        try {
          const maybeJson = await response.json();
          if (maybeJson && typeof maybeJson.error === 'string') {
            serverMsg = maybeJson.error;
          }
        } catch {
          // ignore JSON parse failure
        }
        throw new Error(serverMsg);
      }

      const data: ConversionResult = await response.json();
      setResult(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(msg);
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownload = () => {
    if (result?.downloadUrl) {
      const link = document.createElement('a');
      link.href = result.downloadUrl;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const prettyBytes = (n?: number) => {
    if (!n && n !== 0) return '-';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const resetForm = () => {
    setSelectedFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            File to Markdown Converter
          </h1>
          <p className="text-lg text-gray-600">
            Convert PDF, DOCX, XLSX, PPTX, HWP, and HWPX files to Markdown format
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100">
          {!result ? (
            <>
              {/* File Upload Area */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
                  isDragActive
                    ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                    : selectedFile
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-300 hover:border-gray-400 hover:shadow-md'
                }`}
              >
                <input {...getInputProps()} />
                <div className="space-y-4">
                  <div className="mx-auto w-16 h-16 text-gray-400">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                      />
                    </svg>
                  </div>
                  {selectedFile ? (
                    <div>
                      <p className="text-green-600 font-medium">File selected:</p>
                      <p className="text-sm text-gray-500">{selectedFile.name}</p>
                      <p className="text-xs text-gray-400">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-lg text-gray-600">
                        {isDragActive
                          ? 'Drop the file here...'
                          : 'Drag & drop a file here, or click to select'}
                      </p>
                      <p className="text-sm text-gray-400 mt-2">
                        Supports PDF, DOCX, XLSX, PPTX, HWP, HWPX (max 50MB)
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Options */}
              <div className="grid sm:grid-cols-3 gap-4 mt-6">
                <label className="flex items-center gap-2 text-sm text-gray-700 border rounded-md p-3">
                  <input type="checkbox" checked={extractImages} onChange={e => setExtractImages(e.target.checked)} />
                  Extract images
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-center space-x-4 mt-6">
                {selectedFile && (
                  <button
                    onClick={resetForm}
                    className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={handleConvert}
                  disabled={!selectedFile || isConverting}
                  className={`px-8 py-2 rounded-md font-medium transition-colors shadow ${
                    !selectedFile || isConverting
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isConverting ? (
                    <span className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Converting...
                    </span>
                  ) : (
                    'Convert to Markdown'
                  )}
                </button>
              </div>

              {/* Error Display */}
              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">
                        Conversion Error
                      </h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p>{error}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Success Result */
            <div className="space-y-6">
              <div className="mx-auto w-16 h-16 text-green-500">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  Conversion Successful!
                </h2>
                <p className="text-gray-600">
                  Your file has been converted to Markdown format
                  {result.hasImages && ' with extracted images'}.
                </p>
              </div>

              <div className="space-y-6">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">File Conversion Details</h3>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p><strong>File:</strong> {result.filename}</p>
                    <p><strong>Output:</strong> {result.hasImages ? 'ZIP (Markdown + Images)' : 'Markdown'}</p>
                    <p><strong>Images:</strong> {result.imageCount ?? (result.hasImages ? 'yes' : 'no')}</p>
                    <p><strong>Charts:</strong> {result.chartCount ?? 0}</p>
                    {result.stats && (
                      <>
                        <p><strong>Input size:</strong> {prettyBytes(result.stats.inputBytes)}</p>
                        <p><strong>Markdown size:</strong> {prettyBytes(result.stats.markdownBytes)}</p>
                        <p><strong>Compression ratio:</strong> {result.stats.compressionRatio ?? '-'}</p>
                      </>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900">Markdown Preview</h3>
                    <button
                      onClick={handleDownload}
                      className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                    >
                      Download {result.hasImages ? 'ZIP' : 'Markdown'}
                    </button>
                  </div>
                  <div className="prose max-w-none text-left bg-white rounded-md p-4 border max-h-[60vh] overflow-auto">
                    <ErrorBoundary
                      fallback={
                        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                          <div className="flex items-center">
                            <svg className="w-5 h-5 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            <p className="text-sm text-yellow-800">
                              Error rendering markdown preview. The file was converted successfully, but some content cannot be displayed.
                            </p>
                          </div>
                          <div className="mt-2">
                            <button
                              onClick={handleDownload}
                              className="text-sm bg-yellow-600 text-white px-3 py-1 rounded hover:bg-yellow-700"
                            >
                              Download Markdown File
                            </button>
                          </div>
                        </div>
                      }
                    >
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                         img: ({...props }) => (
                           // eslint-disable-next-line @next/next/no-img-element
                           <img
                             src={props.src as string}
                             style={{ maxWidth: '100%', height: 'auto', marginBottom: '1rem' }}
                             onError={(e) => {
                               (e.target as HTMLImageElement).style.display = 'none';
                             }}
                             alt={props.alt || 'Image from Markdown conversion'}
                           />
                         )
                        }}
                      >
                        {result.markdown || ''}
                      </ReactMarkdown>
                    </ErrorBoundary>
                  </div>
                </div>
              </div>

              <div className="flex justify-center space-x-4">
                <button
                  onClick={resetForm}
                  className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Convert Another File
                </button>
                <button
                  onClick={handleDownload}
                  className="px-8 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
                >
                  Download {result.hasImages ? 'ZIP' : 'Markdown'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Supported Formats Info */}
        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Supported Formats</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { name: 'PDF', desc: 'Portable Document Format', icon: '📄' },
              { name: 'DOCX', desc: 'Microsoft Word Document', icon: '📝' },
              { name: 'XLSX', desc: 'Microsoft Excel Spreadsheet', icon: '📊' },
              { name: 'PPTX', desc: 'Microsoft PowerPoint Presentation', icon: '📽️' },
              { name: 'HWP', desc: 'Hangul Word Processor', icon: '🇰🇷' },
              { name: 'HWPX', desc: 'Hangul Word Processor XML', icon: '📋' }
            ].map(format => (
              <div key={format.name} className="text-center p-3 border rounded-lg">
                <div className="text-2xl mb-2">{format.icon}</div>
                <div className="font-medium text-gray-900">{format.name}</div>
                <div className="text-xs text-gray-500">{format.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}