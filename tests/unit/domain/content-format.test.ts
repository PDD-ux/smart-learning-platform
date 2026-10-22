import { describe, expect, it } from 'vitest';

import {
  ContentFormatLimits,
  defaultTitleFromFileName,
  formatFromFileName,
  validateUpload,
} from '@/lib/domain/content-format';

/**
 * 内容格式校验 单测（tasks.md §3.2）
 */

describe('formatFromFileName', () => {
  it('normalizes extension to upper case', () => {
    expect(formatFromFileName('lesson.mp4')).toBe('MP4');
    expect(formatFromFileName('notes.MD')).toBe('MD');
  });

  it('maps jpg to JPEG', () => {
    expect(formatFromFileName('scan.jpg')).toBe('JPEG');
    expect(formatFromFileName('scan.JPEG')).toBe('JPEG');
  });

  it('returns null when there is no extension', () => {
    expect(formatFromFileName('noext')).toBeNull();
    expect(formatFromFileName('')).toBeNull();
  });
});

describe('validateUpload', () => {
  it('accepts a valid video', () => {
    const result = validateUpload('video', 'lecture.mp4', 1024);
    expect(result).toMatchObject({ ok: true, contentType: 'video', format: 'MP4' });
  });

  it('accepts a valid document', () => {
    expect(validateUpload('document', 'handout.pdf', 2048).ok).toBe(true);
    expect(validateUpload('document', 'scan.jpeg', 2048).ok).toBe(true);
  });

  it('rejects an unsupported extension', () => {
    expect(validateUpload('video', 'clip.avi', 1024)).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_FORMAT',
    });
    expect(validateUpload('document', 'book.doc', 1024)).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_FORMAT',
    });
  });

  it('rejects a file over the type limit', () => {
    const overVideo = ContentFormatLimits.video.maxBytes + 1;
    expect(validateUpload('video', 'huge.mp4', overVideo)).toEqual({
      ok: false,
      reason: 'FILE_TOO_LARGE',
    });
    const overDoc = ContentFormatLimits.document.maxBytes + 1;
    expect(validateUpload('document', 'huge.pdf', overDoc)).toEqual({
      ok: false,
      reason: 'FILE_TOO_LARGE',
    });
  });

  it('accepts a file exactly at the limit', () => {
    expect(validateUpload('video', 'exact.mp4', ContentFormatLimits.video.maxBytes).ok).toBe(true);
  });
});

describe('defaultTitleFromFileName', () => {
  it('strips the extension', () => {
    expect(defaultTitleFromFileName('第 1 讲.mp4')).toBe('第 1 讲');
  });

  it('truncates to 100 chars', () => {
    const long = `${'a'.repeat(150)}.pdf`;
    expect(defaultTitleFromFileName(long).length).toBe(100);
  });

  it('falls back to a placeholder for empty names', () => {
    expect(defaultTitleFromFileName('.pdf')).toBe('未命名内容');
  });
});
