import { describe, expect, it, vi } from 'vitest';
import { createBilibiliClient } from '../../src/video/bilibili/client';

describe('Bilibili client', () => {
  it('normalizes public metadata and reports unavailable subtitles without fabrication', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/x/web-interface/view')) {
        return new Response(JSON.stringify({
          code: 0,
          message: 'OK',
          data: {
            bvid: 'BV1fixture',
            title: 'Fixture lesson',
            owner: { name: 'Teacher' },
            duration: 120,
            desc: 'A controlled lesson fixture.',
            aid: 123,
            cid: 456,
            pages: [{ cid: 456, page: 1, part: 'Basics', duration: 120 }],
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }), { status: 200 });
    });

    const result = await createBilibiliClient(fetchMock).fetchMaterial('BV1fixture');
    expect(result.metadata).toMatchObject({ bvid: 'BV1fixture', title: 'Fixture lesson', duration_seconds: 120 });
    expect(result.subtitleTracks).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'SUBTITLE_UNAVAILABLE', message: 'No public timestamped subtitle track was available.' }]);
  });

  it('rejects values that are not BVIDs', async () => {
    await expect(createBilibiliClient(vi.fn<typeof fetch>()).fetchMaterial('not-a-bvid')).rejects.toThrow('BVID');
  });
});
